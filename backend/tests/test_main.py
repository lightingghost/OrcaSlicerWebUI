"""
Tests for FastAPI application main module.

Feature: orca-slicer-web-ui
Tests app initialization, lifespan management, CORS configuration, and health endpoint.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient


@pytest.fixture
def mock_cleanup_module():
    """Mock the cleanup module to prevent actual cleanup task startup."""
    with patch("app.cleanup.run_cleanup_loop") as mock:
        mock.return_value = AsyncMock()
        yield mock


@pytest.fixture
def mock_database_module():
    """Mock the database module to prevent actual database operations."""
    with patch("app.database.init_db") as mock:
        mock.return_value = AsyncMock()
        yield mock


@pytest.fixture
def mock_auth_module():
    """Mock the auth module to prevent actual auth initialization."""
    with patch("app.auth.init_auth") as mock:
        yield mock


@pytest.fixture
def mock_workspace_init():
    """
    Prevent lifespan's `settings.init_user_workspace()` call from creating
    real directories. The default settings singleton points workspace_root
    at /app/workspace (production default), which this dev/test
    environment has no write permission for — without this mock, every
    lifespan-triggering test fails with PermissionError before it even
    gets to the behavior under test.

    Patched on the `Settings` class (not the `settings` instance) because
    pydantic BaseSettings instances reject `delattr`, which
    unittest.mock.patch.object's teardown requires when patching an
    instance attribute that doesn't already exist on that instance.
    """
    from app.config import Settings
    with patch.object(Settings, "init_user_workspace"):
        yield


@pytest.fixture
def test_client(mock_cleanup_module, mock_database_module, mock_auth_module, mock_workspace_init):
    """
    Create a TestClient with mocked dependencies.
    
    This avoids actual database creation and cleanup task startup during tests.
    """
    from app.main import app
    
    with TestClient(app) as client:
        yield client


def test_app_instantiation():
    """Test that the FastAPI app is instantiated with correct metadata."""
    from app.main import app
    
    assert app.title == "OrcaSlicer Web UI API"
    assert app.description == "REST API and WebSocket server for browser-based OrcaSlicer CLI interaction"
    assert app.version == "0.1.0"


def test_cors_middleware_configured():
    """Test that CORS middleware is properly configured."""
    from app.main import app
    from fastapi.middleware.cors import CORSMiddleware
    
    # Check that CORSMiddleware is in the middleware stack
    # FastAPI wraps middlewares, so we need to check the cls attribute
    has_cors = any(
        hasattr(m, 'cls') and m.cls == CORSMiddleware
        for m in app.user_middleware
    )
    assert has_cors, "CORS middleware not found in app middleware stack"


def test_health_endpoint_healthy(test_client, tmp_path):
    """
    Test health endpoint returns 'healthy' when CLI and workspace are accessible.
    
    Requirements: 12.3
    """
    # Create temporary CLI binary and workspace
    cli_path = tmp_path / "orca-slicer"
    cli_path.touch()
    workspace_path = tmp_path / "workspace"
    workspace_path.mkdir()
    
    # Patch settings in the config module where it's imported from
    with patch("app.config.settings") as mock_settings:
        mock_settings.orca_cli_path = str(cli_path)
        mock_settings.workspace_root = str(workspace_path)
        
        response = test_client.get("/health")
    
    assert response.status_code == 200
    data = response.json()
    
    assert data["status"] == "healthy"
    assert data["cli_available"] is True
    assert data["workspace_accessible"] is True
    assert data["cli_path"] == str(cli_path)
    assert data["workspace_root"] == str(workspace_path)


def test_health_endpoint_degraded_missing_cli(test_client, tmp_path):
    """
    Test health endpoint returns 'degraded' when CLI binary is missing.
    
    Requirements: 12.3
    """
    workspace_path = tmp_path / "workspace"
    workspace_path.mkdir()
    
    # Patch settings in the config module where it's imported from
    with patch("app.config.settings") as mock_settings:
        mock_settings.orca_cli_path = "/nonexistent/orca-slicer"
        mock_settings.workspace_root = str(workspace_path)
        
        response = test_client.get("/health")
    
    assert response.status_code == 200
    data = response.json()
    
    assert data["status"] == "degraded"
    assert data["cli_available"] is False
    assert data["workspace_accessible"] is True


def test_health_endpoint_degraded_missing_workspace(test_client, tmp_path):
    """
    Test health endpoint returns 'degraded' when workspace is inaccessible.
    
    Requirements: 12.3
    """
    cli_path = tmp_path / "orca-slicer"
    cli_path.touch()
    
    # Patch settings in the config module where it's imported from
    with patch("app.config.settings") as mock_settings:
        mock_settings.orca_cli_path = str(cli_path)
        mock_settings.workspace_root = "/nonexistent/workspace"
        
        response = test_client.get("/health")
    
    assert response.status_code == 200
    data = response.json()
    
    assert data["status"] == "degraded"
    assert data["cli_available"] is True
    assert data["workspace_accessible"] is False


def test_health_endpoint_no_auth_required(test_client):
    """
    Test that health endpoint does not require authentication.
    
    Requirements: 12.3
    """
    # Make request without Authorization header
    response = test_client.get("/health")
    
    # Should not return 401 Unauthorized
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_lifespan_initializes_database(mock_database_module, mock_auth_module, mock_cleanup_module, mock_workspace_init):
    """Test that lifespan context manager initializes the database on startup."""
    from app.main import app
    
    # Trigger lifespan startup
    async with app.router.lifespan_context(app):
        pass
    
    # Verify init_db was called
    mock_database_module.assert_called_once()


@pytest.mark.asyncio
async def test_lifespan_initializes_auth(mock_database_module, mock_auth_module, mock_cleanup_module, mock_workspace_init):
    """Test that lifespan context manager initializes authentication on startup."""
    from app.main import app
    
    # Trigger lifespan startup
    async with app.router.lifespan_context(app):
        pass
    
    # Verify init_auth was called with api_secret
    assert mock_auth_module.call_count == 1


@pytest.mark.asyncio
async def test_lifespan_starts_cleanup_task(mock_database_module, mock_auth_module, mock_cleanup_module, mock_workspace_init):
    """Test that lifespan context manager starts the background cleanup task."""
    from app.main import app
    
    # Trigger lifespan startup and shutdown
    async with app.router.lifespan_context(app):
        # Cleanup task should be started
        mock_cleanup_module.assert_called_once()


@pytest.mark.asyncio
async def test_lifespan_handles_database_init_failure(mock_auth_module, mock_cleanup_module, mock_workspace_init):
    """Test that lifespan raises exception when database initialization fails."""
    from app.main import app
    
    with patch("app.database.init_db") as mock_init_db:
        mock_init_db.side_effect = Exception("Database connection failed")
        
        # Lifespan should raise the exception
        with pytest.raises(Exception, match="Database connection failed"):
            async with app.router.lifespan_context(app):
                pass


@pytest.mark.asyncio
async def test_lifespan_continues_on_cleanup_task_failure(mock_database_module, mock_auth_module, mock_workspace_init):
    """Test that lifespan continues startup even if cleanup task fails to start."""
    from app.main import app
    
    with patch("app.cleanup.run_cleanup_loop") as mock_cleanup:
        mock_cleanup.side_effect = Exception("Cleanup task failed")
        
        # Lifespan should not raise (cleanup failure is non-fatal)
        async with app.router.lifespan_context(app):
            pass
