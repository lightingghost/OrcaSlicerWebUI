"""
Tests for the Device tab's printer-connection endpoints
(GET/POST/DELETE /api/device-connection, POST /api/device-connection/test).

Requirements: (feature request) "The device page should allow connection
to local printers" — host_type=Octo/Klipper, printer_agent=Moonraker,
Device UI iframe once connected. See app/routers/device_connection.py's
module docstring for the native OrcaSlicer field-set this mirrors
(libslic3r/PrintConfig.cpp's host_type/printer_agent/print_host/
print_host_webui/printhost_apikey, slic3r/Utils/Moonraker.cpp's
`/server/info` connectivity-test contract).
"""

import httpx
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    """
    A TestClient wired to a throwaway USER_WORKSPACE directory, with auth
    initialized to a known test secret. Reuses the same env-var-driven
    settings singleton the app itself constructs at import time, so we
    set the env vars BEFORE importing app.main (matching how config.py's
    module-level `settings = get_settings()` singleton is populated).
    """
    monkeypatch.setenv("USER_WORKSPACE", str(tmp_path / "user_workspace"))
    monkeypatch.setenv("WORKSPACE_ROOT", str(tmp_path / "workspace"))
    monkeypatch.setenv("TMP_ROOT", str(tmp_path / "tmp"))
    monkeypatch.setenv("API_SECRET", "test-secret-12345")

    # Reset the settings singleton so it re-reads the env vars just set,
    # rather than reusing whatever was cached from an earlier test/import.
    import app.config as config_module
    config_module._settings = None

    from app.auth import init_auth
    init_auth("test-secret-12345")

    from app.main import app
    return TestClient(app)


AUTH = {"Authorization": "Bearer test-secret-12345"}


def test_get_device_connection_returns_defaults_when_unset(client):
    response = client.get("/api/device-connection", headers=AUTH)
    assert response.status_code == 200
    data = response.json()
    assert data["host_type"] == "octo_klipper"
    assert data["printer_agent"] == "moonraker"
    assert data["print_host"] == ""
    assert data["connected"] is False


def test_save_and_get_device_connection_round_trips(client):
    payload = {
        "host_type": "octo_klipper",
        "printer_agent": "moonraker",
        "print_host": "192.168.1.50",
        "device_ui": "http://192.168.1.50",
        "printhost_apikey": "abc123",
        "printhost_cafile": "",
        "connected": True,
    }
    save_response = client.post("/api/device-connection", json=payload, headers=AUTH)
    assert save_response.status_code == 200
    assert save_response.json() == payload

    get_response = client.get("/api/device-connection", headers=AUTH)
    assert get_response.status_code == 200
    assert get_response.json() == payload


def test_delete_device_connection_resets_to_defaults(client):
    client.post(
        "/api/device-connection",
        json={"print_host": "192.168.1.50", "connected": True},
        headers=AUTH,
    )
    delete_response = client.delete("/api/device-connection", headers=AUTH)
    assert delete_response.status_code == 200

    get_response = client.get("/api/device-connection", headers=AUTH)
    assert get_response.json()["print_host"] == ""
    assert get_response.json()["connected"] is False


def test_device_connection_requires_authentication(client):
    response = client.get("/api/device-connection")
    assert response.status_code in (401, 403)


def test_test_connection_rejects_empty_host(client):
    response = client.post(
        "/api/device-connection/test",
        json={"print_host": "", "printer_agent": "moonraker"},
        headers=AUTH,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert "required" in data["message"].lower()


def test_test_connection_rejects_unsupported_agent(client):
    response = client.post(
        "/api/device-connection/test",
        json={"print_host": "192.168.1.50", "printer_agent": "prusalink"},
        headers=AUTH,
    )
    # printer_agent is a Literal["moonraker"] in the model — an
    # unsupported value should fail request validation (422), not
    # silently coerce.
    assert response.status_code == 422


def test_test_connection_success_when_moonraker_reachable(client, monkeypatch):
    """Mocks httpx to simulate a real Moonraker /server/info response,
    matching Moonraker::test()'s exact success contract: valid JSON
    envelope containing result.klippy_state."""

    class MockResponse:
        status_code = 200

        def json(self):
            return {"result": {"klippy_state": "ready"}}

    class MockAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def get(self, url, headers=None):
            assert url == "http://192.168.1.50/server/info"
            assert headers.get("X-Api-Key") == "abc123"
            return MockResponse()

    monkeypatch.setattr(httpx, "AsyncClient", MockAsyncClient)

    response = client.post(
        "/api/device-connection/test",
        json={
            "print_host": "192.168.1.50",
            "printer_agent": "moonraker",
            "printhost_apikey": "abc123",
        },
        headers=AUTH,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["klippy_state"] == "ready"


def test_test_connection_fails_when_response_not_moonraker_shaped(client, monkeypatch):
    """A host that responds 200 but without result.klippy_state (e.g. an
    OctoPrint instance mis-selected as Moonraker) is treated as a
    connection failure with a clear message, matching Moonraker::test()'s
    explicit handling of this case."""

    class MockResponse:
        status_code = 200

        def json(self):
            return {"unrelated": "shape"}

    class MockAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def get(self, url, headers=None):
            return MockResponse()

    monkeypatch.setattr(httpx, "AsyncClient", MockAsyncClient)

    response = client.post(
        "/api/device-connection/test",
        json={"print_host": "192.168.1.50", "printer_agent": "moonraker"},
        headers=AUTH,
    )
    data = response.json()
    assert data["success"] is False
    assert "klippy_state" in data["message"]


def test_test_connection_handles_unreachable_host(client, monkeypatch):
    class MockAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def get(self, url, headers=None):
            raise httpx.ConnectError("Connection refused")

    monkeypatch.setattr(httpx, "AsyncClient", MockAsyncClient)

    response = client.post(
        "/api/device-connection/test",
        json={"print_host": "192.168.1.50", "printer_agent": "moonraker"},
        headers=AUTH,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert "192.168.1.50" in data["message"]


@pytest.mark.parametrize(
    "raw_host,expected_url",
    [
        ("192.168.1.50", "http://192.168.1.50/server/info"),
        ("192.168.1.50:7125", "http://192.168.1.50:7125/server/info"),
        ("http://192.168.1.50", "http://192.168.1.50/server/info"),
        ("https://printer.local/", "https://printer.local/server/info"),
    ],
)
def test_test_connection_normalizes_host_url(client, monkeypatch, raw_host, expected_url):
    """Bare host/IP (no scheme) defaults to plain HTTP — Moonraker's LAN
    default, matching Moonraker::make_url()'s exact behavior — while an
    already-schemed URL is used as-is."""
    captured_url = {}

    class MockResponse:
        status_code = 200

        def json(self):
            return {"result": {"klippy_state": "ready"}}

    class MockAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def get(self, url, headers=None):
            captured_url["url"] = url
            return MockResponse()

    monkeypatch.setattr(httpx, "AsyncClient", MockAsyncClient)

    client.post(
        "/api/device-connection/test",
        json={"print_host": raw_host, "printer_agent": "moonraker"},
        headers=AUTH,
    )
    assert captured_url["url"] == expected_url


# ============================================================================
# POST /api/device-connection/upload
# ============================================================================
#
# Requirements: "clicking the print button should show a dialog similar
# to the native ui to upload the gcode to the printer and/or print" — see
# app/routers/device_connection.py's upload_job_to_printer docstring for
# the native Moonraker::upload()/print/start contract this mirrors.

import asyncio


@pytest.fixture
def upload_client(tmp_path, monkeypatch):
    """
    Like `client`, but also runs real DB migrations (init_db) against the
    same tmp workspace, so the upload endpoint's `SELECT ... FROM jobs`/
    `output_files` queries have a real (empty, until seeded) schema to
    query against.
    """
    monkeypatch.setenv("USER_WORKSPACE", str(tmp_path / "user_workspace"))
    monkeypatch.setenv("WORKSPACE_ROOT", str(tmp_path / "workspace"))
    monkeypatch.setenv("TMP_ROOT", str(tmp_path / "tmp"))
    monkeypatch.setenv("API_SECRET", "test-secret-12345")

    import app.config as config_module
    config_module._settings = None

    from app.auth import init_auth
    init_auth("test-secret-12345")

    from app.database import init_db
    asyncio.run(init_db())

    from app.main import app
    return TestClient(app)


def _seed_completed_job_with_gcode(tmp_path, job_id: str, gcode_content: bytes = b"G28\nG1 X10\n"):
    """Inserts a completed job row + a plate_1.gcode output_files row
    directly into the real sqlite DB, and writes the gcode bytes to disk
    at the job's own output_dir — mirroring what job_manager.py's
    `_register_output_files` does after a real CLI slice."""
    import aiosqlite
    from app.database import get_db_path

    output_dir = tmp_path / "tmp" / "jobs" / job_id / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    gcode_path = output_dir / "plate_1.gcode"
    gcode_path.write_bytes(gcode_content)

    async def _insert():
        async with aiosqlite.connect(get_db_path()) as db:
            await db.execute(
                """
                INSERT INTO jobs (job_id, session_id, submitted_at, status, action_type, cli_args, output_dir)
                VALUES (?, 'default', datetime('now'), 'completed', 'slice', '[]', ?)
                """,
                (job_id, str(output_dir)),
            )
            await db.execute(
                """
                INSERT INTO output_files (output_file_id, job_id, filename, size_bytes, storage_path, created_at)
                VALUES (?, ?, 'plate_1.gcode', ?, ?, datetime('now'))
                """,
                (f"{job_id}-out", job_id, len(gcode_content), str(gcode_path)),
            )
            await db.commit()

    asyncio.run(_insert())
    return gcode_path


def _connect_printer(upload_client, print_host="192.168.1.50", apikey=""):
    upload_client.post(
        "/api/device-connection",
        json={
            "print_host": print_host,
            "printer_agent": "moonraker",
            "printhost_apikey": apikey,
            "connected": True,
        },
        headers=AUTH,
    )


class _MockUploadAsyncClient:
    """Mocks both /server/files/upload and /printer/print/start calls."""

    captured_calls: list = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def post(self, url, headers=None, data=None, files=None, json=None):
        _MockUploadAsyncClient.captured_calls.append(
            {"url": url, "headers": headers, "data": data, "files": files, "json": json}
        )

        class Resp:
            def __init__(self, status_code, body):
                self.status_code = status_code
                self._body = body

            def json(self):
                return self._body

        if url.endswith("/server/files/upload"):
            # Real Moonraker responds 201 Created on a successful upload,
            # not 200 — this is the exact status the "Upload failed: host
            # responded with HTTP 201" bug report was about. Deliberately
            # NOT using 200 here so this mock catches any regression back
            # to a strict `== 200` check.
            return Resp(201, {"result": {"item": {"path": "plate_1.gcode", "root": "gcodes"}}})
        if url.endswith("/printer/print/start"):
            return Resp(200, {})
        return Resp(404, {})


def test_upload_job_to_printer_success_upload_only(upload_client, tmp_path, monkeypatch):
    _MockUploadAsyncClient.captured_calls = []
    monkeypatch.setattr(httpx, "AsyncClient", _MockUploadAsyncClient)

    _connect_printer(upload_client, apikey="abc123")
    _seed_completed_job_with_gcode(tmp_path, "job-1")

    response = upload_client.post(
        "/api/device-connection/upload",
        json={"job_id": "job-1", "start_print": False},
        headers=AUTH,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["uploaded_filename"] == "plate_1.gcode"
    assert data["print_started"] is False

    # Only the upload call was made — no print/start.
    upload_calls = [c for c in _MockUploadAsyncClient.captured_calls if c["url"].endswith("upload")]
    print_calls = [c for c in _MockUploadAsyncClient.captured_calls if c["url"].endswith("print/start")]
    assert len(upload_calls) == 1
    assert len(print_calls) == 0
    assert upload_calls[0]["headers"]["X-Api-Key"] == "abc123"
    assert upload_calls[0]["data"] == {"root": "gcodes"}


def test_upload_job_to_printer_upload_and_print(upload_client, tmp_path, monkeypatch):
    _MockUploadAsyncClient.captured_calls = []
    monkeypatch.setattr(httpx, "AsyncClient", _MockUploadAsyncClient)

    _connect_printer(upload_client)
    _seed_completed_job_with_gcode(tmp_path, "job-2")

    response = upload_client.post(
        "/api/device-connection/upload",
        json={"job_id": "job-2", "start_print": True},
        headers=AUTH,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["print_started"] is True

    print_calls = [c for c in _MockUploadAsyncClient.captured_calls if c["url"].endswith("print/start")]
    assert len(print_calls) == 1
    assert print_calls[0]["json"] == {"filename": "plate_1.gcode"}


def test_upload_job_to_printer_uses_custom_filename(upload_client, tmp_path, monkeypatch):
    _MockUploadAsyncClient.captured_calls = []
    monkeypatch.setattr(httpx, "AsyncClient", _MockUploadAsyncClient)

    _connect_printer(upload_client)
    _seed_completed_job_with_gcode(tmp_path, "job-3")

    response = upload_client.post(
        "/api/device-connection/upload",
        json={"job_id": "job-3", "filename": "my_custom_name", "start_print": False},
        headers=AUTH,
    )
    assert response.status_code == 200

    upload_calls = [c for c in _MockUploadAsyncClient.captured_calls if c["url"].endswith("upload")]
    # .gcode extension appended automatically since the user's custom name omitted it.
    assert upload_calls[0]["files"]["file"][0] == "my_custom_name.gcode"


def test_upload_job_to_printer_rejects_when_not_connected(upload_client, tmp_path):
    # device_connection.py's `settings` is bound at first module import and
    # reused for the whole pytest session (a "from X import Y" reference,
    # not re-resolved by later fixtures' env-var/singleton resets) — so
    # explicitly clear any connection a previous test in this run may have
    # saved, rather than relying on test-order isolation for the "no
    # printer connected" starting state this test needs.
    upload_client.delete("/api/device-connection", headers=AUTH)
    _seed_completed_job_with_gcode(tmp_path, "job-4")

    response = upload_client.post(
        "/api/device-connection/upload",
        json={"job_id": "job-4", "start_print": False},
        headers=AUTH,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert "no printer is connected" in data["message"].lower()


def test_upload_job_to_printer_404_for_unknown_job(upload_client):
    _connect_printer(upload_client)

    response = upload_client.post(
        "/api/device-connection/upload",
        json={"job_id": "nonexistent-job", "start_print": False},
        headers=AUTH,
    )
    assert response.status_code == 404


def test_upload_job_to_printer_rejects_incomplete_job(upload_client, tmp_path):
    import aiosqlite
    from app.database import get_db_path

    output_dir = tmp_path / "tmp" / "jobs" / "job-running" / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    async def _insert():
        async with aiosqlite.connect(get_db_path()) as db:
            await db.execute(
                """
                INSERT INTO jobs (job_id, session_id, submitted_at, status, action_type, cli_args, output_dir)
                VALUES ('job-running', 'default', datetime('now'), 'running', 'slice', '[]', ?)
                """,
                (str(output_dir),),
            )
            await db.commit()

    asyncio.run(_insert())
    _connect_printer(upload_client)

    response = upload_client.post(
        "/api/device-connection/upload",
        json={"job_id": "job-running", "start_print": False},
        headers=AUTH,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert "not completed" in data["message"].lower()


def test_upload_job_to_printer_rejects_job_with_no_gcode(upload_client, tmp_path):
    import aiosqlite
    from app.database import get_db_path

    output_dir = tmp_path / "tmp" / "jobs" / "job-3mf" / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    async def _insert():
        async with aiosqlite.connect(get_db_path()) as db:
            await db.execute(
                """
                INSERT INTO jobs (job_id, session_id, submitted_at, status, action_type, cli_args, output_dir)
                VALUES ('job-3mf', 'default', datetime('now'), 'completed', 'export_3mf', '[]', ?)
                """,
                (str(output_dir),),
            )
            await db.execute(
                """
                INSERT INTO output_files (output_file_id, job_id, filename, size_bytes, storage_path, created_at)
                VALUES ('out-1', 'job-3mf', 'export.3mf', 100, ?, datetime('now'))
                """,
                (str(output_dir / "export.3mf"),),
            )
            await db.commit()

    asyncio.run(_insert())
    _connect_printer(upload_client)

    response = upload_client.post(
        "/api/device-connection/upload",
        json={"job_id": "job-3mf", "start_print": False},
        headers=AUTH,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert "no sliced gcode" in data["message"].lower()


@pytest.mark.parametrize("status_code", [200, 201, 204])
def test_upload_job_to_printer_treats_any_2xx_as_success(
    upload_client, tmp_path, monkeypatch, status_code
):
    """Regression test: native OrcaSlicer's Http.cpp treats the entire
    2xx range as success (`http_status >= 200 && http_status < 300`),
    matching real Moonraker servers, which respond 201 Created (not 200)
    on a successful /server/files/upload. A strict `== 200` check
    incorrectly reported "Upload failed: host responded with HTTP 201"
    for every real-world upload."""

    class MockAsyncClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            pass

        async def post(self, url, headers=None, data=None, files=None, json=None):
            class Resp:
                def __init__(self):
                    self.status_code = status_code

                def json(self):
                    return {"result": {"item": {"path": "plate_1.gcode"}}}

            return Resp()

    monkeypatch.setattr(httpx, "AsyncClient", MockAsyncClient)

    _connect_printer(upload_client)
    _seed_completed_job_with_gcode(tmp_path, f"job-2xx-{status_code}")

    response = upload_client.post(
        "/api/device-connection/upload",
        json={"job_id": f"job-2xx-{status_code}", "start_print": False},
        headers=AUTH,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True, data["message"]


def test_upload_job_to_printer_treats_4xx_as_failure(upload_client, tmp_path, monkeypatch):
    """Sanity check for the other half of the 2xx-fix: a genuine error
    status (e.g. 403 from a bad API key) must still be reported as a
    failure, matching native's `http_status >= 400` error branch."""

    class MockAsyncClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            pass

        async def post(self, url, headers=None, data=None, files=None, json=None):
            class Resp:
                status_code = 403

                def json(self):
                    return {}

            return Resp()

    monkeypatch.setattr(httpx, "AsyncClient", MockAsyncClient)

    _connect_printer(upload_client)
    _seed_completed_job_with_gcode(tmp_path, "job-403")

    response = upload_client.post(
        "/api/device-connection/upload",
        json={"job_id": "job-403", "start_print": False},
        headers=AUTH,
    )
    data = response.json()
    assert data["success"] is False
    assert "403" in data["message"]


def test_upload_job_to_printer_handles_upload_failure(upload_client, tmp_path, monkeypatch):
    class FailingAsyncClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            pass

        async def post(self, url, **kwargs):
            raise httpx.ConnectError("refused")

    monkeypatch.setattr(httpx, "AsyncClient", FailingAsyncClient)

    _connect_printer(upload_client)
    _seed_completed_job_with_gcode(tmp_path, "job-5")

    response = upload_client.post(
        "/api/device-connection/upload",
        json={"job_id": "job-5", "start_print": False},
        headers=AUTH,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
