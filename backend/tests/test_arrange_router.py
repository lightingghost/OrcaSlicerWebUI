"""
Regression test for POST /api/arrange rejecting a user-saved printer/
process config with a "Path traversal detected ... outside root
<profiles_root>" 422, even though the SAME config resolves fine for a
real slice job.

Root cause: arrange.py's profile-resolution step (right after its own
_check_profile_exists existence check, which DOES correctly check both
the system profiles root and the matching user-config dir) called
`_resolve_profile_path_for_cli` without passing `user_config_dir` at
all — so for a user-saved config (which by definition lives OUTSIDE
profiles_root), `resolve_and_guard(raw_path, profiles_root)` raises
"Path traversal detected ... outside root <profiles_root>", and there is
no second root to fall back to. cli_builder.py's own real slice/export
path (build_cli_args) has always passed `user_config_dir` correctly —
arrange.py's arrange-only path just never wired it through.
"""

from pathlib import Path

import pytest

from app.cli_builder import _resolve_profile_path_for_cli


@pytest.fixture
def profile_dirs(tmp_path):
    profiles_root = tmp_path / "profiles"
    profiles_root.mkdir()
    printer_configs_dir = tmp_path / "user_configs" / "printer"
    printer_configs_dir.mkdir(parents=True)
    process_configs_dir = tmp_path / "user_configs" / "process"
    process_configs_dir.mkdir(parents=True)
    output_dir = tmp_path / "arrange_out"
    output_dir.mkdir()
    return {
        "profiles_root": profiles_root,
        "printer_configs_dir": printer_configs_dir,
        "process_configs_dir": process_configs_dir,
        "output_dir": output_dir,
    }


class TestResolveUserSavedConfigForArrange:
    """
    Exercises _resolve_profile_path_for_cli exactly the way
    routers/arrange.py's arrange_objects endpoint calls it, for a
    user-saved (not system) printer config — the exact scenario from the
    reported bug ("Flashforge Adventurer 5M 0.4 Nozzle - copy.json"
    saved under USER_WORKSPACE/user_configs/printer/).
    """

    def test_resolves_user_saved_printer_config_when_user_config_dir_passed(self, profile_dirs):
        """The FIXED call: passing user_config_dir lets a user-saved
        config resolve successfully instead of raising."""
        user_config_path = profile_dirs["printer_configs_dir"] / "Flashforge Adventurer 5M 0.4 Nozzle - copy.json"
        user_config_path.write_text('{"bed_exclude_area": "1x1"}')

        resolved_path = _resolve_profile_path_for_cli(
            str(user_config_path.resolve()),
            "machine",
            profile_dirs["profiles_root"],
            profile_dirs["output_dir"],
            user_config_dir=profile_dirs["printer_configs_dir"],
        )

        # No `inherits` on this config and no matching vendor profile to
        # resolve against, so _resolve_user_profile_dict falls back to
        # returning the raw (unresolved) file — either way, resolution
        # must succeed rather than raising, which is the actual bug.
        assert resolved_path.exists()

    def test_raises_path_traversal_when_user_config_dir_omitted(self, profile_dirs):
        """The BROKEN call (pre-fix): omitting user_config_dir entirely
        means a user-saved config (which lives outside profiles_root by
        definition) has no root it can resolve against, reproducing the
        exact reported error."""
        user_config_path = profile_dirs["printer_configs_dir"] / "Flashforge Adventurer 5M 0.4 Nozzle - copy.json"
        user_config_path.write_text('{"bed_exclude_area": "1x1"}')

        with pytest.raises(ValueError, match="Path traversal detected"):
            _resolve_profile_path_for_cli(
                str(user_config_path.resolve()),
                "machine",
                profile_dirs["profiles_root"],
                profile_dirs["output_dir"],
                # user_config_dir intentionally omitted — this is the bug.
            )

    def test_resolves_user_saved_process_config_when_user_config_dir_passed(self, profile_dirs):
        """Same fix must apply to the process profile resolution call
        alongside the printer one — arrange.py resolves both."""
        user_config_path = profile_dirs["process_configs_dir"] / "My Process - copy.json"
        user_config_path.write_text('{"layer_height": "0.3"}')

        resolved_path = _resolve_profile_path_for_cli(
            str(user_config_path.resolve()),
            "process",
            profile_dirs["profiles_root"],
            profile_dirs["output_dir"],
            user_config_dir=profile_dirs["process_configs_dir"],
        )

        assert resolved_path.exists()

    def test_system_profile_path_still_resolves_normally(self, profile_dirs):
        """Sanity check: the fix (adding user_config_dir) must not break
        the existing, already-working system-profile resolution path —
        a profile actually under profiles_root should resolve exactly as
        before regardless of whether user_config_dir is also passed."""
        system_profile = profile_dirs["profiles_root"] / "Vendor" / "machine" / "Printer.json"
        system_profile.parent.mkdir(parents=True)
        system_profile.write_text('{"bed_exclude_area": "0x0"}')

        # No vendor index available in this minimal fixture, so
        # _write_resolved_profile's inheritance-chain lookup will raise
        # internally and _resolve_profile_path_for_cli falls back to
        # returning the original (unresolved) path — still a success,
        # not an exception, which is what matters here.
        resolved_path = _resolve_profile_path_for_cli(
            str(system_profile.resolve()),
            "machine",
            profile_dirs["profiles_root"],
            profile_dirs["output_dir"],
            user_config_dir=profile_dirs["printer_configs_dir"],
        )

        assert resolved_path.exists()
