"""
Job execution manager for OrcaSlicer CLI subprocess orchestration.

This module implements the JobManager class which handles:
- Concurrent job execution with configurable semaphore limits
- FIFO job queue for managing pending jobs
- Subprocess spawning with timeout watchdog
- Job status tracking and database updates
- CLI stdout parsing and progress event broadcasting

Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 7.2, 7.4, 7.5, 7.6
"""

import asyncio
import json
import logging
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import aiosqlite

from app.cli_builder import build_cli_args, resolve_and_guard
from app.config import Settings

logger = logging.getLogger(__name__)


def _build_subprocess_env(orca_cli_path: Path) -> dict[str, str]:
    """
    Build the environment for the OrcaSlicer CLI subprocess.

    The distributed OrcaSlicer AppImage bundles its own shared libraries
    (under an `orca-runtime`/`lib` directory next to the AppImage's `bin/`)
    and only resolves them when run through its `AppRun`/`orca-slicer-env`
    wrapper script, which sets LD_LIBRARY_PATH before exec'ing the real
    binary. Since job_manager invokes the binary directly (not through that
    wrapper, so its stdout stays a clean pipe for progress parsing), the
    same LD_LIBRARY_PATH setup must be replicated here or the process fails
    immediately with "error while loading shared libraries" and every job
    fails regardless of how correct the CLI arguments are.

    Mirrors the relevant part of the AppImage's `libexec/orca-slicer-env`:
    prepend `<AppDir>/lib/orca-runtime` (if present) and `<AppDir>/bin` to
    LD_LIBRARY_PATH, where AppDir is the orca_cli_path binary's grandparent
    ('.../bin/orca-slicer' -> AppDir is '...'). Falls back to a no-op
    (inherited environment) if these directories don't exist — e.g. a
    system-installed OrcaSlicer binary that doesn't need this.
    """
    env = os.environ.copy()

    app_dir = orca_cli_path.resolve().parent.parent
    bin_dir = app_dir / "bin"
    runtime_lib_dir = app_dir / "lib" / "orca-runtime"

    ld_library_path_parts = []
    if runtime_lib_dir.is_dir():
        ld_library_path_parts.append(str(runtime_lib_dir))
    if bin_dir.is_dir():
        ld_library_path_parts.append(str(bin_dir))

    if ld_library_path_parts:
        existing = env.get("LD_LIBRARY_PATH")
        if existing:
            ld_library_path_parts.append(existing)
        env["LD_LIBRARY_PATH"] = ":".join(ld_library_path_parts)

    return env


class JobManager:
    """
    Manages job submission, queueing, and execution with concurrency control.
    
    The JobManager enforces a maximum concurrent jobs limit using an asyncio
    Semaphore, maintains a FIFO queue of pending jobs, spawns subprocess for
    CLI execution, implements a timeout watchdog to terminate hung processes,
    and streams progress events via WebSocket.
    
    Attributes:
        config: Application settings (CLI path, workspace, timeouts, etc.)
        db_path: Path to SQLite database file
        ws_manager: WebSocket manager for broadcasting progress events
        semaphore: Limits concurrent job execution
        queue: FIFO queue for pending job requests
        active_jobs: Dict mapping job_id to asyncio Task for cancellation
    """
    
    def __init__(self, config: Settings, db_path: Path, ws_manager: Optional[Any] = None):
        """
        Initialize the JobManager.
        
        Args:
            config: Application settings instance
            db_path: Path to SQLite database file
            ws_manager: WebSocketManager instance for progress broadcasting (optional)
        """
        self.config = config
        self.db_path = db_path
        self.ws_manager = ws_manager
        
        # Semaphore to limit concurrent jobs
        self.semaphore = asyncio.Semaphore(config.max_concurrent_jobs)
        
        # FIFO queue for job requests
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        
        # Track active jobs for cancellation
        self.active_jobs: dict[str, asyncio.Task] = {}
        
        # Worker task to process queue
        self._worker_task: asyncio.Task | None = None
    
    async def start(self) -> None:
        """Start the background worker task that processes the job queue."""
        if self._worker_task is None or self._worker_task.done():
            self._worker_task = asyncio.create_task(self._process_queue())
            logger.info("JobManager worker started")
    
    async def stop(self) -> None:
        """Stop the background worker and cancel all active jobs."""
        # Cancel all active jobs
        for job_id, task in list(self.active_jobs.items()):
            if not task.done():
                task.cancel()
                logger.info(f"Cancelled job {job_id} during shutdown")
        
        # Wait for all active jobs to finish
        if self.active_jobs:
            await asyncio.gather(*self.active_jobs.values(), return_exceptions=True)
        
        # Cancel the worker task
        if self._worker_task and not self._worker_task.done():
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
        
        logger.info("JobManager stopped")
    
    async def submit(self, job_request: dict[str, Any], session_id: str) -> str:
        """
        Submit a job for execution.
        
        Creates a job record in the database with status 'queued', enqueues the
        job_id for processing by the worker, and returns the job_id immediately.
        
        Args:
            job_request: Dictionary containing all job parameters (files, profiles,
                        transforms, parameters, etc.)
            session_id: Session identifier for file resolution
            
        Returns:
            The newly created job_id (UUID string)
            
        Requirements: 6.1, 6.6
        """
        # Generate unique job ID
        job_id = str(uuid.uuid4())
        
        # Prepare job directories
        output_dir = self.config.jobs_output_dir / job_id / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Resolve each file_id to its actual on-disk storage_path (recorded
        # by the upload endpoint as session_uploads_dir/{session_id}/uploads/
        # {file_id}.{ext}) rather than assuming a fixed shape — file_ids are
        # also used for misc.load_custom_gcodes_file_id, so build_cli_args
        # needs a lookup covering every file_id referenced by the job, not
        # just file_ids itself.
        file_ids_to_resolve = set(job_request.get("file_ids", []))
        custom_gcodes_id = (job_request.get("misc") or {}).get("load_custom_gcodes_file_id")
        if custom_gcodes_id:
            file_ids_to_resolve.add(custom_gcodes_id)
        
        file_paths: dict[str, Path] = {}
        if file_ids_to_resolve:
            async with aiosqlite.connect(self.db_path) as db:
                await db.execute("PRAGMA foreign_keys = ON")
                for file_id in file_ids_to_resolve:
                    cursor = await db.execute(
                        "SELECT storage_path FROM files WHERE file_id = ? AND session_id = ?",
                        (file_id, session_id),
                    )
                    row = await cursor.fetchone()
                    if row is None:
                        raise ValueError(f"File not found: {file_id}")
                    file_paths[file_id] = Path(row[0])
        
        # Build CLI args (may raise ValueError on path validation)
        cli_args = build_cli_args(job_request, self.config, file_paths, output_dir)
        
        # Create job record in database
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("PRAGMA foreign_keys = ON")
            
            await db.execute(
                """
                INSERT INTO jobs (
                    job_id, session_id, submitted_at, status, action_type,
                    cli_args, output_dir
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    session_id,
                    datetime.utcnow().isoformat(),
                    "queued",
                    job_request["action"],
                    json.dumps(cli_args),
                    str(output_dir),
                ),
            )
            await db.commit()
        
        # Enqueue job for processing
        await self.queue.put(job_id)
        
        logger.info(
            f"Job {job_id} submitted and queued",
            extra={"job_id": job_id, "action": job_request["action"]},
        )
        
        return job_id
    
    async def cancel(self, job_id: str) -> bool:
        """
        Cancel a queued or running job.
        
        Args:
            job_id: The job to cancel
            
        Returns:
            True if job was cancelled, False if job not found or already terminal
        """
        # Check if job is active
        if job_id in self.active_jobs:
            task = self.active_jobs[job_id]
            if not task.done():
                task.cancel()
                logger.info(f"Cancelled active job {job_id}")
                return True
        
        # If not active, check if it's queued and mark as failed
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("PRAGMA foreign_keys = ON")
            
            cursor = await db.execute(
                "SELECT status FROM jobs WHERE job_id = ?",
                (job_id,),
            )
            row = await cursor.fetchone()
            
            if row and row[0] == "queued":
                await db.execute(
                    """
                    UPDATE jobs
                    SET status = 'failed',
                        completed_at = ?,
                        error_message = 'Job cancelled by user'
                    WHERE job_id = ?
                    """,
                    (datetime.utcnow().isoformat(), job_id),
                )
                await db.commit()
                logger.info(f"Marked queued job {job_id} as cancelled")
                return True
        
        return False
    
    async def _process_queue(self) -> None:
        """
        Background worker that processes jobs from the queue.
        
        Continuously pulls job_ids from the queue and spawns execution tasks.
        The semaphore ensures we never exceed max_concurrent_jobs.
        """
        logger.info("Job queue processor started")
        
        while True:
            try:
                # Get next job from queue (blocks if empty)
                job_id = await self.queue.get()
                
                # Create execution task (will wait for semaphore inside)
                task = asyncio.create_task(self._execute(job_id))
                self.active_jobs[job_id] = task
                
                # Clean up completed tasks
                def cleanup_task(job_id: str, task: asyncio.Task) -> None:
                    if job_id in self.active_jobs:
                        del self.active_jobs[job_id]
                
                task.add_done_callback(lambda t: cleanup_task(job_id, t))
                
            except asyncio.CancelledError:
                logger.info("Job queue processor cancelled")
                break
            except Exception as e:
                logger.error(f"Error in queue processor: {e}", exc_info=True)
                # Continue processing despite errors
    
    def _parse_progress_line(self, line: str, job_id: str) -> Optional[dict[str, Any]]:
        """
        Parse a CLI output line for progress information.
        
        OrcaSlicer CLI outputs progress in various formats. This method attempts
        to extract progress information and warnings from stdout lines.
        
        Args:
            line: Raw line from CLI stdout
            job_id: The job identifier for event tagging
            
        Returns:
            Event dict if progress/warning detected, None otherwise
            
        Requirements: 7.2, 7.4
        """
        line = line.strip()
        if not line:
            return None
        
        # Pattern 1: Warning detection (case-insensitive) - check first to avoid false positives
        if re.search(r'\bwarn(ing)?\b', line, re.IGNORECASE):
            return {
                "type": "warning",
                "job_id": job_id,
                "warning": line,
                "timestamp": datetime.utcnow().isoformat(),
            }
        
        # Pattern 2: Plate progress (e.g., "Plate 1/3: 50%") - more specific than simple percentage
        plate_match = re.search(r'[Pp]late\s+(\d+)/(\d+)[:\s]+(\d+)%', line)
        if plate_match:
            plate_index = int(plate_match.group(1)) - 1  # Convert to 0-based
            plate_count = int(plate_match.group(2))
            plate_percent = int(plate_match.group(3))
            # Estimate total percent based on plate progress
            total_percent = int((plate_index * 100 + plate_percent) / plate_count)
            return {
                "type": "progress",
                "job_id": job_id,
                "plate_index": plate_index,
                "plate_count": plate_count,
                "plate_percent": plate_percent,
                "total_percent": total_percent,
                "message": line,
                "timestamp": datetime.utcnow().isoformat(),
            }
        
        # Pattern 3: Progress percentage (e.g., "Slicing: 45%", "Processing: 75%")
        percent_match = re.search(r'(\d+)%', line)
        if percent_match:
            percent = int(percent_match.group(1))
            return {
                "type": "progress",
                "job_id": job_id,
                "plate_index": 0,  # Default to first plate
                "plate_count": 1,  # Default to single plate
                "plate_percent": percent,
                "total_percent": percent,
                "message": line,
                "timestamp": datetime.utcnow().isoformat(),
            }
        
        # Pattern 4: Status messages (informational)
        status_keywords = [
            'slicing', 'processing', 'generating', 'analyzing',
            'preparing', 'loading', 'saving', 'exporting'
        ]
        if any(keyword in line.lower() for keyword in status_keywords):
            return {
                "type": "progress",
                "job_id": job_id,
                "plate_index": 0,
                "plate_count": 1,
                "plate_percent": 0,
                "total_percent": 0,
                "message": line,
                "timestamp": datetime.utcnow().isoformat(),
            }
        
        return None
    
    async def _broadcast_queued_event(self, job_id: str, queue_position: int) -> None:
        """
        Broadcast a QueuedEvent to WebSocket clients.
        
        Args:
            job_id: The queued job identifier
            queue_position: Position in the queue (1-based)
        """
        if self.ws_manager:
            event = {
                "type": "queued",
                "job_id": job_id,
                "queue_position": queue_position,
                "timestamp": datetime.utcnow().isoformat(),
            }
            await self.ws_manager.broadcast(job_id, event)
    
    async def _broadcast_started_event(self, job_id: str) -> None:
        """
        Broadcast a StartedEvent to WebSocket clients.
        
        Args:
            job_id: The started job identifier
        """
        if self.ws_manager:
            event = {
                "type": "started",
                "job_id": job_id,
                "timestamp": datetime.utcnow().isoformat(),
            }
            await self.ws_manager.broadcast(job_id, event)
    
    async def _broadcast_completed_event(self, job_id: str, output_files: list[dict]) -> None:
        """
        Broadcast a CompletedEvent to WebSocket clients.
        
        Args:
            job_id: The completed job identifier
            output_files: List of output file summaries
        """
        if self.ws_manager:
            event = {
                "type": "completed",
                "job_id": job_id,
                "output_files": output_files,
                "timestamp": datetime.utcnow().isoformat(),
            }
            await self.ws_manager.broadcast(job_id, event)
    
    async def _broadcast_failed_event(self, job_id: str, exit_code: int, error_message: str) -> None:
        """
        Broadcast a FailedEvent to WebSocket clients.
        
        Args:
            job_id: The failed job identifier
            exit_code: Process exit code
            error_message: Error description
        """
        if self.ws_manager:
            event = {
                "type": "failed",
                "job_id": job_id,
                "exit_code": exit_code,
                "error_message": error_message,
                "timestamp": datetime.utcnow().isoformat(),
            }
            await self.ws_manager.broadcast(job_id, event)
    
    async def _broadcast_timed_out_event(self, job_id: str, timeout_seconds: int) -> None:
        """
        Broadcast a TimedOutEvent to WebSocket clients.
        
        Args:
            job_id: The timed-out job identifier
            timeout_seconds: The timeout duration that was exceeded
        """
        if self.ws_manager:
            event = {
                "type": "timed_out",
                "job_id": job_id,
                "timeout_seconds": timeout_seconds,
                "timestamp": datetime.utcnow().isoformat(),
            }
            await self.ws_manager.broadcast(job_id, event)
    
    async def _execute(self, job_id: str) -> None:
        """
        Execute a single job with timeout watchdog.
        
        Acquires the semaphore, retrieves job details from database, spawns the
        CLI subprocess, monitors for completion or timeout, and updates the
        database with results.
        
        Args:
            job_id: The job to execute
            
        Requirements: 6.2, 6.3, 6.5
        """
        # Acquire semaphore (blocks if at max concurrent jobs)
        async with self.semaphore:
            try:
                # Retrieve job details from database
                async with aiosqlite.connect(self.db_path) as db:
                    await db.execute("PRAGMA foreign_keys = ON")
                    db.row_factory = aiosqlite.Row
                    
                    cursor = await db.execute(
                        """
                        SELECT job_id, session_id, cli_args, output_dir, action_type
                        FROM jobs
                        WHERE job_id = ?
                        """,
                        (job_id,),
                    )
                    row = await cursor.fetchone()
                    
                    if not row:
                        logger.error(f"Job {job_id} not found in database")
                        return
                    
                    cli_args_json = row["cli_args"]
                    output_dir = row["output_dir"]
                    action_type = row["action_type"]
                    
                    # Update status to running
                    await db.execute(
                        """
                        UPDATE jobs
                        SET status = 'running', started_at = ?
                        WHERE job_id = ?
                        """,
                        (datetime.utcnow().isoformat(), job_id),
                    )
                    await db.commit()
                
                cli_args = json.loads(cli_args_json)
                
                # Record start time for CLI invocation logging
                start_time = datetime.utcnow().isoformat()
                
                # Broadcast started event
                await self._broadcast_started_event(job_id)
                
                logger.info(
                    f"Starting job {job_id}",
                    extra={
                        "event": "cli_invocation_start",
                        "job_id": job_id,
                        "command_args": cli_args,
                        "start_time": start_time,
                    },
                )
                
                # Create log file for CLI output
                log_file_path = Path(output_dir).parent / "cli.log"
                
                # Spawn CLI subprocess with timeout
                try:
                    async with asyncio.timeout(self.config.job_timeout_seconds):
                        process = await asyncio.create_subprocess_exec(
                            *cli_args,
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.STDOUT,
                            cwd=str(output_dir),
                            env=_build_subprocess_env(self.config.orca_cli_path),
                        )
                        
                        # Stream output to log file, collect lines, and parse for progress
                        output_lines = []
                        with open(log_file_path, "wb") as log_file:
                            while True:
                                line = await process.stdout.readline()
                                if not line:
                                    break
                                
                                # Write to log file
                                log_file.write(line)
                                
                                # Decode and parse line
                                decoded_line = line.decode("utf-8", errors="replace")
                                output_lines.append(decoded_line)
                                
                                # Parse for progress and broadcast events
                                event = self._parse_progress_line(decoded_line, job_id)
                                if event and self.ws_manager:
                                    await self.ws_manager.broadcast(job_id, event)
                        
                        # Wait for process to complete
                        exit_code = await process.wait()
                
                except asyncio.TimeoutError:
                    # Timeout watchdog triggered - terminate process
                    end_time = datetime.utcnow().isoformat()
                    logger.warning(
                        f"Job {job_id} timed out after {self.config.job_timeout_seconds}s"
                    )
                    
                    # Try graceful termination first, then kill
                    try:
                        process.terminate()
                        await asyncio.wait_for(process.wait(), timeout=5.0)
                    except asyncio.TimeoutError:
                        process.kill()
                        await process.wait()
                    
                    # Update database with timeout status
                    async with aiosqlite.connect(self.db_path) as db:
                        await db.execute("PRAGMA foreign_keys = ON")
                        await db.execute(
                            """
                            UPDATE jobs
                            SET status = 'timed_out',
                                completed_at = ?,
                                error_message = ?
                            WHERE job_id = ?
                            """,
                            (
                                end_time,
                                f"Job exceeded timeout of {self.config.job_timeout_seconds} seconds",
                                job_id,
                            ),
                        )
                        await db.commit()
                    
                    # Broadcast timed out event
                    await self._broadcast_timed_out_event(job_id, self.config.job_timeout_seconds)
                    
                    # Log complete CLI invocation details for timeout
                    logger.info(
                        f"CLI invocation completed (timed out) for job {job_id}",
                        extra={
                            "event": "cli_invocation",
                            "job_id": job_id,
                            "command_args": cli_args,
                            "start_time": start_time,
                            "end_time": end_time,
                            "exit_code": None,
                            "status": "timed_out",
                        },
                    )
                    return
                
                # Process completed normally (with or without error)
                end_time = datetime.utcnow().isoformat()
                
                # Log complete CLI invocation details
                logger.info(
                    f"CLI invocation completed for job {job_id} with exit code {exit_code}",
                    extra={
                        "event": "cli_invocation",
                        "job_id": job_id,
                        "command_args": cli_args,
                        "start_time": start_time,
                        "end_time": end_time,
                        "exit_code": exit_code,
                    },
                )
                
                # Determine job status based on exit code
                if exit_code == 0:
                    status = "completed"
                    error_message = None
                    
                    # Scan output directory for files and create output_files records
                    await self._register_output_files(job_id, Path(output_dir))
                    
                    # Get output files for broadcast
                    output_files_summary = []
                    async with aiosqlite.connect(self.db_path) as db:
                        await db.execute("PRAGMA foreign_keys = ON")
                        db.row_factory = aiosqlite.Row
                        cursor = await db.execute(
                            """
                            SELECT filename, size_bytes
                            FROM output_files
                            WHERE job_id = ?
                            """,
                            (job_id,),
                        )
                        rows = await cursor.fetchall()
                        for row in rows:
                            output_files_summary.append({
                                "filename": row["filename"],
                                "size_bytes": row["size_bytes"],
                                "download_url": f"/api/jobs/{job_id}/outputs/{row['filename']}",
                            })
                    
                    # Broadcast completed event
                    await self._broadcast_completed_event(job_id, output_files_summary)
                else:
                    status = "failed"
                    # Extract error message from CLI output (last few lines)
                    error_lines = output_lines[-10:] if output_lines else []
                    error_message = "".join(error_lines).strip() or f"CLI exited with code {exit_code}"
                    
                    # Broadcast failed event
                    await self._broadcast_failed_event(job_id, exit_code, error_message)
                
                # Update database with final status
                async with aiosqlite.connect(self.db_path) as db:
                    await db.execute("PRAGMA foreign_keys = ON")
                    await db.execute(
                        """
                        UPDATE jobs
                        SET status = ?,
                            completed_at = ?,
                            exit_code = ?,
                            error_message = ?
                        WHERE job_id = ?
                        """,
                        (status, end_time, exit_code, error_message, job_id),
                    )
                    await db.commit()
                
                logger.info(f"Job {job_id} finalized with status '{status}'")
            
            except asyncio.CancelledError:
                # Job was cancelled
                logger.info(f"Job {job_id} execution cancelled")
                async with aiosqlite.connect(self.db_path) as db:
                    await db.execute("PRAGMA foreign_keys = ON")
                    await db.execute(
                        """
                        UPDATE jobs
                        SET status = 'failed',
                            completed_at = ?,
                            error_message = 'Job cancelled'
                        WHERE job_id = ?
                        """,
                        (datetime.utcnow().isoformat(), job_id),
                    )
                    await db.commit()
                raise
            
            except Exception as e:
                # Unexpected error during execution
                logger.error(f"Error executing job {job_id}: {e}", exc_info=True)
                async with aiosqlite.connect(self.db_path) as db:
                    await db.execute("PRAGMA foreign_keys = ON")
                    await db.execute(
                        """
                        UPDATE jobs
                        SET status = 'failed',
                            completed_at = ?,
                            error_message = ?
                        WHERE job_id = ?
                        """,
                        (
                            datetime.utcnow().isoformat(),
                            f"Internal error: {str(e)}",
                            job_id,
                        ),
                    )
                    await db.commit()
    
    async def _register_output_files(self, job_id: str, output_dir: Path) -> None:
        """
        Scan output directory and create output_files database records.
        
        Args:
            job_id: The job that produced the files
            output_dir: Directory containing output files
        """
        if not output_dir.exists():
            logger.warning(f"Output directory {output_dir} does not exist for job {job_id}")
            return
        
        output_files = []
        for file_path in output_dir.iterdir():
            if file_path.is_file():
                output_files.append({
                    "output_file_id": str(uuid.uuid4()),
                    "job_id": job_id,
                    "filename": file_path.name,
                    "size_bytes": file_path.stat().st_size,
                    "storage_path": str(file_path),
                    "created_at": datetime.utcnow().isoformat(),
                })
        
        if output_files:
            async with aiosqlite.connect(self.db_path) as db:
                await db.execute("PRAGMA foreign_keys = ON")
                await db.executemany(
                    """
                    INSERT INTO output_files
                    (output_file_id, job_id, filename, size_bytes, storage_path, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            f["output_file_id"],
                            f["job_id"],
                            f["filename"],
                            f["size_bytes"],
                            f["storage_path"],
                            f["created_at"],
                        )
                        for f in output_files
                    ],
                )
                await db.commit()
            
            logger.info(f"Registered {len(output_files)} output files for job {job_id}")
