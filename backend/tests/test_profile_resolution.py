"""
Tests for resolved profile configuration (inherits-chain resolution).

Verifies that GET /api/profiles/{manufacturer}/{category}/{filename}/resolved
correctly walks a profile's `inherits` chain and merges the effective
configuration, matching the values the native OrcaSlicer desktop app would
apply when the same profile is selected.
"""

import os
import sys
import pytest
from pathlib import Path
from fastapi.testclient import TestClient

# Set environment variables at module import time (before app.config's
# settings singleton is first created by any import in this session,
# including the direct `resolve_profile_config` unit tests below which
# bypass the `client` fixture).
os.environ.setdefault('API_SECRET', 'test-secret-key-12345')
os.environ.setdefault(
    'ORCA_CLI_PATH',
    '/home/odin/local/orcaslicerWebUI/OrcaSlicer/build/linux/release/OrcaSlicer_ubu64',
)

# `os.environ.setdefault` above only takes effect if app.config hasn't
# already been imported by an earlier test file in this session (its
# Settings() singleton is built once from whatever env vars were current
# at THAT import, and cached — see app/config.py's get_settings()). Force
# a fresh import here so this module's env vars actually apply, keeping
# this file's behavior independent of overall suite run order.
for _mod in list(sys.modules):
    if _mod == 'app' or _mod.startswith('app.'):
        del sys.modules[_mod]


@pytest.fixture(scope="module")
def client():
    """Create a test client with proper configuration."""
    from app.main import app
    from app.auth import init_auth

    init_auth(os.environ['API_SECRET'])

    return TestClient(app)


@pytest.fixture
def auth_headers():
    return {"Authorization": f"Bearer {os.environ['API_SECRET']}"}


def test_resolve_profile_config_merges_inherits_chain():
    """
    Unit test: resolve_profile_config should walk the inherits chain
    (profile -> fdm_process_flashforge_0.20 -> fdm_process_flashforge_common
    -> fdm_process_common) and merge values, with the most specific profile
    winning for any key defined at multiple levels.
    """
    from app.routers.profiles import resolve_profile_config

    profiles_root = Path("/home/odin/local/orcaslicerWebUI/OrcaSlicer/resources/profiles")

    result = resolve_profile_config(
        profiles_root,
        "Flashforge",
        "process",
        "0.20mm Standard @Flashforge AD5M 0.4 Nozzle.json",
    )

    # Values inherited from fdm_process_flashforge_common.json
    assert result["layer_height"] == "0.2"
    assert result["line_width"] == "0.42"
    assert result["initial_layer_line_width"] == "0.50"
    assert result["seam_position"] == "aligned"

    # Value overridden directly on the leaf profile
    assert result["skirt_loops"] == "0"

    # Sanity: should have far more keys than the leaf file alone (which only
    # defines a handful of overrides).
    assert len(result) > 50


def test_resolve_profile_config_leaf_overrides_ancestor():
    """
    The leaf profile's own values should win over any inherited value for
    the same key.
    """
    from app.routers.profiles import resolve_profile_config

    profiles_root = Path("/home/odin/local/orcaslicerWebUI/OrcaSlicer/resources/profiles")

    result = resolve_profile_config(
        profiles_root,
        "Flashforge",
        "process",
        "0.20mm Standard @Flashforge AD5M 0.4 Nozzle.json",
    )

    # skirt_loops is "2" in fdm_process_flashforge_common but "0" on the leaf.
    assert result["skirt_loops"] == "0"


def test_resolved_endpoint_returns_merged_config(client, auth_headers):
    """
    GET .../resolved should return the fully merged configuration, not just
    the raw leaf file content.
    """
    response = client.get(
        "/api/profiles/Flashforge/process/0.20mm Standard @Flashforge AD5M 0.4 Nozzle.json/resolved",
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    content = response.json()

    assert content["layer_height"] == "0.2"
    assert content["line_width"] == "0.42"
    assert content["seam_position"] == "aligned"
    assert len(content) > 50


def test_resolved_endpoint_differs_from_raw_endpoint(client, auth_headers):
    """
    The raw (non-resolved) endpoint should return only the leaf file's own
    keys, while the resolved endpoint returns the full merged configuration.
    This is the behavior gap that caused the web UI's displayed parameter
    values to differ from the native desktop UI.
    """
    raw_response = client.get(
        "/api/profiles/Flashforge/process/0.20mm Standard @Flashforge AD5M 0.4 Nozzle.json",
        headers=auth_headers,
    )
    resolved_response = client.get(
        "/api/profiles/Flashforge/process/0.20mm Standard @Flashforge AD5M 0.4 Nozzle.json/resolved",
        headers=auth_headers,
    )

    assert raw_response.status_code == 200
    assert resolved_response.status_code == 200

    raw_content = raw_response.json()
    resolved_content = resolved_response.json()

    # Raw content should not define layer_height (it's inherited).
    assert "layer_height" not in raw_content
    # Resolved content should define it.
    assert resolved_content["layer_height"] == "0.2"

    assert len(resolved_content) > len(raw_content)


def test_resolved_endpoint_requires_auth(client):
    response = client.get(
        "/api/profiles/Flashforge/process/0.20mm Standard @Flashforge AD5M 0.4 Nozzle.json/resolved"
    )
    assert response.status_code == 401


def test_resolved_endpoint_404_for_missing_profile(client, auth_headers):
    response = client.get(
        "/api/profiles/Flashforge/process/nonexistent_profile.json/resolved",
        headers=auth_headers,
    )
    assert response.status_code == 404


def test_resolved_endpoint_path_traversal_blocked(client, auth_headers):
    response = client.get(
        "/api/profiles/Flashforge/process/../../../etc/passwd/resolved",
        headers=auth_headers,
    )
    assert response.status_code in (404, 422)


def test_resolve_profile_config_handles_root_profile_with_no_inherits():
    """
    A profile with no `inherits` field (a root profile) should resolve to
    just its own content.
    """
    from app.routers.profiles import resolve_profile_config

    profiles_root = Path("/home/odin/local/orcaslicerWebUI/OrcaSlicer/resources/profiles")

    result = resolve_profile_config(
        profiles_root, "Flashforge", "process", "fdm_process_common.json"
    )

    assert result["name"] == "fdm_process_common"
    assert "inherits" not in result or not result["inherits"]


def test_resolve_profile_config_machine_category():
    """
    Sanity check that resolution also works for machine profiles, which use
    the same inherits/vendor-index mechanism.
    """
    from app.routers.profiles import resolve_profile_config

    profiles_root = Path("/home/odin/local/orcaslicerWebUI/OrcaSlicer/resources/profiles")

    result = resolve_profile_config(
        profiles_root, "Flashforge", "machine", "Flashforge Adventurer 5M 0.4 Nozzle.json"
    )

    assert isinstance(result, dict)
    assert len(result) > 0
