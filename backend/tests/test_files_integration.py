"""
Integration tests for file upload API.

Tests actual file upload with real filesystem operations and database.
"""

import io
import pytest
import tempfile
import shutil
from pathlib import Path
from fastapi.testclient import TestClient


@pytest.fixture
def temp_workspace(tmp_path):
    """Create a temporary workspace directory for testing."""
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    
    # Set environment variable
    import os
    os.environ["WORKSPACE_ROOT"] = str(workspace)
    os.environ["API_SECRET"] = "test_secret_12345678"
    os.environ["ORCA_CLI_PATH"] = "/tmp/fake_cli"  # Non-existent but valid path format
    
    yield workspace
    
    # Cleanup
    if "WORKSPACE_ROOT" in os.environ:
        del os.environ["WORKSPACE_ROOT"]
    if "API_SECRET" in os.environ:
        del os.environ["API_SECRET"]
    if "ORCA_CLI_PATH" in os.environ:
        del os.environ["ORCA_CLI_PATH"]


@pytest.mark.asyncio
async def test_upload_valid_stl_file(temp_workspace):
    """
    Test uploading a valid .stl file.
    
    This is an integration test that verifies the complete upload flow:
    - File extension validation
    - File storage on disk
    - Database record creation
    - Response with file_id
    
    Requirements: 1.1, 1.2, 1.3, 1.4
    """
    # Ensure clean import after environment is set
    import sys
    if 'app.main' in sys.modules:
        del sys.modules['app.main']
    if 'app.config' in sys.modules:
        del sys.modules['app.config']
    
    from app.main import app
    
    client = TestClient(app)
    
    # Create a small STL file content (binary STL header + dummy data)
    content = b"BINARY STL FILE" + b"\x00" * 100
    
    # Upload the file
    response = client.post(
        "/api/files/upload",
        files={"file": ("test_model.stl", io.BytesIO(content), "application/octet-stream")},
        headers={"Authorization": "Bearer test_secret_12345678"},
    )
    
    # Verify response
    assert response.status_code == 200
    data = response.json()
    assert "file_id" in data
    assert data["filename"] == "test_model.stl"
    assert data["extension"] == "stl"
    assert data["size_bytes"] == len(content)
    
    # Verify file exists on disk
    file_id = data["file_id"]
    expected_path = temp_workspace / "sessions" / "default" / "uploads" / f"{file_id}.stl"
    assert expected_path.exists()
    assert expected_path.read_bytes() == content


@pytest.mark.asyncio
async def test_upload_invalid_extension(temp_workspace):
    """
    Test uploading a file with invalid extension returns 422.
    
    Property 1: Invalid extension upload returns 422
    Requirements: 1.3
    """
    import sys
    if 'app.main' in sys.modules:
        del sys.modules['app.main']
    if 'app.config' in sys.modules:
        del sys.modules['app.config']
    
    from app.main import app
    
    client = TestClient(app)
    
    content = b"some text content"
    
    # Try to upload a .txt file
    response = client.post(
        "/api/files/upload",
        files={"file": ("document.txt", io.BytesIO(content), "text/plain")},
        headers={"Authorization": "Bearer test_secret_12345678"},
    )
    
    # Verify 422 response
    assert response.status_code == 422
    assert "Unsupported file extension" in response.json()["detail"]
    
    # Verify no file was created
    sessions_dir = temp_workspace / "sessions"
    if sessions_dir.exists():
        # Count files in the uploads directory
        upload_dirs = list(sessions_dir.rglob("uploads"))
        for upload_dir in upload_dirs:
            assert len(list(upload_dir.iterdir())) == 0


@pytest.mark.asyncio
async def test_upload_file_too_large(temp_workspace):
    """
    Test uploading a file larger than 500 MB returns 413.
    
    Requirements: 1.5, 1.6
    """
    import sys
    if 'app.main' in sys.modules:
        del sys.modules['app.main']
    if 'app.config' in sys.modules:
        del sys.modules['app.config']
    
    from app.main import app
    
    client = TestClient(app)
    
    # Create a file that's slightly over 500 MB
    # We'll simulate this with a custom file-like object that reports large size
    class LargeFile(io.BytesIO):
        """Simulates a large file by yielding many chunks."""
        def __init__(self, chunk_size=1024*1024):
            super().__init__(b"X" * chunk_size)
            self.chunk_size = chunk_size
            self.chunks_read = 0
            self.max_chunks = 501  # 501 MB
        
        def read(self, size=-1):
            """Read method that yields chunks until we exceed 500 MB."""
            if size == -1:
                size = self.chunk_size
            
            if self.chunks_read >= self.max_chunks:
                return b""  # EOF
            
            self.chunks_read += 1
            return b"X" * min(size, self.chunk_size)
    
    # Note: This test might be slow as it actually uploads 500+ MB
    # For faster testing, we could mock the size check, but this tests the real flow
    
    response = client.post(
        "/api/files/upload",
        files={"file": ("huge_model.stl", LargeFile(), "application/octet-stream")},
        headers={"Authorization": "Bearer test_secret_12345678"},
        timeout=10.0,  # Give it time to upload
    )
    
    # Verify 413 response
    assert response.status_code == 413
    assert "exceeds maximum allowed size" in response.json()["detail"]


@pytest.mark.asyncio
async def test_get_file_metadata(temp_workspace):
    """
    Test retrieving file metadata after upload.
    
    Requirements: 1.4
    """
    import sys
    if 'app.main' in sys.modules:
        del sys.modules['app.main']
    if 'app.config' in sys.modules:
        del sys.modules['app.config']
    
    from app.main import app
    
    client = TestClient(app)
    
    content = b"test content"
    
    # Upload file
    upload_response = client.post(
        "/api/files/upload",
        files={"file": ("test.3mf", io.BytesIO(content), "application/octet-stream")},
        headers={"Authorization": "Bearer test_secret_12345678"},
    )
    
    assert upload_response.status_code == 200
    file_id = upload_response.json()["file_id"]
    
    # Get metadata
    metadata_response = client.get(
        f"/api/files/{file_id}",
        headers={"Authorization": "Bearer test_secret_12345678"},
    )
    
    assert metadata_response.status_code == 200
    metadata = metadata_response.json()
    assert metadata["file_id"] == file_id
    assert metadata["original_name"] == "test.3mf"
    assert metadata["extension"] == "3mf"
    assert metadata["size_bytes"] == len(content)
    assert "uploaded_at" in metadata


@pytest.mark.asyncio
async def test_delete_file(temp_workspace):
    """
    Test deleting an uploaded file.
    
    Requirements: 1.4
    """
    import sys
    if 'app.main' in sys.modules:
        del sys.modules['app.main']
    if 'app.config' in sys.modules:
        del sys.modules['app.config']
    
    from app.main import app
    
    client = TestClient(app)
    
    content = b"test content"
    
    # Upload file
    upload_response = client.post(
        "/api/files/upload",
        files={"file": ("test.obj", io.BytesIO(content), "application/octet-stream")},
        headers={"Authorization": "Bearer test_secret_12345678"},
    )
    
    assert upload_response.status_code == 200
    file_id = upload_response.json()["file_id"]
    
    # Verify file exists on disk
    file_path = temp_workspace / "sessions" / "default" / "uploads" / f"{file_id}.obj"
    assert file_path.exists()
    
    # Delete file
    delete_response = client.delete(
        f"/api/files/{file_id}",
        headers={"Authorization": "Bearer test_secret_12345678"},
    )
    
    assert delete_response.status_code == 200
    assert delete_response.json()["file_id"] == file_id
    
    # Verify file is deleted from disk
    assert not file_path.exists()
    
    # Verify metadata endpoint returns 404
    metadata_response = client.get(
        f"/api/files/{file_id}",
        headers={"Authorization": "Bearer test_secret_12345678"},
    )
    assert metadata_response.status_code == 404


@pytest.mark.asyncio
async def test_upload_all_supported_extensions(temp_workspace):
    """
    Test uploading files with all supported extensions.
    
    Requirements: 1.1, 1.3
    """
    import sys
    if 'app.main' in sys.modules:
        del sys.modules['app.main']
    if 'app.config' in sys.modules:
        del sys.modules['app.config']
    
    from app.main import app
    from app.routers.files import ALLOWED_EXTENSIONS
    
    client = TestClient(app)
    
    for ext in ALLOWED_EXTENSIONS:
        content = b"test content for " + ext.encode()
        
        response = client.post(
            "/api/files/upload",
            files={"file": (f"model.{ext}", io.BytesIO(content), "application/octet-stream")},
            headers={"Authorization": "Bearer test_secret_12345678"},
        )
        
        assert response.status_code == 200, f"Extension .{ext} should be allowed"
        assert response.json()["extension"] == ext
