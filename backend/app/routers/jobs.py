"""
Job submission and management API endpoints.

Handles job submission, listing, status retrieval, cancellation, and output file access.

Requirements: 6.1, 6.5, 6.7, 7.4, 9.1, 9.2, 9.3, 9.4, 11.1, 11.4
"""

import base64
import json
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Literal, Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.auth import verify_token
from app.cli_builder import resolve_and_guard
from app.config import settings
from app.database import get_db
from app.routers.parameters import get_param_allowlist


router = APIRouter(dependencies=[Depends(verify_token)])


# Request models using Pydantic v2 strict validation

class TransformOptions(BaseModel):
    """Transform options for geometric operations on models."""
    
    model_config = ConfigDict(strict=True)
    
    rotate: Optional[float] = None  # Z-axis degrees
    rotate_x: Optional[float] = None
    rotate_y: Optional[float] = None
    scale: Optional[float] = None  # scale factor
    arrange: Optional[Literal[0, 1, 2]] = None
    orient: Optional[Literal[0, 1, 2]] = None
    repetitions: Optional[int] = Field(None, ge=1)
    ensure_on_bed: Optional[bool] = None
    assemble: Optional[bool] = None
    convert_unit: Optional[bool] = None
    # Arrange sub-options (only when arrange == 1 or 2)
    allow_rotations: Optional[bool] = None
    allow_multicolor_oneplate: Optional[bool] = None
    avoid_extrusion_cali_region: Optional[bool] = None


class MiscOptions(BaseModel):
    """Miscellaneous CLI options for advanced workflows."""
    
    model_config = ConfigDict(strict=True)
    
    datadir: Optional[str] = None
    debug: Optional[Literal[0, 1, 2, 3, 4, 5]] = None
    load_custom_gcodes_file_id: Optional[str] = Field(None, pattern=r'^[0-9a-f-]{36}$')  # UUID format
    load_filament_ids: Optional[list[int]] = None
    skip_objects: Optional[list[int]] = None
    clone_objects: Optional[list[int]] = None
    allow_newer_file: Optional[bool] = None
    allow_mix_temp: Optional[bool] = None
    skip_modified_gcodes: Optional[bool] = None
    downward_check: Optional[bool] = None
    enable_timelapse: Optional[bool] = None


class ActionFlags(BaseModel):
    """Boolean action flags for CLI behavior."""
    
    model_config = ConfigDict(strict=True)
    
    min_save: Optional[bool] = None
    no_check: Optional[bool] = None
    normative_check: Optional[bool] = None
    uptodate: Optional[bool] = None
    load_defaultfila: Optional[bool] = None
    enable_timelapse: Optional[bool] = None


class JobRequestModel(BaseModel):
    """
    Job request model with strict Pydantic v2 validation.
    
    All fields are validated for type correctness and format before
    any CLI construction or execution occurs.
    """
    
    model_config = ConfigDict(strict=True)
    
    # Files (at least one required)
    file_ids: list[str] = Field(min_length=1, description="One or more uploaded file IDs (UUIDs)")
    
    # Profiles (all required)
    # Native OrcaSlicer profile filenames commonly include '@' (e.g.
    # "Generic ABS @Z-Bolt 0.4 nozzle.json"), and some also use '(', ')',
    # '+' (e.g. vendor/variant annotations). The actual path-traversal
    # defense is resolve_and_guard's containment check in cli_builder.py —
    # this pattern is just a coarse charset allowlist, so it must include
    # every character real profile filenames use or every non-generic
    # printer/process/filament selection gets rejected with a 422.
    printer_profile_path: str = Field(max_length=512, pattern=r'^[\w\-. /@()+]+$', description="Relative path under resources/profiles/")
    process_profile_path: str = Field(max_length=512, pattern=r'^[\w\-. /@()+]+$', description="Relative path under resources/profiles/")
    filament_profile_paths: list[str] = Field(min_length=1, description="One or more filament profile paths")
    
    # Action (exactly one required)
    action: Literal["slice", "export_3mf", "export_stl", "export_stls", "export_settings"]
    plate_number: Optional[int] = Field(None, ge=0, description="For slice: 0=all, >=1 specific plate")
    output_filename: Optional[str] = Field(None, max_length=256, description="For export_3mf / export_settings")
    
    # Parameter overrides (validated against allowlist)
    parameter_overrides: dict[str, str | int | float | bool] = Field(default_factory=dict)
    
    # Transform options
    transforms: Optional[TransformOptions] = None
    
    # Misc options
    misc: Optional[MiscOptions] = None
    
    # Action flags
    action_flags: Optional[ActionFlags] = None
    
    @field_validator("file_ids")
    @classmethod
    def validate_file_ids(cls, v: list[str]) -> list[str]:
        """Validate that all file_ids are UUID format."""
        uuid_pattern = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.IGNORECASE)
        for file_id in v:
            if not uuid_pattern.match(file_id):
                raise ValueError(f"Invalid file_id format: {file_id}. Must be a valid UUID.")
        return v
    
    @field_validator("filament_profile_paths")
    @classmethod
    def validate_filament_paths(cls, v: list[str]) -> list[str]:
        """Validate filament profile path format (see printer_profile_path's
        pattern comment above for why '@()+' must be allowed)."""
        for path in v:
            if len(path) > 512:
                raise ValueError(f"Filament profile path too long: {path}")
            if not re.match(r'^[\w\-. /@()+]+$', path):
                raise ValueError(f"Invalid filament profile path format: {path}")
        return v


@router.get("/jobs")
async def list_jobs(
    session_id: str = "default",  # TODO: integrate with session management
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: aiosqlite.Connection = Depends(get_db),
):
    """
    List jobs for a session with pagination.
    
    Returns a paginated list of jobs ordered by submission time (newest first).
    Each job summary includes job_id, status, submitted_at, started_at,
    completed_at, and action_type.
    
    Args:
        session_id: Session identifier to filter jobs
        limit: Maximum number of jobs to return (1-100, default 50)
        offset: Number of jobs to skip (default 0)
        db: Database connection
        
    Returns:
        JSON object containing:
        - jobs: Array of job summary objects
        - total: Total number of jobs for the session
        - limit: The limit used
        - offset: The offset used
        
    Requirements: 9.1, 9.2
    """
    # Get total count of jobs for the session
    cursor = await db.execute(
        """
        SELECT COUNT(*)
        FROM jobs
        WHERE session_id = ?
        """,
        (session_id,),
    )
    row = await cursor.fetchone()
    total = row[0] if row else 0
    
    # Fetch paginated jobs, ordered by newest first
    cursor = await db.execute(
        """
        SELECT
            job_id,
            status,
            submitted_at,
            started_at,
            completed_at,
            action_type
        FROM jobs
        WHERE session_id = ?
        ORDER BY submitted_at DESC
        LIMIT ? OFFSET ?
        """,
        (session_id, limit, offset),
    )
    rows = await cursor.fetchall()
    
    # Convert rows to list of dictionaries
    jobs = [
        {
            "job_id": row[0],
            "status": row[1],
            "submitted_at": row[2],
            "started_at": row[3],
            "completed_at": row[4],
            "action_type": row[5],
        }
        for row in rows
    ]
    
    return {
        "jobs": jobs,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/jobs")
async def submit_job(
    job_request: JobRequestModel,
    request: Request,
    session_id: str = "default",  # TODO: integrate with session management
    db: aiosqlite.Connection = Depends(get_db),
):
    """
    Submit a job for execution.
    
    Validates the job request with Pydantic v2 strict mode, resolves all file IDs
    from the database, validates all parameter keys against PARAM_ALLOWLIST,
    enqueues the job, persists an initial 'queued' record, and returns the job_id
    and status.
    
    Args:
        job_request: Validated job request model
        request: FastAPI Request object to access app state
        session_id: Session identifier for file resolution
        db: Database connection
        
    Returns:
        JSON object containing:
        - job_id: The newly created job identifier (UUID)
        - status: Initial job status ("queued")
        
    Raises:
        HTTPException 422: Invalid parameter key, file not found, or validation failure
        HTTPException 500: Internal error during job creation
        
    Requirements: 6.1, 11.1, 11.4
    """
    # Step 1: Validate all parameter override keys against PARAM_ALLOWLIST
    param_allowlist = get_param_allowlist()
    
    for param_key in job_request.parameter_overrides.keys():
        if param_key not in param_allowlist:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Unknown parameter key: '{param_key}'. Not in parameter allowlist.",
            )
    
    # Step 2: Resolve all file IDs from database and verify they exist
    file_validation_errors = []
    
    for file_id in job_request.file_ids:
        cursor = await db.execute(
            "SELECT file_id FROM files WHERE file_id = ? AND session_id = ?",
            (file_id, session_id),
        )
        row = await cursor.fetchone()
        
        if row is None:
            file_validation_errors.append(f"File not found: {file_id}")
    
    if file_validation_errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": "One or more file IDs not found",
                "errors": file_validation_errors,
            },
        )
    
    # Step 3: Validate profile paths exist on disk
    profiles_root = settings.profiles_root
    
    profile_paths_to_check = [
        ("printer_profile_path", job_request.printer_profile_path),
        ("process_profile_path", job_request.process_profile_path),
    ] + [
        ("filament_profile_path", fp) for fp in job_request.filament_profile_paths
    ]
    
    profile_validation_errors = []
    
    for field_name, profile_path in profile_paths_to_check:
        full_path = profiles_root / profile_path
        if not full_path.exists() or not full_path.is_file():
            profile_validation_errors.append(
                f"{field_name}: Profile file not found at {profile_path}"
            )
    
    if profile_validation_errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": "One or more profile paths not found",
                "errors": profile_validation_errors,
            },
        )
    
    # Step 4: Get JobManager from app state and enqueue job
    if not hasattr(request.app.state, "job_manager"):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Job manager not initialized. Check server logs.",
        )
    
    job_manager = request.app.state.job_manager
    
    # Convert Pydantic model to dict for job_manager
    job_dict = job_request.model_dump(exclude_unset=True)
    
    try:
        job_id = await job_manager.submit(job_dict, session_id)
    except ValueError as e:
        # Path validation or CLI construction error
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Job validation failed: {str(e)}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to submit job: {str(e)}",
        )
    
    # Return job_id and status
    return {
        "job_id": job_id,
        "status": "queued",
    }


@router.get("/jobs/{job_id}")
async def get_job(
    job_id: str,
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    """
    Get job detail by job_id.
    
    Returns complete job information including:
    - Job status (queued, running, completed, failed, timed_out)
    - CLI arguments used
    - List of output files (filename, size, download URL)
    - Error message (if failed or timed_out)
    
    Args:
        job_id: The unique job identifier (UUID)
        db: Database connection (injected)
    
    Returns:
        Job detail object with status, cli_args, output_files, and error_message
    
    Raises:
        HTTPException: 404 if job not found
    
    Requirements: 7.4, 9.1, 9.3, 9.4
    """
    # Fetch job record
    cursor = await db.execute(
        """
        SELECT
            job_id,
            session_id,
            submitted_at,
            started_at,
            completed_at,
            status,
            action_type,
            cli_args,
            exit_code,
            error_message,
            output_dir
        FROM jobs
        WHERE job_id = ?
        """,
        (job_id,),
    )
    row = await cursor.fetchone()
    
    if not row:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    
    # Parse CLI args from JSON
    cli_args = json.loads(row["cli_args"])
    
    # Fetch output files for this job
    cursor = await db.execute(
        """
        SELECT
            output_file_id,
            filename,
            size_bytes,
            created_at
        FROM output_files
        WHERE job_id = ?
        ORDER BY filename
        """,
        (job_id,),
    )
    output_file_rows = await cursor.fetchall()
    
    # Build output files list with download URLs
    output_files = [
        {
            "filename": file_row["filename"],
            "size_bytes": file_row["size_bytes"],
            "download_url": f"/api/jobs/{job_id}/outputs/{file_row['filename']}",
            "created_at": file_row["created_at"],
        }
        for file_row in output_file_rows
    ]
    
    # Build response object
    return {
        "job_id": row["job_id"],
        "session_id": row["session_id"],
        "submitted_at": row["submitted_at"],
        "started_at": row["started_at"],
        "completed_at": row["completed_at"],
        "status": row["status"],
        "action_type": row["action_type"],
        "cli_args": cli_args,
        "exit_code": row["exit_code"],
        "error_message": row["error_message"],
        "output_dir": row["output_dir"],
        "output_files": output_files,
    }


@router.get("/jobs/{job_id}/outputs")
async def list_job_outputs(
    job_id: str,
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    """
    List output files for a completed job.
    
    Returns a list of output files generated by the job, including filename,
    size in bytes, and download URL for each file. Returns 404 if the job
    is not found.
    
    Args:
        job_id: The unique job identifier (UUID)
        db: Database connection (injected)
    
    Returns:
        JSON object containing:
        - job_id: The job identifier
        - status: Current job status
        - output_files: Array of output file objects with filename, size_bytes, and download_url
    
    Raises:
        HTTPException: 404 if job not found
    
    Requirements: 8.1, 8.2
    """
    # First verify the job exists
    cursor = await db.execute(
        """
        SELECT
            job_id,
            status
        FROM jobs
        WHERE job_id = ?
        """,
        (job_id,),
    )
    row = await cursor.fetchone()
    
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found"
        )
    
    job_status = row["status"]
    
    # Fetch output files for this job
    cursor = await db.execute(
        """
        SELECT
            filename,
            size_bytes
        FROM output_files
        WHERE job_id = ?
        ORDER BY filename
        """,
        (job_id,),
    )
    output_file_rows = await cursor.fetchall()
    
    # Build output files list with download URLs
    output_files = [
        {
            "filename": file_row["filename"],
            "size_bytes": file_row["size_bytes"],
            "download_url": f"/api/jobs/{job_id}/outputs/{file_row['filename']}",
        }
        for file_row in output_file_rows
    ]
    
    return {
        "job_id": job_id,
        "status": job_status,
        "output_files": output_files,
    }


@router.post("/jobs/{job_id}/thumbnail")
async def upload_job_thumbnail(
    job_id: str,
    request: Request,
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    """
    Attach a PNG thumbnail to a completed slice job: registers it as a
    regular output file (`thumbnail.png`, downloadable/listable exactly
    like `plate_1.gcode`) AND splices it directly into the plate's
    .gcode as a native-format `; THUMBNAIL_BLOCK_START ... ; thumbnail
    begin WxH size ... ; thumbnail end ... ; THUMBNAIL_BLOCK_END` comment
    block (see `_splice_thumbnail_into_gcode` below).

    Native OrcaSlicer embeds that exact comment block by calling a
    thumbnail-rendering callback from `GCode.cpp`'s `_do_export`
    (`libslic3r/GCode/Thumbnails.hpp`'s `export_thumbnails_to_file`) — but
    that callback is only ever wired up by the desktop GUI's OpenGL
    rendering pipeline (`BackgroundSlicingProcess::process_fff`); the
    headless CLI binary this app invokes always passes `nullptr` for it
    (confirmed both by reading `OrcaSlicer.cpp`'s `--slice` path AND by
    directly re-running the CLI with `--thumbnails=140x110/PNG` explicitly
    set — the flag is accepted and echoed into the gcode's config-dump
    footer, but `export_thumbnails_to_file`'s `if (thumbnail_cb ==
    nullptr) return;` guard means no actual thumbnail block ever gets
    written, no matter what flags are passed). This is a hard limitation
    of native's own CLI, not something fixable from the argument-passing
    side.

    Since that block is pure ASCII comments (gcode parsers/viewers
    universally skip lines starting with ';'), we don't need the CLI's
    cooperation to produce it — the frontend renders its own live
    Three.js Prepare-tab viewport (showing the exact plate/model this job
    just sliced) to a PNG client-side, and this endpoint splices that PNG
    into the gcode file directly, byte-for-byte equivalent to what native
    would have written.

    Accepts a raw PNG body (Content-Type: image/png). Rejects jobs that
    are not yet completed (no point attaching a thumbnail to a job with
    no output files yet) and validates the body is non-empty and looks
    like a PNG (starts with the PNG magic bytes) rather than trusting the
    Content-Type header alone.

    Returns the registered output file's summary (same shape as entries
    in GET /api/jobs/{job_id}/outputs).
    """
    cursor = await db.execute(
        "SELECT status, output_dir FROM jobs WHERE job_id = ?",
        (job_id,),
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Job {job_id} not found")

    if row["status"] != "completed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot attach a thumbnail to a job in status '{row['status']}' (must be 'completed')",
        )

    body = await request.body()
    if not body:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Empty thumbnail body")

    # PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    if not body.startswith(b"\x89PNG\r\n\x1a\n"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Body is not a valid PNG file")

    output_dir = Path(row["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    thumbnail_path = resolve_and_guard(Path("thumbnail.png"), output_dir)
    thumbnail_path.write_bytes(body)

    output_file_id = str(uuid.uuid4())
    created_at = datetime.utcnow().isoformat()

    # Replace any previously-uploaded thumbnail for this job (e.g. the
    # user re-slices/re-uploads) rather than accumulating duplicate rows.
    await db.execute(
        "DELETE FROM output_files WHERE job_id = ? AND filename = ?",
        (job_id, "thumbnail.png"),
    )
    await db.execute(
        """
        INSERT INTO output_files
        (output_file_id, job_id, filename, size_bytes, storage_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (output_file_id, job_id, "thumbnail.png", len(body), str(thumbnail_path), created_at),
    )
    await db.commit()

    # Also splice the thumbnail directly into the plate's .gcode file, in
    # the exact same comment-block format native's own CLI would have
    # written if its thumbnail generator callback weren't hardcoded to
    # nullptr (see the big doc comment above — this endpoint's whole
    # reason to exist). Since the block is pure ASCII comments (gcode
    # parsers/viewers universally skip lines starting with ';'), splicing
    # it in after the fact produces a byte-for-byte equivalent result to
    # what native's GCode.cpp `_do_export`/`export_thumbnails_to_file`
    # would have written, without needing the CLI to cooperate at all.
    for gcode_path in sorted(output_dir.glob("*.gcode")):
        _splice_thumbnail_into_gcode(gcode_path, body)
        # Splicing changes the file's size on disk — refresh the stored
        # size_bytes so GET /api/jobs/{id} and .../outputs report the
        # real (now-larger) size rather than a stale pre-splice value.
        await db.execute(
            "UPDATE output_files SET size_bytes = ? WHERE job_id = ? AND filename = ?",
            (gcode_path.stat().st_size, job_id, gcode_path.name),
        )
    await db.commit()

    return {
        "filename": "thumbnail.png",
        "size_bytes": len(body),
        "download_url": f"/api/jobs/{job_id}/outputs/thumbnail.png",
        "created_at": created_at,
    }


def _splice_thumbnail_into_gcode(gcode_path: Path, png_bytes: bytes) -> None:
    """
    Insert a native-format thumbnail comment block into an already-sliced
    .gcode file, matching the exact layout
    `GCodeThumbnails::export_thumbnails_to_file` writes
    (libslic3r/GCode/Thumbnails.hpp):

        ; THUMBNAIL_BLOCK_START
        ;
        ; thumbnail begin WxH <base64-byte-count>
        ; <base64, wrapped at 78 chars per line, each line prefixed "; ">
        ; thumbnail end
        ; THUMBNAIL_BLOCK_END

    placed immediately after the `; HEADER_BLOCK_END` line (native writes
    thumbnails right after the header block, before CONFIG_BLOCK/gcode
    body — see GCode.cpp's `_do_export`). Re-running this on a gcode file
    that already has a spliced-in block replaces it rather than
    duplicating it, so re-uploading a thumbnail for the same job is safe.

    Width/height are read directly from the PNG's IHDR chunk (bytes 16-24
    of a well-formed PNG) rather than trusted from any caller-supplied
    value, since that's what actually gets embedded in the "thumbnail
    begin WxH" line that gcode viewers use to size the preview.
    """
    if len(png_bytes) < 24:
        return
    width = int.from_bytes(png_bytes[16:20], "big")
    height = int.from_bytes(png_bytes[20:24], "big")

    encoded = base64.b64encode(png_bytes).decode("ascii")
    max_row_length = 78
    lines = [f"; thumbnail begin {width}x{height} {len(encoded)}"]
    while len(encoded) > max_row_length:
        lines.append(f"; {encoded[:max_row_length]}")
        encoded = encoded[max_row_length:]
    if encoded:
        lines.append(f"; {encoded}")
    lines.append("; thumbnail end")

    block = "; THUMBNAIL_BLOCK_START\n;\n" + "\n".join(lines) + "\n; THUMBNAIL_BLOCK_END\n\n"

    text = gcode_path.read_text(encoding="utf-8", errors="replace")

    # Strip any previously-spliced block first, so re-uploading doesn't
    # accumulate duplicates.
    text = re.sub(
        r"; THUMBNAIL_BLOCK_START\n.*?; THUMBNAIL_BLOCK_END\n\n?",
        "",
        text,
        flags=re.DOTALL,
    )

    header_end_marker = "; HEADER_BLOCK_END\n"
    idx = text.find(header_end_marker)
    if idx == -1:
        # No recognizable header block (unexpected gcode shape) — fall
        # back to prepending, so the thumbnail still ends up in the file
        # rather than silently being dropped.
        new_text = block + text
    else:
        insert_at = idx + len(header_end_marker)
        new_text = text[:insert_at] + "\n" + block + text[insert_at:]

    gcode_path.write_text(new_text, encoding="utf-8")


@router.get("/jobs/{job_id}/outputs/{filename}")
async def download_output_file(
    job_id: str,
    filename: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """
    Download an output file generated by a job.
    
    Streams the output file as a download response with proper Content-Disposition
    header. Applies path traversal protection via resolve_and_guard. Returns 404
    if the file has expired (past retention period) or was not found.
    
    Args:
        job_id: The unique job identifier (UUID)
        filename: The output filename to download
        db: Database connection (injected)
    
    Returns:
        FileResponse: Streaming file download with Content-Disposition: attachment
    
    Raises:
        HTTPException 404: Job not found, file not found, or file expired
        HTTPException 422: Invalid filename (path traversal attempt)
    
    Requirements: 8.1, 8.3, 8.5, 11.3
    """
    # Step 1: Verify the job exists and get its output directory
    cursor = await db.execute(
        """
        SELECT
            output_dir,
            status
        FROM jobs
        WHERE job_id = ?
        """,
        (job_id,),
    )
    row = await cursor.fetchone()
    
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found"
        )
    
    output_dir = row["output_dir"]
    job_status = row["status"]
    
    # Step 2: Apply resolve_and_guard to prevent path traversal
    # The filename should be within the job's output directory
    output_dir_path = Path(output_dir)
    
    try:
        # Resolve the file path and ensure it's within the output directory
        file_path = resolve_and_guard(
            Path(filename),
            output_dir_path
        )
    except ValueError as e:
        # Path traversal attempt detected
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid filename: {str(e)}"
        )
    
    # Step 3: Check if the file exists on disk
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Output file not found or expired: {filename}"
        )
    
    if not file_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Output path is not a file: {filename}"
        )
    
    # Step 4: Return the file as a streaming download response
    # FileResponse automatically handles streaming and sets proper headers
    return FileResponse(
        path=str(file_path),
        filename=filename,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )


@router.delete("/jobs/{job_id}")
async def cancel_job(
    job_id: str,
    request: Request,
    db: aiosqlite.Connection = Depends(get_db),
):
    """
    Cancel a queued or running job.
    
    Terminates the subprocess if the job is currently running, or marks it as
    failed if it's still queued. Jobs in terminal states (completed, failed,
    timed_out) cannot be cancelled.
    
    Args:
        job_id: The unique job identifier (UUID)
        request: The FastAPI Request object
        db: Database connection
        
    Returns:
        JSON object confirming cancellation
        
    Raises:
        HTTPException 404: Job not found
        HTTPException 409: Job already in terminal state
        HTTPException 500: Job manager not initialized
        
    Requirements: 6.5
    """
    # Get the job manager instance from the app state
    job_manager = getattr(request.app.state, "job_manager", None)
    
    if job_manager is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Job manager not initialized",
        )
    
    # First, check if the job exists and get its current status
    cursor = await db.execute(
        """
        SELECT status
        FROM jobs
        WHERE job_id = ?
        """,
        (job_id,),
    )
    row = await cursor.fetchone()
    
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job not found: {job_id}",
        )
    
    current_status = row[0]
    
    # Check if job is already in a terminal state
    if current_status in ("completed", "failed", "timed_out"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot cancel job in terminal state: {current_status}",
        )
    
    # Attempt to cancel the job through the job manager
    cancelled = await job_manager.cancel(job_id)
    
    if not cancelled:
        # This shouldn't happen if our status check was correct, but handle it
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to cancel job",
        )
    
    return {
        "message": "Job cancelled successfully",
        "job_id": job_id,
        "previous_status": current_status,
    }
