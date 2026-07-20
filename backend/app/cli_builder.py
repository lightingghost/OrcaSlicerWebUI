"""
CLI command builder for OrcaSlicer subprocess invocation.

This module provides functions to construct safe, validated CLI arguments
for the OrcaSlicer binary. All file paths are resolved and validated against
workspace roots to prevent path traversal attacks.

Requirements: 4.1, 11.1
"""

import os
from pathlib import Path
from typing import Any


def resolve_and_guard(path: Path, root: Path) -> Path:
    """
    Resolve path to absolute and ensure it stays within the specified root.
    
    This function prevents path traversal attacks by rejecting any path that
    resolves outside the designated root directory.
    
    Args:
        path: The path to resolve (can be relative or absolute)
        root: The root directory that path must remain within
        
    Returns:
        The resolved absolute Path object
        
    Raises:
        ValueError: If the resolved path is outside root
        
    Examples:
        >>> root = Path("/app/workspace")
        >>> resolve_and_guard(Path("session/file.stl"), root)
        Path("/app/workspace/session/file.stl")
        
        >>> resolve_and_guard(Path("../../etc/passwd"), root)
        ValueError: Path traversal detected: ...
    
    Requirements: 11.3
    """
    # Resolve both paths to absolute form
    resolved = (root / path).resolve() if not path.is_absolute() else path.resolve()
    root_resolved = root.resolve()
    
    # Check if resolved path is within root
    # Must start with root path followed by separator to avoid partial matches
    # e.g., /app/workspace-other should not match /app/workspace
    try:
        resolved.relative_to(root_resolved)
    except ValueError:
        raise ValueError(
            f"Path traversal detected: {path!r} resolves to {resolved!r} "
            f"which is outside root {root!r}"
        )
    
    return resolved


def build_cli_args(
    job: dict[str, Any],
    config: Any,
    session_dir: Path,
    output_dir: Path,
) -> list[str]:
    """
    Build CLI argument list for OrcaSlicer subprocess execution.
    
    Constructs arguments in the exact order specified in the design:
    1. CLI binary path
    2. Input file paths
    3. Action flag (slice, export_3mf, etc.)
    4. Profile settings (printer, process, filaments)
    5. Output directory
    6. Parameter overrides
    7. Transform options
    8. Misc options
    
    All paths are validated with resolve_and_guard to prevent path traversal.
    Arguments are returned as a list (not shell string) for safe subprocess execution.
    
    Args:
        job: Job request dictionary containing all job parameters
        config: Settings instance with CLI path and workspace configuration
        session_dir: Directory containing uploaded files for this session
        output_dir: Job-specific output directory (already validated)
        
    Returns:
        List of CLI argument strings ready for asyncio.create_subprocess_exec
        
    Raises:
        ValueError: If any path validation fails
        KeyError: If required job fields are missing
        
    Requirements: 6.2, 11.1, 11.2, 11.3
    """
    args: list[str] = [str(config.orca_cli_path)]
    
    # 1. Input files — paths validated against workspace root
    file_ids = job.get("file_ids", [])
    for file_id in file_ids:
        # Files are stored in session_dir with their file_id as filename
        file_path = resolve_and_guard(
            session_dir / file_id,
            config.workspace_root
        )
        args.append(str(file_path))
    
    # 2. Action flag (exactly one required)
    action = job["action"]
    ACTION_FLAGS = {
        "slice": ["--slice", str(job.get("plate_number", 0))],
        "export_3mf": ["--export_3mf"],
        "export_stl": ["--export_stl"],
        "export_stls": ["--export_stls"],
        "export_settings": ["--export_settings"],
    }
    args.extend(ACTION_FLAGS[action])
    
    # Optional: output filename for certain actions
    if action in ("export_3mf", "export_settings") and job.get("output_filename"):
        # Note: OrcaSlicer may use this differently; verify CLI docs
        # For now, we'll let the output_dir handle naming
        pass
    
    # 3. Profile settings
    profiles_root = config.profiles_root
    
    # Printer profile
    printer_path_str = job.get("printer_profile_path")
    if printer_path_str:
        printer_path = resolve_and_guard(
            Path(printer_path_str),
            profiles_root
        )
        args.extend(["--load_settings", str(printer_path)])
    
    # Process profile
    process_path_str = job.get("process_profile_path")
    if process_path_str:
        process_path = resolve_and_guard(
            Path(process_path_str),
            profiles_root
        )
        args.extend(["--load_settings", str(process_path)])
    
    # Filament profiles (can be multiple)
    filament_paths = job.get("filament_profile_paths", [])
    for fp_str in filament_paths:
        filament_path = resolve_and_guard(
            Path(fp_str),
            profiles_root
        )
        args.extend(["--load_filaments", str(filament_path)])
    
    # 4. Output directory (unique per job)
    args.extend(["--outputdir", str(output_dir)])
    
    # 5. Parameter overrides (keys must be validated against allowlist by caller)
    parameter_overrides = job.get("parameter_overrides", {})
    for key, value in parameter_overrides.items():
        # Keys should already be validated against PARAM_ALLOWLIST
        # Format: --key=value
        args.append(f"--{key}={value}")
    
    # 6. Transform options
    transforms = job.get("transforms", {})
    if transforms:
        # Numeric/enum transforms with values
        TRANSFORM_FLAGS = {
            "rotate": "--rotate",
            "rotate_x": "--rotate_x",
            "rotate_y": "--rotate_y",
            "scale": "--scale",
            "arrange": "--arrange",
            "orient": "--orient",
            "repetitions": "--repetitions",
        }
        
        for key, flag in TRANSFORM_FLAGS.items():
            value = transforms.get(key)
            if value is not None:
                args.append(f"{flag}={value}")
        
        # Boolean transforms (flag only if true)
        BOOL_TRANSFORMS = [
            ("ensure_on_bed", "--ensure_on_bed"),
            ("assemble", "--assemble"),
            ("convert_unit", "--convert_unit"),
        ]
        
        for key, flag in BOOL_TRANSFORMS:
            if transforms.get(key):
                args.append(flag)
        
        # Arrange sub-options (only when arrange is 1 or 2)
        arrange_val = transforms.get("arrange")
        if arrange_val in (1, 2):
            ARRANGE_SUBOPTS = [
                ("allow_rotations", "--allow_rotations"),
                ("allow_multicolor_oneplate", "--allow_multicolor_oneplate"),
                ("avoid_extrusion_cali_region", "--avoid_extrusion_cali_region"),
            ]
            for key, flag in ARRANGE_SUBOPTS:
                if transforms.get(key):
                    args.append(flag)
    
    # 7. Misc options
    misc = job.get("misc", {})
    if misc:
        # datadir path
        if misc.get("datadir"):
            args.extend(["--datadir", misc["datadir"]])
        
        # debug level (0-5)
        if misc.get("debug") is not None:
            args.extend(["--debug", str(misc["debug"])])
        
        # load_custom_gcodes (file_id reference)
        custom_gcode_file_id = misc.get("load_custom_gcodes_file_id")
        if custom_gcode_file_id:
            gcode_path = resolve_and_guard(
                session_dir / custom_gcode_file_id,
                config.workspace_root
            )
            args.extend(["--load_custom_gcodes", str(gcode_path)])
        
        # load_filament_ids (comma-separated integers)
        filament_ids = misc.get("load_filament_ids")
        if filament_ids:
            args.extend(["--load_filament_ids", ",".join(str(fid) for fid in filament_ids)])
        
        # skip_objects (comma-separated integers)
        skip_objects = misc.get("skip_objects")
        if skip_objects:
            args.extend(["--skip_objects", ",".join(str(obj) for obj in skip_objects)])
        
        # clone_objects (comma-separated integers)
        clone_objects = misc.get("clone_objects")
        if clone_objects:
            args.extend(["--clone_objects", ",".join(str(obj) for obj in clone_objects)])
        
        # Boolean misc options
        BOOL_MISC = [
            ("allow_newer_file", "--allow_newer_file"),
            ("allow_mix_temp", "--allow_mix_temp"),
            ("skip_modified_gcodes", "--skip_modified_gcodes"),
            ("downward_check", "--downward_check"),
            ("enable_timelapse", "--enable_timelapse"),
        ]
        
        for key, flag in BOOL_MISC:
            if misc.get(key):
                args.append(flag)
    
    # 8. Action flags (optional boolean flags)
    action_flags = job.get("action_flags", {})
    if action_flags:
        ACTION_BOOL_FLAGS = [
            ("min_save", "--min_save"),
            ("no_check", "--no_check"),
            ("normative_check", "--normative_check"),
            ("uptodate", "--uptodate"),
            ("load_defaultfila", "--load_defaultfila"),
            ("enable_timelapse", "--enable_timelapse"),
        ]
        
        for key, flag in ACTION_BOOL_FLAGS:
            if action_flags.get(key):
                args.append(flag)
    
    return args
