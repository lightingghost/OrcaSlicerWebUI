"""
Configuration management for OrcaSlicer Web UI API server.

Reads environment variables and provides application settings with documented defaults.
Requirements: 12.1, 12.2

Environment Variables
---------------------
ORCA_CLI_PATH           Path to the OrcaSlicer CLI binary (must be absolute)
WORKSPACE_ROOT          Root directory for job/session file storage (must be absolute,
                        default: /app/workspace)
USER_WORKSPACE          Root directory for user-saved configs (printer, filament, process).
                        If not set, defaults to WORKSPACE_ROOT/user_configs.
                        The following subdirectories are created automatically on startup:
                          <USER_WORKSPACE>/autosave/   ← all autosaves (flat, shared)
                          <USER_WORKSPACE>/printer/
                          <USER_WORKSPACE>/filament/
                          <USER_WORKSPACE>/process/
MAX_CONCURRENT_JOBS     Maximum number of concurrent slicing jobs (1-32, default: 4)
JOB_TIMEOUT_SECONDS     Job execution timeout in seconds (≥60, default: 3600)
OUTPUT_RETENTION_SECONDS  How long to keep output files in seconds (default: 86400)
JOB_RECORD_RETENTION_SECONDS  How long to keep job records in seconds (default: 604800)
API_SECRET              Authentication secret for API access (≥8 chars, default: "changeme")
"""

import warnings
from pathlib import Path
from typing import Annotated, Optional

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # CLI binary path (must be absolute)
    orca_cli_path: Annotated[
        Path,
        Field(
            default=Path("/app/orca-slicer/build/linux/OrcaSlicer_ubu64"),
            description="Absolute path to the OrcaSlicer CLI binary",
        ),
    ]

    # Workspace root directory for job/session file storage (must be absolute)
    workspace_root: Annotated[
        Path,
        Field(
            default=Path("/app/workspace"),
            description="Absolute path to workspace root for job/session file storage",
        ),
    ]

    # User workspace root for saved configs (optional; defaults to workspace_root/user_configs)
    user_workspace: Annotated[
        Optional[Path],
        Field(
            default=None,
            description=(
                "Absolute path to the user workspace root for saved configs "
                "(printer/, filament/, process/ subdirs are created automatically). "
                "Defaults to WORKSPACE_ROOT/user_configs if not set."
            ),
        ),
    ]

    # Maximum number of concurrent jobs (1-32)
    max_concurrent_jobs: Annotated[
        int,
        Field(default=4, ge=1, le=32, description="Maximum number of concurrent slicing jobs"),
    ]

    # Job timeout in seconds (minimum 60 seconds)
    job_timeout_seconds: Annotated[
        int,
        Field(default=3600, ge=60, description="Job execution timeout in seconds"),
    ]

    # Output file retention in seconds (24 hours default)
    output_retention_seconds: Annotated[
        int,
        Field(default=86400, ge=0, description="Output file retention period in seconds"),
    ]

    # Job record retention in seconds (7 days default)
    job_record_retention_seconds: Annotated[
        int,
        Field(default=604800, ge=0, description="Job record retention period in seconds"),
    ]

    # API authentication secret (minimum 8 characters)
    api_secret: Annotated[
        str,
        Field(
            default="changeme",
            min_length=8,
            description="Authentication secret for API access",
        ),
    ]

    @field_validator("orca_cli_path", "workspace_root")
    @classmethod
    def validate_absolute_path(cls, v: Path, info) -> Path:
        """Ensure path is absolute."""
        if not v.is_absolute():
            raise ValueError(f"{info.field_name} must be an absolute path, got: {v}")
        return v

    @field_validator("user_workspace", mode="before")
    @classmethod
    def validate_user_workspace(cls, v):
        """Validate user_workspace if provided."""
        if v is None:
            return v
        p = Path(v)
        if not p.is_absolute():
            raise ValueError(f"user_workspace must be an absolute path, got: {v}")
        return p

    @model_validator(mode="after")
    def warn_default_secret(self) -> "Settings":
        """Warn if using the default API secret in production."""
        if self.api_secret == "changeme":
            warnings.warn(
                "Using default API secret 'changeme' is insecure for production deployment. "
                "Set API_SECRET environment variable to a strong random value.",
                UserWarning,
                stacklevel=2,
            )
        return self

    # ------------------------------------------------------------------
    # Derived paths
    # ------------------------------------------------------------------

    @property
    def profiles_root(self) -> Path:
        """Path to OrcaSlicer resources/profiles directory.

        The CLI binary lives at <squashfs-root>/bin/orca-slicer, so
        parent  → <squashfs-root>/bin
        parent  → <squashfs-root>
        → <squashfs-root>/resources/profiles
        """
        orca_root = self.orca_cli_path.parent.parent   # squashfs-root/
        return orca_root / "resources" / "profiles"

    @property
    def session_uploads_dir(self) -> Path:
        """Directory for session upload files."""
        return self.workspace_root / "sessions"

    @property
    def jobs_output_dir(self) -> Path:
        """Directory for job output files."""
        return self.workspace_root / "jobs"

    @property
    def custom_profiles_dir(self) -> Path:
        """Directory for user-uploaded custom profiles."""
        return self.workspace_root / "custom_profiles"

    @property
    def user_workspace_root(self) -> Path:
        """
        Root of the user configs workspace.

        Uses USER_WORKSPACE env var if set, otherwise falls back to
        WORKSPACE_ROOT/user_configs for backward compatibility.
        """
        if self.user_workspace is not None:
            return self.user_workspace
        return self.workspace_root / "user_configs"

    @property
    def autosave_dir(self) -> Path:
        """Flat autosave directory for all config types: USER_WORKSPACE/autosave/"""
        return self.user_workspace_root / "autosave"

    @property
    def printer_configs_dir(self) -> Path:
        """Directory for user-saved printer configs."""
        return self.user_workspace_root / "printer"

    @property
    def filament_configs_dir(self) -> Path:
        """Directory for user-saved filament configs."""
        return self.user_workspace_root / "filament"

    @property
    def process_configs_dir(self) -> Path:
        """Directory for user-saved process configs."""
        return self.user_workspace_root / "process"

    def init_user_workspace(self) -> None:
        """
        Create the user workspace directory tree if it does not exist.

        Creates:
            <user_workspace_root>/autosave/   ← all autosaves (flat, shared)
            <user_workspace_root>/printer/
            <user_workspace_root>/filament/
            <user_workspace_root>/process/
        """
        self.autosave_dir.mkdir(parents=True, exist_ok=True)
        for category_dir in (
            self.printer_configs_dir,
            self.filament_configs_dir,
            self.process_configs_dir,
        ):
            category_dir.mkdir(parents=True, exist_ok=True)


# Singleton instance
_settings: Settings | None = None


def get_settings() -> Settings:
    """Get the global Settings instance (singleton pattern)."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


# Global settings instance for backward compatibility
settings = get_settings()
