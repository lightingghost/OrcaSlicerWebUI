"""
Unit tests for job listing API endpoint (GET /api/jobs).

Tests the paginated job listing with ordering and session filtering.

Requirements: 9.1, 9.2
"""

import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient


def test_list_jobs_empty():
    """Test listing jobs when no jobs exist."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        # Mock database to return empty result
        async def mock_get_db():
            mock_db = AsyncMock()
            
            # Create a counter to differentiate between COUNT and SELECT queries
            call_count = [0]
            
            async def mock_execute(*args, **kwargs):
                call_count[0] += 1
                mock_cursor = AsyncMock()
                
                if call_count[0] == 1:
                    # First call: COUNT query
                    mock_cursor.fetchone = AsyncMock(return_value=(0,))
                else:
                    # Second call: SELECT jobs query
                    mock_cursor.fetchall = AsyncMock(return_value=[])
                
                return mock_cursor
            
            mock_db.execute = mock_execute
            yield mock_db
        
        app.dependency_overrides[get_db] = mock_get_db
        
        try:
            client = TestClient(app)
            response = client.get(
                "/api/jobs",
                headers={"Authorization": "Bearer test-secret-12345"},
                params={"session_id": "test-session"},
            )
            
            assert response.status_code == 200
            data = response.json()
            assert data["jobs"] == []
            assert data["total"] == 0
            assert data["limit"] == 50
            assert data["offset"] == 0
        finally:
            app.dependency_overrides.clear()


def test_list_jobs_with_data():
    """Test listing jobs with sample data."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        # Mock database to return sample jobs
        async def mock_get_db():
            mock_db = AsyncMock()
            
            call_count = [0]
            
            async def mock_execute(*args, **kwargs):
                call_count[0] += 1
                mock_cursor = AsyncMock()
                
                if call_count[0] == 1:
                    # First call: COUNT query
                    mock_cursor.fetchone = AsyncMock(return_value=(3,))
                else:
                    # Second call: SELECT jobs query
                    mock_cursor.fetchall = AsyncMock(return_value=[
                        ("job-1", "completed", "2024-01-03T10:00:00Z", None, None, "slice"),
                        ("job-2", "running", "2024-01-02T10:00:00Z", "2024-01-02T10:01:00Z", None, "export_3mf"),
                        ("job-3", "failed", "2024-01-01T10:00:00Z", "2024-01-01T10:01:00Z", "2024-01-01T10:02:00Z", "slice"),
                    ])
                
                return mock_cursor
            
            mock_db.execute = mock_execute
            yield mock_db
        
        app.dependency_overrides[get_db] = mock_get_db
        
        try:
            client = TestClient(app)
            response = client.get(
                "/api/jobs",
                headers={"Authorization": "Bearer test-secret-12345"},
                params={"session_id": "test-session"},
            )
            
            assert response.status_code == 200
            data = response.json()
            
            assert data["total"] == 3
            assert len(data["jobs"]) == 3
            
            # Check ordering: newest first
            assert data["jobs"][0]["job_id"] == "job-1"
            assert data["jobs"][0]["status"] == "completed"
            assert data["jobs"][0]["action_type"] == "slice"
            
            assert data["jobs"][1]["job_id"] == "job-2"
            assert data["jobs"][1]["status"] == "running"
            
            assert data["jobs"][2]["job_id"] == "job-3"
            assert data["jobs"][2]["status"] == "failed"
        finally:
            app.dependency_overrides.clear()


def test_list_jobs_pagination():
    """Test pagination with limit and offset."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        # Mock database for pagination test
        async def mock_get_db():
            mock_db = AsyncMock()
            
            call_count = [0]
            
            async def mock_execute(*args, **kwargs):
                call_count[0] += 1
                mock_cursor = AsyncMock()
                
                if call_count[0] % 2 == 1:
                    # Odd calls: COUNT query
                    mock_cursor.fetchone = AsyncMock(return_value=(10,))
                else:
                    # Even calls: SELECT jobs query
                    # args[1] is the SQL parameters tuple (session_id, limit, offset)
                    sql_params = args[1] if len(args) > 1 else ()
                    limit = sql_params[1] if len(sql_params) > 1 else 50
                    offset = sql_params[2] if len(sql_params) > 2 else 0
                    
                    # Generate appropriate result based on offset
                    jobs = []
                    for i in range(offset, min(offset + limit, 10)):
                        jobs.append((
                            f"job-{i}",
                            "completed",
                            f"2024-01-{10-i:02d}T10:00:00Z",
                            None,
                            None,
                            "slice",
                        ))
                    
                    mock_cursor.fetchall = AsyncMock(return_value=jobs)
                
                return mock_cursor
            
            mock_db.execute = mock_execute
            yield mock_db
        
        app.dependency_overrides[get_db] = mock_get_db
        
        try:
            client = TestClient(app)
            
            # Test first page
            response = client.get(
                "/api/jobs",
                headers={"Authorization": "Bearer test-secret-12345"},
                params={"session_id": "test-session", "limit": 3, "offset": 0},
            )
            
            assert response.status_code == 200
            data = response.json()
            assert data["total"] == 10
            assert len(data["jobs"]) == 3
            assert data["limit"] == 3
            assert data["offset"] == 0
            assert data["jobs"][0]["job_id"] == "job-0"
            
            # Test second page
            response = client.get(
                "/api/jobs",
                headers={"Authorization": "Bearer test-secret-12345"},
                params={"session_id": "test-session", "limit": 3, "offset": 3},
            )
            
            assert response.status_code == 200
            data = response.json()
            assert len(data["jobs"]) == 3
            assert data["offset"] == 3
            assert data["jobs"][0]["job_id"] == "job-3"
        finally:
            app.dependency_overrides.clear()


def test_list_jobs_requires_auth():
    """Test that the endpoint requires authentication."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        
        client = TestClient(app)
        
        # No auth header
        response = client.get("/api/jobs")
        assert response.status_code in [401, 403]
        
        # Wrong token
        response = client.get(
            "/api/jobs",
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert response.status_code == 401


def test_list_jobs_limit_bounds():
    """Test that limit parameter is bounded to 1-100."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        # Mock database
        async def mock_get_db():
            mock_db = AsyncMock()
            
            async def mock_execute(*args, **kwargs):
                mock_cursor = AsyncMock()
                mock_cursor.fetchone = AsyncMock(return_value=(0,))
                mock_cursor.fetchall = AsyncMock(return_value=[])
                return mock_cursor
            
            mock_db.execute = mock_execute
            yield mock_db
        
        app.dependency_overrides[get_db] = mock_get_db
        
        try:
            client = TestClient(app)
            
            # limit < 1 should fail
            response = client.get(
                "/api/jobs",
                headers={"Authorization": "Bearer test-secret-12345"},
                params={"limit": 0},
            )
            assert response.status_code == 422
            
            # limit > 100 should fail
            response = client.get(
                "/api/jobs",
                headers={"Authorization": "Bearer test-secret-12345"},
                params={"limit": 101},
            )
            assert response.status_code == 422
            
            # limit = 1 should succeed
            response = client.get(
                "/api/jobs",
                headers={"Authorization": "Bearer test-secret-12345"},
                params={"limit": 1},
            )
            assert response.status_code == 200
            
            # limit = 100 should succeed
            response = client.get(
                "/api/jobs",
                headers={"Authorization": "Bearer test-secret-12345"},
                params={"limit": 100},
            )
            assert response.status_code == 200
        finally:
            app.dependency_overrides.clear()


def test_list_jobs_offset_validation():
    """Test that offset parameter must be >= 0."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        # Mock database
        async def mock_get_db():
            mock_db = AsyncMock()
            
            async def mock_execute(*args, **kwargs):
                mock_cursor = AsyncMock()
                mock_cursor.fetchone = AsyncMock(return_value=(0,))
                mock_cursor.fetchall = AsyncMock(return_value=[])
                return mock_cursor
            
            mock_db.execute = mock_execute
            yield mock_db
        
        app.dependency_overrides[get_db] = mock_get_db
        
        try:
            client = TestClient(app)
            
            # offset < 0 should fail
            response = client.get(
                "/api/jobs",
                headers={"Authorization": "Bearer test-secret-12345"},
                params={"offset": -1},
            )
            assert response.status_code == 422
            
            # offset = 0 should succeed
            response = client.get(
                "/api/jobs",
                headers={"Authorization": "Bearer test-secret-12345"},
                params={"offset": 0},
            )
            assert response.status_code == 200
        finally:
            app.dependency_overrides.clear()



@pytest.mark.asyncio
async def test_cancel_queued_job(test_db):
    """Test cancelling a job that is still queued."""
    # Insert a queued job
    async with test_db as db:
        await db.execute("PRAGMA foreign_keys = ON")
        
        await db.execute(
            """
            INSERT INTO jobs (job_id, session_id, submitted_at, status, action_type, cli_args, output_dir)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            ("job-queued", "test-session", "2024-01-01T10:00:00Z", "queued", "slice", "[]", "/tmp/job-queued"),
        )
        
        await db.commit()
    
    # Cancel the job
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.delete(
            "/api/jobs/job-queued",
            headers={"Authorization": "Bearer changeme"},
        )
    
    assert response.status_code == 200
    data = response.json()
    assert data["job_id"] == "job-queued"
    assert data["previous_status"] == "queued"
    assert data["message"] == "Job cancelled successfully"
    
    # Verify job status changed to failed
    async with test_db as db:
        cursor = await db.execute(
            "SELECT status, error_message FROM jobs WHERE job_id = ?",
            ("job-queued",),
        )
        row = await cursor.fetchone()
        assert row[0] == "failed"
        assert "cancelled" in row[1].lower()


@pytest.mark.asyncio
async def test_cancel_nonexistent_job(test_db):
    """Test cancelling a job that doesn't exist returns 404."""
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.delete(
            "/api/jobs/nonexistent-job",
            headers={"Authorization": "Bearer changeme"},
        )
    
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_cancel_completed_job(test_db):
    """Test cancelling a job that has already completed returns 409."""
    # Insert a completed job
    async with test_db as db:
        await db.execute("PRAGMA foreign_keys = ON")
        
        await db.execute(
            """
            INSERT INTO jobs (job_id, session_id, submitted_at, status, action_type, cli_args, output_dir, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("job-completed", "test-session", "2024-01-01T10:00:00Z", "completed", "slice", "[]", "/tmp/job-completed", "2024-01-01T10:05:00Z"),
        )
        
        await db.commit()
    
    # Try to cancel the completed job
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.delete(
            "/api/jobs/job-completed",
            headers={"Authorization": "Bearer changeme"},
        )
    
    assert response.status_code == 409
    assert "terminal state" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_cancel_failed_job(test_db):
    """Test cancelling a job that has failed returns 409."""
    # Insert a failed job
    async with test_db as db:
        await db.execute("PRAGMA foreign_keys = ON")
        
        await db.execute(
            """
            INSERT INTO jobs (job_id, session_id, submitted_at, status, action_type, cli_args, output_dir, completed_at, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("job-failed", "test-session", "2024-01-01T10:00:00Z", "failed", "slice", "[]", "/tmp/job-failed", "2024-01-01T10:05:00Z", "CLI error"),
        )
        
        await db.commit()
    
    # Try to cancel the failed job
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.delete(
            "/api/jobs/job-failed",
            headers={"Authorization": "Bearer changeme"},
        )
    
    assert response.status_code == 409
    assert "terminal state" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_cancel_timed_out_job(test_db):
    """Test cancelling a job that has timed out returns 409."""
    # Insert a timed out job
    async with test_db as db:
        await db.execute("PRAGMA foreign_keys = ON")
        
        await db.execute(
            """
            INSERT INTO jobs (job_id, session_id, submitted_at, status, action_type, cli_args, output_dir, completed_at, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("job-timeout", "test-session", "2024-01-01T10:00:00Z", "timed_out", "slice", "[]", "/tmp/job-timeout", "2024-01-01T11:00:00Z", "Job timed out"),
        )
        
        await db.commit()
    
    # Try to cancel the timed out job
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.delete(
            "/api/jobs/job-timeout",
            headers={"Authorization": "Bearer changeme"},
        )
    
    assert response.status_code == 409
    assert "terminal state" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_cancel_job_requires_auth(test_db):
    """Test that cancelling a job requires authentication."""
    async with AsyncClient(app=app, base_url="http://test") as client:
        # No auth header
        response = await client.delete("/api/jobs/any-job")
        assert response.status_code == 401
        
        # Wrong token
        response = await client.delete(
            "/api/jobs/any-job",
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert response.status_code == 401
