"""
Unit tests for job outputs API endpoint (GET /api/jobs/{job_id}/outputs).

Tests the endpoint that lists output files for a completed job with filename,
size_bytes, and download URL; returns 404 if job not found.

Requirements: 8.1, 8.2
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


def test_list_job_outputs_success():
    """Test listing output files for a job with outputs."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        # Mock database to return job and output files
        async def mock_get_db():
            mock_db = AsyncMock()
            
            call_count = [0]
            
            async def mock_execute(*args, **kwargs):
                call_count[0] += 1
                mock_cursor = AsyncMock()
                
                if call_count[0] == 1:
                    # First call: SELECT job status
                    # Return a dict-like row with column access
                    mock_row = {
                        "job_id": "test-job-1",
                        "status": "completed"
                    }
                    mock_cursor.fetchone = AsyncMock(return_value=mock_row)
                else:
                    # Second call: SELECT output files
                    mock_cursor.fetchall = AsyncMock(return_value=[
                        {"filename": "plate_1.gcode", "size_bytes": 12345},
                        {"filename": "plate_2.gcode", "size_bytes": 67890},
                    ])
                
                return mock_cursor
            
            mock_db.execute = mock_execute
            yield mock_db
        
        app.dependency_overrides[get_db] = mock_get_db
        
        try:
            client = TestClient(app)
            response = client.get(
                "/api/jobs/test-job-1/outputs",
                headers={"Authorization": "Bearer test-secret-12345"},
            )
            
            assert response.status_code == 200
            data = response.json()
            
            assert data["job_id"] == "test-job-1"
            assert data["status"] == "completed"
            assert len(data["output_files"]) == 2
            
            # Check first output file
            assert data["output_files"][0]["filename"] == "plate_1.gcode"
            assert data["output_files"][0]["size_bytes"] == 12345
            assert data["output_files"][0]["download_url"] == "/api/jobs/test-job-1/outputs/plate_1.gcode"
            
            # Check second output file
            assert data["output_files"][1]["filename"] == "plate_2.gcode"
            assert data["output_files"][1]["size_bytes"] == 67890
            assert data["output_files"][1]["download_url"] == "/api/jobs/test-job-1/outputs/plate_2.gcode"
        finally:
            app.dependency_overrides.clear()


def test_list_job_outputs_no_files():
    """Test listing output files for a job that has no output files yet."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        # Mock database to return job but no output files
        async def mock_get_db():
            mock_db = AsyncMock()
            
            call_count = [0]
            
            async def mock_execute(*args, **kwargs):
                call_count[0] += 1
                mock_cursor = AsyncMock()
                
                if call_count[0] == 1:
                    # First call: SELECT job status
                    mock_row = {
                        "job_id": "test-job-2",
                        "status": "running"
                    }
                    mock_cursor.fetchone = AsyncMock(return_value=mock_row)
                else:
                    # Second call: SELECT output files - empty
                    mock_cursor.fetchall = AsyncMock(return_value=[])
                
                return mock_cursor
            
            mock_db.execute = mock_execute
            yield mock_db
        
        app.dependency_overrides[get_db] = mock_get_db
        
        try:
            client = TestClient(app)
            response = client.get(
                "/api/jobs/test-job-2/outputs",
                headers={"Authorization": "Bearer test-secret-12345"},
            )
            
            assert response.status_code == 200
            data = response.json()
            
            assert data["job_id"] == "test-job-2"
            assert data["status"] == "running"
            assert data["output_files"] == []
        finally:
            app.dependency_overrides.clear()


def test_list_job_outputs_not_found():
    """Test listing output files for a non-existent job returns 404."""
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
                "/api/jobs/nonexistent-job/outputs",
                headers={"Authorization": "Bearer test-secret-12345"},
            )
            
            assert response.status_code == 404
            assert "not found" in response.json()["detail"].lower()
        finally:
            app.dependency_overrides.clear()


def test_list_job_outputs_requires_auth():
    """Test that the endpoint requires authentication."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        
        client = TestClient(app)
        
        # No auth header
        response = client.get("/api/jobs/any-job/outputs")
        assert response.status_code in [401, 403]
        
        # Wrong token
        response = client.get(
            "/api/jobs/any-job/outputs",
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert response.status_code == 401


def test_list_job_outputs_various_statuses():
    """Test that endpoint works for jobs in various states."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        test_cases = [
            ("queued", []),
            ("running", []),
            ("completed", [{"filename": "output.gcode", "size_bytes": 1000}]),
            ("failed", []),
            ("timed_out", []),
        ]
        
        for status, files in test_cases:
            # Mock database for each status
            async def mock_get_db():
                mock_db = AsyncMock()
                
                call_count = [0]
                
                async def mock_execute(*args, **kwargs):
                    call_count[0] += 1
                    mock_cursor = AsyncMock()
                    
                    if call_count[0] == 1:
                        # First call: SELECT job status
                        mock_row = {
                            "job_id": f"job-{status}",
                            "status": status
                        }
                        mock_cursor.fetchone = AsyncMock(return_value=mock_row)
                    else:
                        # Second call: SELECT output files
                        mock_cursor.fetchall = AsyncMock(return_value=files)
                    
                    return mock_cursor
                
                mock_db.execute = mock_execute
                yield mock_db
            
            app.dependency_overrides[get_db] = mock_get_db
            
            try:
                client = TestClient(app)
                response = client.get(
                    f"/api/jobs/job-{status}/outputs",
                    headers={"Authorization": "Bearer test-secret-12345"},
                )
                
                assert response.status_code == 200
                data = response.json()
                assert data["status"] == status
                assert len(data["output_files"]) == len(files)
            finally:
                app.dependency_overrides.clear()


def test_list_job_outputs_multiple_files():
    """Test listing multiple output files with different names and sizes."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        # Mock database with multiple output files
        async def mock_get_db():
            mock_db = AsyncMock()
            
            call_count = [0]
            
            async def mock_execute(*args, **kwargs):
                call_count[0] += 1
                mock_cursor = AsyncMock()
                
                if call_count[0] == 1:
                    # First call: SELECT job status
                    mock_row = {
                        "job_id": "multi-output-job",
                        "status": "completed"
                    }
                    mock_cursor.fetchone = AsyncMock(return_value=mock_row)
                else:
                    # Second call: SELECT output files
                    mock_cursor.fetchall = AsyncMock(return_value=[
                        {"filename": "model.gcode", "size_bytes": 500000},
                        {"filename": "plate_1.gcode", "size_bytes": 250000},
                        {"filename": "plate_2.gcode", "size_bytes": 250000},
                        {"filename": "summary.txt", "size_bytes": 1024},
                    ])
                
                return mock_cursor
            
            mock_db.execute = mock_execute
            yield mock_db
        
        app.dependency_overrides[get_db] = mock_get_db
        
        try:
            client = TestClient(app)
            response = client.get(
                "/api/jobs/multi-output-job/outputs",
                headers={"Authorization": "Bearer test-secret-12345"},
            )
            
            assert response.status_code == 200
            data = response.json()
            
            assert len(data["output_files"]) == 4
            
            # Verify each file has the required fields
            for output_file in data["output_files"]:
                assert "filename" in output_file
                assert "size_bytes" in output_file
                assert "download_url" in output_file
                assert output_file["download_url"].startswith("/api/jobs/multi-output-job/outputs/")
                assert output_file["download_url"].endswith(output_file["filename"])
        finally:
            app.dependency_overrides.clear()
