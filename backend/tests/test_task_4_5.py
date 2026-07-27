"""
Property-based test for Task 4.5: Profile lookup validation.

Property 3: Profile lookup returns only existing files

For any manufacturer name present in the profiles directory, calling
GET /api/profiles/{manufacturer} shall return a list where every entry's
path corresponds to a file that actually exists on disk within the
manufacturer's directory.

Validates: Requirements 2.2
"""

import os
import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from hypothesis import given, settings, strategies as st, HealthCheck
from datetime import timedelta


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


@pytest.fixture(scope="module")
def profiles_root():
    """Path to the OrcaSlicer profiles directory."""
    return Path('/home/odin/local/orcaslicerWebUI/OrcaSlicer/resources/profiles')


@pytest.fixture(scope="module")
def real_manufacturers(profiles_root):
    """
    Get list of all real manufacturer directories on disk.
    
    Returns only directories (not .json files or other files).
    """
    manufacturers = []
    for item in profiles_root.iterdir():
        if item.is_dir() and not item.name.startswith('.'):
            manufacturers.append(item.name)
    return sorted(manufacturers)


class TestProfileLookupPropertyBased:
    """
    Property-based tests for profile lookup.
    
    Property 3: Profile lookup returns only existing files
    
    For any manufacturer name present in the profiles directory, calling
    GET /api/profiles/{manufacturer} shall return a list where every entry's
    path corresponds to a file that actually exists on disk within the
    manufacturer's directory.
    
    Validates: Requirements 2.2
    """

    def test_property_3_all_manufacturers_return_existing_files(
        self, client, auth_headers, profiles_root, real_manufacturers
    ):
        """
        **Property 3: Profile lookup returns only existing files**
        
        For EACH real manufacturer directory on disk, assert that every
        returned profile path:
        1. Exists as a file (not a directory)
        2. Is within the manufacturer's directory
        3. Has a .json extension
        
        This is an exhaustive test over all manufacturers, ensuring that
        the API never returns paths to non-existent files.
        
        **Validates: Requirements 2.2**
        """
        assert len(real_manufacturers) > 0, "Should have at least one manufacturer directory"
        
        # Track statistics
        total_profiles_checked = 0
        manufacturers_checked = 0
        
        # Test each manufacturer
        for manufacturer in real_manufacturers:
            # Call the API endpoint
            response = client.get(
                f'/api/profiles/{manufacturer}',
                headers=auth_headers
            )
            
            # Skip if manufacturer endpoint returns 404
            # (some directories might not be valid manufacturers)
            if response.status_code == 404:
                continue
            
            # Endpoint should succeed for valid manufacturers
            assert response.status_code == 200, (
                f"Expected 200 OK for manufacturer {manufacturer!r}, "
                f"got {response.status_code}: {response.text}"
            )
            
            manufacturers_checked += 1
            
            profiles = response.json()
            assert isinstance(profiles, list), (
                f"Expected list response for manufacturer {manufacturer!r}, "
                f"got {type(profiles)}"
            )
            
            # For each returned profile, verify the file exists
            for profile in profiles:
                assert isinstance(profile, dict), "Each profile should be a dict"
                assert 'path' in profile, "Profile should have 'path' field"
                assert 'name' in profile, "Profile should have 'name' field"
                assert 'category' in profile, "Profile should have 'category' field"
                
                profile_path = profile['path']
                full_path = profiles_root / profile_path
                
                # CRITICAL: Verify the file exists
                assert full_path.exists(), (
                    f"Profile file does not exist: {full_path}\n"
                    f"  Manufacturer: {manufacturer}\n"
                    f"  Profile name: {profile['name']}\n"
                    f"  Profile path: {profile_path}\n"
                    f"  Category: {profile['category']}"
                )
                
                # Verify it's a file, not a directory
                assert full_path.is_file(), (
                    f"Profile path is not a file: {full_path}\n"
                    f"  It is a directory: {full_path.is_dir()}"
                )
                
                # Verify it's within the manufacturer directory
                try:
                    full_path.relative_to(profiles_root / manufacturer)
                except ValueError:
                    pytest.fail(
                        f"Profile path is not within manufacturer directory:\n"
                        f"  Profile path: {full_path}\n"
                        f"  Expected within: {profiles_root / manufacturer}"
                    )
                
                # Verify it has .json extension
                assert full_path.suffix == '.json', (
                    f"Profile file should have .json extension: {full_path}"
                )
                
                # Verify the category directory is correct
                expected_categories = ['machine', 'process', 'filament']
                assert profile['category'] in expected_categories, (
                    f"Invalid category {profile['category']!r} for profile {profile['name']}"
                )
                
                # Verify the path contains the category directory
                path_parts = Path(profile_path).parts
                assert profile['category'] in path_parts, (
                    f"Profile path should contain category directory {profile['category']!r}, "
                    f"but got path: {profile_path}"
                )
                
                total_profiles_checked += 1
        
        # Report statistics
        print(f"\n✓ Checked {manufacturers_checked} manufacturers")
        print(f"✓ Verified {total_profiles_checked} profile file paths exist on disk")
        
        # Ensure we actually tested something
        assert manufacturers_checked > 0, "Should have checked at least one manufacturer"
        assert total_profiles_checked > 0, "Should have checked at least one profile"

    @settings(
        max_examples=100,
        deadline=timedelta(seconds=10),
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    @given(
        manufacturer_idx=st.integers(min_value=0, max_value=100),
    )
    def test_property_3_random_manufacturers_files_exist(
        self, client, auth_headers, profiles_root, real_manufacturers, manufacturer_idx
    ):
        """
        **Property 3: Profile lookup returns only existing files**
        
        Hypothesis-driven test that randomly samples manufacturers and verifies
        all returned profile paths exist on disk.
        
        This test uses Hypothesis to:
        1. Generate random manufacturer indices
        2. For each valid manufacturer, fetch profiles
        3. Verify every profile path exists
        
        **Validates: Requirements 2.2**
        """
        if not real_manufacturers:
            pytest.skip("No manufacturers found")
        
        # Use modulo to wrap around if index is too large
        manufacturer = real_manufacturers[manufacturer_idx % len(real_manufacturers)]
        
        # Call API
        response = client.get(
            f'/api/profiles/{manufacturer}',
            headers=auth_headers
        )
        
        # Skip if 404 (not a valid manufacturer endpoint)
        if response.status_code == 404:
            return
        
        assert response.status_code == 200, (
            f"Expected 200 for manufacturer {manufacturer!r}"
        )
        
        profiles = response.json()
        
        # Verify each profile path exists
        for profile in profiles:
            profile_path = profile['path']
            full_path = profiles_root / profile_path
            
            assert full_path.exists(), (
                f"Profile file should exist: {full_path} "
                f"(manufacturer: {manufacturer}, profile: {profile['name']})"
            )
            assert full_path.is_file(), (
                f"Profile path should be a file: {full_path}"
            )

    def test_property_3_sample_specific_manufacturers(
        self, client, auth_headers, profiles_root
    ):
        """
        **Property 3: Profile lookup returns only existing files**
        
        Test specific well-known manufacturers to ensure the property holds.
        
        **Validates: Requirements 2.2**
        """
        # Test a few well-known manufacturers
        test_manufacturers = ['BBL', 'Creality', 'Prusa', 'Anycubic']
        
        for manufacturer in test_manufacturers:
            response = client.get(
                f'/api/profiles/{manufacturer}',
                headers=auth_headers
            )
            
            # Some manufacturers might not exist, that's ok
            if response.status_code == 404:
                continue
            
            assert response.status_code == 200, (
                f"Expected 200 for {manufacturer}"
            )
            
            profiles = response.json()
            assert len(profiles) > 0, (
                f"Expected at least one profile for {manufacturer}"
            )
            
            # Verify all profile paths exist
            for profile in profiles:
                full_path = profiles_root / profile['path']
                assert full_path.exists(), (
                    f"Profile file missing: {full_path} "
                    f"(from manufacturer {manufacturer})"
                )

    def test_property_3_categories_have_valid_paths(
        self, client, auth_headers, profiles_root, real_manufacturers
    ):
        """
        **Property 3: Profile lookup returns only existing files**
        
        For each category (machine, process, filament), verify that all
        profile paths exist on disk.
        
        **Validates: Requirements 2.2**
        """
        if not real_manufacturers:
            pytest.skip("No manufacturers found")
        
        # Pick first manufacturer
        manufacturer = real_manufacturers[0]
        
        response = client.get(
            f'/api/profiles/{manufacturer}',
            headers=auth_headers
        )
        
        if response.status_code == 404:
            pytest.skip(f"Manufacturer {manufacturer} not found")
        
        assert response.status_code == 200
        
        profiles = response.json()
        
        # Group by category and check each
        categories = {}
        for profile in profiles:
            category = profile['category']
            if category not in categories:
                categories[category] = []
            categories[category].append(profile)
        
        # Verify each category
        for category, cat_profiles in categories.items():
            assert category in ['machine', 'process', 'filament'], (
                f"Unknown category: {category}"
            )
            
            for profile in cat_profiles:
                full_path = profiles_root / profile['path']
                assert full_path.exists(), (
                    f"Category {category} profile missing: {full_path}"
                )
                
                # Verify the path contains the category directory
                assert f"/{category}/" in str(full_path) or f"\\{category}\\" in str(full_path), (
                    f"Profile path should contain category directory: {full_path}"
                )

    def test_property_3_no_broken_symlinks(
        self, client, auth_headers, profiles_root, real_manufacturers
    ):
        """
        **Property 3: Profile lookup returns only existing files**
        
        Verify that the API doesn't return paths to broken symbolic links.
        
        **Validates: Requirements 2.2**
        """
        if not real_manufacturers:
            pytest.skip("No manufacturers found")
        
        for manufacturer in real_manufacturers[:5]:  # Test first 5
            response = client.get(
                f'/api/profiles/{manufacturer}',
                headers=auth_headers
            )
            
            if response.status_code == 404:
                continue
            
            assert response.status_code == 200
            
            profiles = response.json()
            
            for profile in profiles:
                full_path = profiles_root / profile['path']
                
                # Check that the path exists (follows symlinks)
                assert full_path.exists(), (
                    f"Profile path does not exist (possibly broken symlink): {full_path}"
                )
                
                # If it's a symlink, verify the target exists
                if full_path.is_symlink():
                    target = full_path.resolve()
                    assert target.exists(), (
                        f"Symlink target does not exist: {full_path} -> {target}"
                    )


class TestProfileLookupEdgeCases:
    """Edge case tests for profile lookup."""

    def test_nonexistent_manufacturer_returns_404(
        self, client, auth_headers, profiles_root
    ):
        """
        Verify that requesting a non-existent manufacturer returns 404.
        
        Validates: Requirements 2.2
        """
        fake_manufacturer = "NonExistentManufacturer12345"
        
        response = client.get(
            f'/api/profiles/{fake_manufacturer}',
            headers=auth_headers
        )
        
        assert response.status_code == 404, (
            "Should return 404 for non-existent manufacturer"
        )

    def test_empty_manufacturer_name(self, client, auth_headers):
        """
        Verify behavior with empty manufacturer name.
        """
        response = client.get(
            '/api/profiles/',
            headers=auth_headers
        )
        
        # Should either return 404 or 405 (method not allowed)
        assert response.status_code in [404, 405], (
            "Empty manufacturer name should not succeed"
        )

    def test_manufacturer_with_special_characters(
        self, client, auth_headers
    ):
        """
        Verify behavior with special characters in manufacturer name.

        NOTE: httpx (which TestClient wraps) normalizes ".." path segments
        client-side before the request is even sent — e.g.
        "/api/profiles/../../" actually gets sent as a request for "/"
        (verified directly against httpx.URL), which lands on the SPA
        index route (see main.py's spa_fallback) rather than exercising
        any manufacturer-lookup logic at all. Percent-encoding the dots
        (%2e%2e) below makes the payload survive httpx's client-side
        normalization so it reaches the server as a literal ".." segment
        the FastAPI/profiles router itself must reject — this is what
        actually exercises _get_profiles_root's manufacturer-not-found
        handling for a raw client (curl, netcat) that doesn't normalize
        the path before sending it.
        """
        special_names = [
            '%2e%2e/etc',
            '%2e%2e/%2e%2e/',
            'manufacturer/%2e%2e/',
            'manufacturer/./subdir',
        ]
        
        for name in special_names:
            response = client.get(
                f'/api/profiles/{name}',
                headers=auth_headers
            )
            
            # Should return 404, not cause a security issue
            assert response.status_code in [404, 400, 422], (
                f"Special character name {name!r} should be rejected or not found"
            )


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
