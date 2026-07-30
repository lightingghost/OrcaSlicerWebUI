"""
Unit tests for job submission endpoint (POST /api/jobs).

Tests job request validation, parameter allowlist enforcement, file resolution,
and job enqueueing.

Requirements: 6.1, 11.1, 11.4
"""

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch

import pytest
from fastapi.testclient import TestClient


def test_submit_job_validates_parameter_keys():
    """Test that unknown parameter keys are rejected with 422."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()), \
         patch("app.job_manager.JobManager"):
        
        from app.main import app
        from app.database import get_db
        
        # Mock database
        async def mock_get_db():
            mock_db = AsyncMock()
            yield mock_db
        
        app.dependency_overrides[get_db] = mock_get_db
        
        try:
            client = TestClient(app)
            
            # Valid job request with invalid parameter key
            job_request = {
                "file_ids": ["00000000-0000-0000-0000-000000000001"],
                "printer_profile_path": "manufacturer/machine/printer.json",
                "process_profile_path": "manufacturer/process/process.json",
                "filament_profile_paths": ["manufacturer/filament/filament.json"],
                "action": "slice",
                "parameter_overrides": {
                    "unknown_param_key": "value"  # This should be rejected
                }
            }
            
            response = client.post(
                "/api/jobs",
                headers={"Authorization": "Bearer test-secret-12345"},
                json=job_request,
            )
            
            assert response.status_code == 422
            detail = response.json()["detail"]
            assert "unknown_param_key" in detail.lower()
            assert "allowlist" in detail.lower()
        finally:
            app.dependency_overrides.clear()


def test_submit_job_validates_instance_config_override_keys():
    """
    Unknown keys in an instance's own per-object config_overrides (see
    JobInstancePlacementModel.config_overrides's doc comment) must be
    rejected with 422 against the SAME PARAM_ALLOWLIST as the top-level
    parameter_overrides — these values get embedded directly into the
    plate snapshot 3mf's Metadata/model_settings.config, so an
    unvalidated key here would let arbitrary data reach the CLI's own
    config deserializer.
    """
    from app.auth import init_auth
    init_auth("test-secret-12345")

    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()), \
         patch("app.job_manager.JobManager"):

        from app.main import app
        from app.database import get_db

        async def mock_get_db():
            mock_db = AsyncMock()
            yield mock_db

        app.dependency_overrides[get_db] = mock_get_db

        try:
            client = TestClient(app)

            job_request = {
                "file_ids": ["00000000-0000-0000-0000-000000000001"],
                "printer_profile_path": "manufacturer/machine/printer.json",
                "process_profile_path": "manufacturer/process/process.json",
                "filament_profile_paths": ["manufacturer/filament/filament.json"],
                "action": "slice",
                "instances": [
                    {
                        "instance_id": "00000000-0000-0000-0000-000000000001",
                        "file_id": "00000000-0000-0000-0000-000000000001",
                        "x": 0.0,
                        "y": 0.0,
                        "config_overrides": {"unknown_param_key": "5"},
                    }
                ],
            }

            response = client.post(
                "/api/jobs",
                headers={"Authorization": "Bearer test-secret-12345"},
                json=job_request,
            )

            assert response.status_code == 422
            detail = response.json()["detail"]
            assert "unknown_param_key" in detail.lower()
            assert "allowlist" in detail.lower()
        finally:
            app.dependency_overrides.clear()


def test_submit_job_validates_file_ids():
    """Test that missing file IDs are rejected with 422."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()), \
         patch("app.job_manager.JobManager"):
        
        from app.main import app
        from app.database import get_db
        
        # Mock database to return no files. db.execute is itself awaited by
        # the route handler (`cursor = await db.execute(...)`), so it must
        # be an AsyncMock (or an async function) rather than a MagicMock —
        # a MagicMock's return value can't be used in an `await` expression.
        async def mock_get_db():
            mock_cursor = AsyncMock()
            mock_cursor.fetchone = AsyncMock(return_value=None)  # File not found
            mock_db = AsyncMock()
            mock_db.execute = AsyncMock(return_value=mock_cursor)
            yield mock_db
        
        app.dependency_overrides[get_db] = mock_get_db
        
        try:
            client = TestClient(app)
            
            # Job request with non-existent file ID
            job_request = {
                "file_ids": ["00000000-0000-0000-0000-000000000001"],
                "printer_profile_path": "manufacturer/machine/printer.json",
                "process_profile_path": "manufacturer/process/process.json",
                "filament_profile_paths": ["manufacturer/filament/filament.json"],
                "action": "slice",
            }
            
            response = client.post(
                "/api/jobs",
                headers={"Authorization": "Bearer test-secret-12345"},
                json=job_request,
            )
            
            assert response.status_code == 422
            detail = response.json()["detail"]
            assert "file" in str(detail).lower()
            assert "not found" in str(detail).lower()
        finally:
            app.dependency_overrides.clear()


def test_submit_job_validates_profile_paths():
    """Test that missing profile files are rejected with 422."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()), \
         patch("app.job_manager.JobManager"):
        
        from app.main import app
        from app.database import get_db
        from app.routers import jobs as jobs_router
        
        # Mock database to return files exist. db.execute is awaited by the
        # route handler, so it must be an AsyncMock, not a MagicMock.
        async def mock_get_db():
            mock_cursor = AsyncMock()
            # File exists
            mock_cursor.fetchone = AsyncMock(return_value=("00000000-0000-0000-0000-000000000001",))
            mock_db = AsyncMock()
            mock_db.execute = AsyncMock(return_value=mock_cursor)
            yield mock_db
        
        app.dependency_overrides[get_db] = mock_get_db
        
        # Point profiles_root (read via `settings.profiles_root` inside the
        # jobs router module) at a directory that doesn't exist. `settings`
        # is a pydantic BaseSettings instance, whose properties can't be
        # patched with patch.object/delattr (no property deleter) — instead
        # patch the module-level `settings` name that jobs.py imports and
        # reads from, with a lightweight stand-in exposing just what the
        # route needs.
        fake_settings = MagicMock()
        fake_settings.profiles_root = Path("/nonexistent/profiles")
        
        with patch.object(jobs_router, "settings", fake_settings):
            try:
                client = TestClient(app)
                
                # Job request with non-existent profile paths
                job_request = {
                    "file_ids": ["00000000-0000-0000-0000-000000000001"],
                    "printer_profile_path": "manufacturer/machine/printer.json",
                    "process_profile_path": "manufacturer/process/process.json",
                    "filament_profile_paths": ["manufacturer/filament/filament.json"],
                    "action": "slice",
                }
                
                response = client.post(
                    "/api/jobs",
                    headers={"Authorization": "Bearer test-secret-12345"},
                    json=job_request,
                )
                
                assert response.status_code == 422
                detail = response.json()["detail"]
                assert "profile" in str(detail).lower()
                assert "not found" in str(detail).lower()
            finally:
                app.dependency_overrides.clear()


def test_submit_job_accepts_user_saved_printer_profile_path(tmp_path):
    """
    Regression test for the reported bug: after editing a printer config
    in PrinterConfigDialog and saving it as a new custom profile (e.g.
    "Flashforge Adventurer 5M 0.4 Nozzle - Copy"), submitting a slice job
    referencing that saved config's path must NOT be rejected at Step 3's
    profile-existence check with a 422 — the path is a real absolute file
    under settings.printer_configs_dir, not under profiles_root, and the
    validation must check BOTH allowed roots (see jobs.py's Step 3 doc
    comment / cli_builder.py's _resolve_profile_path_for_cli).

    This test only exercises Step 3 (profile existence) in isolation by
    mocking job_manager.submit itself, so it stays focused on the exact
    bug reported rather than depending on the CLI actually running.
    """
    from app.auth import init_auth
    init_auth("test-secret-12345")

    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()), \
         patch("app.job_manager.JobManager"):

        from app.main import app
        from app.database import get_db
        from app.routers import jobs as jobs_router

        async def mock_get_db():
            mock_cursor = AsyncMock()
            mock_cursor.fetchone = AsyncMock(return_value=("00000000-0000-0000-0000-000000000001",))
            mock_db = AsyncMock()
            mock_db.execute = AsyncMock(return_value=mock_cursor)
            yield mock_db

        app.dependency_overrides[get_db] = mock_get_db

        # Real directories: profiles_root has a system process+filament
        # profile; printer_configs_dir has the user-saved custom profile
        # (mirroring _save_config's real on-disk layout in printer_config.py).
        profiles_root = tmp_path / "profiles"
        process_dir = profiles_root / "manufacturer" / "process"
        process_dir.mkdir(parents=True)
        (process_dir / "process.json").write_text("{}")
        filament_dir = profiles_root / "manufacturer" / "filament"
        filament_dir.mkdir(parents=True)
        (filament_dir / "filament.json").write_text("{}")

        printer_configs_dir = tmp_path / "user_configs" / "printer"
        printer_configs_dir.mkdir(parents=True)
        user_printer_config = printer_configs_dir / "Flashforge Adventurer 5M 0.4 Nozzle - Copy.json"
        user_printer_config.write_text('{"inherits": "Flashforge Adventurer 5M 0.4 Nozzle"}')

        fake_settings = MagicMock()
        fake_settings.profiles_root = profiles_root
        fake_settings.printer_configs_dir = printer_configs_dir
        fake_settings.process_configs_dir = profiles_root  # unused by this request
        fake_settings.filament_configs_dir = profiles_root  # unused by this request

        mock_job_manager = MagicMock()
        mock_job_manager.submit = AsyncMock(return_value="fake-job-id")
        app.state.job_manager = mock_job_manager

        with patch.object(jobs_router, "settings", fake_settings):
            try:
                client = TestClient(app)

                job_request = {
                    "file_ids": ["00000000-0000-0000-0000-000000000001"],
                    "printer_profile_path": str(user_printer_config.resolve()),
                    "process_profile_path": "manufacturer/process/process.json",
                    "filament_profile_paths": ["manufacturer/filament/filament.json"],
                    "action": "slice",
                }

                response = client.post(
                    "/api/jobs",
                    headers={"Authorization": "Bearer test-secret-12345"},
                    json=job_request,
                )

                assert response.status_code == 200, (
                    f"Expected 200, got {response.status_code}: {response.text}"
                )
                assert response.json()["job_id"] == "fake-job-id"
            finally:
                app.dependency_overrides.clear()
                del app.state.job_manager


def test_submit_job_strict_validation():
    """Test that Pydantic strict validation rejects invalid types."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()), \
         patch("app.job_manager.JobManager"):
        
        from app.main import app
        from app.database import get_db
        
        # Both requests below are rejected by Pydantic model validation
        # before the handler ever touches the database, but the get_db
        # dependency still runs first (FastAPI resolves dependencies before
        # the body-validation-triggered 422 short-circuits) — override it
        # so it doesn't attempt a real sqlite connection in the test env.
        async def mock_get_db():
            yield AsyncMock()
        
        app.dependency_overrides[get_db] = mock_get_db
        
        try:
            client = TestClient(app)
            
            # Invalid job request: file_ids is not a list
            job_request = {
                "file_ids": "not-a-list",  # Should be a list
                "printer_profile_path": "manufacturer/machine/printer.json",
                "process_profile_path": "manufacturer/process/process.json",
                "filament_profile_paths": ["manufacturer/filament/filament.json"],
                "action": "slice",
            }
            
            response = client.post(
                "/api/jobs",
                headers={"Authorization": "Bearer test-secret-12345"},
                json=job_request,
            )
            
            assert response.status_code == 422
            
            # Invalid job request: action is not in allowed literals
            job_request2 = {
                "file_ids": ["00000000-0000-0000-0000-000000000001"],
                "printer_profile_path": "manufacturer/machine/printer.json",
                "process_profile_path": "manufacturer/process/process.json",
                "filament_profile_paths": ["manufacturer/filament/filament.json"],
                "action": "invalid_action",  # Should be one of the allowed actions
            }
            
            response = client.post(
                "/api/jobs",
                headers={"Authorization": "Bearer test-secret-12345"},
                json=job_request2,
            )
            
            assert response.status_code == 422
        finally:
            app.dependency_overrides.clear()


def test_submit_job_requires_auth():
    """Test that the endpoint requires authentication."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()), \
         patch("app.job_manager.JobManager"):
        
        from app.main import app
        
        client = TestClient(app)
        
        job_request = {
            "file_ids": ["00000000-0000-0000-0000-000000000001"],
            "printer_profile_path": "manufacturer/machine/printer.json",
            "process_profile_path": "manufacturer/process/process.json",
            "filament_profile_paths": ["manufacturer/filament/filament.json"],
            "action": "slice",
        }
        
        # No auth header
        response = client.post("/api/jobs", json=job_request)
        assert response.status_code in [401, 403]
        
        # Wrong token
        response = client.post(
            "/api/jobs",
            headers={"Authorization": "Bearer wrong-token"},
            json=job_request,
        )
        assert response.status_code == 401


def test_submit_job_validates_uuid_format():
    """Test that file_ids must be valid UUIDs."""
    # Initialize auth
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()), \
         patch("app.job_manager.JobManager"):
        
        from app.main import app
        from app.database import get_db
        
        # Rejected by Pydantic's field_validator before the handler touches
        # the database — override get_db anyway so dependency resolution
        # doesn't attempt a real sqlite connection in the test env.
        async def mock_get_db():
            yield AsyncMock()
        
        app.dependency_overrides[get_db] = mock_get_db
        
        try:
            client = TestClient(app)
            
            # Invalid UUID format
            job_request = {
                "file_ids": ["not-a-uuid"],
                "printer_profile_path": "manufacturer/machine/printer.json",
                "process_profile_path": "manufacturer/process/process.json",
                "filament_profile_paths": ["manufacturer/filament/filament.json"],
                "action": "slice",
            }
            
            response = client.post(
                "/api/jobs",
                headers={"Authorization": "Bearer test-secret-12345"},
                json=job_request,
            )
            
            assert response.status_code == 422
            detail = str(response.json()["detail"])
            assert "uuid" in detail.lower() or "format" in detail.lower()
        finally:
            app.dependency_overrides.clear()
