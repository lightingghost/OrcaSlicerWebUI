"""
Tests for file upload API endpoints.

Feature: orca-slicer-web-ui
Tests file upload with extension validation, size limits, and storage.
"""

import io
import os
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient


def _override_get_db(app, mock_get_db):
    """
    Install a get_db dependency override on the given app.

    FastAPI resolves `Depends(get_db)` using the function reference bound
    at route-decoration time, so `patch("app.routers.files.get_db", ...)`
    (patching the module attribute after the routes already captured the
    original) has no effect. `app.dependency_overrides[get_db] = ...` is
    the mechanism FastAPI actually provides for swapping a dependency.
    """
    from app.database import get_db
    app.dependency_overrides[get_db] = mock_get_db


def _make_cursor_cm(fetchone_result):
    """
    Build a mock object usable as `async with db.execute(...) as cursor:`
    (get_file_metadata/delete_file use this form, unlike the plain
    `cursor = await db.execute(...)` form used elsewhere in this app) —
    i.e. an object with __aenter__/__aexit__ that resolves to a cursor
    whose `fetchone()` returns the given value.
    """
    mock_cursor = AsyncMock()
    mock_cursor.fetchone = AsyncMock(return_value=fetchone_result)

    class _CursorCM:
        async def __aenter__(self):
            return mock_cursor

        async def __aexit__(self, *exc_info):
            return None

    return _CursorCM()


def _make_select_then_plain_execute(fetchone_result):
    """
    delete_file() calls db.execute() twice with two different usage
    shapes: `async with db.execute(SELECT...) as cursor:` for the lookup,
    then a plain `await db.execute(DELETE...)` for the deletion. A single
    mock therefore needs to behave as BOTH an async-context-manager (1st
    call) AND a plain awaitable (2nd call) depending on call order.
    """
    calls = {"n": 0}

    def _execute(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return _make_cursor_cm(fetchone_result)
        # Second call (DELETE) is awaited directly.
        future = AsyncMock()
        future.return_value = None
        return future()

    return _execute


def test_upload_invalid_extension_returns_422():
    """
    Test uploading a file with unsupported extension returns 422.
    
    Property 1: Invalid extension upload returns 422
    Requirements: 1.3
    """
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.auth import init_auth
        
        # Initialize auth for testing
        init_auth("test_secret_12345")

        # Depends(get_db) is resolved before the handler body runs (and
        # therefore before extension validation happens), so it must be
        # mocked even though this handler never reaches the DB itself.
        async def mock_get_db():
            mock_db = AsyncMock()
            yield mock_db

        _override_get_db(app, mock_get_db)

        try:
            client = TestClient(app)

            # Try to upload a .txt file (not in allowed extensions)
            content = b"some text content"

            response = client.post(
                "/api/files/upload",
                files={"file": ("document.txt", io.BytesIO(content), "text/plain")},
                headers={"Authorization": "Bearer test_secret_12345"},
            )

            assert response.status_code == 422
            assert "Unsupported file extension" in response.json()["detail"]
        finally:
            app.dependency_overrides.clear()


def test_upload_requires_authentication():
    """
    Test that upload endpoint requires authentication.
    
    Requirements: 11.5
    """
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.auth import init_auth
        
        # Initialize auth for testing
        init_auth("test_secret_12345")
        
        client = TestClient(app)
        
        content = b"test content"
        
        # Make request without Authorization header
        response = client.post(
            "/api/files/upload",
            files={"file": ("test.stl", io.BytesIO(content), "application/octet-stream")},
        )
        
        # Should return 401 or 403
        assert response.status_code in [401, 403]


def test_upload_case_insensitive_extension():
    """
    Test that file extension matching is case-insensitive.
    
    Requirements: 1.1, 1.3
    """
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.auth import init_auth
        
        # Initialize auth for testing
        init_auth("test_secret_12345")
        
        content = b"test content"
        
        # Mock database and filesystem operations
        async def mock_get_db():
            mock_db = AsyncMock()
            mock_db.execute = AsyncMock()
            mock_db.commit = AsyncMock()
            yield mock_db

        _override_get_db(app, mock_get_db)

        try:
            client = TestClient(app)
            with patch("builtins.open", MagicMock()), \
                 patch("pathlib.Path.mkdir"):

                # Test uppercase extension
                response = client.post(
                    "/api/files/upload",
                    files={"file": ("MODEL.STL", io.BytesIO(content), "application/octet-stream")},
                    headers={"Authorization": "Bearer test_secret_12345"},
                )

            assert response.status_code == 200
            # Extension should be normalized to lowercase
            assert response.json()["extension"] == "stl"
        finally:
            app.dependency_overrides.clear()


def test_upload_multiple_valid_extensions():
    """
    Test all supported file extensions work.
    
    Requirements: 1.1, 1.3
    """
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.auth import init_auth
        from app.routers.files import ALLOWED_EXTENSIONS
        
        # Initialize auth for testing
        init_auth("test_secret_12345")

        async def mock_get_db():
            mock_db = AsyncMock()
            mock_db.execute = AsyncMock()
            mock_db.commit = AsyncMock()
            yield mock_db

        _override_get_db(app, mock_get_db)

        try:
            client = TestClient(app)

            for ext in ALLOWED_EXTENSIONS:
                content = b"test content"

                with patch("builtins.open", MagicMock()), \
                     patch("pathlib.Path.mkdir"):

                    response = client.post(
                        "/api/files/upload",
                        files={"file": (f"model.{ext}", io.BytesIO(content), "application/octet-stream")},
                        headers={"Authorization": "Bearer test_secret_12345"},
                    )

                assert response.status_code == 200, f"Extension {ext} should be allowed"
                assert response.json()["extension"] == ext
        finally:
            app.dependency_overrides.clear()


def test_upload_missing_filename_returns_422():
    """
    Test that upload without filename returns 422.
    
    Requirements: 1.3
    """
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.auth import init_auth
        
        # Initialize auth for testing
        init_auth("test_secret_12345")

        async def mock_get_db():
            mock_db = AsyncMock()
            yield mock_db

        _override_get_db(app, mock_get_db)

        try:
            client = TestClient(app)

            content = b"test content"

            # Try to upload without filename
            response = client.post(
                "/api/files/upload",
                files={"file": (None, io.BytesIO(content), "application/octet-stream")},
                headers={"Authorization": "Bearer test_secret_12345"},
            )

            assert response.status_code == 422
        finally:
            app.dependency_overrides.clear()


def test_get_file_metadata_returns_metadata():
    """
    Test retrieving file metadata for an existing file.
    
    Requirements: 1.4
    """
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.auth import init_auth
        
        # Initialize auth for testing
        init_auth("test_secret_12345")
        
        test_file_id = "test-uuid-1234"
        
        # get_file_metadata uses `async with db.execute(...) as cursor:`,
        # so db.execute must be a plain (sync) function returning an
        # async-context-manager, not an AsyncMock (which would make
        # `db.execute(...)` itself a coroutine, incompatible with `async with`).
        async def mock_get_db():
            mock_db = AsyncMock()
            mock_db.execute = MagicMock(return_value=_make_cursor_cm((
                test_file_id,
                "test.stl",
                1024,
                "stl",
                "2024-01-01T00:00:00Z"
            )))
            yield mock_db

        _override_get_db(app, mock_get_db)

        try:
            client = TestClient(app)
            response = client.get(
                f"/api/files/{test_file_id}",
                headers={"Authorization": "Bearer test_secret_12345"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["file_id"] == test_file_id
            assert data["original_name"] == "test.stl"
            assert data["size_bytes"] == 1024
            assert data["extension"] == "stl"
            assert data["uploaded_at"] == "2024-01-01T00:00:00Z"
        finally:
            app.dependency_overrides.clear()


def test_get_file_metadata_not_found_returns_404():
    """
    Test retrieving metadata for non-existent file returns 404.
    
    Requirements: 1.4
    """
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.auth import init_auth
        
        # Initialize auth for testing
        init_auth("test_secret_12345")
        
        nonexistent_file_id = "nonexistent-uuid"
        
        # Mock database to return None (file not found); see
        # test_get_file_metadata_returns_metadata for why db.execute must
        # be a MagicMock returning an async-context-manager here.
        async def mock_get_db():
            mock_db = AsyncMock()
            mock_db.execute = MagicMock(return_value=_make_cursor_cm(None))
            yield mock_db

        _override_get_db(app, mock_get_db)

        try:
            client = TestClient(app)
            response = client.get(
                f"/api/files/{nonexistent_file_id}",
                headers={"Authorization": "Bearer test_secret_12345"},
            )

            assert response.status_code == 404
            assert "File not found" in response.json()["detail"]
        finally:
            app.dependency_overrides.clear()


def test_delete_file_removes_file_and_record():
    """
    Test deleting a file removes both disk file and database record.
    
    Requirements: 1.5
    """
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.auth import init_auth
        
        # Initialize auth for testing
        init_auth("test_secret_12345")
        
        test_file_id = "test-uuid-to-delete"
        storage_path = "/app/workspace/sessions/default/uploads/test-uuid-to-delete.stl"
        
        # See _make_select_then_plain_execute: delete_file's SELECT uses
        # `async with`, its DELETE uses a plain `await`.
        async def mock_get_db():
            mock_db = AsyncMock()
            mock_db.execute = MagicMock(
                side_effect=_make_select_then_plain_execute((storage_path,))
            )
            mock_db.commit = AsyncMock()
            yield mock_db

        _override_get_db(app, mock_get_db)

        try:
            with patch("pathlib.Path.unlink") as mock_unlink:
                client = TestClient(app)
                response = client.delete(
                    f"/api/files/{test_file_id}",
                    headers={"Authorization": "Bearer test_secret_12345"},
                )

            assert response.status_code == 200
            data = response.json()
            assert data["file_id"] == test_file_id
            assert "deleted successfully" in data["message"]

            # Verify unlink was called with missing_ok=True
            mock_unlink.assert_called_once_with(missing_ok=True)
        finally:
            app.dependency_overrides.clear()


def test_delete_file_not_found_returns_404():
    """
    Test deleting non-existent file returns 404.
    
    Requirements: 1.5
    """
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.auth import init_auth
        
        # Initialize auth for testing
        init_auth("test_secret_12345")
        
        nonexistent_file_id = "nonexistent-uuid"
        
        # Mock database to return None (file not found). delete_file's
        # SELECT branch returns 404 before ever reaching the DELETE
        # statement, so only the `async with` (1st-call) shape is needed
        # here, but _make_select_then_plain_execute still works fine.
        async def mock_get_db():
            mock_db = AsyncMock()
            mock_db.execute = MagicMock(
                side_effect=_make_select_then_plain_execute(None)
            )
            yield mock_db

        _override_get_db(app, mock_get_db)

        try:
            client = TestClient(app)
            response = client.delete(
                f"/api/files/{nonexistent_file_id}",
                headers={"Authorization": "Bearer test_secret_12345"},
            )

            assert response.status_code == 404
            assert "File not found" in response.json()["detail"]
        finally:
            app.dependency_overrides.clear()


def test_delete_file_handles_disk_race_condition():
    """
    Test delete gracefully handles case where file already deleted from disk.
    
    Requirements: 1.5
    """
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.auth import init_auth
        
        # Initialize auth for testing
        init_auth("test_secret_12345")
        
        test_file_id = "test-uuid-race"
        storage_path = "/app/workspace/sessions/default/uploads/test-uuid-race.stl"
        
        # See _make_select_then_plain_execute: delete_file's SELECT uses
        # `async with`, its DELETE uses a plain `await`.
        async def mock_get_db():
            mock_db = AsyncMock()
            mock_db.execute = MagicMock(
                side_effect=_make_select_then_plain_execute((storage_path,))
            )
            mock_db.commit = AsyncMock()
            yield mock_db

        _override_get_db(app, mock_get_db)

        try:
            # Mock unlink to raise an exception (simulating file already gone)
            with patch("pathlib.Path.unlink", side_effect=OSError("File not found")):
                client = TestClient(app)
                response = client.delete(
                    f"/api/files/{test_file_id}",
                    headers={"Authorization": "Bearer test_secret_12345"},
                )

            # Should still succeed (returns 200) because DB record is deleted
            assert response.status_code == 200
            data = response.json()
            assert data["file_id"] == test_file_id
        finally:
            app.dependency_overrides.clear()


def test_get_file_metadata_returns_file_info():
    """
    Test retrieving file metadata by file ID.
    
    Requirements: 1.4
    """
    # Initialize auth first
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        # Mock database to return a file record
        test_file_id = "test-file-id-123"
        
        async def mock_get_db():
            mock_db = AsyncMock()
            # get_file_metadata uses `async with db.execute(...) as cursor:`
            mock_db.execute = MagicMock(return_value=_make_cursor_cm((
                test_file_id,
                "test_model.stl",
                1024,
                "stl",
                "2024-01-01T00:00:00Z",
            )))
            yield mock_db
        
        # Override the get_db dependency
        app.dependency_overrides[get_db] = mock_get_db
        
        try:
            client = TestClient(app)
            response = client.get(
                f"/api/files/{test_file_id}",
                headers={"Authorization": "Bearer test-secret-12345"},
            )
            
            assert response.status_code == 200
            data = response.json()
            assert data["file_id"] == test_file_id
            assert data["original_name"] == "test_model.stl"
            assert data["size_bytes"] == 1024
            assert data["extension"] == "stl"
            assert data["uploaded_at"] == "2024-01-01T00:00:00Z"
        finally:
            # Clean up dependency override
            app.dependency_overrides.clear()


def test_get_file_metadata_returns_404_for_nonexistent_file():
    """
    Test that retrieving metadata for a non-existent file returns 404.
    
    Requirements: 1.4
    """
    # Initialize auth first
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        from app.database import get_db
        
        # Mock database to return None (file not found)
        async def mock_get_db():
            mock_db = AsyncMock()
            mock_db.execute = MagicMock(return_value=_make_cursor_cm(None))
            yield mock_db
        
        # Override the get_db dependency
        app.dependency_overrides[get_db] = mock_get_db
        
        try:
            client = TestClient(app)
            response = client.get(
                "/api/files/nonexistent-file-id",
                headers={"Authorization": "Bearer test-secret-12345"},
            )
            
            assert response.status_code == 404
            assert "File not found" in response.json()["detail"]
        finally:
            # Clean up dependency override
            app.dependency_overrides.clear()


def test_get_file_metadata_requires_authentication():
    """
    Test that GET /api/files/{file_id} requires authentication.
    
    Requirements: 11.5
    """
    # Initialize auth first
    from app.auth import init_auth
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        
        client = TestClient(app)
        
        # Make request without Authorization header
        response = client.get("/api/files/some-file-id")
        
        # Should return 401 or 403
        assert response.status_code in [401, 403]


# ============================================================================
# PROPERTY-BASED TESTS
# ============================================================================

from hypothesis import given, settings, strategies as st, HealthCheck
from datetime import timedelta
import tempfile


def test_property_1_invalid_extension_returns_422():
    """
    **Property 1: Invalid extension upload returns 422**
    
    For any filename whose extension is not in {stl, 3mf, obj, amf},
    uploading it to POST /api/files/upload shall return HTTP 422 with
    an error body, and no file shall be created in the workspace.
    
    **Validates: Requirements 1.3**
    """
    # Feature: orca-slicer-web-ui, Property 1
    
    # Create a temporary workspace directory to verify no files are created
    with tempfile.TemporaryDirectory() as temp_dir:
        workspace_path = Path(temp_dir) / "workspace"
        workspace_path.mkdir(exist_ok=True)
        
        # Initialize auth once before all examples
        from app.auth import init_auth
        from app.database import get_db
        from app.config import get_settings
        init_auth("test-secret-12345")
        
        with patch("app.database.init_db", new_callable=AsyncMock), \
             patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()), \
             patch("app.config.get_settings") as mock_settings:
            
            # Configure mock settings to use our temp workspace
            mock_config = MagicMock()
            mock_config.workspace_root = workspace_path
            mock_config.api_secret = "test-secret-12345"
            mock_config.orca_cli_path = "/tmp/fake_cli"
            mock_config.max_concurrent_jobs = 4
            mock_settings.return_value = mock_config
            
            from app.main import app
            
            # Mock the database dependency
            async def mock_get_db():
                mock_db = AsyncMock()
                mock_db.execute = AsyncMock()
                mock_db.commit = AsyncMock()
                yield mock_db
            
            app.dependency_overrides[get_db] = mock_get_db
            
            try:
                client = TestClient(app)
                
                # Now run the property test with the client
                @settings(max_examples=100, deadline=None)
                @given(
                    extension=st.text(
                        min_size=1,
                        max_size=10,
                        alphabet=st.characters(
                            whitelist_categories=('Lu', 'Ll', 'Nd'),
                            blacklist_characters=['.', '/', '\\', '\x00']
                        )
                    ).filter(lambda ext: ext.lower() not in {"stl", "3mf", "obj", "amf"})
                )
                def check_invalid_extension(extension):
                    filename = f"model.{extension}"
                    content = b"test file content"
                    
                    # Get list of files before the request
                    files_before = set()
                    if workspace_path.exists():
                        for root, dirs, files in os.walk(workspace_path):
                            for file in files:
                                files_before.add(os.path.join(root, file))
                    
                    response = client.post(
                        "/api/files/upload",
                        files={"file": (filename, io.BytesIO(content), "application/octet-stream")},
                        headers={"Authorization": "Bearer test-secret-12345"},
                    )
                    
                    assert response.status_code == 422, (
                        f"Expected HTTP 422 for extension {extension!r}, got {response.status_code}"
                    )
                    
                    response_json = response.json()
                    assert "detail" in response_json, "Response should contain 'detail' field"
                    error_message = str(response_json["detail"]).lower()
                    assert any(word in error_message for word in ["unsupported", "extension", "invalid", "not allowed"]), (
                        f"Error message should mention unsupported extension. Got: {response_json['detail']}"
                    )
                    
                    # Verify no new files were created in the workspace
                    files_after = set()
                    if workspace_path.exists():
                        for root, dirs, files in os.walk(workspace_path):
                            for file in files:
                                files_after.add(os.path.join(root, file))
                    
                    new_files = files_after - files_before
                    assert len(new_files) == 0, (
                        f"No files should be created in workspace for invalid extension {extension!r}, "
                        f"but found new files: {new_files}"
                    )
                
                # Run the property test
                check_invalid_extension()
            finally:
                app.dependency_overrides.clear()


def test_property_1_common_invalid_extensions_rejected():
    """
    **Property 1: Invalid extension upload returns 422**
    
    Test common file extensions that should be rejected.
    
    **Validates: Requirements 1.3**
    """
    # Feature: orca-slicer-web-ui, Property 1
    
    # Initialize auth once
    from app.auth import init_auth
    from app.database import get_db
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        
        # Mock the database dependency
        async def mock_get_db():
            mock_db = AsyncMock()
            mock_db.execute = AsyncMock()
            mock_db.commit = AsyncMock()
            yield mock_db
        
        app.dependency_overrides[get_db] = mock_get_db
        
        try:
            client = TestClient(app)
            
            @settings(max_examples=30, deadline=None)
            @given(
                base_name=st.text(
                    min_size=1,
                    max_size=15,
                    alphabet=st.characters(
                        whitelist_categories=('Lu', 'Ll', 'Nd'),
                        blacklist_characters=['.', '/', '\\', '\x00']
                    )
                ),
                invalid_ext=st.sampled_from([
                    "txt", "pdf", "doc", "jpg", "png", "zip", "exe",
                    "py", "json", "xml", "mp3"
                ])
            )
            def check_common_extensions(base_name, invalid_ext):
                filename = f"{base_name}.{invalid_ext}"
                content = b"test content"
                
                response = client.post(
                    "/api/files/upload",
                    files={"file": (filename, io.BytesIO(content), "application/octet-stream")},
                    headers={"Authorization": "Bearer test-secret-12345"},
                )
                
                assert response.status_code == 422, (
                    f"Extension {invalid_ext!r} should be rejected with HTTP 422"
                )
            
            check_common_extensions()
        finally:
            app.dependency_overrides.clear()


def test_property_1_valid_extensions_not_rejected():
    """
    **Property 1: Invalid extension upload returns 422**
    
    Sanity check: valid extensions should NOT return 422.
    
    **Validates: Requirements 1.1, 1.3**
    """
    # Feature: orca-slicer-web-ui, Property 1
    
    # Initialize auth once
    from app.auth import init_auth
    from app.database import get_db
    init_auth("test-secret-12345")
    
    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()):
        
        from app.main import app
        
        # Mock the database dependency
        async def mock_get_db():
            mock_db = AsyncMock()
            mock_db.execute = AsyncMock()
            mock_db.commit = AsyncMock()
            yield mock_db
        
        app.dependency_overrides[get_db] = mock_get_db
        
        try:
            client = TestClient(app)
            
            @settings(max_examples=20, deadline=None)
            @given(valid_extension=st.sampled_from(["stl", "3mf", "obj", "amf"]))
            def check_valid_extensions(valid_extension):
                filename = f"model.{valid_extension}"
                content = b"test content"
                
                # Mock filesystem for valid extensions
                with patch("builtins.open", MagicMock()), \
                     patch("pathlib.Path.mkdir"):
                    
                    response = client.post(
                        "/api/files/upload",
                        files={"file": (filename, io.BytesIO(content), "application/octet-stream")},
                        headers={"Authorization": "Bearer test-secret-12345"},
                    )
                
                assert response.status_code != 422, (
                    f"Valid extension {valid_extension!r} should not be rejected with 422. "
                    f"Got status {response.status_code}"
                )
            
            check_valid_extensions()
        finally:
            app.dependency_overrides.clear()
