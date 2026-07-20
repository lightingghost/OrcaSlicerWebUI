"""
Configuration management for OrcaSlicer Web UI API server.

Reads environment variables and provides application settings with documented defaults.
Requirements: 12.1, 12.2
"""

import warnings
from pathlib import Path
from typing import Annotated

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.
    
    All values have documented defaults and can be overridden via environment variables.
    
    Environment Variables:
        ORCA_CLI_PATH: Path to the OrcaSlicer CLI binary (must be absolute)
        WORKSPACE_ROOT: Root directory for file storage (must be absolute, default: /app/workspace)
        MAX_CONCURRENT_JOBS: Maximum number of concurrent slicing jobs (1-32, default: 4)
        JOB_TIMEOUT_SECONDS: Job execution timeout in seconds (≥60, default: 3600)
        OUTPUT_RETENTION_SECONDS: How long to keep output files in seconds (default: 86400)
        JOB_RECORD_RETENTION_SECONDS: How long to keep job records in seconds (default: 604800)
        API_SECRET: Authentication secret for API access (≥8 chars, default: "changeme")
    """
    
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
    
    # Workspace root directory for file storage (must be absolute)
    workspace_root: Annotated[
        Path,
        Field(
            default=Path("/app/workspace"),
            description="Absolute path to workspace root for file storage",
        ),
    ]
    
    # Maximum number of concurrent jobs (1-32)
    max_concurrent_jobs: Annotated[
        int,
        Field(
            default=4,
            ge=1,
            le=32,
            description="Maximum number of concurrent slicing jobs",
        ),
    ]
    
    # Job timeout in seconds (minimum 60 seconds)
    job_timeout_seconds: Annotated[
        int,
        Field(
            default=3600,
            ge=60,
            description="Job execution timeout in seconds (1 hour default)",
        ),
    ]
    
    # Output file retention in seconds (24 hours default)
    output_retention_seconds: Annotated[
        int,
        Field(
            default=86400,
            ge=0,
            description="Output file retention period in seconds (24 hours default)",
        ),
    ]
    
    # Job record retention in seconds (7 days default)
    job_record_retention_seconds: Annotated[
        int,
        Field(
            default=604800,
            ge=0,
            description="Job record retention period in seconds (7 days default)",
        ),
    ]
    
    # API authentication secret (minimum 8 characters)
    api_secret: Annotated[
        str,
        Field(
            default="changeme",
            min_length=8,
            description="Authentication secret for API access (minimum 8 characters)",
        ),
    ]
    
    @field_validator("orca_cli_path", "workspace_root")
    @classmethod
    def validate_absolute_path(cls, v: Path, info) -> Path:
        """Ensure path is absolute."""
        if not v.is_absolute():
            raise ValueError(f"{info.field_name} must be an absolute path, got: {v}")
        return v
    
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
    
    @property
    def profiles_root(self) -> Path:
        """
        Derived path to OrcaSlicer profiles directory.
        
        Returns:
            Path to resources/profiles relative to the CLI binary location.
        """
        # CLI path: /app/orca-slicer/build/linux/OrcaSlicer_ubu64
        # Profiles: /app/orca-slicer/resources/profiles
        cli_dir = self.orca_cli_path.parent  # .../build/linux
        orca_root = cli_dir.parent.parent  # .../OrcaSlicer (or orca-slicer)
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


# Singleton instance
_settings: Settings | None = None


def get_settings() -> Settings:
    """
    Get the global Settings instance (singleton pattern).
    
    Returns:
        The global Settings instance, creating it if necessary.
    """
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


# Global settings instance for backward compatibility
settings = get_settings()
