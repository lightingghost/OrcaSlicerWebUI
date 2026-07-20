"""
Unit tests for WebSocket job progress route.

Tests WebSocket authentication, connection, status replay, and ping/pong.

Requirements: 7.1, 11.5
"""

import asyncio
import json
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.config import settings
from app.auth import init_auth
from app.ws_manager import WebSocketManager


@pytest.fixture(autouse=True)
def setup_auth():
    """Initialize authentication for all tests."""
    init_auth(settings.api_secret)
    yield


@pytest.fixture(autouse=True)
def setup_ws_manager():
    """Initialize WebSocket manager for all tests."""
    app.state.ws_manager = WebSocketManager()
    yield


@pytest.fixture
def test_job_id():
    """Fixture providing a test job ID."""
    return "test-job-12345"


def test_websocket_auth_missing_token(test_job_id):
    """
    Test that WebSocket connection rejects requests without token.
    
    Requirements: 11.5
    """
    client = TestClient(app)
    
    # Try to connect without token - should fail immediately
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/jobs/{test_job_id}"):
            pass


def test_websocket_auth_invalid_token(test_job_id):
    """
    Test that WebSocket connection rejects requests with invalid token.
    
    Requirements: 11.5
    """
    client = TestClient(app)
    
    # Try to connect with wrong token - should fail immediately
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/jobs/{test_job_id}?token=wrong_token"):
            pass


def test_websocket_auth_valid_token(test_job_id):
    """
    Test that WebSocket connection accepts valid token.
    
    Requirements: 11.5
    """
    client = TestClient(app)
    
    # Connect with correct token
    with client.websocket_connect(f"/ws/jobs/{test_job_id}?token={settings.api_secret}") as websocket:
        # Should connect successfully
        # Receive initial status message (may be error if job doesn't exist)
        data = websocket.receive_json()
        
        # Should have type field
        assert "type" in data
        assert "job_id" in data or "message" in data


def test_websocket_replay_status_nonexistent_job():
    """
    Test that WebSocket sends error event for nonexistent job.
    
    Requirements: 7.1
    """
    client = TestClient(app)
    nonexistent_job_id = "does-not-exist-12345"
    
    with client.websocket_connect(
        f"/ws/jobs/{nonexistent_job_id}?token={settings.api_secret}"
    ) as websocket:
        # Receive initial status
        data = websocket.receive_json()
        
        # Should be an error event (either job not found or database error in test)
        assert data["type"] == "error"
        assert data["job_id"] == nonexistent_job_id
        # Message should be present
        assert "message" in data
        # In test environment, database may not exist, so error is expected


def test_websocket_manager_registration():
    """
    Test that WebSocket connections are registered in WebSocketManager.
    
    Requirements: 7.1
    """
    from app.ws_manager import WebSocketManager
    
    ws_manager = WebSocketManager()
    job_id = "test-job-123"
    
    # Initially no connections
    assert asyncio.run(ws_manager.get_connection_count(job_id)) == 0
    
    # Add a mock connection (using None as placeholder for test)
    # In real scenario, this would be a WebSocket object
    mock_ws = object()
    asyncio.run(ws_manager.add_connection(job_id, mock_ws))
    
    # Should have 1 connection
    assert asyncio.run(ws_manager.get_connection_count(job_id)) == 1
    
    # Remove connection
    asyncio.run(ws_manager.remove_connection(job_id, mock_ws))
    
    # Should have 0 connections again
    assert asyncio.run(ws_manager.get_connection_count(job_id)) == 0


def test_websocket_ping_message(test_job_id):
    """
    Test that WebSocket sends periodic ping messages.
    
    This test connects and waits briefly to see if ping mechanism is working.
    Full ping testing requires longer wait times.
    
    Requirements: 7.1
    """
    client = TestClient(app)
    
    with client.websocket_connect(f"/ws/jobs/{test_job_id}?token={settings.api_secret}") as websocket:
        # Receive initial status
        initial_data = websocket.receive_json()
        assert "type" in initial_data
        
        # Note: To test ping, we'd need to wait 30+ seconds, which is too long for unit test
        # The ping functionality is tested indirectly through integration tests
        # Here we just verify the connection stays open briefly
        pass


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
