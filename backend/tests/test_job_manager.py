"""
Unit tests for JobManager class.

Tests job submission, queueing, execution, timeout, and cancellation logic.
"""

import asyncio
import json
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import aiosqlite

from app.job_manager import JobManager
from app.config import Settings


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
async def test_db(temp_workspace):
    """Create a test database with schema."""
    db_path = temp_workspace / "test.db"
    
    # Create schema
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        
        # Create jobs table
        await db.execute("""
            CREATE TABLE jobs (
                job_id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                submitted_at TEXT NOT NULL,
                started_at TEXT,
                completed_at TEXT,
                status TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','completed','failed','timed_out')),
                action_type TEXT NOT NULL,
                cli_args TEXT NOT NULL,
                exit_code INTEGER,
                error_message TEXT,
                output_dir TEXT NOT NULL
            )
        """)
        
        # Create output_files table
        await db.execute("""
            CREATE TABLE output_files (
                output_file_id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
                filename TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                storage_path TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        
        # Create files table — JobManager.submit resolves every file_id
        # referenced by a job request against this table to find its real
        # on-disk storage_path (see files.py's upload endpoint), so tests
        # exercising submit() need matching rows here.
        await db.execute("""
            CREATE TABLE files (
                file_id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                original_name TEXT NOT NULL,
                extension TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                storage_path TEXT NOT NULL,
                uploaded_at TEXT NOT NULL
            )
        """)
        
        await db.commit()
    
    yield db_path


@pytest.fixture
def test_config(temp_workspace):
    """Create test configuration."""
    # Create a fake OrcaSlicer directory structure in temp_workspace
    fake_orca_dir = temp_workspace / "orca-slicer"
    fake_build_dir = fake_orca_dir / "build" / "linux"
    fake_build_dir.mkdir(parents=True)
    fake_cli_path = fake_build_dir / "OrcaSlicer_test"
    fake_cli_path.write_text("#!/bin/sh\necho 'test'")
    fake_cli_path.chmod(0o755)
    
    # Create profiles directory
    profiles_dir = fake_orca_dir / "resources" / "profiles"
    profiles_dir.mkdir(parents=True)
    
    return Settings(
        orca_cli_path=fake_cli_path,
        workspace_root=temp_workspace,
        max_concurrent_jobs=2,
        job_timeout_seconds=60,  # Minimum allowed value
        output_retention_seconds=3600,
        job_record_retention_seconds=86400,
        api_secret="test_secret_12345",
    )


@pytest.mark.asyncio
async def test_job_manager_initialization(test_config, test_db):
    """Test JobManager initialization."""
    manager = JobManager(test_config, test_db)
    
    assert manager.config == test_config
    assert manager.db_path == test_db
    assert manager.semaphore._value == 2  # max_concurrent_jobs
    assert manager.queue.empty()
    assert len(manager.active_jobs) == 0


@pytest.mark.asyncio
async def test_job_submission(test_config, test_db, temp_workspace):
    """Test job submission creates database record and enqueues job."""
    manager = JobManager(test_config, test_db)
    
    # Create session directory
    session_id = "test-session"
    session_dir = temp_workspace / "sessions" / session_id / "uploads"
    session_dir.mkdir(parents=True)
    
    # Create a dummy uploaded file, matching the real upload endpoint's
    # storage convention: sessions/{session_id}/uploads/{file_id}.{ext}
    file_id = "11111111-1111-1111-1111-111111111111"
    storage_path = session_dir / f"{file_id}.stl"
    storage_path.write_text("dummy stl content")
    
    # Record it in the files table so JobManager.submit can resolve it.
    async with aiosqlite.connect(test_db) as db:
        await db.execute(
            """
            INSERT INTO files (file_id, session_id, original_name, extension, size_bytes, storage_path, uploaded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (file_id, session_id, "test-file.stl", "stl", storage_path.stat().st_size, str(storage_path), "2024-01-01T00:00:00Z"),
        )
        await db.commit()
    
    # Submit job
    job_request = {
        "file_ids": [file_id],
        "action": "slice",
        "plate_number": 0,
        "printer_profile_path": "test/printer.json",
        "process_profile_path": "test/process.json",
        "filament_profile_paths": ["test/filament.json"],
    }
    
    # Create dummy profile files under the calculated profiles_root
    profiles_dir = test_config.profiles_root / "test"
    profiles_dir.mkdir(parents=True, exist_ok=True)
    (profiles_dir / "printer.json").write_text("{}")
    (profiles_dir / "process.json").write_text("{}")
    (profiles_dir / "filament.json").write_text("{}")
    
    job_id = await manager.submit(job_request, session_id)
    
    # Verify job_id is a valid UUID
    assert len(job_id) == 36  # UUID4 format
    
    # Verify database record
    async with aiosqlite.connect(test_db) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,))
        row = await cursor.fetchone()
        
        assert row is not None
        assert row["session_id"] == session_id
        assert row["status"] == "queued"
        assert row["action_type"] == "slice"
        
        cli_args = json.loads(row["cli_args"])
        assert len(cli_args) > 0
        assert cli_args[0] == str(test_config.orca_cli_path)
    
    # Verify job was enqueued
    assert not manager.queue.empty()
    queued_job_id = await manager.queue.get()
    assert queued_job_id == job_id


@pytest.mark.asyncio
async def test_job_execution_success(test_config, test_db, temp_workspace):
    """Test successful job execution."""
    manager = JobManager(test_config, test_db)
    
    # Create session and job directories
    session_id = "test-session"
    session_dir = temp_workspace / "sessions" / session_id
    session_dir.mkdir(parents=True)
    
    job_id = "test-job-123"
    output_dir = temp_workspace / "jobs" / job_id / "output"
    output_dir.mkdir(parents=True)
    
    # Create job record with simple echo command
    cli_args = ["/usr/bin/echo", "test output"]
    
    async with aiosqlite.connect(test_db) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        await db.execute(
            """
            INSERT INTO jobs (job_id, session_id, submitted_at, status, action_type, cli_args, output_dir)
            VALUES (?, ?, datetime('now'), 'queued', 'slice', ?, ?)
            """,
            (job_id, session_id, json.dumps(cli_args), str(output_dir)),
        )
        await db.commit()
    
    # Execute job
    await manager._execute(job_id)
    
    # Verify job completed
    async with aiosqlite.connect(test_db) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,))
        row = await cursor.fetchone()
        
        assert row["status"] == "completed"
        assert row["exit_code"] == 0
        assert row["completed_at"] is not None
        assert row["error_message"] is None


@pytest.mark.asyncio
async def test_job_timeout(test_config, test_db, temp_workspace):
    """Test job timeout watchdog."""
    # Use very short timeout for testing (must be at least 60 due to validation)
    # We'll use 2 seconds in the actual test by modifying the manager directly
    manager = JobManager(test_config, test_db)
    manager.config.job_timeout_seconds = 2  # Override for test
    
    session_id = "test-session"
    job_id = "timeout-job"
    output_dir = temp_workspace / "jobs" / job_id / "output"
    output_dir.mkdir(parents=True)
    
    # Create job with sleep command that exceeds timeout
    cli_args = ["/usr/bin/sleep", "10"]
    
    async with aiosqlite.connect(test_db) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        await db.execute(
            """
            INSERT INTO jobs (job_id, session_id, submitted_at, status, action_type, cli_args, output_dir)
            VALUES (?, ?, datetime('now'), 'queued', 'slice', ?, ?)
            """,
            (job_id, session_id, json.dumps(cli_args), str(output_dir)),
        )
        await db.commit()
    
    # Execute job (should timeout)
    await manager._execute(job_id)
    
    # Verify job timed out
    async with aiosqlite.connect(test_db) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,))
        row = await cursor.fetchone()
        
        assert row["status"] == "timed_out"
        assert row["completed_at"] is not None
        assert "timeout" in row["error_message"].lower()


@pytest.mark.asyncio
async def test_job_cancellation(test_config, test_db, temp_workspace):
    """Test job cancellation for queued jobs."""
    manager = JobManager(test_config, test_db)
    
    session_id = "test-session"
    job_id = "cancel-job"
    output_dir = temp_workspace / "jobs" / job_id / "output"
    output_dir.mkdir(parents=True)
    
    # Create queued job
    async with aiosqlite.connect(test_db) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        await db.execute(
            """
            INSERT INTO jobs (job_id, session_id, submitted_at, status, action_type, cli_args, output_dir)
            VALUES (?, ?, datetime('now'), 'queued', 'slice', '[]', ?)
            """,
            (job_id, session_id, str(output_dir)),
        )
        await db.commit()
    
    # Cancel job
    result = await manager.cancel(job_id)
    assert result is True
    
    # Verify job marked as failed
    async with aiosqlite.connect(test_db) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,))
        row = await cursor.fetchone()
        
        assert row["status"] == "failed"
        assert "cancelled" in row["error_message"].lower()


@pytest.mark.asyncio
async def test_concurrent_job_limit(test_config, test_db, temp_workspace):
    """Test that semaphore enforces max concurrent jobs."""
    test_config.max_concurrent_jobs = 2
    manager = JobManager(test_config, test_db)
    
    # Verify semaphore has correct value
    assert manager.semaphore._value == 2
    
    # Acquire semaphore twice (should succeed)
    acquired1 = await manager.semaphore.acquire()
    acquired2 = await manager.semaphore.acquire()
    
    assert acquired1 is True or acquired1 is None  # acquire() returns None on success
    assert acquired2 is True or acquired2 is None
    
    # Semaphore should now be at 0
    assert manager.semaphore._value == 0
    
    # Clean up
    manager.semaphore.release()
    manager.semaphore.release()


@pytest.mark.asyncio
async def test_manager_start_stop(test_config, test_db):
    """Test JobManager start and stop lifecycle."""
    manager = JobManager(test_config, test_db)
    
    # Start manager
    await manager.start()
    assert manager._worker_task is not None
    assert not manager._worker_task.done()
    
    # Stop manager
    await manager.stop()
    assert manager._worker_task.done() or manager._worker_task.cancelled()


@pytest.mark.asyncio
async def test_cli_invocation_logging(test_config, test_db, temp_workspace, caplog):
    """
    Test that CLI invocation details are logged with structured data.
    
    Verifies that start_time, end_time, exit_code, and command args are logged
    at INFO level with the event="cli_invocation" marker.
    
    Requirements: 12.5 (Task 7.6)
    """
    import logging
    
    # Configure caplog to capture INFO level
    caplog.set_level(logging.INFO)
    
    manager = JobManager(test_config, test_db)
    
    session_id = "test-session"
    job_id = "log-test-job"
    output_dir = temp_workspace / "jobs" / job_id / "output"
    output_dir.mkdir(parents=True)
    
    # Create job with simple echo command
    cli_args = ["/usr/bin/echo", "test output"]
    
    async with aiosqlite.connect(test_db) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        await db.execute(
            """
            INSERT INTO jobs (job_id, session_id, submitted_at, status, action_type, cli_args, output_dir)
            VALUES (?, ?, datetime('now'), 'queued', 'slice', ?, ?)
            """,
            (job_id, session_id, json.dumps(cli_args), str(output_dir)),
        )
        await db.commit()
    
    # Execute job
    await manager._execute(job_id)
    
    # Find log records with cli_invocation event
    invocation_records = [
        record for record in caplog.records
        if hasattr(record, 'event') and record.event == 'cli_invocation'
    ]
    
    # Should have exactly one cli_invocation log (the completion log)
    assert len(invocation_records) >= 1, "Expected at least one cli_invocation log record"
    
    # Verify the completion log has all required fields
    completion_record = [r for r in invocation_records if hasattr(r, 'exit_code')]
    assert len(completion_record) >= 1, "Expected cli_invocation log with exit_code"
    
    record = completion_record[0]
    
    # Verify all required fields are present
    assert hasattr(record, 'job_id'), "Log record missing job_id"
    assert record.job_id == job_id
    
    assert hasattr(record, 'command_args'), "Log record missing command_args"
    assert record.command_args == cli_args
    
    assert hasattr(record, 'start_time'), "Log record missing start_time"
    assert record.start_time is not None
    
    assert hasattr(record, 'end_time'), "Log record missing end_time"
    assert record.end_time is not None
    
    assert hasattr(record, 'exit_code'), "Log record missing exit_code"
    assert record.exit_code == 0
    
    # Verify log level is INFO
    assert record.levelno == logging.INFO


@pytest.mark.asyncio
async def test_cli_invocation_logging_timeout(test_config, test_db, temp_workspace, caplog):
    """
    Test that CLI invocation logging includes timeout cases.
    
    Verifies that timed-out jobs also log complete invocation details including
    args, start_time, end_time, and exit_code=None.
    
    Requirements: 12.5 (Task 7.6)
    """
    import logging
    
    caplog.set_level(logging.INFO)
    
    # Use very short timeout for testing
    manager = JobManager(test_config, test_db)
    manager.config.job_timeout_seconds = 2  # Override for test
    
    session_id = "test-session"
    job_id = "timeout-log-job"
    output_dir = temp_workspace / "jobs" / job_id / "output"
    output_dir.mkdir(parents=True)
    
    # Create job with sleep command that exceeds timeout
    cli_args = ["/usr/bin/sleep", "10"]
    
    async with aiosqlite.connect(test_db) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        await db.execute(
            """
            INSERT INTO jobs (job_id, session_id, submitted_at, status, action_type, cli_args, output_dir)
            VALUES (?, ?, datetime('now'), 'queued', 'slice', ?, ?)
            """,
            (job_id, session_id, json.dumps(cli_args), str(output_dir)),
        )
        await db.commit()
    
    # Execute job (should timeout)
    await manager._execute(job_id)
    
    # Find log records with cli_invocation event
    invocation_records = [
        record for record in caplog.records
        if hasattr(record, 'event') and record.event == 'cli_invocation'
    ]
    
    # Should have at least one cli_invocation log
    assert len(invocation_records) >= 1, "Expected at least one cli_invocation log record"
    
    # Find the timeout completion log
    timeout_record = [
        r for r in invocation_records 
        if hasattr(r, 'status') and r.status == 'timed_out'
    ]
    assert len(timeout_record) >= 1, "Expected cli_invocation log with timed_out status"
    
    record = timeout_record[0]
    
    # Verify all required fields are present
    assert hasattr(record, 'job_id')
    assert record.job_id == job_id
    
    assert hasattr(record, 'command_args')
    assert record.command_args == cli_args
    
    assert hasattr(record, 'start_time')
    assert record.start_time is not None
    
    assert hasattr(record, 'end_time')
    assert record.end_time is not None
    
    assert hasattr(record, 'exit_code')
    assert record.exit_code is None  # Timeout means no exit code
    
    # Verify log level is INFO
    assert record.levelno == logging.INFO


@pytest.mark.asyncio
async def test_json_formatter_output():
    """
    Test that the JSONFormatter produces valid JSON output.
    
    This test verifies that the custom JSONFormatter defined in main.py
    correctly formats log records with extra fields into JSON.
    
    Requirements: 12.5 (Task 7.6)
    """
    import logging
    import json
    import io
    import sys
    
    # Import the JSONFormatter from main module
    from app.main import JSONFormatter
    
    # Create a string buffer to capture output
    log_output = io.StringIO()
    
    # Set up a logger with JSON formatter
    handler = logging.StreamHandler(log_output)
    handler.setFormatter(JSONFormatter())
    
    test_logger = logging.getLogger("test_json_logger")
    test_logger.handlers = []  # Clear any existing handlers
    test_logger.addHandler(handler)
    test_logger.setLevel(logging.INFO)
    
    # Log a message with structured data (similar to CLI invocation log)
    test_logger.info(
        "CLI invocation completed",
        extra={
            "event": "cli_invocation",
            "job_id": "test-job-123",
            "command_args": ["/usr/bin/echo", "test"],
            "start_time": "2024-01-01T00:00:00",
            "end_time": "2024-01-01T00:00:05",
            "exit_code": 0,
        },
    )
    
    # Get the logged output
    output = log_output.getvalue().strip()
    
    # Verify it's valid JSON
    log_data = json.loads(output)
    
    # Verify standard fields
    assert "timestamp" in log_data
    assert "level" in log_data
    assert log_data["level"] == "INFO"
    assert "logger" in log_data
    assert log_data["logger"] == "test_json_logger"
    assert "message" in log_data
    assert log_data["message"] == "CLI invocation completed"
    
    # Verify extra fields
    assert log_data["event"] == "cli_invocation"
    assert log_data["job_id"] == "test-job-123"
    assert log_data["command_args"] == ["/usr/bin/echo", "test"]
    assert log_data["start_time"] == "2024-01-01T00:00:00"
    assert log_data["end_time"] == "2024-01-01T00:00:05"
    assert log_data["exit_code"] == 0


@pytest.mark.asyncio
async def test_parse_progress_line_with_percentage(test_config, test_db):
    """Test parsing CLI output line with percentage."""
    job_manager = JobManager(test_config, test_db)
    job_id = "test-job-123"
    
    # Test simple percentage pattern
    line = "Slicing: 45%"
    event = job_manager._parse_progress_line(line, job_id)
    
    assert event is not None
    assert event["type"] == "progress"
    assert event["job_id"] == job_id
    assert event["total_percent"] == 45
    assert event["plate_percent"] == 45
    assert event["message"] == line
    assert "timestamp" in event


@pytest.mark.asyncio
async def test_parse_progress_line_with_plate_info(test_config, test_db):
    """Test parsing CLI output line with plate information."""
    job_manager = JobManager(test_config, test_db)
    job_id = "test-job-123"
    
    # Test plate progress pattern
    line = "Plate 2/3: 75%"
    event = job_manager._parse_progress_line(line, job_id)
    
    assert event is not None
    assert event["type"] == "progress"
    assert event["job_id"] == job_id
    assert event["plate_index"] == 1  # 0-based
    assert event["plate_count"] == 3
    assert event["plate_percent"] == 75
    # Total should be (1*100 + 75)/3 = 58
    assert event["total_percent"] == 58
    assert event["message"] == line


@pytest.mark.asyncio
async def test_parse_progress_line_with_warning(test_config, test_db):
    """Test parsing CLI output line with warning."""
    job_manager = JobManager(test_config, test_db)
    job_id = "test-job-123"
    
    # Test warning detection
    line = "Warning: Invalid parameter detected"
    event = job_manager._parse_progress_line(line, job_id)
    
    assert event is not None
    assert event["type"] == "warning"
    assert event["job_id"] == job_id
    assert event["warning"] == line
    assert "timestamp" in event


@pytest.mark.asyncio
async def test_parse_progress_line_with_status_keyword(test_config, test_db):
    """Test parsing CLI output line with status keywords."""
    job_manager = JobManager(test_config, test_db)
    job_id = "test-job-123"
    
    # Test status message detection
    test_lines = [
        "Generating support structures",
        "Processing layer 100",
        "Exporting G-code",
        "Analyzing model geometry",
    ]
    
    for line in test_lines:
        event = job_manager._parse_progress_line(line, job_id)
        
        assert event is not None
        assert event["type"] == "progress"
        assert event["job_id"] == job_id
        assert event["message"] == line


@pytest.mark.asyncio
async def test_parse_progress_line_with_empty_line(test_config, test_db):
    """Test parsing empty line returns None."""
    job_manager = JobManager(test_config, test_db)
    job_id = "test-job-123"
    
    # Empty line should return None
    event = job_manager._parse_progress_line("", job_id)
    assert event is None
    
    # Whitespace-only line should return None
    event = job_manager._parse_progress_line("   \n", job_id)
    assert event is None


@pytest.mark.asyncio
async def test_parse_progress_line_with_no_match(test_config, test_db):
    """Test parsing line with no recognized patterns returns None."""
    job_manager = JobManager(test_config, test_db)
    job_id = "test-job-123"
    
    # Arbitrary line with no progress indicators
    line = "Some random output text"
    event = job_manager._parse_progress_line(line, job_id)
    
    assert event is None


@pytest.mark.asyncio
async def test_broadcast_started_event(test_config, test_db):
    """Test broadcasting started event via WebSocketManager."""
    # Create mock WebSocket manager
    mock_ws_manager = MagicMock()
    mock_ws_manager.broadcast = AsyncMock()
    
    job_manager = JobManager(test_config, test_db, ws_manager=mock_ws_manager)
    job_id = "test-job-123"
    
    await job_manager._broadcast_started_event(job_id)
    
    # Verify broadcast was called with correct event
    mock_ws_manager.broadcast.assert_called_once()
    call_args = mock_ws_manager.broadcast.call_args[0]
    assert call_args[0] == job_id
    
    event = call_args[1]
    assert event["type"] == "started"
    assert event["job_id"] == job_id
    assert "timestamp" in event


@pytest.mark.asyncio
async def test_broadcast_completed_event(test_config, test_db):
    """Test broadcasting completed event via WebSocketManager."""
    mock_ws_manager = MagicMock()
    mock_ws_manager.broadcast = AsyncMock()
    
    job_manager = JobManager(test_config, test_db, ws_manager=mock_ws_manager)
    job_id = "test-job-123"
    output_files = [
        {"filename": "output.gcode", "size_bytes": 1024, "download_url": "/api/..."}
    ]
    
    await job_manager._broadcast_completed_event(job_id, output_files)
    
    mock_ws_manager.broadcast.assert_called_once()
    call_args = mock_ws_manager.broadcast.call_args[0]
    
    event = call_args[1]
    assert event["type"] == "completed"
    assert event["job_id"] == job_id
    assert event["output_files"] == output_files
    assert "timestamp" in event


@pytest.mark.asyncio
async def test_broadcast_failed_event(test_config, test_db):
    """Test broadcasting failed event via WebSocketManager."""
    mock_ws_manager = MagicMock()
    mock_ws_manager.broadcast = AsyncMock()
    
    job_manager = JobManager(test_config, test_db, ws_manager=mock_ws_manager)
    job_id = "test-job-123"
    
    await job_manager._broadcast_failed_event(job_id, 1, "Error message")
    
    mock_ws_manager.broadcast.assert_called_once()
    call_args = mock_ws_manager.broadcast.call_args[0]
    
    event = call_args[1]
    assert event["type"] == "failed"
    assert event["job_id"] == job_id
    assert event["exit_code"] == 1
    assert event["error_message"] == "Error message"
    assert "timestamp" in event


@pytest.mark.asyncio
async def test_broadcast_timed_out_event(test_config, test_db):
    """Test broadcasting timed out event via WebSocketManager."""
    mock_ws_manager = MagicMock()
    mock_ws_manager.broadcast = AsyncMock()
    
    job_manager = JobManager(test_config, test_db, ws_manager=mock_ws_manager)
    job_id = "test-job-123"
    
    await job_manager._broadcast_timed_out_event(job_id, 3600)
    
    mock_ws_manager.broadcast.assert_called_once()
    call_args = mock_ws_manager.broadcast.call_args[0]
    
    event = call_args[1]
    assert event["type"] == "timed_out"
    assert event["job_id"] == job_id
    assert event["timeout_seconds"] == 3600
    assert "timestamp" in event


@pytest.mark.asyncio
async def test_broadcast_queued_event(test_config, test_db):
    """Test broadcasting queued event via WebSocketManager."""
    mock_ws_manager = MagicMock()
    mock_ws_manager.broadcast = AsyncMock()
    
    job_manager = JobManager(test_config, test_db, ws_manager=mock_ws_manager)
    job_id = "test-job-123"
    
    await job_manager._broadcast_queued_event(job_id, 3)
    
    mock_ws_manager.broadcast.assert_called_once()
    call_args = mock_ws_manager.broadcast.call_args[0]
    
    event = call_args[1]
    assert event["type"] == "queued"
    assert event["job_id"] == job_id
    assert event["queue_position"] == 3
    assert "timestamp" in event


@pytest.mark.asyncio
async def test_job_manager_without_ws_manager(test_config, test_db):
    """Test that JobManager works without WebSocketManager."""
    # Create JobManager without ws_manager
    job_manager = JobManager(test_config, test_db, ws_manager=None)
    job_id = "test-job-123"
    
    # All broadcast methods should work without error
    await job_manager._broadcast_started_event(job_id)
    await job_manager._broadcast_completed_event(job_id, [])
    await job_manager._broadcast_failed_event(job_id, 1, "error")
    await job_manager._broadcast_timed_out_event(job_id, 3600)
    await job_manager._broadcast_queued_event(job_id, 1)
    
    # Parse progress line should still work
    event = job_manager._parse_progress_line("Slicing: 50%", job_id)
    assert event is not None
