"""
"Project" import/export as a single .3mf file.

A "project" in this app is the set of files currently on the Prepare tab's
plate (uploadedFiles in the frontend store) plus each object's live
position/rotation in the viewport. There is no single backend record for
this — it's assembled on demand:

  POST /api/projects/import  — splits an uploaded .3mf's objects into
    individual STL files, registers each as a normal uploaded file (same
    `files` DB table / storage layout upload_file uses — see files.py),
    and returns each new file's id plus its placement from the 3mf so the
    frontend can add it to the plate at the right position instead of the
    default "stack new imports in a grid" placement.

  POST /api/projects/export  — given the CURRENT plate's file_ids and
    live positions/rotations (captured from the Three.js scene by the
    frontend), looks up each file's on-disk STL, builds a single .3mf
    (see threemf_io.write_3mf) preserving that placement, and streams it
    back as a downloadable file.

Both endpoints work in raw STL <-> 3mf mesh terms via threemf_io.py, not
by shelling out to the OrcaSlicer CLI — unlike routers/arrange.py (which
needs the CLI's own real arrange algorithm, not obtainable any other way),
reading/writing a 3mf's mesh + placement data is a pure data
transformation this app can do directly, and doing so avoids a CLI
round-trip (with its own timeout/subprocess/profile-loading overhead) for
what is otherwise a simple file format conversion.
"""

import uuid
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from app.auth import verify_token
from app.config import settings
from app.database import get_db
from app.threemf_io import (
    ProjectObject,
    parse_3mf_objects,
    parse_stl_bytes,
    write_3mf,
    write_stl_bytes,
)

router = APIRouter(dependencies=[Depends(verify_token)])

# Mirrors files.py's own limit — imported 3mf files go through the exact
# same size ceiling as a direct upload.
MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024


class ImportedObjectModel(BaseModel):
    file_id: str
    filename: str
    x: float
    y: float
    z: float
    # Full orientation quaternion (THREE.js order: x, y, z, w) — see
    # threemf_io.ProjectObject's doc comment for why a plate object's
    # rotation can't be reduced to a single Z angle.
    qx: float
    qy: float
    qz: float
    qw: float
    sx: float
    sy: float
    sz: float


class ImportProjectResponse(BaseModel):
    objects: list[ImportedObjectModel]


class ExportObjectModel(BaseModel):
    """One plate object's current live placement, as captured from the
    Three.js scene by the frontend (see ThreeViewport's getPlateSnapshot
    registration)."""

    model_config = ConfigDict(strict=True)

    file_id: str
    x: float
    y: float
    z: float = 0.0
    qx: float = 0.0
    qy: float = 0.0
    qz: float = 0.0
    qw: float = 1.0
    sx: float = 1.0
    sy: float = 1.0
    sz: float = 1.0


class ExportProjectRequest(BaseModel):
    model_config = ConfigDict(strict=True)

    objects: list[ExportObjectModel] = Field(min_length=1)


@router.post("/projects/import", response_model=ImportProjectResponse)
async def import_project(
    file: UploadFile = File(...),
    session_id: str = "default",
    db: aiosqlite.Connection = Depends(get_db),
) -> ImportProjectResponse:
    """
    Import a .3mf "project" file: split it into one STL per object and
    register each as a normal uploaded file, so the rest of the app
    (ThreeViewport's uploadedFiles-driven mesh loading, job submission,
    etc.) treats them exactly like individually-uploaded STLs — the only
    difference is the response also reports each object's original
    position/rotation from the 3mf, which the frontend applies once when
    adding these objects to the plate instead of the default
    grid-placement new uploads normally get.
    """
    if not file.filename or not file.filename.lower().endswith(".3mf"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Import requires a .3mf file",
        )

    body = await file.read()
    if len(body) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File size exceeds maximum allowed size of {MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB",
        )

    # Write the upload to a temp path so ZipFile (used by parse_3mf_objects)
    # can read it — it needs random access / seeking, which an in-memory
    # UploadFile stream doesn't cleanly support without buffering into a
    # real file anyway.
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".3mf") as tmp:
        tmp.write(body)
        tmp.flush()
        try:
            parsed_objects = parse_3mf_objects(Path(tmp.name))
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Failed to parse 3mf file: {e}",
            )

    if not parsed_objects:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="3mf file contains no importable objects",
        )

    session_dir = settings.session_uploads_dir / session_id / "uploads"
    session_dir.mkdir(parents=True, exist_ok=True)

    imported: list[ImportedObjectModel] = []
    upload_timestamp = datetime.now(timezone.utc).isoformat()

    for obj in parsed_objects:
        file_id = str(uuid.uuid4())
        stl_bytes = write_stl_bytes(obj.mesh, solid_name=obj.name)
        storage_path = session_dir / f"{file_id}.stl"
        storage_path.write_bytes(stl_bytes)

        original_name = obj.name if obj.name.lower().endswith(".stl") else f"{obj.name}.stl"

        await db.execute(
            """
            INSERT INTO files (file_id, session_id, original_name, extension, size_bytes, storage_path, uploaded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (file_id, session_id, original_name, "stl", len(stl_bytes), str(storage_path), upload_timestamp),
        )

        imported.append(
            ImportedObjectModel(
                file_id=file_id,
                filename=original_name,
                x=obj.x,
                y=obj.y,
                z=obj.z,
                qx=obj.qx,
                qy=obj.qy,
                qz=obj.qz,
                qw=obj.qw,
                sx=obj.sx,
                sy=obj.sy,
                sz=obj.sz,
            )
        )

    await db.commit()

    return ImportProjectResponse(objects=imported)


@router.post("/projects/autosave")
async def autosave_project(
    export_request: ExportProjectRequest,
    session_id: str = "default",
    db: aiosqlite.Connection = Depends(get_db),
) -> dict:
    """
    Same 3mf-building logic as POST /projects/export, but writes the
    result to a fixed on-disk path (USER_WORKSPACE/autosave/project.3mf)
    instead of streaming it back as a download — this is the REAL .3mf
    project autosave (as opposed to ProjectAutoSave.tsx's own periodic
    JSON-blob autosave of file_ids + placements, which is what actually
    restores the plate on reload; this endpoint exists so the autosaved
    project can be inspected/verified as an actual, valid 3mf file on
    disk, and so a user can grab it directly without going through
    Download Project).
    """
    from app.threemf_io import write_3mf as _write_3mf  # local alias, avoids shadowing

    file_ids = [obj.file_id for obj in export_request.objects]
    placeholders = ",".join("?" for _ in file_ids)
    cursor = await db.execute(
        f"""
        SELECT file_id, storage_path, original_name, extension
        FROM files
        WHERE file_id IN ({placeholders}) AND session_id = ?
        """,
        (*file_ids, session_id),
    )
    rows = await cursor.fetchall()
    files_by_id = {row[0]: (Path(row[1]), row[2], row[3]) for row in rows}

    missing = [fid for fid in file_ids if fid not in files_by_id]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"File(s) not found: {', '.join(missing)}",
        )

    unsupported = [files_by_id[fid][1] for fid in file_ids if files_by_id[fid][2] != "stl"]
    if unsupported:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Only STL-sourced plate objects can be autosaved to a project 3mf "
                f"right now; unsupported file(s): {', '.join(unsupported)}"
            ),
        )

    project_objects: list[ProjectObject] = []
    for obj in export_request.objects:
        storage_path, original_name, _ext = files_by_id[obj.file_id]
        if not storage_path.exists():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"File missing on disk: {original_name}",
            )
        mesh = parse_stl_bytes(storage_path.read_bytes())
        project_objects.append(
            ProjectObject(
                name=original_name, mesh=mesh,
                x=obj.x, y=obj.y, z=obj.z,
                qx=obj.qx, qy=obj.qy, qz=obj.qz, qw=obj.qw,
                sx=obj.sx, sy=obj.sy, sz=obj.sz,
            )
        )

    data = _write_3mf(project_objects)
    autosave_path = settings.autosave_dir / "project.3mf"
    autosave_path.parent.mkdir(parents=True, exist_ok=True)
    autosave_path.write_bytes(data)

    return {"path": str(autosave_path), "object_count": len(project_objects)}


@router.post("/projects/export")
async def export_project(
    export_request: ExportProjectRequest,
    session_id: str = "default",
    db: aiosqlite.Connection = Depends(get_db),
) -> Response:
    """
    Build and return a .3mf "project" file from the CURRENT plate: each
    object's real uploaded STL geometry, placed at the live position/
    rotation the frontend captured from the Three.js scene.

    Only .stl-sourced objects are currently supported (the vast majority
    of real usage — files uploaded directly or imported from a prior
    project's own split-into-STLs round-trip are always .stl). A
    plate object backed by an .obj/.amf/.3mf upload is rejected with a
    clear 422 rather than silently dropped or exported empty/wrong, since
    this module's mesh parser (threemf_io.py) only implements STL.
    """
    file_ids = [obj.file_id for obj in export_request.objects]
    placeholders = ",".join("?" for _ in file_ids)
    cursor = await db.execute(
        f"""
        SELECT file_id, storage_path, original_name, extension
        FROM files
        WHERE file_id IN ({placeholders}) AND session_id = ?
        """,
        (*file_ids, session_id),
    )
    rows = await cursor.fetchall()
    files_by_id = {row[0]: (Path(row[1]), row[2], row[3]) for row in rows}

    missing = [fid for fid in file_ids if fid not in files_by_id]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"File(s) not found: {', '.join(missing)}",
        )

    unsupported = [
        files_by_id[fid][1] for fid in file_ids if files_by_id[fid][2] != "stl"
    ]
    if unsupported:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Only STL-sourced plate objects can be exported to a project 3mf "
                f"right now; unsupported file(s): {', '.join(unsupported)}"
            ),
        )

    project_objects: list[ProjectObject] = []
    for obj in export_request.objects:
        storage_path, original_name, _ext = files_by_id[obj.file_id]
        if not storage_path.exists():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"File missing on disk: {original_name}",
            )
        mesh = parse_stl_bytes(storage_path.read_bytes())
        project_objects.append(
            ProjectObject(
                name=original_name,
                mesh=mesh,
                x=obj.x,
                y=obj.y,
                z=obj.z,
                qx=obj.qx,
                qy=obj.qy,
                qz=obj.qz,
                qw=obj.qw,
                sx=obj.sx,
                sy=obj.sy,
                sz=obj.sz,
            )
        )

    data = write_3mf(project_objects)

    return Response(
        content=data,
        media_type="application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
        headers={"Content-Disposition": 'attachment; filename="project.3mf"'},
    )
