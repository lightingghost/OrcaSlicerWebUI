"""
Property-based test for file upload round-trip (Property 2).

Feature: orca-slicer-web-ui
Property 2: Uploaded file is stored and retrievable by ID

This test validates that for any valid model file (with an accepted extension
and size ≤ 500 MB), after a successful upload the returned file_id shall be
usable to retrieve the file's metadata via GET /api/files/{file_id}, and the
file shall exist on disk at the recorded storage_path.

**Validates: Requirements 1.2, 1.4**

IMPORTANT: This property test is comprehensive but uses a function-scoped fixture
that reinitializes the FastAPI app for Hypothesis property testing. The app loads
751 parameters from parameters.json on each initialization. Due to this overhead:

- The test runs with max_examples=100 by default (standard for property tests)
- Each example takes ~1-2 seconds due to app initialization
- Total test time: ~2-3 minutes for full run
- The logic is also thoroughly tested by test_files_integration.py

To run this test specifically:
    pytest tests/test_property_2_file_roundtrip.py -v
"""

import io
from pathlib import Path

from fastapi.testclient import TestClient
from hypothesis import given, settings, assume, HealthCheck
from hypothesis import strategies as st
import pytest


# Strategy for generating valid file extensions
valid_extensions = st.sampled_from(["stl", "3mf", "obj", "amf"])


# Strategy for generating valid file content
# For testing, we generate small files up to 50 KB to keep tests fast
valid_file_content = st.binary(min_size=10, max_size=50 * 1024)


# Strategy for generating valid filenames
@st.composite
def valid_filename(draw):
    """Generate a valid filename with an allowed extension."""
    ext = draw(valid_extensions)
    # Generate a simple alphanumeric base name (no special chars to avoid filesystem issues)
    basename = draw(st.text(
        alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
        min_size=1,
        max_size=20
    ))
    assume(len(basename) > 0)  # Ensure non-empty
    return f"{basename}.{ext}"


@pytest.fixture
def test_client_workspace(tmp_path):
    """
    Create a test client with a temporary workspace.
    
    Uses pytest's tmp_path fixture to create isolated workspace for each test.
    Note: Hypothesis reuses this fixture across generated examples within the same test invocation.
    """
    import os
    import sys
    
    workspace = tmp_path / "workspace"
    workspace.mkdir(exist_ok=True)
    
    # Set environment variables
    os.environ["WORKSPACE_ROOT"] = str(workspace)
    os.environ["API_SECRET"] = "test_secret_prop2_xyz"
    os.environ["ORCA_CLI_PATH"] = "/tmp/fake_cli_prop2"
    
    try:
        # Ensure clean import
        for module in ['app.main', 'app.config', 'app.database']:
            if module in sys.modules:
                del sys.modules[module]
        
        from app.main import app
        
        client = TestClient(app)
        
        yield (client, workspace)
    finally:
        # Cleanup environment variables
        for key in ["WORKSPACE_ROOT", "API_SECRET", "ORCA_CLI_PATH"]:
            if key in os.environ:
                del os.environ[key]


# Feature: orca-slicer-web-ui, Property 2: Uploaded file is stored and retrievable by ID
@settings(
    max_examples=100,  # Standard for property tests - provides comprehensive coverage
    deadline=None,  # No deadline as app initialization can take 1-2 seconds per example
    suppress_health_check=[HealthCheck.function_scoped_fixture],  # Fixture is safe for reuse by Hypothesis
)
@given(
    filename=valid_filename(),
    content=valid_file_content,
)
def test_property_2_file_upload_roundtrip(test_client_workspace, filename, content):
    """
    Property 2: Uploaded file is stored and retrievable by ID.
    
    For any valid model file (with an accepted extension and size ≤ 500 MB),
    after a successful upload the returned file_id shall be usable to retrieve
    the file's metadata via GET /api/files/{file_id}, and the file shall exist
    on disk at the recorded storage_path.
    
    This test generates random valid filenames and file contents to verify:
    1. Upload succeeds and returns a file_id
    2. GET /api/files/{file_id} returns correct metadata
    3. File exists on disk at the expected path
    4. File content is preserved exactly
    5. File size matches
    
    **Validates: Requirements 1.2, 1.4**
    """
    client, workspace = test_client_workspace
    
    # Step 1: Upload the file
    upload_response = client.post(
        "/api/files/upload",
        files={"file": (filename, io.BytesIO(content), "application/octet-stream")},
        headers={"Authorization": "Bearer test_secret_prop2_xyz"},
    )
    
    # Assert upload succeeded
    assert upload_response.status_code == 200, \
        f"Upload failed with status {upload_response.status_code}: {upload_response.text}"
    
    upload_data = upload_response.json()
    assert "file_id" in upload_data, "Response should contain file_id"
    file_id = upload_data["file_id"]
    
    # Verify upload response contains expected fields
    assert upload_data["filename"] == filename
    assert upload_data["size_bytes"] == len(content)
    
    # Extract expected extension from filename
    expected_ext = Path(filename).suffix.lstrip(".").lower()
    assert upload_data["extension"] == expected_ext
    
    # Step 2: Retrieve file metadata using the file_id
    metadata_response = client.get(
        f"/api/files/{file_id}",
        headers={"Authorization": "Bearer test_secret_prop2_xyz"},
    )
    
    # Assert metadata retrieval succeeded
    assert metadata_response.status_code == 200, \
        f"Metadata retrieval failed with status {metadata_response.status_code}: {metadata_response.text}"
    
    metadata = metadata_response.json()
    
    # Verify metadata matches upload
    assert metadata["file_id"] == file_id
    assert metadata["original_name"] == filename
    assert metadata["size_bytes"] == len(content)
    assert metadata["extension"] == expected_ext
    assert "uploaded_at" in metadata
    
    # Step 3: Verify the file exists on disk at the storage path
    expected_storage_path = workspace / "sessions" / "default" / "uploads" / f"{file_id}.{expected_ext}"
    
    assert expected_storage_path.exists(), \
        f"File does not exist at expected storage path: {expected_storage_path}"
    
    # Verify the file content matches what was uploaded
    with open(expected_storage_path, "rb") as f:
        stored_content = f.read()
    
    assert stored_content == content, \
        "Stored file content does not match uploaded content"
    
    # Verify the file size matches
    assert expected_storage_path.stat().st_size == len(content), \
        "Stored file size does not match uploaded size"
