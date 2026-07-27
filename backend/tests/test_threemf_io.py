"""
Unit tests for app/threemf_io.py: STL parsing/writing and 3mf
reading/writing, including round-trip correctness of position, full
orientation (quaternion), and non-uniform scale.
"""

import math
import struct
from pathlib import Path

import pytest

from app.threemf_io import (
    MeshData,
    ProjectObject,
    parse_3mf_objects,
    parse_stl_bytes,
    write_3mf,
    write_stl_bytes,
)


def _make_binary_stl_cube(size: float = 10.0) -> bytes:
    """Build a minimal binary STL cube (12 triangles) for testing."""
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


def _quat_from_axis_angle(axis: tuple[float, float, float], angle_deg: float):
    ax, ay, az = axis
    length = math.sqrt(ax * ax + ay * ay + az * az)
    ax, ay, az = ax / length, ay / length, az / length
    half = math.radians(angle_deg) / 2
    s = math.sin(half)
    return (ax * s, ay * s, az * s, math.cos(half))


class TestStlParsing:
    def test_parse_binary_stl_cube(self):
        data = _make_binary_stl_cube(10.0)
        mesh = parse_stl_bytes(data)
        assert len(mesh.vertices) == 8
        assert len(mesh.triangles) == 12

    def test_parse_ascii_stl(self):
        ascii_stl = (
            "solid test\n"
            "facet normal 0 0 1\n"
            "  outer loop\n"
            "    vertex 0 0 0\n"
            "    vertex 1 0 0\n"
            "    vertex 0 1 0\n"
            "  endloop\n"
            "endfacet\n"
            "endsolid test\n"
        ).encode("ascii")
        mesh = parse_stl_bytes(ascii_stl)
        assert len(mesh.vertices) == 3
        assert len(mesh.triangles) == 1

    def test_stl_round_trip(self):
        data = _make_binary_stl_cube(5.0)
        mesh = parse_stl_bytes(data)
        rewritten = write_stl_bytes(mesh, "cube")
        mesh2 = parse_stl_bytes(rewritten)
        assert len(mesh2.vertices) == len(mesh.vertices)
        assert len(mesh2.triangles) == len(mesh.triangles)


class Test3mfWriteAndParse:
    def test_write_then_parse_preserves_position(self, tmp_path: Path):
        mesh = parse_stl_bytes(_make_binary_stl_cube(10.0))
        obj = ProjectObject(name="cube.stl", mesh=mesh, x=12.5, y=-7.25, z=0.0)
        data = write_3mf([obj])
        out_path = tmp_path / "project.3mf"
        out_path.write_bytes(data)

        parsed = parse_3mf_objects(out_path)
        assert len(parsed) == 1
        assert parsed[0].x == pytest.approx(12.5)
        assert parsed[0].y == pytest.approx(-7.25)
        assert parsed[0].z == pytest.approx(0.0)

    def test_write_then_parse_preserves_arbitrary_rotation(self, tmp_path: Path):
        """
        Rotation about a non-Z axis must survive the round trip — a
        naive "Z angle only" implementation would silently drop this
        (see threemf_io.ProjectObject's doc comment for why a full
        quaternion is used instead of a single Z angle).
        """
        mesh = parse_stl_bytes(_make_binary_stl_cube(10.0))
        qx, qy, qz, qw = _quat_from_axis_angle((1, 0, 0), 30.0)
        obj = ProjectObject(name="tilted.stl", mesh=mesh, x=0, y=0, z=0, qx=qx, qy=qy, qz=qz, qw=qw)
        data = write_3mf([obj])
        out_path = tmp_path / "project.3mf"
        out_path.write_bytes(data)

        parsed = parse_3mf_objects(out_path)
        assert parsed[0].qx == pytest.approx(qx, abs=1e-4)
        assert parsed[0].qy == pytest.approx(qy, abs=1e-4)
        assert parsed[0].qz == pytest.approx(qz, abs=1e-4)
        assert parsed[0].qw == pytest.approx(qw, abs=1e-4)

    def test_write_then_parse_preserves_nonuniform_scale(self, tmp_path: Path):
        mesh = parse_stl_bytes(_make_binary_stl_cube(10.0))
        obj = ProjectObject(name="scaled.stl", mesh=mesh, x=0, y=0, z=0, sx=2.0, sy=1.5, sz=0.5)
        data = write_3mf([obj])
        out_path = tmp_path / "project.3mf"
        out_path.write_bytes(data)

        parsed = parse_3mf_objects(out_path)
        assert parsed[0].sx == pytest.approx(2.0, abs=1e-4)
        assert parsed[0].sy == pytest.approx(1.5, abs=1e-4)
        assert parsed[0].sz == pytest.approx(0.5, abs=1e-4)
        # Scale must not corrupt the extracted quaternion (identity here).
        assert parsed[0].qw == pytest.approx(1.0, abs=1e-4)

    def test_write_then_parse_multiple_objects_preserves_names_and_order(self, tmp_path: Path):
        mesh_small = parse_stl_bytes(_make_binary_stl_cube(5.0))
        mesh_big = parse_stl_bytes(_make_binary_stl_cube(20.0))
        objects = [
            ProjectObject(name="small.stl", mesh=mesh_small, x=10, y=20, z=0),
            ProjectObject(name="big.stl", mesh=mesh_big, x=-30, y=15, z=0),
        ]
        data = write_3mf(objects)
        out_path = tmp_path / "project.3mf"
        out_path.write_bytes(data)

        parsed = parse_3mf_objects(out_path)
        assert len(parsed) == 2
        by_name = {p.name: p for p in parsed}
        assert by_name["small.stl"].x == pytest.approx(10)
        assert by_name["big.stl"].x == pytest.approx(-30)

    def test_written_3mf_is_valid_zip_with_expected_parts(self, tmp_path: Path):
        mesh = parse_stl_bytes(_make_binary_stl_cube(10.0))
        data = write_3mf([ProjectObject(name="cube.stl", mesh=mesh)])
        out_path = tmp_path / "project.3mf"
        out_path.write_bytes(data)

        from zipfile import ZipFile

        with ZipFile(out_path) as zf:
            names = set(zf.namelist())
            assert "[Content_Types].xml" in names
            assert "_rels/.rels" in names
            assert "3D/3dmodel.model" in names
            # No object carries config_overrides, so native OrcaSlicer's
            # model-settings part should simply be omitted.
            assert "Metadata/model_settings.config" not in names


class Test3mfPerObjectConfigOverrides:
    """
    Covers ProjectObject.config_overrides — per-object process (print)
    config overrides embedded as Metadata/model_settings.config, in the
    exact format native OrcaSlicer's CLI reads back into
    ModelObject::config (see bbs_3mf.cpp's _add_model_config_file_to_archive
    for the writer, _handle_start_config_metadata for the reader — both
    confirmed directly against the native source this app is a web UI
    for).
    """

    def test_object_with_overrides_gets_model_settings_config_part(self, tmp_path: Path):
        mesh = parse_stl_bytes(_make_binary_stl_cube(10.0))
        obj = ProjectObject(
            name="cube.stl", mesh=mesh, config_overrides={"brim_type": "outer_brim_only", "brim_width": "5"}
        )
        data = write_3mf([obj])
        out_path = tmp_path / "project.3mf"
        out_path.write_bytes(data)

        from zipfile import ZipFile

        with ZipFile(out_path) as zf:
            names = set(zf.namelist())
            assert "Metadata/model_settings.config" in names
            config_xml = zf.read("Metadata/model_settings.config").decode("utf-8")

        # Matches the exact tag/attribute names native OrcaSlicer's own
        # writer/reader use: <object id=".."><metadata key=".." value=".."/>
        assert '<object id="1">' in config_xml
        assert '<metadata key="brim_type" value="outer_brim_only"/>' in config_xml
        assert '<metadata key="brim_width" value="5"/>' in config_xml
        # The object's own "name" metadata key must always be present
        # alongside the actual overrides — omitting it causes native
        # OrcaSlicer's importer to blank out ModelObject::name entirely
        # (confirmed directly against a real CLI slice — see
        # threemf_io.py's write_3mf doc comment on this exact bug).
        assert '<metadata key="name" value="cube.stl"/>' in config_xml

    def test_object_without_overrides_is_omitted_from_model_settings_config(self, tmp_path: Path):
        mesh = parse_stl_bytes(_make_binary_stl_cube(10.0))
        objects = [
            ProjectObject(name="with_override.stl", mesh=mesh, config_overrides={"brim_width": "5"}),
            ProjectObject(name="no_override.stl", mesh=mesh),
        ]
        data = write_3mf(objects)
        out_path = tmp_path / "project.3mf"
        out_path.write_bytes(data)

        from zipfile import ZipFile

        with ZipFile(out_path) as zf:
            config_xml = zf.read("Metadata/model_settings.config").decode("utf-8")

        # Object 1 (with_override.stl) carries the override; object 2
        # (no_override.stl) must not appear in the config file at all —
        # its absence IS the "fully inherits from Global" signal.
        assert '<object id="1">' in config_xml
        assert '<object id="2">' not in config_xml

    def test_no_objects_have_overrides_omits_the_file_entirely(self, tmp_path: Path):
        mesh = parse_stl_bytes(_make_binary_stl_cube(10.0))
        data = write_3mf([ProjectObject(name="plain.stl", mesh=mesh)])
        out_path = tmp_path / "project.3mf"
        out_path.write_bytes(data)

        from zipfile import ZipFile

        with ZipFile(out_path) as zf:
            assert "Metadata/model_settings.config" not in set(zf.namelist())

    def test_special_characters_in_override_values_are_xml_escaped(self, tmp_path: Path):
        mesh = parse_stl_bytes(_make_binary_stl_cube(10.0))
        obj = ProjectObject(name="cube.stl", mesh=mesh, config_overrides={"some_key": '<>&"'})
        data = write_3mf([obj])
        out_path = tmp_path / "project.3mf"
        out_path.write_bytes(data)

        from zipfile import ZipFile

        with ZipFile(out_path) as zf:
            config_xml = zf.read("Metadata/model_settings.config").decode("utf-8")

        assert "<>&\"" not in config_xml
        assert "&lt;&gt;&amp;&quot;" in config_xml
