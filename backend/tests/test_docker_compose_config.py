"""
Smoke test for Docker Compose configuration validation.

Feature: orca-slicer-web-ui
Task: 22.5 Write smoke test for Docker Compose config

This test runs `docker compose config` via subprocess to validate the
docker-compose.yml file and ensure it contains both service definitions.

Requirements: 12.4
"""

import subprocess
import pytest
from pathlib import Path


def test_docker_compose_config_validates():
    """
    Test that docker compose config command succeeds and contains both services.
    
    This smoke test validates:
    1. docker-compose.yml is valid YAML and parseable by docker compose
    2. The 'frontend' service is defined
    3. The 'backend' service is defined
    4. The command exits with code 0
    
    Requirements: 12.4
    """
    # Find docker-compose.yml in the OrcaSlicerWebUI directory
    # Test file is at: OrcaSlicerWebUI/backend/tests/test_docker_compose_config.py
    # docker-compose.yml is at: OrcaSlicerWebUI/docker-compose.yml
    test_file_path = Path(__file__).resolve()
    orcaslicer_webui_root = test_file_path.parent.parent.parent
    compose_file = orcaslicer_webui_root / "docker-compose.yml"
    
    # Verify the compose file exists before running the command
    assert compose_file.exists(), f"docker-compose.yml not found at {compose_file}"
    
    # Run docker compose config from the OrcaSlicerWebUI directory
    result = subprocess.run(
        ["docker", "compose", "config"],
        cwd=str(orcaslicer_webui_root),
        capture_output=True,
        text=True,
        timeout=30
    )
    
    # Assert exit code is 0 (success)
    assert result.returncode == 0, (
        f"docker compose config failed with exit code {result.returncode}\n"
        f"stdout: {result.stdout}\n"
        f"stderr: {result.stderr}"
    )
    
    # Assert output contains both service definitions
    output = result.stdout.lower()
    
    # Check for 'frontend' service
    assert "frontend" in output, (
        "docker compose config output does not contain 'frontend' service definition\n"
        f"Output:\n{result.stdout}"
    )
    
    # Check for 'backend' service
    assert "backend" in output, (
        "docker compose config output does not contain 'backend' service definition\n"
        f"Output:\n{result.stdout}"
    )


def test_docker_compose_file_exists():
    """
    Test that docker-compose.yml file exists in the expected location.
    
    This is a precondition check that helps diagnose issues if the main test fails.
    
    Requirements: 12.4
    """
    test_file_path = Path(__file__).resolve()
    orcaslicer_webui_root = test_file_path.parent.parent.parent
    compose_file = orcaslicer_webui_root / "docker-compose.yml"
    
    assert compose_file.exists(), (
        f"docker-compose.yml not found at expected location: {compose_file}\n"
        f"Expected location: OrcaSlicerWebUI/docker-compose.yml"
    )
    assert compose_file.is_file(), f"{compose_file} exists but is not a file"


def test_docker_compose_services_structure():
    """
    Test that docker compose config output has expected structure.
    
    Validates that the merged configuration includes:
    - services section
    - volumes section
    - frontend service with expected keys
    - backend service with expected keys
    
    Requirements: 12.4
    """
    test_file_path = Path(__file__).resolve()
    orcaslicer_webui_root = test_file_path.parent.parent.parent
    compose_file = orcaslicer_webui_root / "docker-compose.yml"
    
    assert compose_file.exists(), f"docker-compose.yml not found at {compose_file}"
    
    result = subprocess.run(
        ["docker", "compose", "config"],
        cwd=str(orcaslicer_webui_root),
        capture_output=True,
        text=True,
        timeout=30
    )
    
    assert result.returncode == 0, (
        f"docker compose config failed with exit code {result.returncode}"
    )
    
    output = result.stdout.lower()
    
    # Check for structural elements
    assert "services:" in output, "Output missing 'services:' section"
    assert "volumes:" in output, "Output missing 'volumes:' section"
    
    # Check frontend service has expected configuration
    assert "frontend:" in output, "Missing frontend service definition"
    assert "build:" in output, "Missing build configuration"
    assert "ports:" in output, "Missing ports configuration"
    
    # Check backend service has expected configuration
    assert "backend:" in output, "Missing backend service definition"
    assert "environment:" in output, "Missing environment configuration"
