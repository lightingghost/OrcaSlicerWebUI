"""
File upload and management API endpoints.

Handles model file uploads (.stl, .3mf, .obj, .amf) with extension validation,
size limits, and session-scoped storage.

Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
"""

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

import aiosqlite
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from app.auth import verify_token
from app.cli_builder import resolve_and_guard
from app.config import settings
from app.database import get_db


# Maximum file size: 500 MB
MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024

# Allowed file extensions
ALLOWED_EXTENSIONS = {"stl", "3mf", "obj", "amf"}


router = APIRouter(dependencies=[Depends(verify_token)])


@router.post("/files/upload")
async def upload_file(
    file: UploadFile = File(...),
    session_id: str = "default",  # TODO: integrate with session management
    db: aiosqlite.Connection = Depends(get_db),
):
    """
    Upload a 3D model file.
    
    Validates the file extension and size, stores it in the session-scoped
    workspace directory, and creates a database record.
    
    Args:
        file: The uploaded file (multipart/form-data)
        session_id: Session identifier for scoped storage
        db: Database connection
        
    Returns:
        JSON object containing the file_id
        
    Raises:
        HTTPException 422: Invalid file extension
        HTTPException 413: File size exceeds 500 MB limit
        HTTPException 500: Storage or database error
        
    Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
    """
    # Extract file extension
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Filename is required",
        )
    
    # Get the file extension (lowercase, without dot)
    file_ext = Path(file.filename).suffix.lstrip(".").lower()
    
    # Requirement 1.3: Validate extension
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported file extension: .{file_ext}. "
                   f"Allowed extensions: {', '.join('.' + ext for ext in sorted(ALLOWED_EXTENSIONS))}",
        )
    
    # Generate unique file ID
    file_id = str(uuid.uuid4())
    
    # Create session uploads directory
    session_dir = settings.session_uploads_dir / session_id / "uploads"
    session_dir.mkdir(parents=True, exist_ok=True)
    
    # Storage path: workspace/sessions/{session_id}/uploads/{file_id}.{ext}
    storage_path = session_dir / f"{file_id}.{file_ext}"
    
    # Read and validate file size while writing to disk
    # Requirement 1.5, 1.6: Enforce 500 MB size limit
    bytes_written = 0
    
    try:
        with open(storage_path, "wb") as f:
            # Read file in chunks to avoid loading entire file into memory
            chunk_size = 1024 * 1024  # 1 MB chunks
            
            while chunk := await file.read(chunk_size):
                bytes_written += len(chunk)
                
                # Requirement 1.6: Check size limit during upload
                if bytes_written > MAX_FILE_SIZE_BYTES:
                    # Delete partial file
                    storage_path.unlink(missing_ok=True)
                    
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"File size exceeds maximum allowed size of {MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB",
                    )
                
                f.write(chunk)
    
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        # Clean up partial file on error
        storage_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to write file to storage: {str(e)}",
        )
    
    # Requirement 1.2: Store file record in database
    upload_timestamp = datetime.now(timezone.utc).isoformat()
    
    try:
        await db.execute(
            """
            INSERT INTO files (file_id, session_id, original_name, extension, size_bytes, storage_path, uploaded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                file_id,
                session_id,
                file.filename,
                file_ext,
                bytes_written,
                str(storage_path),
                upload_timestamp,
            ),
        )
        await db.commit()
    
    except Exception as e:
        # Clean up file on database error
        storage_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create database record: {str(e)}",
        )
    
    # Requirement 1.4: Return file_id
    return {
        "file_id": file_id,
        "filename": file.filename,
        "size_bytes": bytes_written,
        "extension": file_ext,
    }


@router.get("/files/{file_id}")
async def get_file_metadata(
    file_id: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """
    Get metadata for an uploaded file.
    
    Retrieves file information from the database including original filename,
    size, extension, and upload timestamp.
    
    Args:
        file_id: The unique file identifier (UUID)
        db: Database connection
        
    Returns:
        JSON object containing file metadata:
        - file_id: The unique file identifier
        - original_name: The original filename
        - size_bytes: File size in bytes
        - extension: File extension (without dot)
        - uploaded_at: ISO-8601 timestamp of upload
        
    Raises:
        HTTPException 404: File not found
        
    Requirement 1.4
    """
    # Query database for file record
    async with db.execute(
        """
        SELECT file_id, original_name, size_bytes, extension, uploaded_at
        FROM files
        WHERE file_id = ?
        """,
        (file_id,),
    ) as cursor:
        row = await cursor.fetchone()
    
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File not found: {file_id}",
        )
    
    # Return file metadata
    return {
        "file_id": row[0],
        "original_name": row[1],
        "size_bytes": row[2],
        "extension": row[3],
        "uploaded_at": row[4],
    }


@router.delete("/files/{file_id}")
async def delete_file(
    file_id: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """
    Delete a file and its database record.
    
    Removes both the file from disk and its database record. If the file
    doesn't exist in the database, returns 404. Handles race conditions
    gracefully (e.g., file already deleted from disk).
    
    Args:
        file_id: The unique file identifier
        db: Database connection
        
    Returns:
        JSON object confirming deletion
        
    Raises:
        HTTPException 404: File not found in database
        
    Requirements: 1.5
    """
    # First, fetch the file record to get the storage path
    async with db.execute(
        """
        SELECT storage_path
        FROM files
        WHERE file_id = ?
        """,
        (file_id,),
    ) as cursor:
        row = await cursor.fetchone()
    
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File not found: {file_id}",
        )
    
    storage_path = Path(row[0])
    
    # Delete the file from disk (handle race condition gracefully)
    try:
        storage_path.unlink(missing_ok=True)
    except Exception:
        # File already deleted or permission issue - continue to delete DB record
        pass
    
    # Delete the database record
    await db.execute(
        """
        DELETE FROM files
        WHERE file_id = ?
        """,
        (file_id,),
    )
    await db.commit()
    
    return {
        "message": "File deleted successfully",
        "file_id": file_id,
    }


@router.get("/files/{file_id}/download")
async def download_file(
    file_id: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """
    Download an uploaded file.
    
    Streams the uploaded file as a download response. Applies path traversal
    protection via resolve_and_guard. Returns 404 if file not found.
    
    Args:
        file_id: The unique file identifier (UUID)
        db: Database connection (injected)
    
    Returns:
        FileResponse: Streaming file download with Content-Disposition: attachment
    
    Raises:
        HTTPException 404: File not found
        HTTPException 422: Invalid file path (path traversal attempt)
    
    Requirements: 1.4, 13.2
    """
    # Step 1: Fetch the file record from database
    async with db.execute(
        """
        SELECT storage_path, original_name, extension
        FROM files
        WHERE file_id = ?
        """,
        (file_id,),
    ) as cursor:
        row = await cursor.fetchone()
    
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File not found: {file_id}",
        )
    
    storage_path_str = row[0]
    original_name = row[1]
    extension = row[2]
    
    storage_path = Path(storage_path_str)
    
    # Step 2: Apply resolve_and_guard to prevent path traversal
    # The file should be within the session uploads directory
    try:
        # Verify the storage path is within workspace root
        file_path = resolve_and_guard(
            storage_path.relative_to(settings.workspace_root),
            settings.workspace_root
        )
    except (ValueError, OSError) as e:
        # Path traversal attempt detected or invalid path
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid file path: {str(e)}"
        )
    
    # Step 3: Check if the file exists on disk
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File not found on disk: {file_id}"
        )
    
    if not file_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Path is not a file: {file_id}"
        )
    
    # Step 4: Determine media type based on extension
    media_types = {
        "stl": "application/sla",
        "3mf": "application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
        "obj": "text/plain",
        "amf": "application/x-amf",
    }
    media_type = media_types.get(extension, "application/octet-stream")
    
    # Step 5: Return the file as a streaming download response
    return FileResponse(
        path=str(file_path),
        filename=original_name,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{original_name}"'
        }
    )
