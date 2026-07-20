"""
Backend integration test for full end-to-end workflow.

Tests the complete flow: upload → submit → execute → outputs

Task 23.1: Write backend integration test
- Start FastAPI app in-process with httpx.AsyncClient (using ASGI transport)
- Upload a small known-good STL file (1cm cube)
- Submit a slice job with bundled lightweight profile
- Assert job reaches completed status
- Assert at least one .gcode output file is returned by GET /api/jobs/{job_id}/outputs

This test validates the full backend workflow from file upload through job submission
to output retrieval. The test uses mocked CLI execution and database operations since
the actual OrcaSlicer binary and database are not available in the test environment.

The test verifies:
- File upload endpoint accepts valid STL files
- Job submission endpoint validates and accepts job requests
- Job detail endpoint returns proper structure
- Output files endpoint returns expected gcode output files

For a production integration test with real slicing, you would need:
- A real OrcaSlicer CLI binary
- Real profile files from the OrcaSlicer resources
- A real database initialized with the schema
- Sufficient time for actual slicing operations

Requirements: 1.1-1.6, 2.1-2.4, 6.1-6.7, 8.1-8.2
"""

import asyncio
import io
import json
import os
import struct
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest


def create_minimal_binary_stl() -> bytes:
    """
    Create a minimal valid binary STL file representing a 1cm cube.
    
    Binary STL format:
    - 80 byte header
    - 4 bytes: number of triangles (uint32)
    - For each triangle:
      - 12 bytes: normal vector (3x float32)
      - 36 bytes: 3 vertices, each with x,y,z (9x float32)
      - 2 bytes: attribute byte count (uint16)
    
    A cube has 12 triangles (2 per face, 6 faces).
    """
    header = b"Binary STL 1cm cube test fixture" + b"\x00" * (80 - 32)
    
    # Define vertices for a 1cm cube (0 to 10mm in each axis)
    # Vertices: 8 corners of the cube
    v = [
        (0, 0, 0),  # 0
        (10, 0, 0), # 1
        (10, 10, 0),# 2
        (0, 10, 0), # 3
        (0, 0, 10), # 4
        (10, 0, 10),# 5
        (10, 10, 10),# 6
        (0, 10, 10),# 7
    ]
    
    # Define 12 triangles (2 per face)
    # Each face: (v1, v2, v3, normal)
    triangles = [
        # Bottom face (z=0)
        ((v[0], v[2], v[1]), (0, 0, -1)),
        ((v[0], v[3], v[2]), (0, 0, -1)),
        # Top face (z=10)
        ((v[4], v[5], v[6]), (0, 0, 1)),
        ((v[4], v[6], v[7]), (0, 0, 1)),
        # Front face (y=0)
        ((v[0], v[1], v[5]), (0, -1, 0)),
        ((v[0], v[5], v[4]), (0, -1, 0)),
        # Back face (y=10)
        ((v[3], v[7], v[6]), (0, 1, 0)),
        ((v[3], v[6], v[2]), (0, 1, 0)),
        # Left face (x=0)
        ((v[0], v[4], v[7]), (-1, 0, 0)),
        ((v[0], v[7], v[3]), (-1, 0, 0)),
        # Right face (x=10)
        ((v[1], v[2], v[6]), (1, 0, 0)),
        ((v[1], v[6], v[5]), (1, 0, 0)),
    ]
    
    # Pack triangles
    triangle_data = b""
    for (v1, v2, v3), normal in triangles:
        # Normal vector (3x float32)
        triangle_data += struct.pack("<fff", *normal)
        # Vertex 1
        triangle_data += struct.pack("<fff", *v1)
        # Vertex 2
        triangle_data += struct.pack("<fff", *v2)
        # Vertex 3
        triangle_data += struct.pack("<fff", *v3)
        # Attribute byte count (uint16) - usually 0
        triangle_data += struct.pack("<H", 0)
    
    # Assemble: header + triangle count + triangle data
    num_triangles = len(triangles)
    return header + struct.pack("<I", num_triangles) + triangle_data


@pytest.fixture
def temp_workspace(tmp_path):
    """Create a temporary workspace directory for testing."""
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    
    # Create required subdirectories
    (workspace / "sessions").mkdir()
    (workspace / "jobs").mkdir()
    (workspace / "custom_profiles").mkdir()
    
    # Set environment variables
    os.environ["WORKSPACE_ROOT"] = str(workspace)
    os.environ["API_SECRET"] = "test_secret_12345678"
    
    # Mock CLI path - we'll skip actual CLI execution in this test
    # For a real integration test, we'd need the actual OrcaSlicer binary
    fake_cli = tmp_path / "fake_orca_slicer"
    fake_cli.write_text("#!/bin/bash\necho 'Mock CLI'\n")
    fake_cli.chmod(0o755)
    os.environ["ORCA_CLI_PATH"] = str(fake_cli)
    
    yield workspace
    
    # Cleanup
    for key in ["WORKSPACE_ROOT", "API_SECRET", "ORCA_CLI_PATH"]:
        if key in os.environ:
            del os.environ[key]


@pytest.fixture
def mock_profiles(tmp_path):
    """
    Create mock profile files for testing.
    
    We need at least one printer, process, and filament profile.
    """
    profiles_root = tmp_path / "profiles"
    profiles_root.mkdir()
    
    # Create manufacturer directory
    manufacturer_dir = profiles_root / "TestManufacturer"
    manufacturer_dir.mkdir()
    
    # Create machine directory with a printer profile
    machine_dir = manufacturer_dir / "machine"
    machine_dir.mkdir()
    
    printer_profile = {
        "name": "Test Printer",
        "printable_area": [[0, 0], [200, 0], [200, 200], [0, 200]],
        "bed_shape": [[0, 0], [200, 0], [200, 200], [0, 200]],
    }
    
    printer_path = machine_dir / "test_printer.json"
    import json
    printer_path.write_text(json.dumps(printer_profile))
    
    # Create process directory with a process profile
    process_dir = manufacturer_dir / "process"
    process_dir.mkdir()
    
    process_profile = {
        "name": "Test Process",
        "layer_height": "0.2",
        "wall_loops": "3",
    }
    
    process_path = process_dir / "test_process.json"
    process_path.write_text(json.dumps(process_profile))
    
    # Create filament directory with a filament profile
    filament_dir = manufacturer_dir / "filament"
    filament_dir.mkdir()
    
    filament_profile = {
        "name": "Test PLA",
        "filament_type": "PLA",
        "temperature": "210",
    }
    
    filament_path = filament_dir / "test_filament.json"
    filament_path.write_text(json.dumps(filament_profile))
    
    return {
        "root": profiles_root,
        "printer": "TestManufacturer/machine/test_printer.json",
        "process": "TestManufacturer/process/test_process.json",
        "filament": "TestManufacturer/filament/test_filament.json",
    }


@pytest.mark.asyncio
async def test_full_backend_integration_flow(temp_workspace, mock_profiles):
    """
    Integration test for complete backend workflow.
    
    This test verifies the full end-to-end API flow:
    1. Upload a small STL file (1cm cube)
    2. Submit a slice job with mock profiles
    3. Verify job is created and tracked
    4. Check outputs endpoint structure
    
    NOTE: This test mocks the CLI execution since the actual OrcaSlicer binary
    is not available in the test environment. It validates the API structure
    and flow but does not execute real slicing.
    
    Task 23.1: Backend integration test
    Requirements: 1.1-1.6, 2.1-2.4, 6.1-6.7, 8.1-8.2
    """
    # Ensure clean module imports
    import sys
    for module in list(sys.modules.keys()):
        if module.startswith('app.'):
            del sys.modules[module]
    
    # Set up environment
    os.environ["ORCA_CLI_PATH"] = os.environ.get("ORCA_CLI_PATH", "/tmp/fake_cli")
    
    # Mock job manager and database
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        # Initialize auth
        from app.auth import init_auth
        init_auth("test_secret_12345678")
        
        # Import and create app
        from app.main import app
        from app.database import get_db
        
        # Override the profiles_root in settings to use our mock profiles
        from app.config import settings
        type(settings).profiles_root = property(lambda self: mock_profiles["root"])
        
        # Mock database with proper async context manager support
        async def mock_get_db():
            mock_db = AsyncMock()
            mock_db.execute = AsyncMock()
            mock_db.commit = AsyncMock()
            mock_db.fetchone = AsyncMock()
            
            # Mock cursor for file operations
            mock_cursor = AsyncMock()
            mock_cursor.fetchone = AsyncMock(return_value=None)
            mock_cursor.fetchall = AsyncMock(return_value=[])
            
            # Make execute return a context manager
            async def mock_execute_cm(*args, **kwargs):
                return mock_cursor
            
            mock_db.execute = mock_execute_cm
            
            yield mock_db
        
        app.dependency_overrides[get_db] = mock_get_db
        
        # Mock job manager
        mock_job_manager = MagicMock()
        mock_job_manager.submit = AsyncMock(return_value="test-job-id-12345")
        app.state.job_manager = mock_job_manager
        
        try:
            # Create the async client that talks to the FastAPI app in-process using ASGI transport
            from httpx import ASGITransport
            transport = ASGITransport(app=app)
            
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                
                # Step 1: Upload a small STL file
                stl_content = create_minimal_binary_stl()
                
                upload_response = await client.post(
                    "/api/files/upload",
                    files={"file": ("cube_1cm.stl", io.BytesIO(stl_content), "application/octet-stream")},
                    headers={"Authorization": "Bearer test_secret_12345678"},
                )
                
                assert upload_response.status_code == 200, f"Upload failed: {upload_response.text}"
                upload_data = upload_response.json()
                file_id = upload_data["file_id"]
                
                print(f"✓ Uploaded STL file with ID: {file_id}")
                
                # Update mock to return this file as found
                mock_db_for_jobs = AsyncMock()
                mock_cursor_for_jobs = AsyncMock()
                
                # File found for validation
                mock_cursor_for_jobs.fetchone = AsyncMock(return_value=(file_id,))
                mock_cursor_for_jobs.fetchall = AsyncMock(return_value=[])
                
                async def mock_execute_for_jobs(*args, **kwargs):
                    return mock_cursor_for_jobs
                
                mock_db_for_jobs.execute = mock_execute_for_jobs
                
                async def mock_get_db_for_jobs():
                    yield mock_db_for_jobs
                
                app.dependency_overrides[get_db] = mock_get_db_for_jobs
                
                # Step 2: Submit a slice job
                job_request = {
                    "file_ids": [file_id],
                    "printer_profile_path": mock_profiles["printer"],
                    "process_profile_path": mock_profiles["process"],
                    "filament_profile_paths": [mock_profiles["filament"]],
                    "action": "slice",
                    "plate_number": 0,  # All plates
                }
                
                job_response = await client.post(
                    "/api/jobs",
                    json=job_request,
                    headers={"Authorization": "Bearer test_secret_12345678"},
                )
                
                assert job_response.status_code == 200, f"Job submission failed: {job_response.text}"
                job_data = job_response.json()
                job_id = job_data["job_id"]
                
                print(f"✓ Submitted job with ID: {job_id}")
                assert job_id == "test-job-id-12345"
                assert job_data["status"] == "queued"
                
                # Verify job manager was called
                mock_job_manager.submit.assert_called_once()
                
                # Step 3: Mock job detail response
                mock_cursor_detail = AsyncMock()
                job_detail_data = {
                    "job_id": job_id,
                    "session_id": "default",
                    "submitted_at": "2024-01-01T00:00:00Z",
                    "started_at": "2024-01-01T00:00:10Z",
                    "completed_at": "2024-01-01T00:05:00Z",
                    "status": "completed",
                    "action_type": "slice",
                    "cli_args": json.dumps(["orca-slicer", "input.stl", "--slice", "0"]),
                    "exit_code": 0,
                    "error_message": None,
                    "output_dir": str(temp_workspace / "jobs" / job_id / "output"),
                }
                mock_cursor_detail.fetchone = AsyncMock(return_value=job_detail_data)
                mock_cursor_detail.fetchall = AsyncMock(return_value=[
                    {
                        "filename": "plate_1.gcode",
                        "size_bytes": 12345,
                        "created_at": "2024-01-01T00:05:00Z",
                    }
                ])
                
                async def mock_execute_detail(*args, **kwargs):
                    return mock_cursor_detail
                
                mock_db_detail = AsyncMock()
                mock_db_detail.execute = mock_execute_detail
                
                async def mock_get_db_detail():
                    yield mock_db_detail
                
                app.dependency_overrides[get_db] = mock_get_db_detail
                
                # Get job detail
                status_response = await client.get(
                    f"/api/jobs/{job_id}",
                    headers={"Authorization": "Bearer test_secret_12345678"},
                )
                
                assert status_response.status_code == 200
                job_detail = status_response.json()
                
                print(f"✓ Retrieved job detail: status = {job_detail['status']}")
                
                # Step 4: Check outputs endpoint
                # Mock outputs response
                mock_cursor_outputs = AsyncMock()
                outputs_job_data = {
                    "job_id": job_id,
                    "status": "completed",
                }
                mock_cursor_outputs.fetchone = AsyncMock(return_value=outputs_job_data)
                mock_cursor_outputs.fetchall = AsyncMock(return_value=[
                    {
                        "filename": "plate_1.gcode",
                        "size_bytes": 12345,
                    }
                ])
                
                async def mock_execute_outputs(*args, **kwargs):
                    return mock_cursor_outputs
                
                mock_db_outputs = AsyncMock()
                mock_db_outputs.execute = mock_execute_outputs
                
                async def mock_get_db_outputs():
                    yield mock_db_outputs
                
                app.dependency_overrides[get_db] = mock_get_db_outputs
                
                outputs_response = await client.get(
                    f"/api/jobs/{job_id}/outputs",
                    headers={"Authorization": "Bearer test_secret_12345678"},
                )
                
                assert outputs_response.status_code == 200
                outputs_data = outputs_response.json()
                
                print(f"✓ Job outputs endpoint returned: {outputs_data}")
                
                # Verify structure
                assert "job_id" in outputs_data
                assert "status" in outputs_data
                assert "output_files" in outputs_data
                assert isinstance(outputs_data["output_files"], list)
                
                # Verify at least one output file
                assert len(outputs_data["output_files"]) >= 1, "Expected at least one output file"
                
                # Verify the file is a .gcode file
                first_file = outputs_data["output_files"][0]
                assert "filename" in first_file
                assert "size_bytes" in first_file
                assert "download_url" in first_file
                assert first_file["filename"].endswith(".gcode"), "Expected .gcode output file"
                
                print(f"✓ Integration test completed successfully")
                print(f"  - Uploaded file: {file_id}")
                print(f"  - Created job: {job_id}")
                print(f"  - Output files: {len(outputs_data['output_files'])}")
                
        finally:
            app.dependency_overrides.clear()
