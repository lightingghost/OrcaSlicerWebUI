"""
Tests for task 4.4: POST /api/profiles/custom endpoint.

Tests the custom profile upload functionality, ensuring:
- Valid JSON files are accepted and stored
- Invalid JSON is rejected with 422
- Non-JSON files are rejected
- Files are stored in correct directory structure
- Unique profile IDs are generated
"""

import json
import tempfile
from pathlib import Path
from io import BytesIO
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Create test client with proper initialization."""
    # Import first, then initialize
    from app.auth import init_auth
    
    # Initialize auth before patching
    init_auth("test_secret_12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        
        yield TestClient(app)


@pytest.fixture
def auth_headers():
    """Get authentication headers."""
    return {"Authorization": "Bearer test_secret_12345"}


@pytest.fixture
def settings():
    """Get settings."""
    from app.config import settings
    return settings


@pytest.fixture
def temp_workspace(tmp_path, settings):
    """Create temporary workspace for testing."""
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    
    # Override settings to use temporary workspace
    original_workspace = settings.workspace_root
    settings.workspace_root = workspace
    
    yield workspace
    
    # Restore original settings
    settings.workspace_root = original_workspace


def test_upload_valid_json_profile(client, auth_headers, temp_workspace):
    """
    Test uploading a valid JSON profile.
    
    Should:
    - Accept valid JSON file
    - Return 200 with profile_id
    - Store file in workspace/custom_profiles/default/{profile_id}.json
    - File should be readable and contain the original JSON
    """
    # Create valid JSON profile content
    profile_data = {
        "printer": "Test Printer",
        "nozzle_diameter": 0.4,
        "layer_height": 0.2
    }
    profile_json = json.dumps(profile_data)
    
    # Create file-like object
    file_data = BytesIO(profile_json.encode('utf-8'))
    
    # Upload file
    response = client.post(
        "/api/profiles/custom",
        headers=auth_headers,
        files={"file": ("test_profile.json", file_data, "application/json")}
    )
    
    # Assert response
    assert response.status_code == 200
    data = response.json()
    assert "profile_id" in data
    profile_id = data["profile_id"]
    
    # Validate UUID format
    assert len(profile_id) == 36  # UUID v4 format
    assert profile_id.count('-') == 4
    
    # Check file was stored correctly
    profile_path = temp_workspace / "custom_profiles" / "default" / f"{profile_id}.json"
    assert profile_path.exists()
    
    # Verify file content
    with open(profile_path, 'r') as f:
        stored_data = json.load(f)
    assert stored_data == profile_data


def test_upload_invalid_json(client, auth_headers, temp_workspace):
    """
    Test uploading invalid JSON content.
    
    Should:
    - Reject invalid JSON with 422
    - Return error message about invalid JSON format
    - Not create any files
    """
    # Create invalid JSON content
    invalid_json = b"{ this is not valid json }"
    file_data = BytesIO(invalid_json)
    
    # Upload file
    response = client.post(
        "/api/profiles/custom",
        headers=auth_headers,
        files={"file": ("invalid.json", file_data, "application/json")}
    )
    
    # Assert response
    assert response.status_code == 422
    assert "Invalid JSON format" in response.json()["detail"]
    
    # Verify no files were created
    custom_profiles_dir = temp_workspace / "custom_profiles"
    if custom_profiles_dir.exists():
        # Should be empty or only contain empty directories
        json_files = list(custom_profiles_dir.rglob("*.json"))
        assert len(json_files) == 0


def test_upload_non_json_extension(client, auth_headers, temp_workspace):
    """
    Test uploading file without .json extension.
    
    Should:
    - Reject non-.json files with 422
    - Return error message about file extension
    """
    # Create file with wrong extension
    content = json.dumps({"test": "data"})
    file_data = BytesIO(content.encode('utf-8'))
    
    # Upload file with .txt extension
    response = client.post(
        "/api/profiles/custom",
        headers=auth_headers,
        files={"file": ("profile.txt", file_data, "text/plain")}
    )
    
    # Assert response
    assert response.status_code == 422
    assert "must be a JSON file" in response.json()["detail"]


def test_upload_creates_directory_structure(client, auth_headers, temp_workspace):
    """
    Test that upload creates necessary directory structure.
    
    Should:
    - Create workspace/custom_profiles/default/ if it doesn't exist
    - Store file in correct location
    """
    # Ensure directory doesn't exist initially
    custom_profiles_dir = temp_workspace / "custom_profiles" / "default"
    assert not custom_profiles_dir.exists()
    
    # Create valid JSON profile
    profile_data = {"test": "data"}
    file_data = BytesIO(json.dumps(profile_data).encode('utf-8'))
    
    # Upload file
    response = client.post(
        "/api/profiles/custom",
        headers=auth_headers,
        files={"file": ("test.json", file_data, "application/json")}
    )
    
    # Assert success
    assert response.status_code == 200
    
    # Verify directory was created
    assert custom_profiles_dir.exists()
    assert custom_profiles_dir.is_dir()


def test_upload_multiple_profiles_get_unique_ids(client, auth_headers, temp_workspace):
    """
    Test that multiple uploads get unique profile IDs.
    
    Should:
    - Each upload returns a different profile_id
    - All files are stored separately
    """
    profile_ids = []
    
    # Upload 3 profiles
    for i in range(3):
        profile_data = {"profile": f"test_{i}"}
        file_data = BytesIO(json.dumps(profile_data).encode('utf-8'))
        
        response = client.post(
            "/api/profiles/custom",
            headers=auth_headers,
            files={"file": (f"profile_{i}.json", file_data, "application/json")}
        )
        
        assert response.status_code == 200
        profile_id = response.json()["profile_id"]
        profile_ids.append(profile_id)
    
    # Verify all IDs are unique
    assert len(profile_ids) == len(set(profile_ids))
    
    # Verify all files exist
    custom_profiles_dir = temp_workspace / "custom_profiles" / "default"
    for profile_id in profile_ids:
        profile_path = custom_profiles_dir / f"{profile_id}.json"
        assert profile_path.exists()


def test_upload_requires_authentication(client, temp_workspace):
    """
    Test that upload endpoint requires authentication.
    
    Should:
    - Reject requests without auth header with 401
    - Reject requests with wrong token with 401
    """
    profile_data = {"test": "data"}
    file_data = BytesIO(json.dumps(profile_data).encode('utf-8'))
    
    # Test without auth header
    response = client.post(
        "/api/profiles/custom",
        files={"file": ("test.json", file_data, "application/json")}
    )
    assert response.status_code == 401  # HTTPBearer returns 401 for missing auth
    
    # Test with wrong token
    file_data = BytesIO(json.dumps(profile_data).encode('utf-8'))
    response = client.post(
        "/api/profiles/custom",
        headers={"Authorization": "Bearer wrong_token"},
        files={"file": ("test.json", file_data, "application/json")}
    )
    assert response.status_code == 401


def test_upload_empty_file(client, auth_headers, temp_workspace):
    """
    Test uploading an empty file.
    
    Should:
    - Reject empty file with 422
    """
    file_data = BytesIO(b"")
    
    response = client.post(
        "/api/profiles/custom",
        headers=auth_headers,
        files={"file": ("empty.json", file_data, "application/json")}
    )
    
    # Empty content is not valid JSON
    assert response.status_code == 422


def test_upload_complex_json_profile(client, auth_headers, temp_workspace):
    """
    Test uploading a complex, realistic profile JSON.
    
    Should:
    - Accept complex nested JSON structures
    - Preserve all data accurately
    """
    # Create realistic profile with nested structures
    profile_data = {
        "version": "1.0.0",
        "printer_settings": {
            "name": "Bambu Lab X1 Carbon",
            "bed_size": [256, 256],
            "nozzle_diameter": [0.4],
            "max_layer_height": [0.3]
        },
        "print_settings": {
            "layer_height": 0.2,
            "first_layer_height": 0.2,
            "infill_density": 15,
            "support_material": False
        },
        "filament_settings": [
            {
                "name": "PLA Basic",
                "temperature": 220,
                "bed_temperature": 60
            }
        ]
    }
    
    file_data = BytesIO(json.dumps(profile_data, indent=2).encode('utf-8'))
    
    response = client.post(
        "/api/profiles/custom",
        headers=auth_headers,
        files={"file": ("complex_profile.json", file_data, "application/json")}
    )
    
    assert response.status_code == 200
    profile_id = response.json()["profile_id"]
    
    # Verify stored content matches original
    profile_path = temp_workspace / "custom_profiles" / "default" / f"{profile_id}.json"
    with open(profile_path, 'r') as f:
        stored_data = json.load(f)
    
    assert stored_data == profile_data
