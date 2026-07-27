"""
Unit tests for configuration module.

Tests verify that the Settings model correctly loads environment variables,
applies defaults, validates constraints, and provides derived properties.
"""

import os
import warnings
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import Settings, get_settings


class TestSettingsDefaults:
    """Test that Settings applies correct default values."""

    def test_default_values(self, monkeypatch):
        """All settings should have documented defaults when env vars are absent."""
        # Clear any existing env vars
        for key in [
            "ORCA_CLI_PATH",
            "WORKSPACE_ROOT",
            "MAX_CONCURRENT_JOBS",
            "JOB_TIMEOUT_SECONDS",
            "OUTPUT_RETENTION_SECONDS",
            "JOB_RECORD_RETENTION_SECONDS",
            "API_SECRET",
        ]:
            monkeypatch.delenv(key, raising=False)

        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            settings = Settings()

        assert settings.orca_cli_path == Path(
            "/app/orca-slicer/build/linux/OrcaSlicer_ubu64"
        )
        assert settings.workspace_root == Path("/app/workspace")
        assert settings.max_concurrent_jobs == 4
        assert settings.job_timeout_seconds == 3600
        assert settings.output_retention_seconds == 86400
        assert settings.job_record_retention_seconds == 604800
        assert settings.api_secret == "changeme"


class TestSettingsEnvironmentVariables:
    """Test that Settings correctly reads from environment variables."""

    def test_env_var_override(self, monkeypatch):
        """Settings should override defaults when env vars are provided."""
        monkeypatch.setenv("ORCA_CLI_PATH", "/custom/path/to/orca")
        monkeypatch.setenv("WORKSPACE_ROOT", "/custom/workspace")
        monkeypatch.setenv("MAX_CONCURRENT_JOBS", "8")
        monkeypatch.setenv("JOB_TIMEOUT_SECONDS", "7200")
        monkeypatch.setenv("OUTPUT_RETENTION_SECONDS", "43200")
        monkeypatch.setenv("JOB_RECORD_RETENTION_SECONDS", "1209600")
        monkeypatch.setenv("API_SECRET", "custom_secret_key_12345")

        settings = Settings()

        assert settings.orca_cli_path == Path("/custom/path/to/orca")
        assert settings.workspace_root == Path("/custom/workspace")
        assert settings.max_concurrent_jobs == 8
        assert settings.job_timeout_seconds == 7200
        assert settings.output_retention_seconds == 43200
        assert settings.job_record_retention_seconds == 1209600
        assert settings.api_secret == "custom_secret_key_12345"


class TestSettingsValidation:
    """Test that Settings validates constraints correctly."""

    def test_max_concurrent_jobs_min_constraint(self, monkeypatch):
        """max_concurrent_jobs must be >= 1."""
        monkeypatch.setenv("MAX_CONCURRENT_JOBS", "0")
        monkeypatch.setenv("API_SECRET", "test_secret")

        with pytest.raises(ValidationError) as exc_info:
            Settings()

        assert "max_concurrent_jobs" in str(exc_info.value)

    def test_max_concurrent_jobs_max_constraint(self, monkeypatch):
        """max_concurrent_jobs must be <= 32."""
        monkeypatch.setenv("MAX_CONCURRENT_JOBS", "33")
        monkeypatch.setenv("API_SECRET", "test_secret")

        with pytest.raises(ValidationError) as exc_info:
            Settings()

        assert "max_concurrent_jobs" in str(exc_info.value)

    def test_job_timeout_min_constraint(self, monkeypatch):
        """job_timeout_seconds must be >= 60."""
        monkeypatch.setenv("JOB_TIMEOUT_SECONDS", "30")
        monkeypatch.setenv("API_SECRET", "test_secret")

        with pytest.raises(ValidationError) as exc_info:
            Settings()

        assert "job_timeout_seconds" in str(exc_info.value)

    def test_api_secret_min_length(self, monkeypatch):
        """api_secret must be at least 8 characters."""
        monkeypatch.setenv("API_SECRET", "short")

        with pytest.raises(ValidationError) as exc_info:
            Settings()

        assert "api_secret" in str(exc_info.value)

    def test_orca_cli_path_must_be_absolute(self, monkeypatch):
        """orca_cli_path must be an absolute path."""
        monkeypatch.setenv("ORCA_CLI_PATH", "relative/path/to/orca")
        monkeypatch.setenv("API_SECRET", "test_secret")

        with pytest.raises(ValidationError) as exc_info:
            Settings()

        assert "absolute path" in str(exc_info.value).lower()

    def test_workspace_root_must_be_absolute(self, monkeypatch):
        """workspace_root must be an absolute path."""
        monkeypatch.setenv("WORKSPACE_ROOT", "relative/workspace")
        monkeypatch.setenv("API_SECRET", "test_secret")

        with pytest.raises(ValidationError) as exc_info:
            Settings()

        assert "absolute path" in str(exc_info.value).lower()


class TestDerivedProperties:
    """Test that derived properties compute correct paths."""

    def test_profiles_root(self, monkeypatch):
        """
        profiles_root should be derived from CLI path.

        The CLI binary lives at <squashfs-root>/bin/orca-slicer (the
        AppImage extraction layout used in production — see Dockerfile /
        run-local.sh), so profiles_root walks up two levels from the
        binary (bin/ -> squashfs-root/) then into resources/profiles.
        """
        monkeypatch.setenv(
            "ORCA_CLI_PATH", "/app/squashfs-root/bin/orca-slicer"
        )
        monkeypatch.setenv("API_SECRET", "test_secret")

        settings = Settings()

        expected = Path("/app/squashfs-root/resources/profiles")
        assert settings.profiles_root == expected

    def test_session_uploads_dir(self, monkeypatch):
        """session_uploads_dir should be workspace_root/sessions."""
        monkeypatch.setenv("WORKSPACE_ROOT", "/custom/workspace")
        monkeypatch.setenv("API_SECRET", "test_secret")

        settings = Settings()

        assert settings.session_uploads_dir == Path("/custom/workspace/sessions")

    def test_jobs_output_dir(self, monkeypatch):
        """jobs_output_dir should be workspace_root/jobs."""
        monkeypatch.setenv("WORKSPACE_ROOT", "/custom/workspace")
        monkeypatch.setenv("API_SECRET", "test_secret")

        settings = Settings()

        assert settings.jobs_output_dir == Path("/custom/workspace/jobs")

    def test_custom_profiles_dir(self, monkeypatch):
        """custom_profiles_dir should be workspace_root/custom_profiles."""
        monkeypatch.setenv("WORKSPACE_ROOT", "/custom/workspace")
        monkeypatch.setenv("API_SECRET", "test_secret")

        settings = Settings()

        assert settings.custom_profiles_dir == Path("/custom/workspace/custom_profiles")


class TestDefaultSecretWarning:
    """Test that using the default API secret triggers a warning."""

    def test_default_secret_triggers_warning(self, monkeypatch):
        """Using default 'changeme' secret should emit a UserWarning."""
        monkeypatch.delenv("API_SECRET", raising=False)

        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            Settings()

            # Check that a warning was issued
            assert len(w) == 1
            assert issubclass(w[0].category, UserWarning)
            assert "changeme" in str(w[0].message).lower()
            assert "deployment" in str(w[0].message).lower()

    def test_custom_secret_no_warning(self, monkeypatch):
        """Using a custom secret should not emit a warning."""
        monkeypatch.setenv("API_SECRET", "custom_secret_12345")

        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            Settings()

            # No warnings should be issued
            assert len(w) == 0


class TestGetSettings:
    """Test the get_settings singleton function."""

    def test_get_settings_singleton(self, monkeypatch):
        """get_settings should return the same instance on repeated calls."""
        monkeypatch.setenv("API_SECRET", "test_secret_singleton")

        # Clear the global singleton
        import app.config

        app.config._settings = None

        # Get settings twice
        settings1 = get_settings()
        settings2 = get_settings()

        # Should be the exact same instance
        assert settings1 is settings2

        # Clean up
        app.config._settings = None
