"""
Tests for job management API endpoints.

Feature: orca-slicer-web-ui
Tests job detail retrieval.
Requirements: 7.4, 9.1, 9.3, 9.4
"""

import json
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient


def test_get_job_returns_job_detail():
    """
    Test retrieving job detail by job_id.
    
    Requirements: 7.4, 9.1, 9.3
    """
    # Initialize auth first
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        test_job_id = "test-job-id-123"
        test_cli_args = ["orca-slicer", "model.stl", "--slice", "0"]
        
        # Mock database to return a job record with output files
        async def mock_get_db():
            mock_db = AsyncMock()
            
            job_row = {
                "job_id": test_job_id,
                "session_id": "test-session",
                "submitted_at": "2024-01-01T00:00:00Z",
                "started_at": "2024-01-01T00:01:00Z",
                "completed_at": "2024-01-01T00:05:00Z",
                "status": "completed",
                "action_type": "slice",
                "cli_args": json.dumps(test_cli_args),
                "exit_code": 0,
                "error_message": None,
                "output_dir": "/app/workspace/jobs/test-job-id-123/output",
            }
            
            output_files = [
                {
                    "output_file_id": "output-1",
                    "filename": "plate_1.gcode",
                    "size_bytes": 2048,
                    "created_at": "2024-01-01T00:05:00Z",
                },
                {
                    "output_file_id": "output-2",
                    "filename": "plate_2.gcode",
                    "size_bytes": 3072,
                    "created_at": "2024-01-01T00:05:00Z",
                },
            ]
            
            # Set up mock to return job row first, then output files
            call_count = [0]
            
            async def mock_execute(*args, **kwargs):
                call_count[0] += 1
                cursor = AsyncMock()
                if call_count[0] == 1:
                    cursor.fetchone = AsyncMock(return_value=job_row)
                else:
                    cursor.fetchall = AsyncMock(return_value=output_files)
                return cursor
            
            mock_db.execute = mock_execute
            yield mock_db
        
        app.dependency_overrides[get_db] = mock_get_db
        
        try:
            client = TestClient(app)
            response = client.get(
                f"/api/jobs/{test_job_id}",
                headers={"Authorization": "Bearer test-secret-12345"},
            )
            
            assert response.status_code == 200
            data = response.json()
            
            # Verify job fields
            assert data["job_id"] == test_job_id
            assert data["session_id"] == "test-session"
            assert data["status"] == "completed"
            assert data["action_type"] == "slice"
            assert data["cli_args"] == test_cli_args
            assert data["exit_code"] == 0
            assert data["error_message"] is None
            assert data["output_dir"] == "/app/workspace/jobs/test-job-id-123/output"
            
            # Verify output files
            assert len(data["output_files"]) == 2
            assert data["output_files"][0]["filename"] == "plate_1.gcode"
            assert data["output_files"][0]["size_bytes"] == 2048
            assert data["output_files"][0]["download_url"] == f"/api/jobs/{test_job_id}/outputs/plate_1.gcode"
            assert data["output_files"][1]["filename"] == "plate_2.gcode"
            assert data["output_files"][1]["size_bytes"] == 3072
            
        finally:
            app.dependency_overrides.clear()


def test_get_job_returns_404_for_nonexistent_job():
    """
    Test that retrieving a non-existent job returns 404.
    
    Requirements: 9.1, 9.3
    """
    # Initialize auth first
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        # Mock database to return None (job not found)
        async def mock_get_db():
            mock_db = AsyncMock()
            mock_cursor = AsyncMock()
            mock_cursor.fetchone = AsyncMock(return_value=None)
            mock_db.execute = AsyncMock(return_value=mock_cursor)
            yield mock_db
        
        app.dependency_overrides[get_db] = mock_get_db
        
        try:
            client = TestClient(app)
            response = client.get(
                "/api/jobs/nonexistent-job-id",
                headers={"Authorization": "Bearer test-secret-12345"},
            )
            
            assert response.status_code == 404
            assert "not found" in response.json()["detail"].lower()
        finally:
            app.dependency_overrides.clear()


def test_get_job_failed_job_includes_error_message():
    """
    Test that a failed job includes error_message in response.
    
    Requirements: 9.4
    """
    # Initialize auth first
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        test_job_id = "test-failed-job"
        test_cli_args = ["orca-slicer", "model.stl", "--slice", "0"]
        
        # Mock database to return a failed job record
        async def mock_get_db():
            mock_db = AsyncMock()
            
            job_row = {
                "job_id": test_job_id,
                "session_id": "test-session",
                "submitted_at": "2024-01-01T00:00:00Z",
                "started_at": "2024-01-01T00:01:00Z",
                "completed_at": "2024-01-01T00:02:00Z",
                "status": "failed",
                "action_type": "slice",
                "cli_args": json.dumps(test_cli_args),
                "exit_code": 1,
                "error_message": "CLI exited with code 1: Invalid model file",
                "output_dir": "/app/workspace/jobs/test-failed-job/output",
            }
            
            call_count = [0]
            
            async def mock_execute(*args, **kwargs):
                call_count[0] += 1
                cursor = AsyncMock()
                if call_count[0] == 1:
                    cursor.fetchone = AsyncMock(return_value=job_row)
                else:
                    cursor.fetchall = AsyncMock(return_value=[])
                return cursor
            
            mock_db.execute = mock_execute
            yield mock_db
        
        app.dependency_overrides[get_db] = mock_get_db
        
        try:
            client = TestClient(app)
            response = client.get(
                f"/api/jobs/{test_job_id}",
                headers={"Authorization": "Bearer test-secret-12345"},
            )
            
            assert response.status_code == 200
            data = response.json()
            
            assert data["status"] == "failed"
            assert data["exit_code"] == 1
            assert data["error_message"] == "CLI exited with code 1: Invalid model file"
            assert len(data["output_files"]) == 0
            
        finally:
            app.dependency_overrides.clear()


def test_get_job_queued_job_has_no_completion_time():
    """
    Test that a queued job has None for started_at and completed_at.
    
    Requirements: 9.1
    """
    # Initialize auth first
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        test_job_id = "test-queued-job"
        test_cli_args = ["orca-slicer", "model.stl", "--slice", "0"]
        
        # Mock database to return a queued job record
        async def mock_get_db():
            mock_db = AsyncMock()
            
            job_row = {
                "job_id": test_job_id,
                "session_id": "test-session",
                "submitted_at": "2024-01-01T00:00:00Z",
                "started_at": None,
                "completed_at": None,
                "status": "queued",
                "action_type": "slice",
                "cli_args": json.dumps(test_cli_args),
                "exit_code": None,
                "error_message": None,
                "output_dir": "/app/workspace/jobs/test-queued-job/output",
            }
            
            call_count = [0]
            
            async def mock_execute(*args, **kwargs):
                call_count[0] += 1
                cursor = AsyncMock()
                if call_count[0] == 1:
                    cursor.fetchone = AsyncMock(return_value=job_row)
                else:
                    cursor.fetchall = AsyncMock(return_value=[])
                return cursor
            
            mock_db.execute = mock_execute
            yield mock_db
        
        app.dependency_overrides[get_db] = mock_get_db
        
        try:
            client = TestClient(app)
            response = client.get(
                f"/api/jobs/{test_job_id}",
                headers={"Authorization": "Bearer test-secret-12345"},
            )
            
            assert response.status_code == 200
            data = response.json()
            
            assert data["status"] == "queued"
            assert data["started_at"] is None
            assert data["completed_at"] is None
            assert data["exit_code"] is None
            assert data["error_message"] is None
            
        finally:
            app.dependency_overrides.clear()


def test_get_job_requires_authentication():
    """
    Test that GET /api/jobs/{job_id} requires authentication.
    
    Requirements: 11.5
    """
    # Initialize auth first
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        
        client = TestClient(app)
        
        # Make request without Authorization header
        response = client.get("/api/jobs/some-job-id")
        
        # Should return 401 or 403
        assert response.status_code in [401, 403]
