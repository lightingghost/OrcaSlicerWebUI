"""
Unit tests for JobManager class.

Tests job submission, queueing, execution, timeout, and cancellation logic.
"""

import asyncio
import json
import struct
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from zipfile import ZipFile

import pytest
import aiosqlite

from app.job_manager import (
    JobManager,
    _build_positioned_project_3mf,
    _extract_cli_flag_value,
    _extract_gcode_config_value,
    _extract_input_file_paths,
    _extract_post_process_from_settings_file,
    _parse_post_process_scripts,
    _short_time,
    _substitute_filename_format,
    DEFAULT_FILENAME_FORMAT,
)
from app.config import Settings


def _make_binary_stl_cube(size: float = 10.0) -> bytes:
    """Minimal binary STL cube (12 triangles) — mirrors test_threemf_io.py's
    identical helper, duplicated here to keep this test module
    self-contained."""
    s = size
    verts = [
        (0, 0, 0), (s, 0, 0), (s, s, 0), (0, s, 0),
        (0, 0, s), (s, 0, s), (s, s, s), (0, s, s),
    ]
    faces = [
        (0, 1, 2), (0, 2, 3),
        (4, 6, 5), (4, 7, 6),
        (0, 5, 1), (0, 4, 5),
        (1, 6, 2), (1, 5, 6),
        (2, 7, 3), (2, 6, 7),
        (3, 4, 0), (3, 7, 4),
    ]
    out = bytearray(b"\x00" * 80)
    out += struct.pack("<I", len(faces))
    for tri in faces:
        out += struct.pack("<3f", 0, 0, 0)
        for idx in tri:
            out += struct.pack("<3f", *verts[idx])
        out += struct.pack("<H", 0)
    return bytes(out)


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
        tmp_root=temp_workspace,
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


@pytest.mark.asyncio
async def test_job_submission_with_instances_builds_positioned_3mf(test_config, test_db, temp_workspace):
    """
    When the job request carries `instances` (live per-object placement
    from the viewport — see JobRequestModel.instances's doc comment), the
    resulting cli_args must reference a single positioned .3mf snapshot
    instead of the raw file_ids, and that 3mf must contain each object's
    given position.

    Regression coverage for: slicing 2+ objects failed with
    CLI_OBJECTS_PARTLY_INSIDE because Slice always passed raw,
    unpositioned STL files (each landing at its own mesh-native origin)
    with no arrange fallback once arrange was disabled by default.
    """
    from zipfile import ZipFile

    manager = JobManager(test_config, test_db)

    session_id = "test-session"
    session_dir = temp_workspace / "sessions" / session_id / "uploads"
    session_dir.mkdir(parents=True)

    def make_stl(path: Path, size: float):
        import struct
        s = size
        verts = [
            (0, 0, 0), (s, 0, 0), (s, s, 0), (0, s, 0),
            (0, 0, s), (s, 0, s), (s, s, s), (0, s, s),
        ]
        faces = [
            (0, 1, 2), (0, 2, 3), (4, 6, 5), (4, 7, 6), (0, 5, 1), (0, 4, 5),
            (1, 6, 2), (1, 5, 6), (2, 7, 3), (2, 6, 7), (3, 4, 0), (3, 7, 4),
        ]
        data = bytearray(b"\x00" * 80)
        data += struct.pack("<I", len(faces))
        for tri in faces:
            data += struct.pack("<3f", 0, 0, 0)
            for idx in tri:
                data += struct.pack("<3f", *verts[idx])
            data += struct.pack("<H", 0)
        path.write_bytes(bytes(data))

    file_id_1 = "11111111-1111-1111-1111-111111111111"
    file_id_2 = "22222222-2222-2222-2222-222222222222"
    path_1 = session_dir / f"{file_id_1}.stl"
    path_2 = session_dir / f"{file_id_2}.stl"
    make_stl(path_1, 10.0)
    make_stl(path_2, 20.0)

    async with aiosqlite.connect(test_db) as db:
        for fid, p in [(file_id_1, path_1), (file_id_2, path_2)]:
            await db.execute(
                """
                INSERT INTO files (file_id, session_id, original_name, extension, size_bytes, storage_path, uploaded_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (fid, session_id, p.name, "stl", p.stat().st_size, str(p), "2024-01-01T00:00:00Z"),
            )
        await db.commit()

    profiles_dir = test_config.profiles_root / "test"
    profiles_dir.mkdir(parents=True, exist_ok=True)
    (profiles_dir / "printer.json").write_text("{}")
    (profiles_dir / "process.json").write_text("{}")
    (profiles_dir / "filament.json").write_text("{}")

    job_request = {
        "file_ids": [file_id_1, file_id_2],
        "instances": [
            {
                "instance_id": "instA", "file_id": file_id_1,
                "x": 30.0, "y": 40.0, "z": 0.0,
                "qx": 0.0, "qy": 0.0, "qz": 0.0, "qw": 1.0,
                "sx": 1.0, "sy": 1.0, "sz": 1.0,
            },
            {
                "instance_id": "instB", "file_id": file_id_2,
                "x": -50.0, "y": 60.0, "z": 0.0,
                "qx": 0.0, "qy": 0.0, "qz": 0.0, "qw": 1.0,
                "sx": 1.0, "sy": 1.0, "sz": 1.0,
            },
        ],
        "action": "slice",
        "plate_number": 0,
        "printer_profile_path": "test/printer.json",
        "process_profile_path": "test/process.json",
        "filament_profile_paths": ["test/filament.json"],
    }

    job_id = await manager.submit(job_request, session_id)

    async with aiosqlite.connect(test_db) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT cli_args FROM jobs WHERE job_id = ?", (job_id,))
        row = await cursor.fetchone()
        cli_args = json.loads(row["cli_args"])

    # The raw STL paths must NOT appear as separate input arguments —
    # they've been replaced by a single positioned 3mf snapshot.
    assert str(path_1) not in cli_args
    assert str(path_2) not in cli_args
    snapshot_args = [a for a in cli_args if a.endswith("_plate_snapshot.3mf")]
    assert len(snapshot_args) == 1
    snapshot_path = Path(snapshot_args[0])
    assert snapshot_path.exists()

    with ZipFile(snapshot_path) as zf:
        model_xml = zf.read("3D/3dmodel.model").decode("utf-8")
    assert 'transform="1.0 0.0 0.0 0.0 1.0 0.0 0.0 0.0 1.0 30.0 40.0 0.0"' in model_xml
    assert 'transform="1.0 0.0 0.0 0.0 1.0 0.0 0.0 0.0 1.0 -50.0 60.0 0.0"' in model_xml


@pytest.mark.asyncio
async def test_job_submission_without_instances_uses_raw_file_ids(test_config, test_db, temp_workspace):
    """Backward-compat: a job request with no `instances` field must
    behave exactly as before (raw file paths passed directly), since
    single-object jobs / any client not yet sending live placement must
    keep working unchanged."""
    manager = JobManager(test_config, test_db)

    session_id = "test-session"
    session_dir = temp_workspace / "sessions" / session_id / "uploads"
    session_dir.mkdir(parents=True)

    file_id = "33333333-3333-3333-3333-333333333333"
    storage_path = session_dir / f"{file_id}.stl"
    storage_path.write_text("dummy stl content")

    async with aiosqlite.connect(test_db) as db:
        await db.execute(
            """
            INSERT INTO files (file_id, session_id, original_name, extension, size_bytes, storage_path, uploaded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (file_id, session_id, "test-file.stl", "stl", storage_path.stat().st_size, str(storage_path), "2024-01-01T00:00:00Z"),
        )
        await db.commit()

    profiles_dir = test_config.profiles_root / "test"
    profiles_dir.mkdir(parents=True, exist_ok=True)
    (profiles_dir / "printer.json").write_text("{}")
    (profiles_dir / "process.json").write_text("{}")
    (profiles_dir / "filament.json").write_text("{}")

    job_request = {
        "file_ids": [file_id],
        "action": "slice",
        "plate_number": 0,
        "printer_profile_path": "test/printer.json",
        "process_profile_path": "test/process.json",
        "filament_profile_paths": ["test/filament.json"],
    }

    job_id = await manager.submit(job_request, session_id)

    async with aiosqlite.connect(test_db) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT cli_args FROM jobs WHERE job_id = ?", (job_id,))
        row = await cursor.fetchone()
        cli_args = json.loads(row["cli_args"])

    assert str(storage_path) in cli_args


class TestBuildPositionedProject3mfConfigOverrides:
    """
    Covers _build_positioned_project_3mf's per-object config_overrides
    passthrough — i.e. that a JobInstancePlacementModel's own
    config_overrides ends up embedded in the resulting snapshot 3mf's
    Metadata/model_settings.config (see threemf_io.py's
    ProjectObject.config_overrides / write_3mf for the actual embedding
    logic this exercises end-to-end).
    """

    def test_instance_config_overrides_appear_in_snapshot_3mf(self, tmp_path: Path):
        stl_path = tmp_path / "cube.stl"
        stl_path.write_bytes(_make_binary_stl_cube(10.0))

        instances = [
            {
                "instance_id": "obj-1",
                "file_id": "obj-1",
                "x": 0.0,
                "y": 0.0,
                "config_overrides": {"brim_type": "outer_brim_only", "brim_width": "5"},
            },
            {
                "instance_id": "obj-2",
                "file_id": "obj-2",
                "x": 50.0,
                "y": 0.0,
                # No overrides — must NOT appear in model_settings.config at all.
            },
        ]
        file_paths = {"obj-1": stl_path, "obj-2": stl_path}
        output_dir = tmp_path / "output"
        output_dir.mkdir()

        snapshot_path = _build_positioned_project_3mf(instances, file_paths, output_dir)

        with ZipFile(snapshot_path) as zf:
            names = set(zf.namelist())
            assert "Metadata/model_settings.config" in names
            config_xml = zf.read("Metadata/model_settings.config").decode("utf-8")

        assert '<object id="1">' in config_xml
        assert '<metadata key="brim_type" value="outer_brim_only"/>' in config_xml
        assert '<metadata key="brim_width" value="5"/>' in config_xml
        assert '<object id="2">' not in config_xml

    def test_instance_without_config_overrides_key_produces_no_model_settings_config(self, tmp_path: Path):
        stl_path = tmp_path / "cube.stl"
        stl_path.write_bytes(_make_binary_stl_cube(10.0))

        instances = [{"instance_id": "obj-1", "file_id": "obj-1", "x": 0.0, "y": 0.0}]
        file_paths = {"obj-1": stl_path}
        output_dir = tmp_path / "output"
        output_dir.mkdir()

        snapshot_path = _build_positioned_project_3mf(instances, file_paths, output_dir)

        with ZipFile(snapshot_path) as zf:
            assert "Metadata/model_settings.config" not in set(zf.namelist())


class TestExtractCliFlagValue:
    """
    Covers _extract_cli_flag_value, used to recover the `post_process`
    parameter override's value out of an already-built cli_args list (the
    CLI itself never runs post-processing scripts — see
    _run_post_process_scripts's doc comment — so job_manager must extract
    the configured script path(s) itself after the CLI exits).
    """

    def test_finds_flag_value(self):
        cli_args = ["/bin/orca-slicer", "--slice", "0", "--post-process=/tmp/addMD5.sh"]
        assert _extract_cli_flag_value(cli_args, "post-process") == "/tmp/addMD5.sh"

    def test_returns_none_when_flag_absent(self):
        cli_args = ["/bin/orca-slicer", "--slice", "0"]
        assert _extract_cli_flag_value(cli_args, "post-process") is None

    def test_value_containing_equals_sign_preserved(self):
        cli_args = ["--post-process=/tmp/script.sh --flag=value"]
        assert _extract_cli_flag_value(cli_args, "post-process") == "/tmp/script.sh --flag=value"


class TestExtractPostProcessFromSettingsFile:
    """
    Covers _extract_post_process_from_settings_file — the fallback source
    for `post_process` when it was SAVED into a process config (rather
    than left as a live, unsaved Process-panel edit sent through
    parameter_overrides/`--post-process=`). Regression coverage for the
    reported bug: adding a post_process script, saving it into the
    process config, and slicing again produced gcode with no "; MD5:"
    line, because job_manager only ever checked the CLI flag and never
    looked at the resolved process settings file that --load-settings
    actually pointed at.
    """

    def test_reads_string_value_from_last_load_settings_path(self, tmp_path):
        process_settings = tmp_path / "process.json"
        process_settings.write_text(json.dumps({"post_process": "/tmp/addMD5.sh"}))
        printer_settings = tmp_path / "printer.json"
        printer_settings.write_text(json.dumps({"nozzle_diameter": "0.4"}))

        cli_args = [
            "/bin/orca-slicer", "--slice", "0",
            "--load-settings", f"{printer_settings};{process_settings}",
        ]
        assert _extract_post_process_from_settings_file(cli_args) == "/tmp/addMD5.sh"

    def test_reads_coStrings_list_value_joined_with_semicolon(self, tmp_path):
        # Native's own on-disk representation of a coStrings option is a
        # JSON list, not a single string — see PrintConfig.cpp's
        # `post_process` def (coStrings) / Config.hpp's ConfigOptionStrings.
        process_settings = tmp_path / "process.json"
        process_settings.write_text(json.dumps({"post_process": ["/tmp/a.sh", "/tmp/b.sh"]}))

        cli_args = ["/bin/orca-slicer", "--slice", "0", "--load-settings", str(process_settings)]
        assert _extract_post_process_from_settings_file(cli_args) == "/tmp/a.sh;/tmp/b.sh"

    def test_returns_none_when_post_process_absent(self, tmp_path):
        process_settings = tmp_path / "process.json"
        process_settings.write_text(json.dumps({"layer_height": "0.2"}))

        cli_args = ["/bin/orca-slicer", "--slice", "0", "--load-settings", str(process_settings)]
        assert _extract_post_process_from_settings_file(cli_args) is None

    def test_returns_none_when_post_process_is_empty(self, tmp_path):
        process_settings = tmp_path / "process.json"
        process_settings.write_text(json.dumps({"post_process": []}))

        cli_args = ["/bin/orca-slicer", "--slice", "0", "--load-settings", str(process_settings)]
        assert _extract_post_process_from_settings_file(cli_args) is None

    def test_returns_none_when_load_settings_flag_absent(self):
        cli_args = ["/bin/orca-slicer", "--slice", "0"]
        assert _extract_post_process_from_settings_file(cli_args) is None

    def test_returns_none_when_settings_file_missing(self, tmp_path):
        missing = tmp_path / "does-not-exist.json"
        cli_args = ["/bin/orca-slicer", "--slice", "0", "--load-settings", str(missing)]
        assert _extract_post_process_from_settings_file(cli_args) is None

    def test_returns_none_when_settings_file_not_valid_json(self, tmp_path):
        bad = tmp_path / "process.json"
        bad.write_text("not json")
        cli_args = ["/bin/orca-slicer", "--slice", "0", "--load-settings", str(bad)]
        assert _extract_post_process_from_settings_file(cli_args) is None


class TestParsePostProcessScripts:
    """
    Covers _parse_post_process_scripts, which must accept either of
    native OrcaSlicer's own separator conventions for multiple scripts
    (';' per the config option's documented tooltip, or newlines per its
    actual coStrings/multiline runtime representation — see the
    function's doc comment).
    """

    def test_single_script(self):
        assert _parse_post_process_scripts("/tmp/addMD5.sh") == ["/tmp/addMD5.sh"]

    def test_semicolon_separated(self):
        assert _parse_post_process_scripts("/tmp/a.sh;/tmp/b.sh") == ["/tmp/a.sh", "/tmp/b.sh"]

    def test_newline_separated(self):
        assert _parse_post_process_scripts("/tmp/a.sh\n/tmp/b.sh") == ["/tmp/a.sh", "/tmp/b.sh"]

    def test_strips_whitespace_and_drops_empty_entries(self):
        assert _parse_post_process_scripts("  /tmp/a.sh ; ;\n/tmp/b.sh  ") == ["/tmp/a.sh", "/tmp/b.sh"]

    def test_empty_value_yields_no_scripts(self):
        assert _parse_post_process_scripts("") == []
        assert _parse_post_process_scripts("   ") == []


@pytest.mark.asyncio
async def test_job_execution_runs_configured_post_process_script(test_config, test_db, temp_workspace):
    """
    End-to-end: a job whose cli_args include `--post-process=<script>`
    must have that script actually executed against every .gcode file in
    the job's output directory after the (mocked, always-exit-0) CLI
    "completes" — this is the actual behavior being added, since the real
    OrcaSlicer CLI binary itself never runs post_process (the call is
    commented out in OrcaSlicer.cpp's --slice path).

    Uses the repo's own scripts/addMD5.sh so this test also guards
    against the exact regression reported: a completed job's gcode
    missing the "; MD5:" line despite post_process being configured.
    """
    manager = JobManager(test_config, test_db)

    session_id = "test-session"
    job_id = "post-process-job"
    output_dir = temp_workspace / "jobs" / job_id / "output"
    output_dir.mkdir(parents=True)

    gcode_path = output_dir / "plate_1.gcode"
    gcode_path.write_text("; HEADER_BLOCK_START\nG28\n")

    addmd5_script = (
        Path(__file__).parent.parent.parent / "scripts" / "addMD5.sh"
    ).resolve()
    assert addmd5_script.exists(), f"addMD5.sh not found at {addmd5_script}"

    # A real CLI invocation would be something like
    # `orca-slicer ... --post-process=/path/to/addMD5.sh`; use `echo` as a
    # stand-in for the CLI binary itself so this test doesn't depend on
    # having the real orca-slicer binary available, while still exercising
    # the real _extract_cli_flag_value -> _run_post_process_scripts path
    # against the job's ACTUAL cli_args.
    cli_args = ["/bin/echo", "slicing", f"--post-process={addmd5_script}"]

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

    await manager._execute(job_id)

    async with aiosqlite.connect(test_db) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT status FROM jobs WHERE job_id = ?", (job_id,))
        row = await cursor.fetchone()
        assert row["status"] == "completed"

    # filename_format (see _apply_filename_format) unconditionally renames
    # every output gcode even when post_process is also configured — since
    # the input here has no real path/footer, it renames to some
    # placeholder-substituted name rather than staying "plate_1.gcode".
    renamed_paths = list(output_dir.glob("*.gcode"))
    assert len(renamed_paths) == 1, f"Expected exactly one gcode output, found: {renamed_paths}"
    contents = renamed_paths[0].read_text()
    assert contents.startswith("; MD5:"), (
        f"Expected addMD5.sh to prepend an MD5 line, got: {contents[:80]!r}"
    )
    assert "G28" in contents


@pytest.mark.asyncio
async def test_job_execution_runs_post_process_saved_into_process_settings_file(test_config, test_db, temp_workspace):
    """
    End-to-end regression test for the reported bug: a job with NO
    `--post-process=...` CLI flag (i.e. the value was saved into the
    process config rather than left as a live Process-panel edit) must
    still run the script, by falling back to reading `post_process` out
    of the resolved process settings file named in `--load-settings` (the
    LAST path in that semicolon-joined list — see cli_builder.py's
    build_cli_args, which always emits printer then process).
    """
    manager = JobManager(test_config, test_db)

    session_id = "test-session"
    job_id = "post-process-saved-config-job"
    output_dir = temp_workspace / "jobs" / job_id / "output"
    output_dir.mkdir(parents=True)

    gcode_path = output_dir / "plate_1.gcode"
    gcode_path.write_text("; HEADER_BLOCK_START\nG28\n")

    addmd5_script = (
        Path(__file__).parent.parent.parent / "scripts" / "addMD5.sh"
    ).resolve()
    assert addmd5_script.exists(), f"addMD5.sh not found at {addmd5_script}"

    printer_settings = output_dir / "printer.json"
    printer_settings.write_text(json.dumps({"nozzle_diameter": "0.4"}))
    process_settings = output_dir / "process.json"
    process_settings.write_text(json.dumps({"post_process": str(addmd5_script)}))

    # No --post-process flag at all — only --load-settings, mirroring a
    # real job built from a process config that already has post_process
    # saved into it (cli_builder.py deliberately never re-emits it as a
    # parameter_overrides flag once it's part of the profile).
    cli_args = [
        "/bin/echo", "slicing",
        "--load-settings", f"{printer_settings};{process_settings}",
    ]

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

    await manager._execute(job_id)

    async with aiosqlite.connect(test_db) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT status FROM jobs WHERE job_id = ?", (job_id,))
        row = await cursor.fetchone()
        assert row["status"] == "completed"

    renamed_paths = list(output_dir.glob("*.gcode"))
    assert len(renamed_paths) == 1, f"Expected exactly one gcode output, found: {renamed_paths}"
    contents = renamed_paths[0].read_text()
    assert contents.startswith("; MD5:"), (
        f"Expected addMD5.sh to prepend an MD5 line even though post_process "
        f"was only saved into the process config (no CLI flag), got: {contents[:80]!r}"
    )
    assert "G28" in contents


@pytest.mark.asyncio
async def test_job_execution_without_post_process_flag_skips_post_processing(test_config, test_db, temp_workspace):
    """A job whose cli_args have no `--post-process=...` flag must leave
    its gcode output completely untouched (no post-processing attempted
    at all) — this is the common case (most jobs don't configure
    post_process) and must not regress into always trying to post-process
    every job."""
    manager = JobManager(test_config, test_db)

    session_id = "test-session"
    job_id = "no-post-process-job"
    output_dir = temp_workspace / "jobs" / job_id / "output"
    output_dir.mkdir(parents=True)

    gcode_path = output_dir / "plate_1.gcode"
    original_contents = "; HEADER_BLOCK_START\nG28\n"
    gcode_path.write_text(original_contents)

    cli_args = ["/bin/echo", "slicing"]

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

    await manager._execute(job_id)

    # filename_format (see _apply_filename_format) still renames the file
    # unconditionally (native applies its default naming scheme even
    # without any explicit override) — content must be untouched, but the
    # name won't stay "plate_1.gcode" since there's no post_process
    # involved here at all.
    remaining_gcodes = list(output_dir.glob("*.gcode"))
    assert len(remaining_gcodes) == 1
    assert remaining_gcodes[0].read_text() == original_contents


@pytest.mark.asyncio
async def test_job_execution_post_process_script_failure_does_not_fail_job(test_config, test_db, temp_workspace):
    """A post-processing script that exits non-zero must be logged and
    skipped, not turn an already-successful (exit code 0) CLI run into a
    failed job — the slice itself succeeded; only the optional
    post-processing step didn't."""
    manager = JobManager(test_config, test_db)

    session_id = "test-session"
    job_id = "post-process-fail-job"
    output_dir = temp_workspace / "jobs" / job_id / "output"
    output_dir.mkdir(parents=True)

    gcode_path = output_dir / "plate_1.gcode"
    gcode_path.write_text("G28\n", encoding="utf-8")

    failing_script = temp_workspace / "fail.sh"
    failing_script.write_text("#!/bin/sh\nexit 1\n")
    failing_script.chmod(0o755)

    cli_args = ["/bin/echo", "slicing", f"--post-process={failing_script}"]

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

    await manager._execute(job_id)

    async with aiosqlite.connect(test_db) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT status, error_message FROM jobs WHERE job_id = ?", (job_id,))
        row = await cursor.fetchone()
        assert row["status"] == "completed"
        assert row["error_message"] is None

    # Content is untouched since the failing script never wrote to it —
    # but filename_format still renames the file unconditionally (see
    # _apply_filename_format), so look up whatever it got renamed to
    # rather than asserting on the original plate_1.gcode path.
    remaining_gcodes = list(output_dir.glob("*.gcode"))
    assert len(remaining_gcodes) == 1
    assert remaining_gcodes[0].read_text() == "G28\n"


class TestExtractInputFilePaths:
    """Covers _extract_input_file_paths, used to recover
    input_filename_base for filename_format substitution from an
    already-built cli_args list (positional args before the first
    --flag, per build_cli_args's fixed ordering)."""

    def test_single_input_file(self):
        cli_args = ["/bin/orca-slicer", "/tmp/model.stl", "--slice", "0"]
        assert _extract_input_file_paths(cli_args) == ["/tmp/model.stl"]

    def test_multiple_input_files(self):
        cli_args = ["/bin/orca-slicer", "/tmp/a.stl", "/tmp/b.stl", "--slice", "0"]
        assert _extract_input_file_paths(cli_args) == ["/tmp/a.stl", "/tmp/b.stl"]

    def test_no_input_files(self):
        cli_args = ["/bin/orca-slicer", "--slice", "0"]
        assert _extract_input_file_paths(cli_args) == []


class TestExtractGcodeConfigValue:
    """Covers _extract_gcode_config_value, which reads a resolved config
    value back out of a sliced gcode's own CONFIG_BLOCK footer dump
    (e.g. "; filament_type = PETG")."""

    def test_extracts_simple_value(self):
        text = "; some line\n; filament_type = PETG\n; other = x\n"
        assert _extract_gcode_config_value(text, "filament_type") == "PETG"

    def test_extracts_value_with_spaces_in_key(self):
        text = "; estimated printing time (normal mode) = 15m 47s\n"
        assert (
            _extract_gcode_config_value(text, "estimated printing time (normal mode)")
            == "15m 47s"
        )

    def test_missing_key_returns_none(self):
        text = "; filament_type = PETG\n"
        assert _extract_gcode_config_value(text, "nozzle_diameter") is None


class TestShortTime:
    """Covers _short_time, a port of native OrcaSlicer's short_time()
    (Utils.hpp) used to render the {print_time} filename_format
    placeholder exactly as native would name the file."""

    def test_minutes_and_seconds(self):
        # Matches the real observed native-named export box_PETG_15m47s.gcode
        assert _short_time("15m 47s") == "15m47s"

    def test_hours_rounds_to_minutes(self):
        assert _short_time("1h 30m 45s") == "1h31m"

    def test_hours_no_rounding_under_30s(self):
        assert _short_time("1h 30m 20s") == "1h30m"

    def test_days(self):
        assert _short_time("2d 3h 15m 10s") == "2d3h15m"

    def test_seconds_only(self):
        assert _short_time("45s") == "45s"

    def test_sub_second(self):
        assert _short_time("0.5s") == "<1s"

    def test_zero(self):
        assert _short_time("0s") == "0s"


class TestSubstituteFilenameFormat:
    """Covers _substitute_filename_format's placeholder substitution
    against the exact default filename_format value documented in
    PrintConfig.cpp / data/parameters.json."""

    def test_default_format(self):
        result = _substitute_filename_format(
            DEFAULT_FILENAME_FORMAT,
            input_filename_base="box",
            filament_type="PETG",
            print_time="15m47s",
        )
        assert result == "box_PETG_15m47s.gcode"

    def test_unknown_placeholder_left_as_literal(self):
        result = _substitute_filename_format(
            "{input_filename_base}_{unknown_key}.gcode",
            input_filename_base="box",
            filament_type="PETG",
            print_time="15m47s",
        )
        assert result == "box_{unknown_key}.gcode"

    def test_no_placeholders(self):
        result = _substitute_filename_format(
            "static_name.gcode",
            input_filename_base="box",
            filament_type="PETG",
            print_time="15m47s",
        )
        assert result == "static_name.gcode"


@pytest.mark.asyncio
async def test_job_execution_applies_default_filename_format(test_config, test_db, temp_workspace):
    """
    End-to-end regression test for the reported bug: a completed slice
    job's output gcode must be renamed to
    {input_filename_base}_{filament_type[initial_tool]}_{print_time}.gcode
    (PrintConfig.cpp's own default for filename_format) even though NO
    filename_format override was configured — native applies this naming
    scheme unconditionally, and the real OrcaSlicer CLI binary never
    performs the substitution itself (see _apply_filename_format's doc
    comment), so job_manager must do it after the CLI exits.
    """
    manager = JobManager(test_config, test_db)

    session_id = "test-session"
    job_id = "filename-format-job"
    output_dir = temp_workspace / "jobs" / job_id / "output"
    output_dir.mkdir(parents=True)

    input_stl = temp_workspace / "sessions" / session_id / "uploads" / "box.stl"
    input_stl.parent.mkdir(parents=True)
    input_stl.write_text("dummy stl")

    original_gcode = output_dir / "plate_1.gcode"
    original_gcode.write_text(
        "; HEADER_BLOCK_START\nG28\n"
        "; CONFIG_BLOCK_START\n"
        "; filament_type = PETG\n"
        "; estimated printing time (normal mode) = 15m 47s\n"
        "; CONFIG_BLOCK_END\n"
    )

    # A real CLI invocation includes the input STL path as a positional
    # arg before --slice, exactly like build_cli_args produces.
    cli_args = ["/bin/echo", str(input_stl), "--slice", "0"]

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

    await manager._execute(job_id)

    async with aiosqlite.connect(test_db) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT status FROM jobs WHERE job_id = ?", (job_id,))
        row = await cursor.fetchone()
        assert row["status"] == "completed"

    expected_path = output_dir / "box_PETG_15m47s.gcode"
    assert expected_path.exists(), (
        f"Expected renamed output at {expected_path}, contents of output_dir: "
        f"{list(output_dir.iterdir())}"
    )
    assert not original_gcode.exists()

    # Registered output_files record must reference the RENAMED file, not
    # the original plate_N.gcode name.
    async with aiosqlite.connect(test_db) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT filename FROM output_files WHERE job_id = ?", (job_id,)
        )
        rows = await cursor.fetchall()
        filenames = {r["filename"] for r in rows}
    assert "box_PETG_15m47s.gcode" in filenames
    assert "plate_1.gcode" not in filenames


@pytest.mark.asyncio
async def test_job_execution_respects_filename_format_override(test_config, test_db, temp_workspace):
    """A job whose cli_args include an explicit
    `--filename-format=...` override must use THAT template instead of
    the built-in default."""
    manager = JobManager(test_config, test_db)

    session_id = "test-session"
    job_id = "filename-format-override-job"
    output_dir = temp_workspace / "jobs" / job_id / "output"
    output_dir.mkdir(parents=True)

    input_stl = temp_workspace / "sessions" / session_id / "uploads" / "widget.stl"
    input_stl.parent.mkdir(parents=True)
    input_stl.write_text("dummy stl")

    original_gcode = output_dir / "plate_1.gcode"
    original_gcode.write_text(
        "; CONFIG_BLOCK_START\n"
        "; filament_type = PLA\n"
        "; estimated printing time (normal mode) = 2h 5m 0s\n"
        "; CONFIG_BLOCK_END\n"
    )

    cli_args = [
        "/bin/echo", str(input_stl), "--slice", "0",
        "--filename-format={input_filename_base}-custom.gcode",
    ]

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

    await manager._execute(job_id)

    assert (output_dir / "widget-custom.gcode").exists()
    assert not original_gcode.exists()
