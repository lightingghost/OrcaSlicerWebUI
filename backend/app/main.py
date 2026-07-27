"""
FastAPI application entry point for OrcaSlicer Web UI.

This module instantiates the FastAPI application with a lifespan context manager
that handles database initialization and background task startup/shutdown.
"""

from contextlib import asynccontextmanager
from typing import AsyncIterator
import asyncio
import logging
import json
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse


class JSONFormatter(logging.Formatter):
    """
    Custom JSON formatter for structured logging.
    
    Outputs log records as JSON objects to stdout for machine-readable logs.
    Includes both standard fields and any extra fields passed via logger.info(..., extra={...})
    """
    
    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        
        # Include any extra fields (e.g., event, job_id, args, start_time, end_time, exit_code)
        for key, value in record.__dict__.items():
            if key not in [
                "name", "msg", "args", "created", "filename", "funcName", "levelname",
                "levelno", "lineno", "module", "msecs", "message", "pathname", "process",
                "processName", "relativeCreated", "thread", "threadName", "exc_info",
                "exc_text", "stack_info", "getMessage", "formatTime", "formatException",
                "formatStack",
            ]:
                log_data[key] = value
        
        return json.dumps(log_data)


def configure_logging():
    """
    Configure structured JSON logging to stdout.
    
    Requirements: 12.5
    """
    # Create handler that writes to stdout
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())
    
    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    root_logger.addHandler(handler)
    
    # Also configure app-specific loggers
    app_logger = logging.getLogger("app")
    app_logger.setLevel(logging.INFO)


# Background task reference
_cleanup_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """
    Lifespan context manager for FastAPI app.
    
    Handles:
    - Database initialization and migration on startup
    - Job manager initialization
    - Background cleanup task startup
    - Cleanup task cancellation on shutdown
    """
    global _cleanup_task
    
    # Startup: Configure structured JSON logging
    configure_logging()
    print("✓ Structured JSON logging configured")
    
    # Startup: Initialize authentication
    try:
        from app.auth import init_auth
        from app.config import settings
        init_auth(settings.api_secret)
        print("✓ Authentication initialized")
    except Exception as e:
        print(f"✗ Authentication initialization failed: {e}")
        raise

    # Startup: Initialise user workspace directory tree (persistent)
    try:
        from app.config import settings as _s
        _s.init_user_workspace()
        print(f"✓ User workspace initialised at {_s.user_workspace_root}")
    except Exception as e:
        print(f"✗ User workspace initialisation failed: {e}")
        raise

    # Startup: Initialise tmp workspace directory tree (ephemeral)
    try:
        from app.config import settings as _s
        _s.init_tmp_workspace()
        print(f"✓ Tmp workspace initialised at {_s.tmp_root}")
    except Exception as e:
        print(f"✗ Tmp workspace initialisation failed: {e}")
        raise
    
    # Startup: Initialize database
    try:
        from app.database import init_db, get_db_path
        await init_db()
        print("✓ Database initialized and migrations applied")
    except Exception as e:
        print(f"✗ Database initialization failed: {e}")
        raise
    
    # Startup: Initialize WebSocket manager
    try:
        from app.ws_manager import WebSocketManager
        
        ws_manager = WebSocketManager()
        
        # Store WebSocket manager in app state for access in route handlers
        app.state.ws_manager = ws_manager
        print("✓ WebSocket manager initialized")
    except Exception as e:
        print(f"✗ WebSocket manager initialization failed: {e}")
        raise
    
    # Startup: Initialize job manager
    try:
        from app.job_manager import JobManager
        from app.config import settings
        from app.database import get_db_path
        
        job_manager = JobManager(settings, get_db_path())
        await job_manager.start()
        
        # Store job manager in app state for access in route handlers
        app.state.job_manager = job_manager
        print("✓ Job manager initialized and started")
    except Exception as e:
        print(f"✗ Job manager initialization failed: {e}")
        raise
    
    # Startup: Start background cleanup task
    try:
        from app.cleanup import run_cleanup_loop
        _cleanup_task = asyncio.create_task(run_cleanup_loop())
        print("✓ Background cleanup task started")
    except Exception as e:
        print(f"✗ Background cleanup task startup failed: {e}")
        # Non-fatal: cleanup is optional, continue startup
    
    yield
    
    # Shutdown: Stop job manager
    if hasattr(app.state, "job_manager"):
        try:
            await app.state.job_manager.stop()
            print("✓ Job manager stopped")
        except Exception as e:
            print(f"✗ Job manager shutdown failed: {e}")
    
    # Shutdown: Cancel background cleanup task
    if _cleanup_task and not _cleanup_task.done():
        _cleanup_task.cancel()
        try:
            await _cleanup_task
        except asyncio.CancelledError:
            pass
        print("✓ Background cleanup task stopped")


# Instantiate FastAPI app
app = FastAPI(
    title="OrcaSlicer Web UI API",
    description="REST API and WebSocket server for browser-based OrcaSlicer CLI interaction",
    version="0.1.0",
    lifespan=lifespan,
)


# CORS middleware configuration
# Allow all origins for development; restrict in production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # TODO: restrict to frontend domain in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Health check endpoint (no auth required)
@app.get("/health")
async def health_check():
    """
    Health check endpoint.
    
    Returns service status, CLI binary availability, and workspace accessibility.
    No authentication required.
    
    Requirements: 12.3
    """
    from app.config import settings
    from pathlib import Path
    
    cli_available = Path(settings.orca_cli_path).exists() and Path(settings.orca_cli_path).is_file()
    workspace_accessible = Path(settings.workspace_root).exists() and Path(settings.workspace_root).is_dir()
    tmp_accessible = Path(settings.tmp_root).exists() and Path(settings.tmp_root).is_dir()

    status = "healthy" if (cli_available and workspace_accessible and tmp_accessible) else "degraded"

    return {
        "status": status,
        "cli_available": cli_available,
        "cli_path": settings.orca_cli_path,
        "workspace_accessible": workspace_accessible,
        "workspace_root": settings.workspace_root,
        "tmp_accessible": tmp_accessible,
        "tmp_root": settings.tmp_root,
    }


# Mount routers
from app.routers import (
    files,
    profiles,
    parameters,
    jobs,
    websockets,
    user_config,
    printer_config,
    device_connection,
    arrange,
    projects,
)

app.include_router(files.router, prefix="/api", tags=["files"])
app.include_router(profiles.router, prefix="/api", tags=["profiles"])
app.include_router(parameters.router, prefix="/api", tags=["parameters"])
app.include_router(jobs.router, prefix="/api", tags=["jobs"])
app.include_router(user_config.router, prefix="/api", tags=["user_config"])
app.include_router(printer_config.router, prefix="/api", tags=["printer_config"])
app.include_router(device_connection.router, prefix="/api", tags=["device_connection"])
app.include_router(arrange.router, prefix="/api", tags=["arrange"])
app.include_router(projects.router, prefix="/api", tags=["projects"])
app.include_router(websockets.router, tags=["websockets"])


# ---------------------------------------------------------------------------
# Static file serving (frontend React SPA)
# ---------------------------------------------------------------------------
# The frontend build output is copied to /app/frontend/dist at image build
# time.  STATIC_DIR can be overridden via environment variable for local dev.
import os
from pathlib import Path

_STATIC_DIR = Path(os.environ.get("STATIC_DIR", Path(__file__).parent.parent.parent / "frontend" / "dist"))

if _STATIC_DIR.exists():
    # Serve hashed assets (JS/CSS/images) with long-lived cache headers
    app.mount("/assets", StaticFiles(directory=_STATIC_DIR / "assets"), name="assets")

    # Serve the /data/ directory (config dialog JSON files)
    _data_dir = _STATIC_DIR / "data"
    if _data_dir.exists():
        app.mount("/data", StaticFiles(directory=_data_dir), name="data")

    # Serve any other static files at the root (favicon, manifest, …)
    app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static-root")

    # SPA catch-all: return index.html for every path not matched above so
    # client-side routing (react-router) works on hard refresh / deep links.
    #
    # IMPORTANT: must exclude /api/* and /ws/* — otherwise a malformed or
    # unmatched API path (e.g. one containing ".." segments that get
    # normalized to a route no API router recognizes) falls through to
    # this handler and incorrectly returns 200 + index.html instead of a
    # 404, defeating path-traversal / not-found checks the API routers
    # rely on (see resolve_and_guard's callers in profiles.py/jobs.py).
    from fastapi import HTTPException

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str) -> FileResponse:
        if full_path.startswith("api/") or full_path.startswith("ws/"):
            raise HTTPException(status_code=404, detail="Not Found")
        index = _STATIC_DIR / "index.html"
        return FileResponse(str(index))
else:
    print(f"WARNING: Static dir {_STATIC_DIR} not found — frontend will not be served")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
