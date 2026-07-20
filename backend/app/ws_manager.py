"""
WebSocket connection manager for real-time job progress streaming.

This module implements the WebSocketManager class which handles:
- Per-job WebSocket connection registry
- Broadcasting events to all connected clients for a specific job
- Connection/disconnection lifecycle management
- Thread-safe operations for concurrent access

Requirements: 7.1
"""

import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WebSocketManager:
    """
    Manages WebSocket connections for real-time job progress streaming.
    
    The WebSocketManager maintains a registry of active WebSocket connections
    organized by job_id. It provides thread-safe methods to add/remove
    connections and broadcast JSON events to all clients subscribed to a
    specific job.
    
    Attributes:
        _connections: Dict mapping job_id to list of active WebSocket connections
        _lock: Asyncio lock for thread-safe access to the connections registry
    """
    
    def __init__(self):
        """Initialize the WebSocketManager with an empty connection registry."""
        # Map job_id -> list of WebSocket connections
        self._connections: dict[str, list[WebSocket]] = {}
        
        # Lock for thread-safe access to connections
        self._lock = asyncio.Lock()
    
    async def add_connection(self, job_id: str, websocket: WebSocket) -> None:
        """
        Register a new WebSocket connection for a job.
        
        Adds the websocket to the list of connections subscribed to the
        specified job_id. Creates the job entry if it doesn't exist.
        
        Args:
            job_id: The job identifier to subscribe to
            websocket: The WebSocket connection to register
        """
        async with self._lock:
            if job_id not in self._connections:
                self._connections[job_id] = []
            
            self._connections[job_id].append(websocket)
            
            logger.info(
                f"WebSocket connected for job {job_id}. "
                f"Total connections: {len(self._connections[job_id])}"
            )
    
    async def remove_connection(self, job_id: str, websocket: WebSocket) -> None:
        """
        Unregister a WebSocket connection for a job.
        
        Removes the websocket from the list of connections for the specified
        job_id. Cleans up the job entry if no connections remain.
        
        Args:
            job_id: The job identifier
            websocket: The WebSocket connection to unregister
        """
        async with self._lock:
            if job_id in self._connections:
                if websocket in self._connections[job_id]:
                    self._connections[job_id].remove(websocket)
                    
                    logger.info(
                        f"WebSocket disconnected for job {job_id}. "
                        f"Remaining connections: {len(self._connections[job_id])}"
                    )
                
                # Clean up empty job entries
                if not self._connections[job_id]:
                    del self._connections[job_id]
                    logger.info(f"Removed job {job_id} from connection registry (no connections)")
    
    async def broadcast(self, job_id: str, event_dict: dict[str, Any]) -> None:
        """
        Broadcast a JSON event to all connected clients for a specific job.
        
        Sends the event_dict as JSON to all WebSocket connections subscribed
        to the specified job_id. Handles connection errors gracefully by
        removing failed connections from the registry.
        
        Args:
            job_id: The job identifier whose subscribers will receive the event
            event_dict: Dictionary containing the event data. Must include a
                       'type' field and will be serialized to JSON.
        
        Example:
            await ws_manager.broadcast("job-123", {
                "type": "progress",
                "job_id": "job-123",
                "total_percent": 45,
                "message": "Slicing plate 1/2",
                "timestamp": "2024-01-15T10:30:00Z"
            })
        """
        async with self._lock:
            if job_id not in self._connections:
                # No subscribers for this job
                return
            
            # Get a snapshot of connections to avoid holding lock during I/O
            connections = self._connections[job_id].copy()
        
        # Serialize event to JSON once
        try:
            event_json = json.dumps(event_dict)
        except (TypeError, ValueError) as e:
            logger.error(f"Failed to serialize event for job {job_id}: {e}")
            return
        
        # Send to all connections
        failed_connections: list[WebSocket] = []
        
        for websocket in connections:
            try:
                await websocket.send_text(event_json)
            except Exception as e:
                # Connection failed - mark for removal
                logger.warning(
                    f"Failed to send event to WebSocket for job {job_id}: {e}"
                )
                failed_connections.append(websocket)
        
        # Remove failed connections
        if failed_connections:
            async with self._lock:
                if job_id in self._connections:
                    for websocket in failed_connections:
                        if websocket in self._connections[job_id]:
                            self._connections[job_id].remove(websocket)
                    
                    # Clean up empty job entries
                    if not self._connections[job_id]:
                        del self._connections[job_id]
            
            logger.info(
                f"Removed {len(failed_connections)} failed connections for job {job_id}"
            )
    
    async def get_connection_count(self, job_id: str) -> int:
        """
        Get the number of active connections for a job.
        
        Args:
            job_id: The job identifier
            
        Returns:
            Number of active WebSocket connections for the job
        """
        async with self._lock:
            return len(self._connections.get(job_id, []))
    
    async def get_total_connections(self) -> int:
        """
        Get the total number of active WebSocket connections across all jobs.
        
        Returns:
            Total number of active connections
        """
        async with self._lock:
            return sum(len(conns) for conns in self._connections.values())
    
    async def close_all_connections(self, job_id: str) -> None:
        """
        Close all WebSocket connections for a specific job.
        
        Useful for cleanup when a job is cancelled or completes.
        
        Args:
            job_id: The job identifier whose connections should be closed
        """
        async with self._lock:
            if job_id not in self._connections:
                return
            
            connections = self._connections[job_id].copy()
            del self._connections[job_id]
        
        # Close all connections
        for websocket in connections:
            try:
                await websocket.close()
            except Exception as e:
                logger.warning(f"Error closing WebSocket for job {job_id}: {e}")
        
        logger.info(f"Closed {len(connections)} connections for job {job_id}")
