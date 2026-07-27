"""
Smoke test for Docker Compose configuration validation.

Feature: orca-slicer-web-ui
Task: 22.5 Write smoke test for Docker Compose config

Validates that docker-compose.yml is valid and the combined single-service
configuration is structurally correct.

Requirements: 12.4
"""

import subprocess
import pytest
from pathlib import Path


def _compose_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def test_docker_compose_file_exists():
    """docker-compose.yml must exist at OrcaSlicerWebUI/docker-compose.yml."""
    compose_file = _compose_root() / "docker-compose.yml"
    assert compose_file.exists(), f"docker-compose.yml not found at {compose_file}"
    assert compose_file.is_file()


def test_docker_compose_config_validates():
    """
    `docker compose config` must exit 0 and emit the combined service.

    Requirements: 12.4
    """
    root = _compose_root()
    assert (root / "docker-compose.yml").exists()

    result = subprocess.run(
        ["docker", "compose", "--env-file", "build.env", "config"],
        cwd=str(root),
        capture_output=True,
        text=True,
        timeout=30,
    )

    assert result.returncode == 0, (
        f"docker compose config failed (exit {result.returncode})\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )

    output = result.stdout.lower()
    # Single combined service
    assert "orcaslicer-webui" in output, (
        "Expected 'orcaslicer-webui' service in docker compose config output\n"
        f"Output:\n{result.stdout}"
    )


def test_docker_compose_services_structure():
    """
    Merged config must contain structural elements for the combined service.

    Requirements: 12.4
    """
    root = _compose_root()
    assert (root / "docker-compose.yml").exists()

    result = subprocess.run(
        ["docker", "compose", "--env-file", "build.env", "config"],
        cwd=str(root),
        capture_output=True,
        text=True,
        timeout=30,
    )

    assert result.returncode == 0

    output = result.stdout.lower()
    assert "services:" in output, "Output missing 'services:' section"
    assert "volumes:" in output, "Output missing 'volumes:' section"
    assert "build:" in output, "Missing build configuration"
    assert "ports:" in output, "Missing ports configuration"
    # Single combined container — no separate frontend/backend services
    assert "orcaslicer-webui" in output, "Missing orcaslicer-webui service"
