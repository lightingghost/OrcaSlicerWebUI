"""
Property-based test for job record round-trip (Property 13).

Feature: orca-slicer-web-ui
Property 13: Job records round-trip correctly

This test validates that for any job submitted to the API, after the job
transitions to any terminal state (completed, failed, timed_out), calling
GET /api/jobs/{job_id} shall return a response containing the original
cli_args, the correct terminal status, a non-null completed_at timestamp,
and all associated output_files (or error_message for failure).

**Validates: Requirements 9.1**
"""

import json
import uuid
from datetime import datetime
from pathlib import Path

import aiosqlite
import pytest
from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st


# Strategy for generating valid terminal status outcomes
terminal_status = st.sampled_from(["completed", "failed", "timed_out"])

# Strategy for generating exit codes
# 0 = success, 1-255 = failure
exit_codes = st.integers(min_value=0, max_value=255)

# Strategy for generating job actions
job_actions = st.sampled_from(["slice", "export_3mf", "export_stl", "export_stls", "export_settings"])


# Strategy for generating simple filenames for output files
@st.composite
def output_filenames(draw):
    """Generate a list of 0-3 output filenames."""
    count = draw(st.integers(min_value=0, max_value=3))
    names = []
    for i in range(count):
        ext = draw(st.sampled_from(["gcode", "3mf", "stl", "json"]))
        names.append(f"output_{i}.{ext}")
    return names


# Strategy for generating error messages
error_messages = st.text(min_size=1, max_size=200)


# Feature: orca-slicer-web-ui, Property 13: Job records round-trip correctly
@settings(
    max_examples=100,  # Standard for property tests
    deadline=None,  # No deadline due to async execution
    suppress_health_check=[HealthCheck.function_scoped_fixture],  # Fixture is safe for reuse
)
@given(
    action=job_actions,
    terminal_state=terminal_status,
    exit_code=exit_codes,
    output_files=output_filenames(),
    error_msg=error_messages,
)
@pytest.mark.asyncio
async def test_property_13_job_roundtrip(
    test_db,
    temp_workspace,
    action,
    terminal_state,
    exit_code,
    output_files,
    error_msg,
):
    """
    Property 13: Job records round-trip correctly.
    
    For any job submitted to the API, after the job transitions to any terminal
    state (completed, failed, timed_out), calling GET /api/jobs/{job_id} shall
    return a response containing the original cli_args, the correct terminal
    status, a non-null completed_at timestamp, and all associated output_files
    (or error_message for failure).
    
    This test:
    1. Directly inserts a job in a terminal state into the database
    2. Inserts corresponding output files for completed jobs
    3. Uses the GET /api/jobs/{job_id} endpoint to retrieve the job
    4. Verifies all fields are present and correct
    
    **Validates: Requirements 9.1**
    """
    from app.auth import init_auth
    from app.routers.jobs import get_job
    from app.database import get_db as get_db_dep
    
    # Initialize auth for API access
    init_auth("test_secret_prop13")
    
    # Generate test data
    job_id = str(uuid.uuid4())
    session_id = "test-session"
    submitted_at = "2024-01-01T10:00:00Z"
    started_at = "2024-01-01T10:01:00Z"
    completed_at = "2024-01-01T10:05:00Z"
    
    # Build CLI args (simplified for testing)
    cli_args = [
        "/tmp/fake_cli",
        "/tmp/test.stl",
        "--slice",
        "0",
        "--load_settings",
        "/tmp/printer.json",
        "--outputdir",
        str(temp_workspace / "jobs" / job_id / "output"),
    ]
    
    output_dir = temp_workspace / "jobs" / job_id / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Determine error_message based on terminal_state
    if terminal_state == "completed":
        final_error_message = None
        final_exit_code = 0
    elif terminal_state == "failed":
        final_error_message = error_msg if error_msg.strip() else "CLI failed"
        final_exit_code = exit_code if exit_code != 0 else 1
    else:  # timed_out
        final_error_message = "Job timed out"
        final_exit_code = None
    
    # Step 1: Insert job record with terminal status
    async with test_db as db:
        await db.execute(
            """
            INSERT INTO jobs (
                job_id, session_id, submitted_at, started_at, completed_at,
                status, action_type, cli_args, exit_code, error_message, output_dir
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                session_id,
                submitted_at,
                started_at,
                completed_at,
                terminal_state,
                action,
                json.dumps(cli_args),
                final_exit_code,
                final_error_message,
                str(output_dir),
            ),
        )
        
        # Step 2: Insert output files if status is completed
        if terminal_state == "completed":
            for filename in output_files:
                file_path = output_dir / filename
                file_path.write_text(f"Mock output content for {filename}")
                
                await db.execute(
                    """
                    INSERT INTO output_files (
                        output_file_id, job_id, filename, size_bytes, storage_path, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid.uuid4()),
                        job_id,
                        filename,
                        len(f"Mock output content for {filename}"),
                        str(file_path),
                        completed_at,
                    ),
                )
        
        await db.commit()
    
    # Step 3: Retrieve job via GET endpoint
    async with test_db as db:
        job_data = await get_job(job_id, db)
    
    # Property assertions:
    
    # 1. Original cli_args are present and match what was stored
    assert "cli_args" in job_data
    assert isinstance(job_data["cli_args"], list)
    assert job_data["cli_args"] == cli_args
    
    # 2. Correct terminal status
    assert job_data["status"] == terminal_state
    assert job_data["status"] in ["completed", "failed", "timed_out"]
    
    # 3. Non-null completed_at timestamp
    assert job_data["completed_at"] is not None
    assert isinstance(job_data["completed_at"], str)
    assert job_data["completed_at"] == completed_at
    
    # 4a. If completed successfully: output_files present
    if terminal_state == "completed":
        assert "output_files" in job_data
        assert isinstance(job_data["output_files"], list)
        assert len(job_data["output_files"]) == len(output_files)
        
        # Verify each output file has required fields
        for output_file in job_data["output_files"]:
            assert "filename" in output_file
            assert "size_bytes" in output_file
            assert "download_url" in output_file
            assert output_file["filename"] in output_files
    
    # 4b. If failed or timed out: error_message present
    if terminal_state in ["failed", "timed_out"]:
        assert "error_message" in job_data
        assert job_data["error_message"] is not None
        assert isinstance(job_data["error_message"], str)
        assert len(job_data["error_message"]) > 0
        assert job_data["error_message"] == final_error_message
    
    # 5. Exit code matches expected (present for completed/failed, None for timed_out)
    assert "exit_code" in job_data
    if terminal_state in ["completed", "failed"]:
        assert job_data["exit_code"] == final_exit_code
    else:  # timed_out
        assert job_data["exit_code"] is None
    
    # 6. Other metadata fields present
    assert job_data["job_id"] == job_id
    assert job_data["session_id"] == session_id
    assert job_data["submitted_at"] == submitted_at
    assert job_data["started_at"] == started_at
    assert job_data["action_type"] == action
    assert job_data["output_dir"] == str(output_dir)
    
    # 7. Timestamps are properly ordered
    submitted_dt = datetime.fromisoformat(job_data["submitted_at"])
    completed_dt = datetime.fromisoformat(job_data["completed_at"])
    assert completed_dt >= submitted_dt, "completed_at must be >= submitted_at"
    
    if job_data["started_at"] is not None:
        started_dt = datetime.fromisoformat(job_data["started_at"])
        assert started_dt >= submitted_dt, "started_at must be >= submitted_at"
        assert completed_dt >= started_dt, "completed_at must be >= started_at"



@pytest.mark.asyncio
async def test_property_13_roundtrip_minimal_example(test_db, temp_workspace):
    """
    Minimal example test for Property 13 - serves as a smoke test.
    
    This is a simplified version that doesn't use Hypothesis, making it easier
    to debug if the property test fails.
    """
    from app.auth import init_auth
    from app.routers.jobs import get_job
    
    # Initialize auth
    init_auth("test_secret")
    
    # Generate test data
    job_id = str(uuid.uuid4())
    session_id = "test-session"
    submitted_at = "2024-01-01T10:00:00Z"
    started_at = "2024-01-01T10:01:00Z"
    completed_at = "2024-01-01T10:05:00Z"
    
    cli_args = ["/tmp/fake_cli", "/tmp/test.stl", "--slice", "0"]
    output_dir = temp_workspace / "jobs" / job_id / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Insert a completed job
    async with test_db as db:
        await db.execute(
            """
            INSERT INTO jobs (
                job_id, session_id, submitted_at, started_at, completed_at,
                status, action_type, cli_args, exit_code, error_message, output_dir
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                session_id,
                submitted_at,
                started_at,
                completed_at,
                "completed",
                "slice",
                json.dumps(cli_args),
                0,
                None,
                str(output_dir),
            ),
        )
        
        # Insert an output file
        output_file_path = output_dir / "output.gcode"
        output_file_path.write_text("G1 X0 Y0")
        
        await db.execute(
            """
            INSERT INTO output_files (
                output_file_id, job_id, filename, size_bytes, storage_path, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid.uuid4()),
                job_id,
                "output.gcode",
                len("G1 X0 Y0"),
                str(output_file_path),
                completed_at,
            ),
        )
        
        await db.commit()
    
    # Retrieve job
    async with test_db as db:
        job_data = await get_job(job_id, db)
    
    # Verify basic fields
    assert job_data["job_id"] == job_id
    assert job_data["status"] == "completed"
    assert job_data["completed_at"] == completed_at
    assert job_data["cli_args"] == cli_args
    assert len(job_data["output_files"]) == 1
    assert job_data["output_files"][0]["filename"] == "output.gcode"
    assert job_data["error_message"] is None
    assert job_data["exit_code"] == 0
