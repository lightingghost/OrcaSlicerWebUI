"""
Test suite for Task 4.1: GET /api/profiles/manufacturers endpoint.

Requirements validated: 2.1
"""

import os
import pytest
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
    """Valid authentication headers."""
    return {'Authorization': 'Bearer test-secret-key-12345'}


def test_manufacturers_endpoint_requires_auth(client):
    """
    Test that the manufacturers endpoint requires authentication.
    
    Validates: Requirements 11.5 (authentication required)
    """
    response = client.get('/api/profiles/manufacturers')
    assert response.status_code == 401, "Expected 401 Unauthorized without auth token"


def test_manufacturers_endpoint_rejects_invalid_token(client):
    """
    Test that the manufacturers endpoint rejects invalid tokens.
    
    Validates: Requirements 11.5 (token validation)
    """
    headers = {'Authorization': 'Bearer invalid-token'}
    response = client.get('/api/profiles/manufacturers', headers=headers)
    assert response.status_code == 401, "Expected 401 Unauthorized with invalid token"


def test_manufacturers_endpoint_returns_list(client, auth_headers):
    """
    Test that the manufacturers endpoint returns a list of manufacturers.
    
    Validates: Requirements 2.1
    """
    response = client.get('/api/profiles/manufacturers', headers=auth_headers)
    assert response.status_code == 200, f"Expected 200 OK, got {response.status_code}"
    
    manufacturers = response.json()
    assert isinstance(manufacturers, list), "Response should be a list"
    assert len(manufacturers) > 0, "Should return at least one manufacturer"


def test_manufacturers_are_strings(client, auth_headers):
    """
    Test that all manufacturer entries are strings.
    
    Validates: Requirements 2.1
    """
    response = client.get('/api/profiles/manufacturers', headers=auth_headers)
    manufacturers = response.json()
    
    assert all(isinstance(m, str) for m in manufacturers), \
        "All manufacturer entries should be strings"


def test_manufacturers_list_is_sorted(client, auth_headers):
    """
    Test that the manufacturers list is sorted alphabetically.
    
    Validates: Requirements 2.1 (consistent ordering)
    """
    response = client.get('/api/profiles/manufacturers', headers=auth_headers)
    manufacturers = response.json()
    
    assert manufacturers == sorted(manufacturers), \
        "Manufacturers list should be sorted alphabetically"


def test_manufacturers_only_directories(client, auth_headers):
    """
    Test that only directories are returned (no files).
    
    Validates: Requirements 2.1 (scan for subdirectories)
    """
    response = client.get('/api/profiles/manufacturers', headers=auth_headers)
    manufacturers = response.json()
    
    # Verify that no file extensions are present (files like "BBL.json" should not be included)
    for manufacturer in manufacturers:
        assert '.' not in manufacturer or not manufacturer.endswith('.json'), \
            f"Manufacturer list should not include files: {manufacturer}"


def test_expected_manufacturers_present(client, auth_headers):
    """
    Test that common expected manufacturers are present.
    
    Validates: Requirements 2.1
    """
    response = client.get('/api/profiles/manufacturers', headers=auth_headers)
    manufacturers = response.json()
    
    # These are well-known manufacturers that should exist in OrcaSlicer
    expected_manufacturers = ['BBL', 'Anycubic', 'Creality', 'Prusa']
    
    for expected in expected_manufacturers:
        assert expected in manufacturers, \
            f"Expected manufacturer '{expected}' not found in list"


def test_manufacturers_endpoint_path(client, auth_headers):
    """
    Test that the endpoint is accessible at the correct path.
    
    Validates: Requirements 2.1
    """
    # Test with /api prefix (as mounted in main.py)
    response = client.get('/api/profiles/manufacturers', headers=auth_headers)
    assert response.status_code == 200, \
        "Endpoint should be accessible at /api/profiles/manufacturers"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
