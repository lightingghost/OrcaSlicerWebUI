"""
Test suite for Task 4.2: GET /api/profiles/{manufacturer} endpoint.

Requirements validated: 2.2
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


def test_manufacturer_profiles_requires_auth(client):
    """
    Test that the manufacturer profiles endpoint requires authentication.
    
    Validates: Requirements 11.5 (authentication required)
    """
    response = client.get('/api/profiles/BBL')
    assert response.status_code == 401, "Expected 401 Unauthorized without auth token"


def test_manufacturer_profiles_rejects_invalid_token(client):
    """
    Test that the manufacturer profiles endpoint rejects invalid tokens.
    
    Validates: Requirements 11.5 (token validation)
    """
    headers = {'Authorization': 'Bearer invalid-token'}
    response = client.get('/api/profiles/BBL', headers=headers)
    assert response.status_code == 401, "Expected 401 Unauthorized with invalid token"


def test_manufacturer_profiles_returns_list(client, auth_headers):
    """
    Test that the manufacturer profiles endpoint returns a list of profiles.
    
    Validates: Requirements 2.2
    """
    response = client.get('/api/profiles/BBL', headers=auth_headers)
    assert response.status_code == 200, f"Expected 200 OK, got {response.status_code}"
    
    profiles = response.json()
    assert isinstance(profiles, list), "Response should be a list"
    assert len(profiles) > 0, "Should return at least one profile for BBL manufacturer"


def test_manufacturer_not_found(client, auth_headers):
    """
    Test that non-existent manufacturer returns 404.
    
    Validates: Requirements 2.2 (404 if manufacturer not found)
    """
    response = client.get('/api/profiles/NonExistentManufacturer', headers=auth_headers)
    assert response.status_code == 404, "Expected 404 Not Found for non-existent manufacturer"
    
    error = response.json()
    assert 'detail' in error, "Error response should contain detail field"
    assert 'not found' in error['detail'].lower(), "Error message should indicate manufacturer not found"


def test_profile_entry_structure(client, auth_headers):
    """
    Test that each profile entry has the correct structure.
    
    Validates: Requirements 2.2 (name, path, category fields)
    """
    response = client.get('/api/profiles/BBL', headers=auth_headers)
    profiles = response.json()
    
    # Check at least one profile has all required fields
    assert len(profiles) > 0, "Should have at least one profile"
    
    for profile in profiles:
        assert 'name' in profile, "Profile entry should have 'name' field"
        assert 'path' in profile, "Profile entry should have 'path' field"
        assert 'category' in profile, "Profile entry should have 'category' field"
        
        # Check field types
        assert isinstance(profile['name'], str), "Profile name should be a string"
        assert isinstance(profile['path'], str), "Profile path should be a string"
        assert isinstance(profile['category'], str), "Profile category should be a string"
        
        # Check category is one of the valid values
        assert profile['category'] in ['machine', 'process', 'filament'], \
            f"Profile category should be machine, process, or filament, got: {profile['category']}"


def test_profile_paths_are_absolute(client, auth_headers):
    """
    Test that profile paths are absolute filesystem paths, with the
    manufacturer/filename decomposition available via dedicated fields —
    see profiles.py's ProfileEntry.path doc comment for why paths moved
    from relative-to-resources/profiles/ to absolute (uniform identifier
    shared with user-saved configs, which have no "resources/profiles/"
    ancestor to be relative to at all).

    Validates: Requirements 2.2
    """
    response = client.get('/api/profiles/BBL', headers=auth_headers)
    profiles = response.json()

    for profile in profiles:
        path = profile['path']
        # Path should be absolute and end with .json
        assert path.startswith('/'), \
            f"Profile path should be an absolute filesystem path, got: {path}"
        assert path.endswith('.json'), \
            f"Profile path should end with .json, got: {path}"
        # Path should contain the category directory
        assert any(cat in path for cat in ['/machine/', '/process/', '/filament/']), \
            f"Profile path should contain category directory, got: {path}"
        # manufacturer/filename fields should be populated for system profiles
        assert profile['manufacturer'] == 'BBL', \
            f"Expected manufacturer 'BBL', got: {profile['manufacturer']}"
        assert profile['filename'], "filename field should be populated"
        assert profile['filename'].endswith('.json')
        assert profile.get('is_user') in (False, None), \
            "System profiles should not be marked is_user"


def test_profile_names_no_extension(client, auth_headers):
    """
    Test that profile names do not include .json extension.
    
    Validates: Requirements 2.2 (name is filename without .json)
    """
    response = client.get('/api/profiles/BBL', headers=auth_headers)
    profiles = response.json()
    
    for profile in profiles:
        name = profile['name']
        assert not name.endswith('.json'), \
            f"Profile name should not include .json extension, got: {name}"


def test_all_categories_present(client, auth_headers):
    """
    Test that profiles from all categories are returned.
    
    Validates: Requirements 2.2 (scan machine, process, and filament directories)
    """
    response = client.get('/api/profiles/BBL', headers=auth_headers)
    profiles = response.json()
    
    categories = {profile['category'] for profile in profiles}
    
    # BBL should have all three categories
    assert 'machine' in categories, "Should have machine profiles"
    assert 'process' in categories, "Should have process profiles"
    assert 'filament' in categories, "Should have filament profiles"


def test_profiles_are_sorted(client, auth_headers):
    """
    Test that profiles are sorted by name.
    
    Validates: Requirements 2.2 (consistent ordering)
    """
    response = client.get('/api/profiles/BBL', headers=auth_headers)
    profiles = response.json()
    
    profile_names = [p['name'] for p in profiles]
    assert profile_names == sorted(profile_names), \
        "Profiles should be sorted by name"


def test_profile_files_exist_on_disk(client, auth_headers):
    """
    Test that returned profile paths correspond to files that exist on disk.
    
    Validates: Property 3: Profile lookup returns only existing files
    Validates: Requirements 2.2
    """
    response = client.get('/api/profiles/BBL', headers=auth_headers)
    profiles = response.json()
    
    for profile in profiles:
        # path is now an absolute filesystem path (see
        # test_profile_paths_are_absolute) — use it directly rather than
        # joining onto profiles_root.
        file_path = Path(profile['path'])
        assert file_path.exists(), \
            f"Profile file should exist on disk: {file_path}"
        assert file_path.is_file(), \
            f"Profile path should point to a file, not directory: {file_path}"


def test_machine_profiles_present(client, auth_headers):
    """
    Test that machine profiles are detected.
    
    Validates: Requirements 2.2
    """
    response = client.get('/api/profiles/BBL', headers=auth_headers)
    profiles = response.json()
    
    machine_profiles = [p for p in profiles if p['category'] == 'machine']
    assert len(machine_profiles) > 0, "Should have at least one machine profile"
    
    # Check for expected machine profiles
    machine_names = {p['name'] for p in machine_profiles}
    # BBL should have various printer models
    assert any('A1' in name or 'X1' in name or 'P1' in name for name in machine_names), \
        "Should have BBL printer models (A1, X1, or P1 series)"


def test_process_profiles_present(client, auth_headers):
    """
    Test that process profiles are detected.
    
    Validates: Requirements 2.2
    """
    response = client.get('/api/profiles/BBL', headers=auth_headers)
    profiles = response.json()
    
    process_profiles = [p for p in profiles if p['category'] == 'process']
    assert len(process_profiles) > 0, "Should have at least one process profile"


def test_filament_profiles_present(client, auth_headers):
    """
    Test that filament profiles are detected.
    
    Validates: Requirements 2.2
    """
    response = client.get('/api/profiles/BBL', headers=auth_headers)
    profiles = response.json()
    
    filament_profiles = [p for p in profiles if p['category'] == 'filament']
    assert len(filament_profiles) > 0, "Should have at least one filament profile"


def test_multiple_manufacturers(client, auth_headers):
    """
    Test that the endpoint works for multiple different manufacturers.
    
    Validates: Requirements 2.2
    """
    manufacturers = ['BBL', 'Creality', 'Prusa', 'Anycubic']
    
    for manufacturer in manufacturers:
        response = client.get(f'/api/profiles/{manufacturer}', headers=auth_headers)
        assert response.status_code == 200, \
            f"Should return 200 for manufacturer {manufacturer}"
        
        profiles = response.json()
        assert len(profiles) > 0, \
            f"Should return profiles for manufacturer {manufacturer}"


def test_manufacturer_with_spaces(client, auth_headers):
    """
    Test that manufacturers with spaces in names work correctly.
    
    Validates: Requirements 2.2
    """
    # "Co Print" is a manufacturer with a space in the name
    response = client.get('/api/profiles/Co Print', headers=auth_headers)
    
    # URL encoding should handle spaces
    if response.status_code == 200:
        profiles = response.json()
        assert isinstance(profiles, list), "Should return a list"
        # If manufacturer exists, verify paths include it
        if len(profiles) > 0:
            for profile in profiles:
                assert 'Co Print' in profile['path'], \
                    "Profile path should include manufacturer name with space"
                assert profile['manufacturer'] == 'Co Print'


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
