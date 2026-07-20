"""
WebSocket endpoints for real-time job progress streaming.

This module implements WebSocket routes that allow clients to subscribe to
real-time job progress updates.

Requirements: 7.1, 11.5
"""

import asyncio
import json
import logging
from typing import Optional

import aiosqlite
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from starlette.websockets import WebSocketState

from app.auth import verify_websocket_token
from app.database import get_db_path

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/ws/jobs/{job_id}")
async def websocket_job_progress(websocket: WebSocket, job_id: str):
    """
    WebSocket endpoint for real-time job progress updates.
    
    Authenticates via ?token= query parameter, registers the connection with
    the WebSocketManager, replays the last known job status on connect, and
    keeps the connection alive with periodic pings.
    
    Args:
        websocket: The WebSocket connection
        job_id: The job ID to subscribe to
        
    Protocol:
        - Client connects with: ws://host/ws/jobs/{job_id}?token=<api_secret>
        - Server immediately sends current job status
        - Server sends progress events as they occur
        - Server sends ping every 30 seconds
        - Client responds with pong (automatic in most WebSocket clients)
        
    Requirements: 7.1, 11.5
    """
    # Authenticate before accepting the connection
    try:
        await verify_websocket_token(websocket)
    except HTTPException as e:
        # Close with error code for authentication failure
        await websocket.close(code=1008, reason=e.detail)
        logger.warning(f"WebSocket authentication failed for job {job_id}: {e.detail}")
        return
    
    # Accept the WebSocket connection
    await websocket.accept()
    logger.info(f"WebSocket connected for job {job_id}")
    
    # Get WebSocketManager from app state
    ws_manager = websocket.app.state.ws_manager
    
    # Register this connection
    await ws_manager.add_connection(job_id, websocket)
    
    try:
        # Replay last known status on connect
        await _send_current_status(websocket, job_id)
        
        # Keep connection alive with ping/pong
        ping_task = asyncio.create_task(_ping_loop(websocket))
        
        try:
            # Wait for messages (we don't expect any from client, but keep connection open)
            while True:
                try:
                    # Receive with timeout to allow ping task to run
                    await asyncio.wait_for(websocket.receive_text(), timeout=1.0)
                except asyncio.TimeoutError:
                    # No message received, continue waiting
                    continue
                
        finally:
            # Cancel ping task when connection closes
            ping_task.cancel()
            try:
                await ping_task
            except asyncio.CancelledError:
                pass
    
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for job {job_id}")
    
    except Exception as e:
        logger.error(f"WebSocket error for job {job_id}: {e}", exc_info=True)
    
    finally:
        # Unregister connection
        await ws_manager.remove_connection(job_id, websocket)


async def _send_current_status(websocket: WebSocket, job_id: str) -> None:
    """
    Send the current job status to a newly connected WebSocket client.
    
    Queries the database for the job's current state and sends an appropriate
    event message (queued, started, completed, failed, or timed_out).
    
    Args:
        websocket: The WebSocket connection
        job_id: The job ID to query
    """
    try:
        async with aiosqlite.connect(get_db_path()) as db:
            db.row_factory = aiosqlite.Row
            
            cursor = await db.execute(
                """
                SELECT job_id, status, submitted_at, started_at, completed_at,
                       exit_code, error_message, action_type
                FROM jobs
                WHERE job_id = ?
                """,
                (job_id,),
            )
            row = await cursor.fetchone()
        
        if not row:
            # Job not found - send error event
            event = {
                "type": "error",
                "job_id": job_id,
                "message": "Job not found",
                "timestamp": _utc_timestamp(),
            }
            await websocket.send_json(event)
            return
        
        status = row["status"]
        
        # Send appropriate event based on job status
        if status == "queued":
            # For queued jobs, we could calculate queue position but that requires
            # counting jobs ahead in the queue. For now, send a simple queued event.
            event = {
                "type": "queued",
                "job_id": job_id,
                "queue_position": 0,  # TODO: Calculate actual position
                "timestamp": row["submitted_at"],
            }
        
        elif status == "running":
            event = {
                "type": "started",
                "job_id": job_id,
                "timestamp": row["started_at"],
            }
        
        elif status == "completed":
            # Fetch output files for completed jobs
            async with aiosqlite.connect(get_db_path()) as db:
                db.row_factory = aiosqlite.Row
                cursor = await db.execute(
                    """
                    SELECT filename, size_bytes
                    FROM output_files
                    WHERE job_id = ?
                    """,
                    (job_id,),
                )
                output_rows = await cursor.fetchall()
            
            output_files = [
                {
                    "filename": r["filename"],
                    "size_bytes": r["size_bytes"],
                    "download_url": f"/api/jobs/{job_id}/outputs/{r['filename']}",
                }
                for r in output_rows
            ]
            
            event = {
                "type": "completed",
                "job_id": job_id,
                "output_files": output_files,
                "timestamp": row["completed_at"],
            }
        
        elif status == "failed":
            event = {
                "type": "failed",
                "job_id": job_id,
                "exit_code": row["exit_code"],
                "error_message": row["error_message"] or "Unknown error",
                "timestamp": row["completed_at"],
            }
        
        elif status == "timed_out":
            event = {
                "type": "timed_out",
                "job_id": job_id,
                "timeout_seconds": 3600,  # TODO: Get from config
                "timestamp": row["completed_at"],
            }
        
        else:
            # Unknown status
            event = {
                "type": "error",
                "job_id": job_id,
                "message": f"Unknown job status: {status}",
                "timestamp": _utc_timestamp(),
            }
        
        await websocket.send_json(event)
        logger.debug(f"Sent current status '{status}' for job {job_id}")
    
    except Exception as e:
        logger.error(f"Error sending current status for job {job_id}: {e}", exc_info=True)
        # Try to send error event
        try:
            await websocket.send_json({
                "type": "error",
                "job_id": job_id,
                "message": f"Error retrieving job status: {str(e)}",
                "timestamp": _utc_timestamp(),
            })
        except Exception:
            pass


async def _ping_loop(websocket: WebSocket) -> None:
    """
    Send periodic ping messages to keep the WebSocket connection alive.
    
    Sends a ping every 30 seconds. The WebSocket client automatically responds
    with pong, keeping the connection from timing out.
    
    Args:
        websocket: The WebSocket connection
    """
    try:
        while True:
            # Wait 30 seconds
            await asyncio.sleep(30)
            
            # Check if connection is still open
            if websocket.client_state != WebSocketState.CONNECTED:
                break
            
            # Send ping (client will automatically respond with pong)
            try:
                await websocket.send_json({"type": "ping", "timestamp": _utc_timestamp()})
            except Exception as e:
                logger.debug(f"Error sending ping: {e}")
                break
    
    except asyncio.CancelledError:
        # Task was cancelled (normal cleanup)
        pass


def _utc_timestamp() -> str:
    """
    Get current UTC timestamp in ISO-8601 format.
    
    Returns:
        ISO-8601 formatted timestamp string
    """
    from datetime import datetime
    return datetime.utcnow().isoformat()
