"""
Property-based test for file upload round-trip (Property 2).

Feature: orca-slicer-web-ui
Property 2: Uploaded file is stored and retrievable by ID

This test validates that for any valid model file (with an accepted extension
and size ≤ 500 MB), after a successful upload the returned file_id shall be
usable to retrieve the file's metadata via GET /api/files/{file_id}, and the
file shall exist on disk at the recorded storage_path.

**Validates: Requirements 1.2, 1.4**

The FastAPI app's real lifespan (auth/db init) now runs exactly once per
test invocation via `with TestClient(app) as client:` in the fixture below
(Hypothesis reuses that single fixture instance across every generated
example — see the `suppress_health_check` below), not once per example, so
this test only pays app-startup cost a single time. max_examples is kept
deliberately small (20) and file content deliberately tiny (≤2 KB) so a
unit test run stays well under a second or two even on slower machines —
this is a fast smoke-level property check, not an exhaustive fuzz run;
test_files_integration.py covers the same logic with concrete cases.

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
# Kept tiny (up to 2 KB) purely for test speed — this property doesn't
# depend on file size, so there's no coverage benefit to larger content.
valid_file_content = st.binary(min_size=10, max_size=2 * 1024)


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
    tmp_root = tmp_path / "tmp"
    tmp_root.mkdir(exist_ok=True)
    
    # Set environment variables. Uploaded files live under TMP_ROOT
    # (ephemeral session storage — see config.py's tmp_root docstring),
    # not WORKSPACE_ROOT.
    os.environ["WORKSPACE_ROOT"] = str(workspace)
    os.environ["TMP_ROOT"] = str(tmp_root)
    os.environ["API_SECRET"] = "test_secret_prop2_xyz"
    os.environ["ORCA_CLI_PATH"] = "/tmp/fake_cli_prop2"
    
    try:
        # Ensure clean import of every app.* module — not just
        # app.main/app.config/app.database. Every router module does its
        # own `from app.config import settings` at import time, binding
        # its own reference to whatever Settings() instance existed at
        # THAT import; clearing only app.config's cache leaves those
        # routers holding a stale settings object built from a different
        # test file's env vars if this test runs after them in the suite.
        for module in list(sys.modules):
            if module == 'app' or module.startswith('app.'):
                del sys.modules[module]
        
        from app.main import app
        
        # `with TestClient(app) as client:` runs the app's lifespan on
        # entry (init_auth/init_db/etc — see app/main.py's `lifespan`),
        # which a bare `TestClient(app)` does NOT do; without it every
        # authenticated request fails with "Authentication not
        # initialized" since `verify_token` depends on `init_auth`
        # having run.
        with TestClient(app) as client:
            yield (client, tmp_root)
    finally:
        # Cleanup environment variables
        for key in ["WORKSPACE_ROOT", "TMP_ROOT", "API_SECRET", "ORCA_CLI_PATH"]:
            if key in os.environ:
                del os.environ[key]


# Feature: orca-slicer-web-ui, Property 2: Uploaded file is stored and retrievable by ID
@settings(
    max_examples=20,  # Kept small: this is a unit-test-speed smoke check,
                      # not an exhaustive fuzz run (see module docstring).
    deadline=None,
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
