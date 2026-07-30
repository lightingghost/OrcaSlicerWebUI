"""
Tests for Task 4.3: GET /api/profiles/{manufacturer}/{category}/{filename}

This test validates that the endpoint:
1. Reads and returns raw profile JSON
2. Applies path guard to prevent traversal
3. Returns 404 if not found

Requirements: 2.3
Validates: Requirements 2.3
"""

import json
import os
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pathlib import Path


@pytest.fixture(scope="module")
def client():
    """Create a test client with proper configuration."""
    # Set environment variables
    os.environ['API_SECRET'] = 'test-secret-key-12345'
    os.environ['ORCA_CLI_PATH'] = '/home/odin/local/orcaslicerWebUI/OrcaSlicer/build/linux/release/OrcaSlicer_ubu64'

    # Force app.config's Settings() singleton to be rebuilt from the env
    # vars just set — otherwise, if an earlier test file in this session
    # already imported app.config, it (and everything that already did
    # `from app.config import settings`) keeps using whichever env vars
    # were current at THAT import, silently ignoring the ones set above.
    import sys
    for mod in list(sys.modules):
        if mod == 'app' or mod.startswith('app.'):
            del sys.modules[mod]
    
    # Import after setting env vars
    from app.main import app
    from app.auth import init_auth
    
    # Initialize auth
    init_auth('test-secret-key-12345')
    
    return TestClient(app)


@pytest.fixture
def auth_headers():
    """Get headers with authentication token."""
    return {"Authorization": "Bearer test-secret-key-12345"}


def test_get_profile_content_success(client, auth_headers):
    """
    Test successfully retrieving a profile JSON file.
    
    Verifies that a valid profile can be retrieved and returns valid JSON.
    """
    # Use BBL manufacturer and a known machine profile
    response = client.get(
        "/api/profiles/BBL/machine/Bambu Lab A1 0.4 nozzle.json",
        headers=auth_headers
    )
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    
    # Verify it returns JSON
    content = response.json()
    assert isinstance(content, dict), "Expected JSON object response"
    
    # Profile JSON should have some standard fields (based on OrcaSlicer structure)
    # We don't verify specific fields as they may vary by profile
    assert len(content) > 0, "Profile should not be empty"


def test_get_profile_content_not_found(client, auth_headers):
    """
    Test that 404 is returned when profile doesn't exist.
    """
    response = client.get(
        "/api/profiles/BBL/machine/nonexistent_profile.json",
        headers=auth_headers
    )
    
    assert response.status_code == 404, f"Expected 404, got {response.status_code}"
    assert "not found" in response.json()["detail"].lower()


def test_get_profile_content_invalid_manufacturer(client, auth_headers):
    """
    Test that 404 is returned for non-existent manufacturer.
    """
    response = client.get(
        "/api/profiles/NonExistentManufacturer/machine/profile.json",
        headers=auth_headers
    )
    
    assert response.status_code == 404, f"Expected 404, got {response.status_code}"


def test_get_profile_content_invalid_category(client, auth_headers):
    """
    Test that 404 is returned for invalid category.
    
    The category is a Literal type, so FastAPI should reject invalid values.
    """
    response = client.get(
        "/api/profiles/BBL/invalid_category/profile.json",
        headers=auth_headers
    )
    
    # FastAPI should return 422 for invalid Literal type
    assert response.status_code == 422, f"Expected 422 for invalid category, got {response.status_code}"


def test_get_profile_content_path_traversal_attempt(client, auth_headers):
    """
    Test that path traversal attempts are blocked.
    
    Verifies that the resolve_and_guard function prevents directory traversal.

    NOTE: httpx (which TestClient wraps) normalizes ".." segments in the URL
    *client-side* before the request is even sent — e.g. requesting
    "/api/profiles/BBL/machine/../../../etc/passwd" actually sends a request
    for "/etc/passwd" (verified directly against httpx.URL), which no longer
    contains "..", exercises a completely different (nonexistent) route, and
    would 404 for a reason unrelated to path-traversal defense at all. A raw
    HTTP client (curl, netcat, or a client using --path-as-is) sends the
    dots on the wire unmodified, so the payload below is percent-encoded
    (%2e%2e) specifically to survive httpx's client-side normalization and
    reach the server with the traversal attempt intact — this is what
    actually exercises resolve_and_guard's defense in cli_builder.py.
    """
    # Percent-encoded ".." so httpx's client-side URL normalization does not
    # collapse the traversal before the request is sent (see note above).
    traversal_attempts = [
        "%2e%2e/%2e%2e/%2e%2e/etc/passwd",
        "%2e%2e/%2e%2e/Prusa/machine/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd",
        "..%2F..%2F..%2Fetc%2Fpasswd",
    ]
    
    for malicious_path in traversal_attempts:
        response = client.get(
            f"/api/profiles/BBL/machine/{malicious_path}",
            headers=auth_headers
        )
        
        # Should return 422 (path validation error) or 404 (file not found after resolution)
        assert response.status_code in [404, 422], (
            f"Path traversal attempt '{malicious_path}' should fail with 404 or 422, "
            f"got {response.status_code}"
        )
        
        # Verify the error message indicates a problem
        assert "detail" in response.json()


def test_get_profile_content_process_category(client, auth_headers):
    """
    Test retrieving a process profile.
    """
    # Check if process profiles exist for BBL
    response = client.get(
        "/api/profiles/BBL",
        headers=auth_headers
    )
    
    assert response.status_code == 200
    profiles = response.json()
    
    # Find a process profile
    process_profiles = [p for p in profiles if p["category"] == "process"]
    
    if process_profiles:
        # Test retrieving the first process profile — build the URL from
        # manufacturer/category/filename (path is now an absolute
        # filesystem path, not a URL-appendable relative segment — see
        # profiles.py's ProfileEntry.path doc comment).
        profile = process_profiles[0]
        response = client.get(
            f"/api/profiles/{profile['manufacturer']}/{profile['category']}/{profile['filename']}",
            headers=auth_headers
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        content = response.json()
        assert isinstance(content, dict), "Expected JSON object response"


def test_get_profile_content_filament_category(client, auth_headers):
    """
    Test retrieving a filament profile.
    """
    # Check if filament profiles exist for BBL
    response = client.get(
        "/api/profiles/BBL",
        headers=auth_headers
    )
    
    assert response.status_code == 200
    profiles = response.json()
    
    # Find a filament profile
    filament_profiles = [p for p in profiles if p["category"] == "filament"]
    
    if filament_profiles:
        # Test retrieving the first filament profile
        profile = filament_profiles[0]
        response = client.get(
            f"/api/profiles/{profile['manufacturer']}/{profile['category']}/{profile['filename']}",
            headers=auth_headers
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        content = response.json()
        assert isinstance(content, dict), "Expected JSON object response"


def test_get_profile_content_requires_auth(client):
    """
    Test that the endpoint requires authentication.
    """
    response = client.get(
        "/api/profiles/BBL/machine/Bambu Lab A1 0.4 nozzle.json"
    )
    
    assert response.status_code == 401, f"Expected 401 without auth, got {response.status_code}"


def test_get_profile_content_with_spaces_in_name(client, auth_headers):
    """
    Test retrieving a profile with spaces in the filename.
    
    This is common in OrcaSlicer profiles (e.g., "Bambu Lab A1 0.4 nozzle.json").
    """
    response = client.get(
        "/api/profiles/BBL/machine/Bambu Lab A1 0.4 nozzle.json",
        headers=auth_headers
    )
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    content = response.json()
    assert isinstance(content, dict), "Expected JSON object response"


def test_get_profile_content_returns_valid_json(client, auth_headers):
    """
    Test that the returned content is valid, parseable JSON.
    """
    response = client.get(
        "/api/profiles/BBL/machine/Bambu Lab A1 0.4 nozzle.json",
        headers=auth_headers
    )
    
    assert response.status_code == 200
    
    # Response should be valid JSON
    content = response.json()
    
    # Should be able to serialize it back to JSON string
    json_str = json.dumps(content)
    assert len(json_str) > 0
    
    # And parse it again
    reparsed = json.loads(json_str)
    assert reparsed == content


if __name__ == "__main__":
    # Run tests with pytest
    pytest.main([__file__, "-v"])
