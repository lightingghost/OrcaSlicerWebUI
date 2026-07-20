"""
Integration tests for DELETE /api/jobs/{job_id} endpoint.

Tests job cancellation for queued and running jobs.

Requirements: 6.5
"""

import asyncio
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.job_manager import JobManager


@pytest.fixture
async def temp_workspace():
    """Create a temporary workspace for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        workspace = Path(tmpdir)
        
        # Create required subdirectories
        (workspace / "sessions").mkdir()
        (workspace / "jobs").mkdir()
        (workspace / "custom_profiles").mkdir()
        
        yield workspace


@pytest.fixture
async def test_config(temp_workspace):
    """Create test configuration."""
    # Create a fake OrcaSlicer directory structure
    fake_orca_dir = temp_workspace / "orca-slicer"
    fake_build_dir = fake_orca_dir / "build" / "linux"
    fake_build_dir.mkdir(parents=True)
    fake_cli_path = fake_build_dir / "OrcaSlicer_test"
    fake_cli_path.write_text("#!/bin/sh\necho 'test'")
    fake_cli_path.chmod(0o755)
    
    # Create profiles directory
    profiles_dir = fake_orca_dir / "resources" / "profiles"
    profiles_dir.mkdir(parents=True)
    
    import os
    os.environ["WORKSPACE_ROOT"] = str(temp_workspace)
    os.environ["ORCA_CLI_PATH"] = str(fake_cli_path)
    os.environ["API_SECRET"] = "changeme"
    os.environ["MAX_CONCURRENT_JOBS"] = "2"
    os.environ["JOB_TIMEOUT_SECONDS"] = "60"
    
    yield
    
    # Cleanup
    for key in ["WORKSPACE_ROOT", "ORCA_CLI_PATH", "API_SECRET", "MAX_CONCURRENT_JOBS", "JOB_TIMEOUT_SECONDS"]:
        if key in os.environ:
            del os.environ[key]


@pytest.fixture
async def initialized_app(test_config, temp_workspace):
    """Fixture that provides a fully initialized app with job manager."""
    # Clean import after environment is set
    import sys
    for module in list(sys.modules.keys()):
        if module.startswith('app.'):
            del sys.modules[module]
    
    # Initialize the database manually
    from app.database import init_db, get_db_path
    await init_db()
    
    # Import app and create job manager
    from app.main import app
    from app.config import settings
    from app.auth import init_auth
    from app.job_manager import JobManager
    
    # Initialize authentication
    init_auth(settings.api_secret)
    
    # Initialize job manager and attach to app.state
    db_path = get_db_path()
    job_manager = JobManager(settings, db_path)
    await job_manager.start()
    app.state.job_manager = job_manager
    
    yield app, db_path
    
    # Clean up job manager
    await job_manager.stop()


@pytest.mark.asyncio
async def test_cancel_queued_job_integration(initialized_app):
    """
    Integration test: Cancel a queued job.
    
    This tests the full flow of cancelling a job that is in the queue.
    """
    app, db_path = initialized_app
    import aiosqlite
    
    # Insert a queued job directly into the database
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        
        await db.execute(
            """
            INSERT INTO jobs (job_id, session_id, submitted_at, status, action_type, cli_args, output_dir)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            ("test-job-1", "test-session", "2024-01-01T10:00:00Z", "queued", "slice", "[]", "/tmp/test-job-1"),
        )
        
        await db.commit()
    
    # Make the API call to cancel the job
    from httpx import ASGITransport, AsyncClient
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.delete(
            "/api/jobs/test-job-1",
            headers={"Authorization": "Bearer changeme"},
        )
    
    # Verify response
    assert response.status_code == 200
    data = response.json()
    assert data["job_id"] == "test-job-1"
    assert data["previous_status"] == "queued"
    assert "cancelled" in data["message"].lower() or "cancel" in data["message"].lower()
    
    # Verify job status changed to failed in database
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        cursor = await db.execute(
            "SELECT status, error_message FROM jobs WHERE job_id = ?",
            ("test-job-1",),
        )
        row = await cursor.fetchone()
        assert row is not None
        assert row[0] == "failed"
        assert row[1] is not None
        assert "cancel" in row[1].lower()


@pytest.mark.asyncio
async def test_cancel_nonexistent_job(initialized_app):
    """Test cancelling a job that doesn't exist returns 404."""
    app, db_path = initialized_app
    from httpx import ASGITransport, AsyncClient
    
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.delete(
            "/api/jobs/nonexistent-job",
            headers={"Authorization": "Bearer changeme"},
        )
    
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_cancel_completed_job(initialized_app):
    """Test cancelling a completed job returns 409."""
    app, db_path = initialized_app
    from httpx import ASGITransport, AsyncClient
    import aiosqlite
    
    # Insert a completed job
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        
        await db.execute(
            """
            INSERT INTO jobs (job_id, session_id, submitted_at, status, action_type, cli_args, output_dir, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("completed-job", "test-session", "2024-01-01T10:00:00Z", "completed", "slice", "[]", "/tmp/completed-job", "2024-01-01T10:05:00Z"),
        )
        
        await db.commit()
    
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.delete(
            "/api/jobs/completed-job",
            headers={"Authorization": "Bearer changeme"},
        )
    
    assert response.status_code == 409
    assert "terminal state" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_cancel_job_requires_auth(initialized_app):
    """Test that cancelling a job requires authentication."""
    app, db_path = initialized_app
    from httpx import ASGITransport, AsyncClient
    
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # No auth header
        response = await client.delete("/api/jobs/any-job")
        assert response.status_code == 401  # FastAPI + HTTPBearer returns 401 for missing credentials
        
        # Wrong token
        response = await client.delete(
            "/api/jobs/any-job",
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert response.status_code == 401
