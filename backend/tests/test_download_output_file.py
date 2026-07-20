"""
Unit tests for job output file download endpoint (GET /api/jobs/{job_id}/outputs/{filename}).

Tests the endpoint that streams output files as download responses, applies path
traversal protection via resolve_and_guard, and returns 404 if file is expired or not found.

Requirements: 8.1, 8.3, 8.5, 11.3
"""

import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


def test_download_output_file_success():
    """Test downloading an existing output file."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        # Create a temporary file to serve as the output file
        with tempfile.TemporaryDirectory() as temp_dir:
            output_file_path = Path(temp_dir) / "test_output.gcode"
            output_file_path.write_text("G1 X10 Y20\nG1 Z5\n")
            
            # Mock database to return job with output directory
            async def mock_get_db():
                mock_db = AsyncMock()
                
                async def mock_execute(*args, **kwargs):
                    mock_cursor = AsyncMock()
                    mock_row = {
                        "output_dir": temp_dir,
                        "status": "completed"
                    }
                    mock_cursor.fetchone = AsyncMock(return_value=mock_row)
                    return mock_cursor
                
                mock_db.execute = mock_execute
                yield mock_db
            
            app.dependency_overrides[get_db] = mock_get_db
            
            try:
                client = TestClient(app)
                response = client.get(
                    "/api/jobs/test-job-1/outputs/test_output.gcode",
                    headers={"Authorization": "Bearer test-secret-12345"},
                )
                
                assert response.status_code == 200
                assert response.content == b"G1 X10 Y20\nG1 Z5\n"
                assert "attachment" in response.headers["content-disposition"].lower()
                assert "test_output.gcode" in response.headers["content-disposition"]
            finally:
                app.dependency_overrides.clear()


def test_download_output_file_not_found():
    """Test downloading a non-existent output file returns 404."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        # Create a temporary directory (but no file)
        with tempfile.TemporaryDirectory() as temp_dir:
            # Mock database to return job with output directory
            async def mock_get_db():
                mock_db = AsyncMock()
                
                async def mock_execute(*args, **kwargs):
                    mock_cursor = AsyncMock()
                    mock_row = {
                        "output_dir": temp_dir,
                        "status": "completed"
                    }
                    mock_cursor.fetchone = AsyncMock(return_value=mock_row)
                    return mock_cursor
                
                mock_db.execute = mock_execute
                yield mock_db
            
            app.dependency_overrides[get_db] = mock_get_db
            
            try:
                client = TestClient(app)
                response = client.get(
                    "/api/jobs/test-job-1/outputs/nonexistent.gcode",
                    headers={"Authorization": "Bearer test-secret-12345"},
                )
                
                assert response.status_code == 404
                assert "not found or expired" in response.json()["detail"].lower()
            finally:
                app.dependency_overrides.clear()


def test_download_output_file_job_not_found():
    """Test downloading from a non-existent job returns 404."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        # Mock database to return no job
        async def mock_get_db():
            mock_db = AsyncMock()
            
            async def mock_execute(*args, **kwargs):
                mock_cursor = AsyncMock()
                mock_cursor.fetchone = AsyncMock(return_value=None)
                return mock_cursor
            
            mock_db.execute = mock_execute
            yield mock_db
        
        app.dependency_overrides[get_db] = mock_get_db
        
        try:
            client = TestClient(app)
            response = client.get(
                "/api/jobs/nonexistent-job/outputs/any.gcode",
                headers={"Authorization": "Bearer test-secret-12345"},
            )
            
            assert response.status_code == 404
            assert "not found" in response.json()["detail"].lower()
        finally:
            app.dependency_overrides.clear()


def test_download_output_file_path_traversal_attempt():
    """Test that path traversal attempts are rejected.
    
    FastAPI/Starlette normalizes URLs before routing, so attempts like
    '../etc/passwd' are resolved at the URL level and either don't match
    the route pattern (404) or are caught by resolve_and_guard (422).
    """
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        with tempfile.TemporaryDirectory() as temp_dir:
            # Create a file outside the temp directory to test against
            parent_dir = Path(temp_dir).parent
            evil_file = parent_dir / "evil.txt"
            evil_file.write_text("You should not see this")
            
            # Mock database to return job with output directory
            async def mock_get_db():
                mock_db = AsyncMock()
                
                async def mock_execute(*args, **kwargs):
                    mock_cursor = AsyncMock()
                    mock_row = {
                        "output_dir": temp_dir,
                        "status": "completed"
                    }
                    mock_cursor.fetchone = AsyncMock(return_value=mock_row)
                    return mock_cursor
                
                mock_db.execute = mock_execute
                yield mock_db
            
            app.dependency_overrides[get_db] = mock_get_db
            
            try:
                client = TestClient(app)
                
                # Test path traversal attempts - these should all be blocked
                # either by URL normalization (404) or by resolve_and_guard (422)
                traversal_attempts = [
                    "../etc/passwd",          # URL normalization causes 404
                    "../../etc/passwd",       # URL normalization causes 404
                    "../../../etc/passwd",    # URL normalization causes 404
                    "..\\..\\windows\\system32\\config\\sam",  # Backslashes
                    "../evil.txt",            # File that actually exists outside dir
                ]
                
                for attempt in traversal_attempts:
                    response = client.get(
                        f"/api/jobs/test-job-1/outputs/{attempt}",
                        headers={"Authorization": "Bearer test-secret-12345"},
                    )
                    
                    # Should be blocked - either 404 (route mismatch) or 422 (validation)
                    assert response.status_code in [404, 422], \
                        f"Path traversal attempt '{attempt}' not blocked: got {response.status_code}"
                    
                    # If we got a response with content, verify it's not the evil file
                    if response.status_code == 200:
                        assert response.content != b"You should not see this", \
                            f"Path traversal succeeded for {attempt}!"
            finally:
                app.dependency_overrides.clear()
                # Cleanup
                if evil_file.exists():
                    evil_file.unlink()


def test_download_output_file_requires_auth():
    """Test that the download endpoint requires authentication."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        
        client = TestClient(app)
        
        # No auth header
        response = client.get("/api/jobs/any-job/outputs/any.gcode")
        assert response.status_code in [401, 403]
        
        # Wrong token
        response = client.get(
            "/api/jobs/any-job/outputs/any.gcode",
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert response.status_code == 401


def test_download_output_file_binary_content():
    """Test downloading binary content (e.g., 3MF file)."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        # Create a temporary binary file
        with tempfile.TemporaryDirectory() as temp_dir:
            output_file_path = Path(temp_dir) / "output.3mf"
            # Write some binary data
            binary_data = b"\x50\x4B\x03\x04" + b"\x00" * 100
            output_file_path.write_bytes(binary_data)
            
            # Mock database to return job with output directory
            async def mock_get_db():
                mock_db = AsyncMock()
                
                async def mock_execute(*args, **kwargs):
                    mock_cursor = AsyncMock()
                    mock_row = {
                        "output_dir": temp_dir,
                        "status": "completed"
                    }
                    mock_cursor.fetchone = AsyncMock(return_value=mock_row)
                    return mock_cursor
                
                mock_db.execute = mock_execute
                yield mock_db
            
            app.dependency_overrides[get_db] = mock_get_db
            
            try:
                client = TestClient(app)
                response = client.get(
                    "/api/jobs/test-job-1/outputs/output.3mf",
                    headers={"Authorization": "Bearer test-secret-12345"},
                )
                
                assert response.status_code == 200
                assert response.content == binary_data
                assert "application/octet-stream" in response.headers["content-type"]
            finally:
                app.dependency_overrides.clear()


def test_download_output_file_directory_not_file():
    """Test that requesting a directory instead of a file returns 404."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        # Create a temporary directory with a subdirectory
        with tempfile.TemporaryDirectory() as temp_dir:
            subdir = Path(temp_dir) / "subdir"
            subdir.mkdir()
            
            # Mock database to return job with output directory
            async def mock_get_db():
                mock_db = AsyncMock()
                
                async def mock_execute(*args, **kwargs):
                    mock_cursor = AsyncMock()
                    mock_row = {
                        "output_dir": temp_dir,
                        "status": "completed"
                    }
                    mock_cursor.fetchone = AsyncMock(return_value=mock_row)
                    return mock_cursor
                
                mock_db.execute = mock_execute
                yield mock_db
            
            app.dependency_overrides[get_db] = mock_get_db
            
            try:
                client = TestClient(app)
                response = client.get(
                    "/api/jobs/test-job-1/outputs/subdir",
                    headers={"Authorization": "Bearer test-secret-12345"},
                )
                
                assert response.status_code == 404
                assert "not a file" in response.json()["detail"].lower()
            finally:
                app.dependency_overrides.clear()


def test_download_output_file_large_file():
    """Test downloading a larger file to verify streaming works."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        # Create a temporary file with more content
        with tempfile.TemporaryDirectory() as temp_dir:
            output_file_path = Path(temp_dir) / "large_output.gcode"
            # Create a larger file (1KB of repeated content)
            content = "G1 X10 Y20 Z0.2\n" * 100
            output_file_path.write_text(content)
            
            # Mock database to return job with output directory
            async def mock_get_db():
                mock_db = AsyncMock()
                
                async def mock_execute(*args, **kwargs):
                    mock_cursor = AsyncMock()
                    mock_row = {
                        "output_dir": temp_dir,
                        "status": "completed"
                    }
                    mock_cursor.fetchone = AsyncMock(return_value=mock_row)
                    return mock_cursor
                
                mock_db.execute = mock_execute
                yield mock_db
            
            app.dependency_overrides[get_db] = mock_get_db
            
            try:
                client = TestClient(app)
                response = client.get(
                    "/api/jobs/test-job-1/outputs/large_output.gcode",
                    headers={"Authorization": "Bearer test-secret-12345"},
                )
                
                assert response.status_code == 200
                assert response.content == content.encode()
                assert len(response.content) > 1000  # Verify it's actually large
            finally:
                app.dependency_overrides.clear()


def test_download_output_file_special_characters_in_filename():
    """Test downloading files with special characters in filenames."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        # Test with filename containing spaces and hyphens
        with tempfile.TemporaryDirectory() as temp_dir:
            output_file_path = Path(temp_dir) / "my-output file.gcode"
            output_file_path.write_text("content")
            
            # Mock database to return job with output directory
            async def mock_get_db():
                mock_db = AsyncMock()
                
                async def mock_execute(*args, **kwargs):
                    mock_cursor = AsyncMock()
                    mock_row = {
                        "output_dir": temp_dir,
                        "status": "completed"
                    }
                    mock_cursor.fetchone = AsyncMock(return_value=mock_row)
                    return mock_cursor
                
                mock_db.execute = mock_execute
                yield mock_db
            
            app.dependency_overrides[get_db] = mock_get_db
            
            try:
                client = TestClient(app)
                # URL encode the space
                response = client.get(
                    "/api/jobs/test-job-1/outputs/my-output%20file.gcode",
                    headers={"Authorization": "Bearer test-secret-12345"},
                )
                
                assert response.status_code == 200
                assert response.content == b"content"
            finally:
                app.dependency_overrides.clear()
