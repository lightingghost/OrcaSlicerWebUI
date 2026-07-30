"""
POST /api/arrange — computes real native-accurate object placement for the
Prepare tab's "Arrange" button by invoking the actual OrcaSlicer CLI (the
same binary jobs.py's slice/export jobs use), instead of the browser's own
simplified JS approximation (frontend/src/lib/arrangePacking.ts).

Why this endpoint exists: the WebUI's Arrange button used to run its own
hand-ported approximation of native's arrange scoring function entirely in
the browser, purely as a Three.js transform — that result was never sent to
the backend. Separately, cli_builder.py always passes a bare `--arrange=N`
flag (no per-object coordinates) for slice/export jobs, so the CLI
re-arranges raw STL/OBJ/AMF uploads using its OWN real arrangement (a
libnest2d NFP nester — see libslic3r/Arrange.cpp) every time a slice job
runs, completely ignoring whatever the browser's approximation displayed.
That's why clicking Arrange in Prepare showed different object positions
than what Slice → Preview later showed.

The fix: call the CLI to compute arrangement ONLY (no --slice — see
`_build_arrange_cli_args` below for why `--export-3mf` without `--slice`
never calls `print->process()`), then parse the resulting 3mf for the
arranged positions (see arrange_3mf.py) and return them to the frontend to
apply directly to the Three.js scene. This makes Prepare's Arrange produce
the exact same layout Slice will use, since it's the exact same code
computing it.

Runs synchronously (not through JobManager's queue) since arranging a
handful of objects is fast (typically well under a second, confirmed by
manual testing of the real CLI) and the UI needs the result immediately to
update the viewport — unlike slice jobs, which can take minutes and need
the queue/progress-socket machinery.

Instance identity: each plate object is identified by an opaque
`instance_id` (the frontend's per-plate-entry id, i.e. `UploadedFile.file_id`
in fileSlice.ts — which is unique per plate object even for clones, unlike
`source_file_id` which multiple clones share). This distinction matters
because the CLI's 3mf output reports each object's `source_file` as the
basename of whatever path was passed as input — if two cloned instances'
shared underlying file were passed to the CLI directly (twice, using its
real stored path), both resulting objects would report the SAME
`source_file` and there would be no way to tell which arranged position
belongs to which clone (confirmed by direct testing). To avoid that, each
plate instance gets its own uniquely-named symlink (named after its
instance_id, not the shared file) before invoking the CLI — confirmed by
direct testing that the CLI's reported `source_file` tracks the symlink's
own name, not the file it points to.
"""

import asyncio
import logging
import os
import tempfile
from pathlib import Path

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.arrange_3mf import parse_arranged_3mf
from app.auth import verify_token
from app.cli_builder import _resolve_profile_path_for_cli
from app.config import settings
from app.database import get_db
from app.job_manager import _build_subprocess_env

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])

# Arranging a small number of objects should complete in well under a
# second (confirmed by manual testing of the actual CLI); this timeout is
# generous headroom for a slower machine or a plate with many objects
# without leaving a broken UI request hanging indefinitely if the CLI
# itself hangs for an unrelated reason.
ARRANGE_TIMEOUT_SECONDS = 60


class PlateInstanceModel(BaseModel):
    """
    One object instance currently on the plate.

    `instance_id` is an opaque, per-plate-object identifier supplied by
    the frontend (its own `UploadedFile.file_id` from fileSlice.ts — note
    this is NOT necessarily a real uploaded file_id for clones; clones
    reuse `source_file_id` for the actual backend file while getting
    their own synthetic id for exactly this kind of per-instance
    identity — see fileSlice.ts's doc comment on `source_file_id`).
    `file_id` is the real uploaded file's id (`source_file_id` for
    clones), used to look up the on-disk geometry to arrange.
    """

    model_config = ConfigDict(strict=True)

    instance_id: str
    file_id: str


class ArrangeRequestModel(BaseModel):
    """Request body for POST /api/arrange."""

    model_config = ConfigDict(strict=True)

    instances: list[PlateInstanceModel] = Field(
        min_length=1, description="Every object instance currently on the plate"
    )
    printer_profile_path: str = Field(max_length=512, description="Relative path under resources/profiles/")
    # Arrangement itself only depends on bed shape/size (from the printer
    # profile) — filament profiles are irrelevant to placement and
    # deliberately not required here (unlike a real slice job). A process
    # profile, however, IS required: confirmed by direct CLI testing that
    # omitting --load-settings's process entry entirely makes even a
    # plain --arrange=1 --export-3mf (no --slice) invocation fail with
    # CLI_PROCESS_NOT_COMPATIBLE (exit -17) — OrcaSlicer.cpp runs a
    # printer/process compatibility check unconditionally for every
    # invocation, before the arrange-vs-slice branch is ever reached, and
    # rejects the request if there is no process preset at all to check
    # compatibility against (not merely if it's incompatible). The
    # process profile's actual settings have no bearing on arrangement,
    # so any compatible process the user has selected works.
    process_profile_path: str = Field(max_length=512, description="Relative path under resources/profiles/")
    spacing_mm: float = Field(0.0, ge=0.0)
    enable_rotation: bool = False
    align_to_y_axis: bool = False


class ArrangedInstanceModel(BaseModel):
    """One object instance's arranged placement, in bed-absolute mm."""

    instance_id: str
    x: float
    y: float
    rotation_z_deg: float


class ArrangeResponseModel(BaseModel):
    instances: list[ArrangedInstanceModel]


async def _lookup_file_paths(
    db: aiosqlite.Connection, file_ids: set[str], session_id: str
) -> dict[str, Path]:
    """Resolve each distinct file_id to its on-disk storage path, or 422 on any miss."""
    file_paths: dict[str, Path] = {}
    for file_id in file_ids:
        cursor = await db.execute(
            "SELECT storage_path FROM files WHERE file_id = ? AND session_id = ?",
            (file_id, session_id),
        )
        row = await cursor.fetchone()
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"File not found: {file_id}",
            )
        file_paths[file_id] = Path(row[0])
    return file_paths


def _build_arrange_cli_args(
    instance_input_paths: list[Path],
    printer_profile_path: Path,
    process_profile_path: Path,
    output_3mf_filename: str,
    output_dir: Path,
    enable_rotation: bool,
) -> list[str]:
    """
    Build the CLI invocation that computes arrangement WITHOUT slicing.

    The key is passing `--export-3mf` without `--slice`: OrcaSlicer.cpp's
    `sliced_plate` variable defaults to -1 and is only ever set inside the
    `opt_key == "slice"` branch, and `print->process()` (the actual
    slicing work) is only ever called from inside that same branch —
    confirmed both by reading OrcaSlicer.cpp directly and by manually
    invoking the real CLI binary this way (see the module doc comment
    above and arrange_3mf.py's doc comment for the full trace). `--arrange
    =1` forces the arrange pass to run even though the inputs are raw
    STL/OBJ/AMF files (which would default to `need_arrange=true` anyway
    — see OrcaSlicer.cpp's `need_arrange` initialization — but being
    explicit here avoids relying on that default).

    Both the printer AND process profiles are loaded via --load-settings.
    Arrangement itself only depends on bed shape/size (the printer
    profile), but the process profile must still be present or the CLI
    fails validation before ever reaching the arrange-vs-slice branch —
    see ArrangeRequestModel.process_profile_path's doc comment for the
    confirmed root cause (CLI_PROCESS_NOT_COMPATIBLE, exit -17, when no
    process preset is loaded at all).

    Native's --allow-rotations CLI flag maps to enable_rotation; spacing
    and align_to_y_axis have no CLI-exposed equivalent (they come from
    GLCanvas3D::ArrangeSettings, a desktop-GUI-only struct — see
    ArrangeSettingsPanel.tsx's doc comment) so they aren't passed through
    here. This is a deliberate trade: getting positions that exactly
    match what Slice will actually use is more valuable than the
    approximate support the old browser-side implementation gave those
    two settings.
    """
    args: list[str] = [str(settings.orca_cli_path)]
    args.extend(str(p) for p in instance_input_paths)
    args.extend(["--load-settings", f"{printer_profile_path};{process_profile_path}"])
    args.append("--arrange=1")
    if enable_rotation:
        args.append("--allow-rotations")
    args.extend(["--export-3mf", output_3mf_filename])
    args.extend(["--outputdir", str(output_dir)])
    return args


async def _run_arrange_cli(
    instances: list[PlateInstanceModel],
    file_paths_by_file_id: dict[str, Path],
    printer_path: Path,
    process_path: Path,
    enable_rotation: bool,
    symlink_dir: Path,
) -> list:
    """
    Run the arrange-only CLI invocation and parse its output 3mf.

    Creates one uniquely-named symlink per plate instance (named after
    its instance_id, preserving the real file's extension) inside
    symlink_dir, so the CLI's reported `source_file` in the output 3mf
    disambiguates every instance even when several instances share the
    same underlying uploaded file (clones) — see the module doc comment
    for the full rationale and confirmation.
    """
    instance_input_paths: list[Path] = []
    source_file_to_instance_id: dict[str, str] = {}

    for instance in instances:
        real_path = file_paths_by_file_id[instance.file_id]
        symlink_name = f"{instance.instance_id}{real_path.suffix}"
        symlink_path = symlink_dir / symlink_name
        os.symlink(real_path, symlink_path)
        instance_input_paths.append(symlink_path)
        source_file_to_instance_id[symlink_name] = instance.instance_id

    with tempfile.TemporaryDirectory(prefix="arrange_out_") as tmp_dir_str:
        output_dir = Path(tmp_dir_str)
        output_3mf_filename = "arranged.3mf"
        output_3mf_path = output_dir / output_3mf_filename

        cli_args = _build_arrange_cli_args(
            instance_input_paths=instance_input_paths,
            printer_profile_path=printer_path,
            process_profile_path=process_path,
            output_3mf_filename=output_3mf_filename,
            output_dir=output_dir,
            enable_rotation=enable_rotation,
        )

        logger.info("Running arrange-only CLI invocation: %s", cli_args)

        try:
            async with asyncio.timeout(ARRANGE_TIMEOUT_SECONDS):
                process = await asyncio.create_subprocess_exec(
                    *cli_args,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    cwd=str(output_dir),
                    env=_build_subprocess_env(settings.orca_cli_path),
                )
                stdout_bytes, _ = await process.communicate()
                exit_code = process.returncode
        except asyncio.TimeoutError:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=f"Arrange CLI invocation exceeded {ARRANGE_TIMEOUT_SECONDS}s",
            )

        if exit_code != 0 or not output_3mf_path.exists():
            output_text = stdout_bytes.decode("utf-8", errors="replace")
            logger.error("Arrange CLI failed (exit %s): %s", exit_code, output_text)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Arrange failed (CLI exit code {exit_code})",
            )

        try:
            return parse_arranged_3mf(output_3mf_path, source_file_to_instance_id)
        except Exception as e:
            logger.error("Failed to parse arranged 3mf: %s", e, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to parse arrange result: {e}",
            )


@router.post("/arrange", response_model=ArrangeResponseModel)
async def arrange_objects(
    arrange_request: ArrangeRequestModel,
    session_id: str = "default",
    db: aiosqlite.Connection = Depends(get_db),
) -> ArrangeResponseModel:
    """
    Compute real native-accurate arrangement for the given plate instances
    using the actual OrcaSlicer CLI, and return each instance's arranged
    X/Y (bed-absolute mm) and Z rotation (degrees).

    Args:
        arrange_request: every object instance currently on the plate,
            the selected printer profile (for bed shape), the selected
            process profile (required by the CLI — see
            ArrangeRequestModel.process_profile_path's doc comment), and
            the arrange settings from ArrangeSettingsPanel.
        session_id: session identifier for file resolution.
        db: database connection.

    Returns:
        One ArrangedInstanceModel per input plate instance.

    Raises:
        HTTPException 422: a file_id or profile path couldn't be resolved.
        HTTPException 500: the CLI failed or its output couldn't be parsed.
        HTTPException 504: the CLI didn't finish within the timeout.
    """
    distinct_file_ids = {inst.file_id for inst in arrange_request.instances}
    file_paths_by_file_id = await _lookup_file_paths(db, distinct_file_ids, session_id)

    profiles_root = settings.profiles_root

    def _check_profile_exists(path_str: str, user_config_dir: Path, label: str) -> None:
        """Validate a profile path against BOTH allowed roots (system
        profiles under profiles_root, or a user-saved config under the
        matching USER_WORKSPACE category dir) — see printer_config.py's
        ConfigEntry.path doc comment for why both are plain absolute
        paths now with no "user:"-style prefix to distinguish them."""
        from app.cli_builder import resolve_and_guard

        raw_path = Path(path_str)
        try:
            full_path = resolve_and_guard(raw_path, profiles_root)
        except ValueError:
            try:
                full_path = resolve_and_guard(raw_path, user_config_dir)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"{label} profile not found: {path_str}",
                )
        if not full_path.exists() or not full_path.is_file():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"{label} profile not found: {path_str}",
            )

    _check_profile_exists(arrange_request.printer_profile_path, settings.printer_configs_dir, "Printer")
    _check_profile_exists(arrange_request.process_profile_path, settings.process_configs_dir, "Process")

    with tempfile.TemporaryDirectory(prefix="arrange_profile_") as profile_tmp_dir_str:
        # Bed shape (`printable_area`) frequently lives on a shared parent
        # profile via `inherits` rather than the leaf profile file itself
        # (e.g. a specific nozzle-size profile inheriting a shared
        # `fdm_*_common` profile) — resolving the inheritance chain here
        # (the same helper cli_builder.py uses for real slice/export jobs)
        # ensures arrangement uses the printer's REAL bed shape rather
        # than silently falling back to whatever default the CLI's own
        # compiled-in PrintConfig defaults happen to be. The process
        # profile is resolved the same way purely so the CLI's mandatory
        # printer/process compatibility check (see
        # ArrangeRequestModel.process_profile_path's doc comment) sees a
        # fully-populated config rather than a leaf file potentially
        # missing inherited keys.
        try:
            printer_path = _resolve_profile_path_for_cli(
                arrange_request.printer_profile_path,
                "machine",
                profiles_root,
                Path(profile_tmp_dir_str),
                user_config_dir=settings.printer_configs_dir,
            )
            process_path = _resolve_profile_path_for_cli(
                arrange_request.process_profile_path,
                "process",
                profiles_root,
                Path(profile_tmp_dir_str),
                user_config_dir=settings.process_configs_dir,
            )
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))

        with tempfile.TemporaryDirectory(prefix="arrange_symlinks_") as symlink_dir_str:
            arranged_instances = await _run_arrange_cli(
                instances=arrange_request.instances,
                file_paths_by_file_id=file_paths_by_file_id,
                printer_path=printer_path,
                process_path=process_path,
                enable_rotation=arrange_request.enable_rotation,
                symlink_dir=Path(symlink_dir_str),
            )

    return ArrangeResponseModel(
        instances=[
            ArrangedInstanceModel(
                instance_id=inst.instance_id,
                x=inst.x,
                y=inst.y,
                rotation_z_deg=inst.rotation_z_deg,
            )
            for inst in arranged_instances
        ]
    )
