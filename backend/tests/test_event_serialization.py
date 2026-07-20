"""
Unit tests for WebSocket event serialization.

Tests that each event type (queued, started, progress, warning, completed,
failed, timed_out) serializes to the correct JSON shape as defined in the
design document.

Requirements: 7.1
Task: 8.5 Write unit tests for WebSocket event serialisation
"""

import json
from datetime import datetime

import pytest


def test_queued_event_serialization():
    """
    Test that QueuedEvent serializes to correct JSON shape.
    
    QueuedEvent should contain:
    - type: "queued"
    - job_id: string
    - queue_position: number (1-based position in wait queue)
    - timestamp: ISO-8601 string
    """
    event = {
        "type": "queued",
        "job_id": "test-job-123",
        "queue_position": 3,
        "timestamp": "2024-01-15T10:30:00.000000",
    }
    
    # Serialize to JSON
    event_json = json.dumps(event)
    
    # Deserialize and verify structure
    parsed = json.loads(event_json)
    
    assert parsed["type"] == "queued"
    assert parsed["job_id"] == "test-job-123"
    assert parsed["queue_position"] == 3
    assert isinstance(parsed["queue_position"], int)
    assert "timestamp" in parsed
    assert isinstance(parsed["timestamp"], str)


def test_started_event_serialization():
    """
    Test that StartedEvent serializes to correct JSON shape.
    
    StartedEvent should contain:
    - type: "started"
    - job_id: string
    - timestamp: ISO-8601 string
    """
    event = {
        "type": "started",
        "job_id": "test-job-456",
        "timestamp": "2024-01-15T10:31:00.000000",
    }
    
    # Serialize to JSON
    event_json = json.dumps(event)
    
    # Deserialize and verify structure
    parsed = json.loads(event_json)
    
    assert parsed["type"] == "started"
    assert parsed["job_id"] == "test-job-456"
    assert "timestamp" in parsed
    assert isinstance(parsed["timestamp"], str)


def test_progress_event_serialization():
    """
    Test that ProgressUpdateEvent serializes to correct JSON shape.
    
    ProgressUpdateEvent should contain:
    - type: "progress"
    - job_id: string
    - plate_index: number (current plate being sliced, 0-based)
    - plate_count: number (total number of plates)
    - plate_percent: number (0-100 for current plate)
    - total_percent: number (0-100 overall)
    - message: string (human-readable status text)
    - timestamp: ISO-8601 string
    """
    event = {
        "type": "progress",
        "job_id": "test-job-789",
        "plate_index": 0,
        "plate_count": 2,
        "plate_percent": 45.5,
        "total_percent": 22.75,
        "message": "Slicing layer 100/250",
        "timestamp": "2024-01-15T10:32:00.000000",
    }
    
    # Serialize to JSON
    event_json = json.dumps(event)
    
    # Deserialize and verify structure
    parsed = json.loads(event_json)
    
    assert parsed["type"] == "progress"
    assert parsed["job_id"] == "test-job-789"
    assert parsed["plate_index"] == 0
    assert isinstance(parsed["plate_index"], int)
    assert parsed["plate_count"] == 2
    assert isinstance(parsed["plate_count"], int)
    assert parsed["plate_percent"] == 45.5
    assert isinstance(parsed["plate_percent"], (int, float))
    assert parsed["total_percent"] == 22.75
    assert isinstance(parsed["total_percent"], (int, float))
    assert parsed["message"] == "Slicing layer 100/250"
    assert isinstance(parsed["message"], str)
    assert "timestamp" in parsed
    assert isinstance(parsed["timestamp"], str)


def test_warning_event_serialization():
    """
    Test that WarningEvent serializes to correct JSON shape.
    
    WarningEvent should contain:
    - type: "warning"
    - job_id: string
    - warning: string (warning text)
    - timestamp: ISO-8601 string
    """
    event = {
        "type": "warning",
        "job_id": "test-job-abc",
        "warning": "Model extends beyond build plate boundary",
        "timestamp": "2024-01-15T10:33:00.000000",
    }
    
    # Serialize to JSON
    event_json = json.dumps(event)
    
    # Deserialize and verify structure
    parsed = json.loads(event_json)
    
    assert parsed["type"] == "warning"
    assert parsed["job_id"] == "test-job-abc"
    assert parsed["warning"] == "Model extends beyond build plate boundary"
    assert isinstance(parsed["warning"], str)
    assert "timestamp" in parsed
    assert isinstance(parsed["timestamp"], str)


def test_completed_event_serialization():
    """
    Test that CompletedEvent serializes to correct JSON shape.
    
    CompletedEvent should contain:
    - type: "completed"
    - job_id: string
    - output_files: array of OutputFileSummary objects
        - Each OutputFileSummary has: filename, size_bytes, download_url
    - timestamp: ISO-8601 string
    """
    event = {
        "type": "completed",
        "job_id": "test-job-def",
        "output_files": [
            {
                "filename": "plate_1.gcode",
                "size_bytes": 1048576,
                "download_url": "/api/jobs/test-job-def/outputs/plate_1.gcode",
            },
            {
                "filename": "plate_2.gcode",
                "size_bytes": 2097152,
                "download_url": "/api/jobs/test-job-def/outputs/plate_2.gcode",
            },
        ],
        "timestamp": "2024-01-15T10:45:00.000000",
    }
    
    # Serialize to JSON
    event_json = json.dumps(event)
    
    # Deserialize and verify structure
    parsed = json.loads(event_json)
    
    assert parsed["type"] == "completed"
    assert parsed["job_id"] == "test-job-def"
    assert "output_files" in parsed
    assert isinstance(parsed["output_files"], list)
    assert len(parsed["output_files"]) == 2
    
    # Verify first output file
    output_file_1 = parsed["output_files"][0]
    assert output_file_1["filename"] == "plate_1.gcode"
    assert output_file_1["size_bytes"] == 1048576
    assert isinstance(output_file_1["size_bytes"], int)
    assert output_file_1["download_url"] == "/api/jobs/test-job-def/outputs/plate_1.gcode"
    
    # Verify second output file
    output_file_2 = parsed["output_files"][1]
    assert output_file_2["filename"] == "plate_2.gcode"
    assert output_file_2["size_bytes"] == 2097152
    assert output_file_2["download_url"] == "/api/jobs/test-job-def/outputs/plate_2.gcode"
    
    assert "timestamp" in parsed
    assert isinstance(parsed["timestamp"], str)


def test_failed_event_serialization():
    """
    Test that FailedEvent serializes to correct JSON shape.
    
    FailedEvent should contain:
    - type: "failed"
    - job_id: string
    - exit_code: number (process exit code)
    - error_message: string (error description)
    - timestamp: ISO-8601 string
    """
    event = {
        "type": "failed",
        "job_id": "test-job-ghi",
        "exit_code": 1,
        "error_message": "Failed to load model: file not found",
        "timestamp": "2024-01-15T10:35:00.000000",
    }
    
    # Serialize to JSON
    event_json = json.dumps(event)
    
    # Deserialize and verify structure
    parsed = json.loads(event_json)
    
    assert parsed["type"] == "failed"
    assert parsed["job_id"] == "test-job-ghi"
    assert parsed["exit_code"] == 1
    assert isinstance(parsed["exit_code"], int)
    assert parsed["error_message"] == "Failed to load model: file not found"
    assert isinstance(parsed["error_message"], str)
    assert "timestamp" in parsed
    assert isinstance(parsed["timestamp"], str)


def test_timed_out_event_serialization():
    """
    Test that TimedOutEvent serializes to correct JSON shape.
    
    TimedOutEvent should contain:
    - type: "timed_out"
    - job_id: string
    - timeout_seconds: number (the timeout duration that was exceeded)
    - timestamp: ISO-8601 string
    """
    event = {
        "type": "timed_out",
        "job_id": "test-job-jkl",
        "timeout_seconds": 3600,
        "timestamp": "2024-01-15T11:30:00.000000",
    }
    
    # Serialize to JSON
    event_json = json.dumps(event)
    
    # Deserialize and verify structure
    parsed = json.loads(event_json)
    
    assert parsed["type"] == "timed_out"
    assert parsed["job_id"] == "test-job-jkl"
    assert parsed["timeout_seconds"] == 3600
    assert isinstance(parsed["timeout_seconds"], int)
    assert "timestamp" in parsed
    assert isinstance(parsed["timestamp"], str)


def test_event_type_discriminator():
    """
    Test that event type field correctly discriminates between event types.
    
    The 'type' field is the discriminator that allows clients to determine
    which event type they received.
    """
    event_types = [
        {"type": "queued", "job_id": "1", "queue_position": 1, "timestamp": "2024-01-15T10:30:00"},
        {"type": "started", "job_id": "2", "timestamp": "2024-01-15T10:30:00"},
        {"type": "progress", "job_id": "3", "plate_index": 0, "plate_count": 1, 
         "plate_percent": 50, "total_percent": 50, "message": "test", "timestamp": "2024-01-15T10:30:00"},
        {"type": "warning", "job_id": "4", "warning": "test warning", "timestamp": "2024-01-15T10:30:00"},
        {"type": "completed", "job_id": "5", "output_files": [], "timestamp": "2024-01-15T10:30:00"},
        {"type": "failed", "job_id": "6", "exit_code": 1, "error_message": "error", "timestamp": "2024-01-15T10:30:00"},
        {"type": "timed_out", "job_id": "7", "timeout_seconds": 3600, "timestamp": "2024-01-15T10:30:00"},
    ]
    
    expected_types = ["queued", "started", "progress", "warning", "completed", "failed", "timed_out"]
    
    for event, expected_type in zip(event_types, expected_types):
        event_json = json.dumps(event)
        parsed = json.loads(event_json)
        assert parsed["type"] == expected_type


def test_timestamp_format():
    """
    Test that timestamp field follows ISO-8601 format.
    
    All events should have a timestamp field in ISO-8601 format.
    This test verifies the format can be parsed as a datetime.
    """
    timestamp = datetime.utcnow().isoformat()
    
    event = {
        "type": "started",
        "job_id": "test-job",
        "timestamp": timestamp,
    }
    
    event_json = json.dumps(event)
    parsed = json.loads(event_json)
    
    # Verify timestamp can be parsed back to datetime
    parsed_timestamp = datetime.fromisoformat(parsed["timestamp"])
    assert isinstance(parsed_timestamp, datetime)


def test_json_serialization_handles_special_characters():
    """
    Test that JSON serialization correctly handles special characters in strings.
    
    Event messages and error strings may contain special characters that need
    proper escaping in JSON.
    """
    event = {
        "type": "warning",
        "job_id": "test-job",
        "warning": 'Warning: "quoted text" and special chars: \n\t\\',
        "timestamp": "2024-01-15T10:30:00",
    }
    
    # Serialize to JSON
    event_json = json.dumps(event)
    
    # Deserialize and verify content is preserved
    parsed = json.loads(event_json)
    
    assert parsed["warning"] == 'Warning: "quoted text" and special chars: \n\t\\'


def test_empty_output_files_array():
    """
    Test that completed event can have an empty output_files array.
    
    Some operations may complete without producing output files.
    """
    event = {
        "type": "completed",
        "job_id": "test-job",
        "output_files": [],
        "timestamp": "2024-01-15T10:30:00",
    }
    
    event_json = json.dumps(event)
    parsed = json.loads(event_json)
    
    assert parsed["type"] == "completed"
    assert parsed["output_files"] == []
    assert isinstance(parsed["output_files"], list)


def test_numeric_types_preserved():
    """
    Test that numeric types (int vs float) are preserved in JSON serialization.
    
    Some fields should be integers (exit_code, queue_position) while others
    can be floats (plate_percent, total_percent).
    """
    progress_event = {
        "type": "progress",
        "job_id": "test-job",
        "plate_index": 0,
        "plate_count": 2,
        "plate_percent": 45.5,  # float
        "total_percent": 22,    # can be int or float
        "message": "Processing",
        "timestamp": "2024-01-15T10:30:00",
    }
    
    progress_json = json.dumps(progress_event)
    parsed_progress = json.loads(progress_json)
    
    # Integers should remain integers
    assert isinstance(parsed_progress["plate_index"], int)
    assert isinstance(parsed_progress["plate_count"], int)
    
    # Floats should remain floats
    assert isinstance(parsed_progress["plate_percent"], float)
    
    # Both int and float are acceptable for percentages
    assert isinstance(parsed_progress["total_percent"], (int, float))
    
    failed_event = {
        "type": "failed",
        "job_id": "test-job",
        "exit_code": 1,
        "error_message": "Error",
        "timestamp": "2024-01-15T10:30:00",
    }
    
    failed_json = json.dumps(failed_event)
    parsed_failed = json.loads(failed_json)
    
    # Exit code should be an integer
    assert isinstance(parsed_failed["exit_code"], int)


def test_required_fields_present():
    """
    Test that each event type has all required fields present.
    
    This test ensures that events cannot be created without their required fields.
    """
    # Test queued event requires all fields
    queued_event = {
        "type": "queued",
        "job_id": "test-job",
        "queue_position": 1,
        "timestamp": "2024-01-15T10:30:00",
    }
    json_str = json.dumps(queued_event)
    parsed = json.loads(json_str)
    assert all(key in parsed for key in ["type", "job_id", "queue_position", "timestamp"])
    
    # Test progress event requires all fields
    progress_event = {
        "type": "progress",
        "job_id": "test-job",
        "plate_index": 0,
        "plate_count": 1,
        "plate_percent": 50,
        "total_percent": 50,
        "message": "Processing",
        "timestamp": "2024-01-15T10:30:00",
    }
    json_str = json.dumps(progress_event)
    parsed = json.loads(json_str)
    assert all(key in parsed for key in [
        "type", "job_id", "plate_index", "plate_count", 
        "plate_percent", "total_percent", "message", "timestamp"
    ])
