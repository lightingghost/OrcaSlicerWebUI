"""
Integration tests for the "Project" import/export API (POST
/api/projects/import, POST /api/projects/export) — see
backend/app/routers/projects.py.

Follows the same real-filesystem/real-app-lifespan pattern as
test_files_integration.py rather than mocking the database, since these
endpoints' whole job is file I/O + DB bookkeeping (splitting/rebuilding
3mf/STL files) — mocking that away would leave the actual behavior
untested.
"""

import io
import struct

import pytest
from fastapi.testclient import TestClient

from app.threemf_io import ProjectObject, parse_stl_bytes, write_3mf


def _reset_app_modules():
    import sys
    for mod in list(sys.modules):
        if mod == "app" or mod.startswith("app."):
            del sys.modules[mod]


@pytest.fixture
def temp_workspace(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    tmp_root = tmp_path / "tmp"
    tmp_root.mkdir()

    import os
    os.environ["WORKSPACE_ROOT"] = str(workspace)
    os.environ["TMP_ROOT"] = str(tmp_root)
    os.environ["API_SECRET"] = "test_secret_12345678"
    os.environ["ORCA_CLI_PATH"] = "/tmp/fake_cli"

    _reset_app_modules()

    yield workspace

    for key in ("WORKSPACE_ROOT", "TMP_ROOT", "API_SECRET", "ORCA_CLI_PATH"):
        os.environ.pop(key, None)
    _reset_app_modules()


def _make_binary_stl_cube(size: float = 10.0) -> bytes:
    s = size
    verts = [
        (0, 0, 0), (s, 0, 0), (s, s, 0), (0, s, 0),
        (0, 0, s), (s, 0, s), (s, s, s), (0, s, s),
    ]
    faces = [
        (0, 1, 2), (0, 2, 3),
        (4, 6, 5), (4, 7, 6),
        (0, 5, 1), (0, 4, 5),
        (1, 6, 2), (1, 5, 6),
        (2, 7, 3), (2, 6, 7),
        (3, 4, 0), (3, 7, 4),
    ]
    out = bytearray(b"\x00" * 80)
    out += struct.pack("<I", len(faces))
    for tri in faces:
        out += struct.pack("<3f", 0, 0, 0)
        for idx in tri:
            out += struct.pack("<3f", *verts[idx])
        out += struct.pack("<H", 0)
    return bytes(out)


def _build_test_3mf(tmp_path) -> bytes:
    """Build a small 2-object project.3mf using threemf_io directly
    (exercising the exact writer this app's own Download Project uses),
    to import in tests without depending on any external CLI/fixture."""
    mesh_small = parse_stl_bytes(_make_binary_stl_cube(5.0))
    mesh_big = parse_stl_bytes(_make_binary_stl_cube(20.0))
    objects = [
        ProjectObject(name="small.stl", mesh=mesh_small, x=10.0, y=20.0, z=0.0),
        ProjectObject(name="big.stl", mesh=mesh_big, x=-30.0, y=15.0, z=0.0),
    ]
    return write_3mf(objects)


AUTH_HEADERS = {"Authorization": "Bearer test_secret_12345678"}


@pytest.mark.asyncio
async def test_import_project_splits_into_files_with_positions(temp_workspace, tmp_path):
    data = _build_test_3mf(tmp_path)

    from app.main import app

    with TestClient(app) as client:
        response = client.post(
            "/api/projects/import",
            files={"file": ("project.3mf", io.BytesIO(data), "application/octet-stream")},
            headers=AUTH_HEADERS,
        )

        assert response.status_code == 200
        body = response.json()
        objects = body["objects"]
        assert len(objects) == 2

        by_name = {o["filename"]: o for o in objects}
        assert by_name["small.stl"]["x"] == pytest.approx(10.0)
        assert by_name["small.stl"]["y"] == pytest.approx(20.0)
        assert by_name["big.stl"]["x"] == pytest.approx(-30.0)
        assert by_name["big.stl"]["y"] == pytest.approx(15.0)

        # Each imported object must be registered as a normal file (i.e.
        # retrievable via the ordinary GET /api/files/{id} endpoint), not
        # a special one-off record.
        for obj in objects:
            get_response = client.get(f"/api/files/{obj['file_id']}", headers=AUTH_HEADERS)
            assert get_response.status_code == 200
            assert get_response.json()["extension"] == "stl"


@pytest.mark.asyncio
async def test_import_project_rejects_non_3mf_file(temp_workspace):
    from app.main import app

    with TestClient(app) as client:
        response = client.post(
            "/api/projects/import",
            files={"file": ("model.stl", io.BytesIO(_make_binary_stl_cube()), "application/octet-stream")},
            headers=AUTH_HEADERS,
        )
        assert response.status_code == 422


@pytest.mark.asyncio
async def test_export_project_round_trips_through_import(temp_workspace, tmp_path):
    """Import a project, then export it back out using the imported
    file_ids + their original positions — the export should succeed and
    produce a valid, re-importable 3mf."""
    data = _build_test_3mf(tmp_path)

    from app.main import app

    with TestClient(app) as client:
        import_response = client.post(
            "/api/projects/import",
            files={"file": ("project.3mf", io.BytesIO(data), "application/octet-stream")},
            headers=AUTH_HEADERS,
        )
        assert import_response.status_code == 200
        imported_objects = import_response.json()["objects"]

        export_request = {
            "objects": [
                {
                    "file_id": obj["file_id"],
                    "x": obj["x"],
                    "y": obj["y"],
                    "z": obj["z"],
                    "qx": obj["qx"],
                    "qy": obj["qy"],
                    "qz": obj["qz"],
                    "qw": obj["qw"],
                    "sx": obj["sx"],
                    "sy": obj["sy"],
                    "sz": obj["sz"],
                }
                for obj in imported_objects
            ]
        }
        export_response = client.post(
            "/api/projects/export", json=export_request, headers=AUTH_HEADERS
        )
        assert export_response.status_code == 200
        assert export_response.headers["content-type"].startswith(
            "application/vnd.ms-package.3dmanufacturing-3dmodel+xml"
        )

        # The exported bytes must themselves be a valid, re-importable 3mf.
        exported_bytes = export_response.content
        reimport_response = client.post(
            "/api/projects/import",
            files={"file": ("reexported.3mf", io.BytesIO(exported_bytes), "application/octet-stream")},
            headers=AUTH_HEADERS,
        )
        assert reimport_response.status_code == 200
        reimported_objects = reimport_response.json()["objects"]
        assert len(reimported_objects) == 2
        reimported_by_name = {o["filename"]: o for o in reimported_objects}
        assert reimported_by_name["small.stl"]["x"] == pytest.approx(10.0)
        assert reimported_by_name["big.stl"]["y"] == pytest.approx(15.0)


@pytest.mark.asyncio
async def test_export_project_rejects_unknown_file_id(temp_workspace):
    from app.main import app

    with TestClient(app) as client:
        response = client.post(
            "/api/projects/export",
            json={"objects": [{"file_id": "00000000-0000-0000-0000-000000000000", "x": 0, "y": 0}]},
            headers=AUTH_HEADERS,
        )
        assert response.status_code == 422


@pytest.mark.asyncio
async def test_export_project_rejects_non_stl_source(temp_workspace):
    """A plate object backed by an .obj/.amf/.3mf upload can't be
    exported yet (threemf_io.py only implements STL mesh parsing) — must
    fail with a clear 422, not silently drop the object or crash."""
    from app.main import app

    with TestClient(app) as client:
        upload_response = client.post(
            "/api/files/upload",
            files={"file": ("model.obj", io.BytesIO(b"v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"), "text/plain")},
            headers=AUTH_HEADERS,
        )
        assert upload_response.status_code == 200
        file_id = upload_response.json()["file_id"]

        export_response = client.post(
            "/api/projects/export",
            json={"objects": [{"file_id": file_id, "x": 0, "y": 0}]},
            headers=AUTH_HEADERS,
        )
        assert export_response.status_code == 422
