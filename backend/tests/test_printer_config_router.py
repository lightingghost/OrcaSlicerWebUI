"""
Tests for the user-saved printer/filament/process config CRUD router
(backend/app/routers/printer_config.py), focused on the delete endpoints
that back the frontend's new "delete saved config" buttons (PrinterSelector,
ProcessSelector, FilamentRow).

Requirements covered:
- DELETE /api/printer-configs/{name} removes the saved file and is
  idempotent-ish (404 if it never existed).
- DELETE /api/filament-configs/{name} and DELETE /api/process-configs/{name}
  behave the same way.
- Deleting one config does not affect sibling configs or other categories.
- Listing reflects deletions immediately.
"""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client_and_dirs(tmp_path):
    """
    Build a TestClient with app.routers.printer_config's `settings` name
    patched to a lightweight stand-in pointing every category dir at a
    fresh tmp_path subtree — this router reads settings.{printer,
    filament,process}_configs_dir directly (via _CATEGORY_DIR's lambdas),
    so patching app.config.settings alone would not affect it since the
    module already imported its own `settings` reference at import time.
    """
    from app.auth import init_auth
    init_auth("test-secret-12345")

    with patch("app.database.init_db", new_callable=AsyncMock), \
         patch("app.cleanup.run_cleanup_loop", return_value=AsyncMock()), \
         patch("app.job_manager.JobManager"):

        from app.main import app
        from app.routers import printer_config as printer_config_router

        printer_dir = tmp_path / "printer"
        filament_dir = tmp_path / "filament"
        process_dir = tmp_path / "process"
        autosave_dir = tmp_path / "autosave"
        for d in (printer_dir, filament_dir, process_dir, autosave_dir):
            d.mkdir(parents=True, exist_ok=True)

        fake_settings = MagicMock()
        fake_settings.printer_configs_dir = printer_dir
        fake_settings.filament_configs_dir = filament_dir
        fake_settings.process_configs_dir = process_dir
        fake_settings.autosave_dir = autosave_dir

        with patch.object(printer_config_router, "settings", fake_settings):
            client = TestClient(app)
            try:
                yield client, {
                    "printer": printer_dir,
                    "filament": filament_dir,
                    "process": process_dir,
                    "autosave": autosave_dir,
                }
            finally:
                pass


AUTH_HEADERS = {"Authorization": "Bearer test-secret-12345"}


class TestDeletePrinterConfig:
    def test_deletes_existing_config_file(self, client_and_dirs):
        client, dirs = client_and_dirs
        (dirs["printer"] / "My Printer.json").write_text('{"inherits": "Base"}')

        response = client.delete(
            "/api/printer-configs/My%20Printer", headers=AUTH_HEADERS
        )

        assert response.status_code == 200
        assert not (dirs["printer"] / "My Printer.json").exists()

    def test_returns_404_for_nonexistent_config(self, client_and_dirs):
        client, _ = client_and_dirs
        response = client.delete(
            "/api/printer-configs/Does Not Exist", headers=AUTH_HEADERS
        )
        assert response.status_code == 404

    def test_deleting_one_config_does_not_affect_others(self, client_and_dirs):
        client, dirs = client_and_dirs
        (dirs["printer"] / "Keep Me.json").write_text("{}")
        (dirs["printer"] / "Delete Me.json").write_text("{}")

        response = client.delete(
            "/api/printer-configs/Delete%20Me", headers=AUTH_HEADERS
        )

        assert response.status_code == 200
        assert (dirs["printer"] / "Keep Me.json").exists()
        assert not (dirs["printer"] / "Delete Me.json").exists()

    def test_list_reflects_deletion(self, client_and_dirs):
        client, dirs = client_and_dirs
        (dirs["printer"] / "Config A.json").write_text("{}")
        (dirs["printer"] / "Config B.json").write_text("{}")

        listed_before = client.get("/api/printer-configs", headers=AUTH_HEADERS).json()
        assert {c["name"] for c in listed_before} == {"Config A", "Config B"}

        client.delete("/api/printer-configs/Config%20A", headers=AUTH_HEADERS)

        listed_after = client.get("/api/printer-configs", headers=AUTH_HEADERS).json()
        assert {c["name"] for c in listed_after} == {"Config B"}

    def test_requires_auth(self, client_and_dirs):
        client, dirs = client_and_dirs
        (dirs["printer"] / "My Printer.json").write_text("{}")
        response = client.delete("/api/printer-configs/My%20Printer")
        assert response.status_code in (401, 403)
        # Unauthenticated request must not have deleted the file.
        assert (dirs["printer"] / "My Printer.json").exists()


class TestDeleteFilamentConfig:
    def test_deletes_existing_config_file(self, client_and_dirs):
        client, dirs = client_and_dirs
        (dirs["filament"] / "My Filament.json").write_text("{}")

        response = client.delete(
            "/api/filament-configs/My%20Filament", headers=AUTH_HEADERS
        )

        assert response.status_code == 200
        assert not (dirs["filament"] / "My Filament.json").exists()

    def test_returns_404_for_nonexistent_config(self, client_and_dirs):
        client, _ = client_and_dirs
        response = client.delete(
            "/api/filament-configs/Nope", headers=AUTH_HEADERS
        )
        assert response.status_code == 404

    def test_does_not_touch_printer_or_process_configs(self, client_and_dirs):
        client, dirs = client_and_dirs
        (dirs["filament"] / "Shared Name.json").write_text("{}")
        (dirs["printer"] / "Shared Name.json").write_text("{}")
        (dirs["process"] / "Shared Name.json").write_text("{}")

        response = client.delete(
            "/api/filament-configs/Shared%20Name", headers=AUTH_HEADERS
        )

        assert response.status_code == 200
        assert not (dirs["filament"] / "Shared Name.json").exists()
        assert (dirs["printer"] / "Shared Name.json").exists()
        assert (dirs["process"] / "Shared Name.json").exists()


class TestDeleteProcessConfig:
    def test_deletes_existing_config_file(self, client_and_dirs):
        client, dirs = client_and_dirs
        (dirs["process"] / "My Process.json").write_text("{}")

        response = client.delete(
            "/api/process-configs/My%20Process", headers=AUTH_HEADERS
        )

        assert response.status_code == 200
        assert not (dirs["process"] / "My Process.json").exists()

    def test_returns_404_for_nonexistent_config(self, client_and_dirs):
        client, _ = client_and_dirs
        response = client.delete(
            "/api/process-configs/Nope", headers=AUTH_HEADERS
        )
        assert response.status_code == 404

    def test_list_reflects_deletion(self, client_and_dirs):
        client, dirs = client_and_dirs
        (dirs["process"] / "0.2mm - Copy.json").write_text('{"inherits": "0.2mm Standard"}')

        listed_before = client.get("/api/process-configs", headers=AUTH_HEADERS).json()
        assert len(listed_before) == 1

        client.delete("/api/process-configs/0.2mm%20-%20Copy", headers=AUTH_HEADERS)

        listed_after = client.get("/api/process-configs", headers=AUTH_HEADERS).json()
        assert listed_after == []


class TestListConfigsExposesInherits:
    """
    GET /api/{printer,filament,process}-configs must surface each saved
    config's own `inherits` field (the system profile name it's based
    on), so the frontend can filter e.g. process configs by printer
    compatibility without an extra request per config — see
    ProcessSelector.tsx's compatibleUserProcessConfigs.
    """

    def test_list_includes_inherits_field(self, client_and_dirs):
        client, dirs = client_and_dirs
        (dirs["process"] / "My Process.json").write_text(
            '{"inherits": "0.2mm Standard @Some Printer", "layer_height": "0.2"}'
        )

        listed = client.get("/api/process-configs", headers=AUTH_HEADERS).json()

        assert len(listed) == 1
        assert listed[0]["inherits"] == "0.2mm Standard @Some Printer"

    def test_inherits_is_none_when_field_absent(self, client_and_dirs):
        client, dirs = client_and_dirs
        (dirs["process"] / "Orphan.json").write_text('{"layer_height": "0.2"}')

        listed = client.get("/api/process-configs", headers=AUTH_HEADERS).json()

        assert len(listed) == 1
        assert listed[0]["inherits"] is None

    def test_inherits_is_none_when_file_is_malformed_json(self, client_and_dirs):
        client, dirs = client_and_dirs
        (dirs["process"] / "Broken.json").write_text("{not valid json")

        # Listing must not fail/error over one unreadable file.
        listed = client.get("/api/process-configs", headers=AUTH_HEADERS).json()

        assert len(listed) == 1
        assert listed[0]["inherits"] is None

    def test_works_for_printer_and_filament_configs_too(self, client_and_dirs):
        client, dirs = client_and_dirs
        (dirs["printer"] / "My Printer.json").write_text('{"inherits": "Some Printer 0.4 Nozzle"}')
        (dirs["filament"] / "My Filament.json").write_text('{"inherits": "Generic PLA"}')

        printer_listed = client.get("/api/printer-configs", headers=AUTH_HEADERS).json()
        filament_listed = client.get("/api/filament-configs", headers=AUTH_HEADERS).json()

        assert printer_listed[0]["inherits"] == "Some Printer 0.4 Nozzle"
        assert filament_listed[0]["inherits"] == "Generic PLA"


class TestDeleteConfigWithAutosaveParam:
    """
    The `autosave` query param (kept for backward-compat — see
    printer_config.py's module docstring) routes deletion through the flat
    USER_WORKSPACE/autosave/ directory instead of the category dir.
    """

    def test_autosave_true_deletes_from_autosave_dir_not_category_dir(self, client_and_dirs):
        client, dirs = client_and_dirs
        (dirs["autosave"] / "printer_config.json").write_text('{"_profile_path": "x"}')
        (dirs["printer"] / "printer_config.json").write_text("{}")

        response = client.delete(
            "/api/printer-configs/printer_config?autosave=true", headers=AUTH_HEADERS
        )

        assert response.status_code == 200
        assert not (dirs["autosave"] / "printer_config.json").exists()
        # The category-dir file (a differently-scoped, explicitly-saved
        # config that happens to share the same name) must be untouched.
        assert (dirs["printer"] / "printer_config.json").exists()

    def test_autosave_delete_is_idempotent(self, client_and_dirs):
        client, _ = client_and_dirs
        response = client.delete(
            "/api/printer-configs/nonexistent_autosave?autosave=true", headers=AUTH_HEADERS
        )
        # delete_autosave returns 200 even if the file never existed.
        assert response.status_code == 200
