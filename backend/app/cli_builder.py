"""
CLI command builder for OrcaSlicer subprocess invocation.

This module provides functions to construct safe, validated CLI arguments
for the OrcaSlicer binary. All file paths are resolved and validated against
workspace roots to prevent path traversal attacks.

Requirements: 4.1, 11.1
"""

import json
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


def _load_matching_autosave(
    autosave_dir: Path, name: str, profile_path_str: str
) -> dict[str, Any] | None:
    """
    Load USER_WORKSPACE/autosave/{name}.json (a pending, unsaved diff from
    the Printer/Filament settings dialog — see PrinterConfigDialog.tsx /
    FilamentConfigDialog.tsx) and return it only if its `_profile_path`
    marker matches the profile currently being resolved for this job.

    Returns None if the autosave doesn't exist, can't be parsed, or belongs
    to a different profile than the one being sliced (e.g. a stale autosave
    left over after the user switched to a different printer/filament
    without touching that dialog again) — in every one of those cases the
    caller should fall back to the profile's own on-disk values.

    Strips leading-underscore bookkeeping keys (`_profile_path`) and
    `inherits`, since the latter is only meaningful when the dialog's
    "Save…" flow creates a brand new named profile — it does not belong in
    a resolved config's own inheritance-chain bookkeeping.
    """
    path = autosave_dir / f"{name}.json"
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None
    if not isinstance(data, dict):
        return None

    saved_for = data.get("_profile_path")
    if saved_for is not None and saved_for != profile_path_str:
        return None

    return {
        k: v for k, v in data.items()
        if not k.startswith("_") and k != "inherits"
    }


def _write_resolved_profile(
    manufacturer: str,
    category: str,
    filename: str,
    profiles_root: Path,
    output_dir: Path,
    overlay: dict[str, Any] | None = None,
) -> Path:
    """
    Resolve a profile's full `inherits` chain (via
    `app.routers.profiles.resolve_profile_config`, the same logic backing
    the `/api/profiles/.../resolved` endpoint), optionally overlay a
    pending dialog autosave diff (`overlay` — see `_load_matching_autosave`)
    on top of it, and write the merged, flattened result as a temporary
    JSON file inside the job's own output directory, returning its path.

    The overlay lets Slice pick up in-progress Printer/Filament settings
    dialog edits that were autosaved but never explicitly "Save…"d as a
    new named profile — without it, only edits saved to a new profile
    (and then re-selected) would ever reach the CLI.

    This is necessary because OrcaSlicer's CLI (`OrcaSlicer.cpp`'s
    `load_config_file` lambda, invoked for every `--load-settings`/
    `--load-filaments` entry) loads a SINGLE json file verbatim via
    `config.load_from_json` and never walks the file's own `inherits`
    field — unlike the desktop GUI, which resolves inheritance through its
    in-memory `PresetBundle`. Since real OrcaSlicer profiles routinely
    store only the keys that differ from their parent (e.g. a machine
    profile's `gcode_flavor`, `before_layer_change_gcode`, and
    `printable_area` frequently live entirely in a shared `fdm_*_common`
    parent file), passing an unresolved child profile straight to the CLI
    silently drops those inherited keys — falling back to the CLI's
    compiled-in defaults instead (e.g. `gcode_flavor` defaults to
    `gcfMarlinLegacy`), which can make an otherwise-valid profile fail
    native's own gcode-validity checks (e.g. the "G92 E0" / relative
    extruder addressing check, which only applies to Marlin flavors and
    would never fire for the profile's real Klipper flavor).
    """
    from app.routers.profiles import resolve_profile_config

    resolved = resolve_profile_config(profiles_root, manufacturer, category, filename)

    if overlay:
        resolved = {**resolved, **overlay}

    # Keep the merged file next to the job's other outputs so it's cleaned
    # up automatically with the rest of the job's output directory,
    # matching the retention/cleanup lifecycle every other job artifact
    # already follows (see job_manager.py's output_dir handling).
    resolved_dir = output_dir / "_resolved_profiles"
    resolved_dir.mkdir(parents=True, exist_ok=True)
    resolved_path = resolved_dir / f"{category}_{Path(filename).stem}.json"
    with open(resolved_path, "w", encoding="utf-8") as f:
        json.dump(resolved, f)

    return resolved_path


def _resolve_profile_path_for_cli(
    profile_path_str: str,
    category: str,
    profiles_root: Path,
    output_dir: Path,
    autosave_dir: Path | None = None,
    autosave_name: str | None = None,
) -> Path:
    """
    Given a profile path relative to profiles_root in the shape
    `{manufacturer}/{category}/{filename}` (the shape every profile path
    in this app uses — see profiles.py's directory layout), validate it
    with resolve_and_guard and return the path to a fully inheritance-
    resolved copy suitable for passing to the CLI's --load-settings/
    --load-filaments. Falls back to the original (unresolved) path if the
    profile isn't laid out in the expected manufacturer/category/filename
    shape (e.g. a user-uploaded custom profile with no vendor index to
    resolve `inherits` against), rather than failing the whole job.

    When `autosave_dir`/`autosave_name` are given, also checks for a
    pending Printer/Filament settings dialog autosave for this exact
    profile (see `_load_matching_autosave`) and overlays it on top of the
    resolved config before writing the temp file — so Slice picks up
    in-progress dialog edits without requiring an explicit "Save…" first.
    """
    # Validate the raw path stays within profiles_root first (same guard
    # as before this function existed).
    validated = resolve_and_guard(Path(profile_path_str), profiles_root)

    parts = Path(profile_path_str).parts
    if len(parts) < 3:
        return validated

    manufacturer = parts[0]
    filename = str(Path(*parts[2:]))

    overlay = None
    if autosave_dir is not None and autosave_name is not None:
        overlay = _load_matching_autosave(autosave_dir, autosave_name, profile_path_str)

    try:
        resolved_path = _write_resolved_profile(
            manufacturer, category, filename, profiles_root, output_dir, overlay=overlay
        )
    except Exception:
        # If resolution fails for any reason (missing vendor index,
        # malformed JSON, etc.), fall back to the original file rather
        # than blocking the whole job — the CLI will at least get
        # whatever keys the raw file itself declares.
        return validated

    return resolved_path


def build_cli_args(
    job: dict[str, Any],
    config: Any,
    file_paths: dict[str, Path],
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
        file_paths: Mapping of every file_id referenced by the job (file_ids
            and misc.load_custom_gcodes_file_id) to its actual on-disk
            storage path, as recorded by the upload endpoint in the `files`
            table — NOT derived from a guessed directory shape, since the
            upload endpoint stores files under a session-scoped `uploads/`
            subdirectory with the original extension appended
            ({file_id}.{ext}), which a naive `session_dir / file_id` guess
            would miss entirely.
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
        stored_path = file_paths.get(file_id)
        if stored_path is None:
            raise ValueError(f"File not found: {file_id}")
        file_path = resolve_and_guard(
            stored_path if stored_path.is_absolute() else Path(stored_path),
            config.workspace_root
        )
        args.append(str(file_path))
    
    # 2. Action flag (exactly one required)
    # NOTE: the real OrcaSlicer CLI uses hyphenated flag names throughout
    # (confirmed via `orca-slicer --help`), not the underscored names an
    # earlier version of this module used (which the CLI rejects outright
    # with "setup params error" / unrecognized option).
    action = job["action"]
    ACTION_FLAGS = {
        "slice": ["--slice", str(job.get("plate_number", 0))],
        # --export-3mf and --export-settings take the output filename as
        # their argument value; --export-stl/--export-stls take none (they
        # always write into --outputdir).
        "export_3mf": ["--export-3mf", job.get("output_filename") or "output.3mf"],
        "export_stl": ["--export-stl"],
        "export_stls": ["--export-stls"],
        "export_settings": ["--export-settings", job.get("output_filename") or "output.json"],
    }
    args.extend(ACTION_FLAGS[action])
    
    # 3. Profile settings
    profiles_root = config.profiles_root
    
    # Printer + process profiles are passed together as ONE
    # --load-settings flag with a semicolon-separated file list (per
    # `orca-slicer --help`: `--load-settings "setting1.json;setting2.json"`)
    # — passing --load-settings twice does not accumulate, the second call
    # replaces the first.
    #
    # Each path is first resolved through its `inherits` chain (see
    # `_resolve_profile_path_for_cli`/`_write_resolved_profile` above) since
    # the CLI itself never does this — passing a raw, unresolved profile
    # file silently drops any keys that only exist on a parent profile.
    # `autosave_dir` holds any pending (unsaved) Printer/Filament settings
    # dialog edits (USER_WORKSPACE/autosave/printer_config.json,
    # filament_N.json — see PrinterConfigDialog.tsx/FilamentConfigDialog.tsx).
    # Passing it through lets Slice pick those edits up automatically; note
    # `process_profile_path` deliberately does NOT go through this overlay
    # mechanism — process-panel edits are applied via `parameter_overrides`
    # below instead, which is already live (read directly from in-memory
    # store state, never stale) and would double-apply if overlaid here too.
    autosave_dir = getattr(config, "autosave_dir", None)

    load_settings_paths: list[str] = []
    printer_path_str = job.get("printer_profile_path")
    if printer_path_str:
        printer_path = _resolve_profile_path_for_cli(
            printer_path_str, "machine", profiles_root, output_dir,
            autosave_dir=autosave_dir, autosave_name="printer_config",
        )
        load_settings_paths.append(str(printer_path))
    
    process_path_str = job.get("process_profile_path")
    if process_path_str:
        process_path = _resolve_profile_path_for_cli(
            process_path_str, "process", profiles_root, output_dir
        )
        load_settings_paths.append(str(process_path))
    
    if load_settings_paths:
        args.extend(["--load-settings", ";".join(load_settings_paths)])
    
    # Filament profiles: also ONE --load-filaments flag, semicolon-joined
    # (per `--load-filaments "filament1.json;filament2.json;..."`).
    # Each filament's autosave slot is numbered by its position in this
    # list (filament_1, filament_2, ...), matching FilamentConfigDialog's
    # `filamentIndex` prop and the FilamentRow component that assigns it.
    filament_paths = job.get("filament_profile_paths", [])
    resolved_filament_paths = [
        str(_resolve_profile_path_for_cli(
            fp_str, "filament", profiles_root, output_dir,
            autosave_dir=autosave_dir, autosave_name=f"filament_{idx + 1}",
        ))
        for idx, fp_str in enumerate(filament_paths)
    ]
    if resolved_filament_paths:
        args.extend(["--load-filaments", ";".join(resolved_filament_paths)])
    
    # 4. Output directory (unique per job)
    args.extend(["--outputdir", str(output_dir)])
    
    # 5. Parameter overrides (keys must be validated against allowlist by caller)
    #
    # Every PrintConfig key's CLI flag name is its own key with underscores
    # replaced by dashes (see `ConfigOptionDef::cli_args`,
    # libslic3r/Config.cpp:238-254 — a config option only keeps its literal
    # underscored key as a CLI flag if it explicitly sets a custom `cli`
    # field, which none of this app's overridable parameters do). Passing
    # the raw underscored key (e.g. `--curr_bed_type=...`) is not a
    # recognized flag at all — `DynamicConfig::read_cli` looks it up in a
    # table keyed by the dashed form and rejects anything else outright
    # with "Invalid option --...", failing the whole job (exit code 254,
    # confirmed via direct CLI invocation). This previously meant EVERY
    # parameter override silently never took effect for any multi-word key
    # (e.g. curr_bed_type, seam_position, etc — anything containing "_"),
    # not just bed type.
    parameter_overrides = job.get("parameter_overrides", {})
    for key, value in parameter_overrides.items():
        # Keys should already be validated against PARAM_ALLOWLIST
        cli_flag = key.replace("_", "-")
        args.append(f"--{cli_flag}={value}")
    
    # 6. Transform options
    transforms = job.get("transforms", {})
    if transforms:
        # Numeric/enum transforms with values
        TRANSFORM_FLAGS = {
            "rotate": "--rotate",
            "rotate_x": "--rotate-x",
            "rotate_y": "--rotate-y",
            "scale": "--scale",
            "arrange": "--arrange",
            "orient": "--orient",
            "repetitions": "--repetitions",
        }
        
        # --rotate / --rotate-x / --rotate-y crash this CLI build with a
        # segfault regardless of the value passed (confirmed by direct
        # invocation: `--rotate=0.0` and `--rotate-x=0.0 --rotate-y=0.0`
        # both dump core, while every other transform flag combination is
        # fine). Since a 0-degree rotation is a no-op anyway, skip emitting
        # these three flags whenever the value is exactly 0 — the common
        # default case — to avoid tripping the crash while still passing
        # the flag through for any genuinely non-zero rotation the user
        # requests (which the caller should be aware may crash this
        # particular CLI build).
        ZERO_SKIPPABLE_ROTATION_KEYS = {"rotate", "rotate_x", "rotate_y"}
        
        for key, flag in TRANSFORM_FLAGS.items():
            value = transforms.get(key)
            if value is None:
                continue
            if key in ZERO_SKIPPABLE_ROTATION_KEYS:
                try:
                    if float(value) == 0:
                        continue
                except (TypeError, ValueError):
                    # Not a real numeric value (should be rejected upstream
                    # by JobRequestModel's strict float typing) — fall
                    # through and pass it along unchanged rather than
                    # silently dropping a malformed value.
                    pass
            args.append(f"{flag}={value}")
        
        # Boolean transforms (flag only if true)
        BOOL_TRANSFORMS = [
            ("ensure_on_bed", "--ensure-on-bed"),
            ("assemble", "--assemble"),
            ("convert_unit", "--convert-unit"),
        ]
        
        for key, flag in BOOL_TRANSFORMS:
            if transforms.get(key):
                args.append(flag)
        
        # Arrange sub-options (only when arrange is 1 or 2)
        arrange_val = transforms.get("arrange")
        if arrange_val in (1, 2):
            ARRANGE_SUBOPTS = [
                ("allow_rotations", "--allow-rotations"),
                ("allow_multicolor_oneplate", "--allow-multicolor-oneplate"),
                ("avoid_extrusion_cali_region", "--avoid-extrusion-cali-region"),
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
            stored_gcode_path = file_paths.get(custom_gcode_file_id)
            if stored_gcode_path is None:
                raise ValueError(f"File not found: {custom_gcode_file_id}")
            gcode_path = resolve_and_guard(
                stored_gcode_path if stored_gcode_path.is_absolute() else Path(stored_gcode_path),
                config.workspace_root
            )
            args.extend(["--load-custom-gcodes", str(gcode_path)])
        
        # load_filament_ids (comma-separated integers)
        filament_ids = misc.get("load_filament_ids")
        if filament_ids:
            args.extend(["--load-filament-ids", ",".join(str(fid) for fid in filament_ids)])
        
        # skip_objects (comma-separated integers)
        skip_objects = misc.get("skip_objects")
        if skip_objects:
            args.extend(["--skip-objects", ",".join(str(obj) for obj in skip_objects)])
        
        # clone_objects (comma-separated integers)
        clone_objects = misc.get("clone_objects")
        if clone_objects:
            args.extend(["--clone-objects", ",".join(str(obj) for obj in clone_objects)])
        
        # Boolean misc options
        BOOL_MISC = [
            ("allow_newer_file", "--allow-newer-file"),
            ("allow_mix_temp", "--allow-mix-temp"),
            ("skip_modified_gcodes", "--skip-modified-gcodes"),
            ("downward_check", "--downward-check"),
            ("enable_timelapse", "--enable-timelapse"),
        ]
        
        for key, flag in BOOL_MISC:
            if misc.get(key):
                args.append(flag)
    
    # 8. Action flags (optional boolean flags)
    action_flags = job.get("action_flags", {})
    if action_flags:
        ACTION_BOOL_FLAGS = [
            ("min_save", "--min-save"),
            ("no_check", "--no-check"),
            ("normative_check", "--normative-check"),
            ("uptodate", "--uptodate"),
            ("load_defaultfila", "--load-defaultfila"),
            ("enable_timelapse", "--enable-timelapse"),
        ]
        
        for key, flag in ACTION_BOOL_FLAGS:
            if action_flags.get(key):
                args.append(flag)
    
    return args
