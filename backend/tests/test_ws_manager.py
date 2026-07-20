"""
Unit tests for WebSocketManager.

Tests connection lifecycle management, broadcasting, error handling,
and thread-safe concurrent access.
"""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.ws_manager import WebSocketManager


@pytest.fixture
def ws_manager():
    """Create a WebSocketManager instance for testing."""
    return WebSocketManager()


@pytest.fixture
def mock_websocket():
    """Create a mock WebSocket connection."""
    websocket = MagicMock()
    websocket.send_text = AsyncMock()
    websocket.close = AsyncMock()
    return websocket


@pytest.mark.asyncio
async def test_add_connection_creates_new_job_entry(ws_manager, mock_websocket):
    """Test that adding a connection for a new job creates the job entry."""
    job_id = "test-job-1"
    
    await ws_manager.add_connection(job_id, mock_websocket)
    
    count = await ws_manager.get_connection_count(job_id)
    assert count == 1


@pytest.mark.asyncio
async def test_add_connection_appends_to_existing_job(ws_manager, mock_websocket):
    """Test that adding multiple connections to the same job appends them."""
    job_id = "test-job-1"
    websocket2 = MagicMock()
    websocket2.send_text = AsyncMock()
    
    await ws_manager.add_connection(job_id, mock_websocket)
    await ws_manager.add_connection(job_id, websocket2)
    
    count = await ws_manager.get_connection_count(job_id)
    assert count == 2


@pytest.mark.asyncio
async def test_remove_connection_removes_websocket(ws_manager, mock_websocket):
    """Test that removing a connection removes it from the registry."""
    job_id = "test-job-1"
    
    await ws_manager.add_connection(job_id, mock_websocket)
    await ws_manager.remove_connection(job_id, mock_websocket)
    
    count = await ws_manager.get_connection_count(job_id)
    assert count == 0


@pytest.mark.asyncio
async def test_remove_connection_cleans_up_empty_job_entry(ws_manager, mock_websocket):
    """Test that removing the last connection removes the job entry."""
    job_id = "test-job-1"
    
    await ws_manager.add_connection(job_id, mock_websocket)
    await ws_manager.remove_connection(job_id, mock_websocket)
    
    # Verify job entry is removed by checking internal state
    async with ws_manager._lock:
        assert job_id not in ws_manager._connections


@pytest.mark.asyncio
async def test_remove_connection_handles_nonexistent_job(ws_manager, mock_websocket):
    """Test that removing a connection for a nonexistent job doesn't error."""
    job_id = "nonexistent-job"
    
    # Should not raise an exception
    await ws_manager.remove_connection(job_id, mock_websocket)


@pytest.mark.asyncio
async def test_remove_connection_handles_nonexistent_websocket(ws_manager, mock_websocket):
    """Test that removing a nonexistent websocket doesn't error."""
    job_id = "test-job-1"
    websocket2 = MagicMock()
    
    await ws_manager.add_connection(job_id, mock_websocket)
    
    # Removing a websocket that was never added should not error
    await ws_manager.remove_connection(job_id, websocket2)
    
    count = await ws_manager.get_connection_count(job_id)
    assert count == 1  # Original websocket still there


@pytest.mark.asyncio
async def test_broadcast_sends_to_all_connections(ws_manager):
    """Test that broadcast sends the event to all connected clients."""
    job_id = "test-job-1"
    websocket1 = MagicMock()
    websocket1.send_text = AsyncMock()
    websocket2 = MagicMock()
    websocket2.send_text = AsyncMock()
    
    await ws_manager.add_connection(job_id, websocket1)
    await ws_manager.add_connection(job_id, websocket2)
    
    event = {
        "type": "progress",
        "job_id": job_id,
        "total_percent": 50,
        "message": "Processing...",
    }
    
    await ws_manager.broadcast(job_id, event)
    
    # Both connections should receive the event
    expected_json = json.dumps(event)
    websocket1.send_text.assert_called_once_with(expected_json)
    websocket2.send_text.assert_called_once_with(expected_json)


@pytest.mark.asyncio
async def test_broadcast_to_nonexistent_job_does_nothing(ws_manager):
    """Test that broadcasting to a job with no connections doesn't error."""
    job_id = "nonexistent-job"
    event = {"type": "progress", "job_id": job_id}
    
    # Should not raise an exception
    await ws_manager.broadcast(job_id, event)


@pytest.mark.asyncio
async def test_broadcast_handles_send_failure(ws_manager):
    """Test that broadcast handles connection failures gracefully."""
    job_id = "test-job-1"
    
    # Create one good connection and one failing connection
    good_websocket = MagicMock()
    good_websocket.send_text = AsyncMock()
    
    failing_websocket = MagicMock()
    failing_websocket.send_text = AsyncMock(side_effect=Exception("Connection lost"))
    
    await ws_manager.add_connection(job_id, good_websocket)
    await ws_manager.add_connection(job_id, failing_websocket)
    
    event = {"type": "progress", "job_id": job_id}
    
    await ws_manager.broadcast(job_id, event)
    
    # Good connection should still receive the event
    good_websocket.send_text.assert_called_once()
    
    # Failing connection should be removed
    count = await ws_manager.get_connection_count(job_id)
    assert count == 1


@pytest.mark.asyncio
async def test_broadcast_removes_all_failed_connections(ws_manager):
    """Test that all failed connections are removed after broadcast."""
    job_id = "test-job-1"
    
    # Create multiple failing connections
    failing1 = MagicMock()
    failing1.send_text = AsyncMock(side_effect=Exception("Error 1"))
    failing2 = MagicMock()
    failing2.send_text = AsyncMock(side_effect=Exception("Error 2"))
    
    await ws_manager.add_connection(job_id, failing1)
    await ws_manager.add_connection(job_id, failing2)
    
    event = {"type": "progress", "job_id": job_id}
    
    await ws_manager.broadcast(job_id, event)
    
    # All connections should be removed
    count = await ws_manager.get_connection_count(job_id)
    assert count == 0


@pytest.mark.asyncio
async def test_broadcast_handles_serialization_error(ws_manager, mock_websocket):
    """Test that broadcast handles JSON serialization errors."""
    job_id = "test-job-1"
    
    await ws_manager.add_connection(job_id, mock_websocket)
    
    # Create an event that can't be serialized (contains a non-serializable object)
    class NonSerializable:
        pass
    
    event = {"type": "progress", "data": NonSerializable()}
    
    # Should not raise an exception, but should log error
    await ws_manager.broadcast(job_id, event)
    
    # Websocket should not be called since serialization failed
    mock_websocket.send_text.assert_not_called()


@pytest.mark.asyncio
async def test_get_connection_count_returns_zero_for_nonexistent_job(ws_manager):
    """Test that get_connection_count returns 0 for nonexistent jobs."""
    count = await ws_manager.get_connection_count("nonexistent-job")
    assert count == 0


@pytest.mark.asyncio
async def test_get_total_connections_counts_all_jobs(ws_manager):
    """Test that get_total_connections sums across all jobs."""
    job1_ws1 = MagicMock()
    job1_ws1.send_text = AsyncMock()
    job1_ws2 = MagicMock()
    job1_ws2.send_text = AsyncMock()
    job2_ws1 = MagicMock()
    job2_ws1.send_text = AsyncMock()
    
    await ws_manager.add_connection("job-1", job1_ws1)
    await ws_manager.add_connection("job-1", job1_ws2)
    await ws_manager.add_connection("job-2", job2_ws1)
    
    total = await ws_manager.get_total_connections()
    assert total == 3


@pytest.mark.asyncio
async def test_get_total_connections_returns_zero_when_empty(ws_manager):
    """Test that get_total_connections returns 0 when no connections exist."""
    total = await ws_manager.get_total_connections()
    assert total == 0


@pytest.mark.asyncio
async def test_close_all_connections_closes_all_websockets(ws_manager):
    """Test that close_all_connections closes all websockets for a job."""
    job_id = "test-job-1"
    
    websocket1 = MagicMock()
    websocket1.close = AsyncMock()
    websocket2 = MagicMock()
    websocket2.close = AsyncMock()
    
    await ws_manager.add_connection(job_id, websocket1)
    await ws_manager.add_connection(job_id, websocket2)
    
    await ws_manager.close_all_connections(job_id)
    
    # Both websockets should be closed
    websocket1.close.assert_called_once()
    websocket2.close.assert_called_once()
    
    # Job entry should be removed
    count = await ws_manager.get_connection_count(job_id)
    assert count == 0


@pytest.mark.asyncio
async def test_close_all_connections_handles_close_errors(ws_manager):
    """Test that close_all_connections handles errors gracefully."""
    job_id = "test-job-1"
    
    websocket = MagicMock()
    websocket.close = AsyncMock(side_effect=Exception("Close error"))
    
    await ws_manager.add_connection(job_id, websocket)
    
    # Should not raise an exception
    await ws_manager.close_all_connections(job_id)
    
    # Job entry should still be removed
    count = await ws_manager.get_connection_count(job_id)
    assert count == 0


@pytest.mark.asyncio
async def test_close_all_connections_for_nonexistent_job(ws_manager):
    """Test that close_all_connections handles nonexistent jobs."""
    # Should not raise an exception
    await ws_manager.close_all_connections("nonexistent-job")


@pytest.mark.asyncio
async def test_concurrent_add_remove_is_thread_safe(ws_manager):
    """Test that concurrent add/remove operations are thread-safe."""
    job_id = "test-job-1"
    
    # Create multiple websockets
    websockets = []
    for i in range(10):
        ws = MagicMock()
        ws.send_text = AsyncMock()
        websockets.append(ws)
    
    # Concurrently add all connections
    await asyncio.gather(
        *[ws_manager.add_connection(job_id, ws) for ws in websockets]
    )
    
    count = await ws_manager.get_connection_count(job_id)
    assert count == 10
    
    # Concurrently remove all connections
    await asyncio.gather(
        *[ws_manager.remove_connection(job_id, ws) for ws in websockets]
    )
    
    count = await ws_manager.get_connection_count(job_id)
    assert count == 0


@pytest.mark.asyncio
async def test_concurrent_broadcast_is_thread_safe(ws_manager):
    """Test that concurrent broadcast operations are thread-safe."""
    job_id = "test-job-1"
    
    # Add several connections
    websockets = []
    for i in range(5):
        ws = MagicMock()
        ws.send_text = AsyncMock()
        websockets.append(ws)
        await ws_manager.add_connection(job_id, ws)
    
    # Concurrently broadcast multiple events
    events = [
        {"type": "progress", "total_percent": i}
        for i in range(10)
    ]
    
    await asyncio.gather(
        *[ws_manager.broadcast(job_id, event) for event in events]
    )
    
    # Each websocket should have been called 10 times (once per broadcast)
    for ws in websockets:
        assert ws.send_text.call_count == 10


@pytest.mark.asyncio
async def test_broadcast_event_contains_required_fields(ws_manager, mock_websocket):
    """Test that broadcast preserves all event fields in the JSON."""
    job_id = "test-job-1"
    
    await ws_manager.add_connection(job_id, mock_websocket)
    
    event = {
        "type": "progress",
        "job_id": job_id,
        "plate_index": 0,
        "plate_count": 2,
        "plate_percent": 45,
        "total_percent": 22,
        "message": "Slicing layer 100/250",
        "timestamp": "2024-01-15T10:30:00Z",
    }
    
    await ws_manager.broadcast(job_id, event)
    
    # Verify the exact JSON was sent
    expected_json = json.dumps(event)
    mock_websocket.send_text.assert_called_once_with(expected_json)
    
    # Parse the sent JSON and verify all fields are present
    call_args = mock_websocket.send_text.call_args[0][0]
    sent_event = json.loads(call_args)
    
    assert sent_event["type"] == "progress"
    assert sent_event["job_id"] == job_id
    assert sent_event["plate_index"] == 0
    assert sent_event["plate_count"] == 2
    assert sent_event["plate_percent"] == 45
    assert sent_event["total_percent"] == 22
    assert sent_event["message"] == "Slicing layer 100/250"
    assert sent_event["timestamp"] == "2024-01-15T10:30:00Z"


@pytest.mark.asyncio
async def test_multiple_jobs_are_isolated(ws_manager):
    """Test that connections for different jobs are isolated."""
    job1_ws = MagicMock()
    job1_ws.send_text = AsyncMock()
    job2_ws = MagicMock()
    job2_ws.send_text = AsyncMock()
    
    await ws_manager.add_connection("job-1", job1_ws)
    await ws_manager.add_connection("job-2", job2_ws)
    
    # Broadcast to job-1 only
    event = {"type": "progress", "job_id": "job-1"}
    await ws_manager.broadcast("job-1", event)
    
    # Only job-1's websocket should receive the event
    job1_ws.send_text.assert_called_once()
    job2_ws.send_text.assert_not_called()
