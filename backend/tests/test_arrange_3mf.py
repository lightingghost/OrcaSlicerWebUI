"""
Unit tests for app/arrange_3mf.py's parse_arranged_3mf, specifically the
composition of the <component> (mesh-recentering) transform with the
<item> (arrange placement) transform.

Regression coverage for a real bug: an earlier version of this module
only read the <item> transform, silently ignoring the <component>
transform OrcaSlicer's 3mf writer emits for every non-origin-centered
object's mesh recentering — this made every arranged object whose local
bounding-box center isn't at (0,0,0) (i.e. essentially every real STL)
report a position offset by exactly that recentering amount, which is
what produced objects landing far from where native's own arrange
algorithm actually placed them (confirmed against the real OrcaSlicer CLI
during investigation).
"""

from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

import pytest

from app.arrange_3mf import parse_arranged_3mf


def _write_split_component_3mf(
    path: Path,
    object_id: str,
    inner_object_id: str,
    source_file: str,
    component_transform: str,
    item_transform: str,
) -> None:
    """
    Build a minimal 3mf matching OrcaSlicer's own split-component-file
    shape (see arrange_3mf.py's module doc comment) — a
    <components><component transform="..."/></components> object
    referencing a separate part file, placed via a <build><item
    transform="..."/>.
    """
    model_settings = f"""<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="{object_id}">
    <metadata key="name" value="{source_file}"/>
    <part id="{inner_object_id}" subtype="normal_part">
      <metadata key="name" value="{source_file}"/>
      <metadata key="source_file" value="{source_file}"/>
    </part>
  </object>
</config>
"""
    model_3d = f"""<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <resources>
    <object id="{object_id}" type="model">
      <components>
        <component p:path="/3D/Objects/part.model" objectid="{inner_object_id}" transform="{component_transform}"/>
      </components>
    </object>
  </resources>
  <build>
    <item objectid="{object_id}" transform="{item_transform}"/>
  </build>
</model>
"""
    with ZipFile(path, "w", ZIP_DEFLATED) as zf:
        zf.writestr("Metadata/model_settings.config", model_settings)
        zf.writestr("3D/3dmodel.model", model_3d)


class TestComponentItemComposition:
    def test_pure_translation_composes_correctly(self, tmp_path: Path):
        """
        A 40x10x5mm box's mesh gets recentered by OrcaSlicer to its own
        local center (20, 5, 2.5) — stored as the <component> transform.
        The <item> transform (80, 95, 0) is the arrange placement applied
        on top of that. True world center must be their sum:
        (100, 100, 2.5) — NOT (80, 95, 0), which is what an
        item-transform-only reading would (incorrectly) report.
        """
        path = tmp_path / "test.3mf"
        _write_split_component_3mf(
            path,
            object_id="2",
            inner_object_id="1",
            source_file="box.stl",
            component_transform="1 0 0 0 1 0 0 0 1 20 5 2.5",
            item_transform="1 0 0 0 1 0 0 0 1 80 95 0",
        )

        result = parse_arranged_3mf(path, {"box.stl": "instance1"})
        assert len(result) == 1
        assert result[0].x == pytest.approx(100.0)
        assert result[0].y == pytest.approx(100.0)
        assert result[0].z == pytest.approx(2.5)

    def test_identity_component_matches_item_translation_directly(self, tmp_path: Path):
        """An object already centered at its own local origin (component
        translation = 0,0,0) should report exactly the item translation —
        sanity check that the composition doesn't introduce an offset
        where none should exist."""
        path = tmp_path / "test.3mf"
        _write_split_component_3mf(
            path,
            object_id="2",
            inner_object_id="1",
            source_file="centered.stl",
            component_transform="1 0 0 0 1 0 0 0 1 0 0 0",
            item_transform="1 0 0 0 1 0 0 0 1 50 60 0",
        )

        result = parse_arranged_3mf(path, {"centered.stl": "instance1"})
        assert result[0].x == pytest.approx(50.0)
        assert result[0].y == pytest.approx(60.0)

    def test_rotated_item_correctly_rotates_component_offset(self, tmp_path: Path):
        """
        When arrange also rotates the object 90 degrees about Z, the
        component's recentering translation must be ROTATED before being
        added to the item translation (true_pos = R_item @ component_t +
        item_t), not just added directly — a 90-degree rotation of
        (20, 5, 0) is (-5, 20, 0) (standard CCW rotation: x'=-y, y'=x).
        """
        path = tmp_path / "test.3mf"
        # 90-degree Z rotation, column-major: col0=(0,1,0), col1=(-1,0,0), col2=(0,0,1)
        rot_90z = "0 1 0 -1 0 0 0 0 1"
        _write_split_component_3mf(
            path,
            object_id="2",
            inner_object_id="1",
            source_file="rotated.stl",
            component_transform="1 0 0 0 1 0 0 0 1 20 5 0",
            item_transform=f"{rot_90z} 100 100 0",
        )

        result = parse_arranged_3mf(path, {"rotated.stl": "instance1"})
        assert result[0].rotation_z_deg == pytest.approx(90.0, abs=1e-3)
        # true_pos = R(90deg) @ (20,5,0) + (100,100,0) = (-5,20,0) + (100,100,0) = (95,120,0)
        assert result[0].x == pytest.approx(95.0, abs=1e-3)
        assert result[0].y == pytest.approx(120.0, abs=1e-3)

    def test_missing_component_falls_back_to_item_translation_only(self, tmp_path: Path):
        """A core-spec embedded-mesh 3mf (no split-component-file shape at
        all) has no <component> to compose with — must fall back cleanly
        to the item transform alone rather than erroring."""
        model_settings = """<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="2">
    <metadata key="name" value="embedded.stl"/>
    <part id="1" subtype="normal_part">
      <metadata key="source_file" value="embedded.stl"/>
    </part>
  </object>
</config>
"""
        model_3d = """<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="2" type="model">
      <mesh><vertices/><triangles/></mesh>
    </object>
  </resources>
  <build>
    <item objectid="2" transform="1 0 0 0 1 0 0 0 1 30 40 0"/>
  </build>
</model>
"""
        path = tmp_path / "test.3mf"
        with ZipFile(path, "w", ZIP_DEFLATED) as zf:
            zf.writestr("Metadata/model_settings.config", model_settings)
            zf.writestr("3D/3dmodel.model", model_3d)

        result = parse_arranged_3mf(path, {"embedded.stl": "instance1"})
        assert result[0].x == pytest.approx(30.0)
        assert result[0].y == pytest.approx(40.0)

    def test_multiple_objects_each_composed_independently(self, tmp_path: Path):
        model_settings = """<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="2">
    <metadata key="name" value="a.stl"/>
    <part id="1" subtype="normal_part"><metadata key="source_file" value="a.stl"/></part>
  </object>
  <object id="4">
    <metadata key="name" value="b.stl"/>
    <part id="3" subtype="normal_part"><metadata key="source_file" value="b.stl"/></part>
  </object>
</config>
"""
        model_3d = """<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <resources>
    <object id="2" type="model">
      <components><component p:path="/3D/Objects/a.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 75 75 2.5"/></components>
    </object>
    <object id="4" type="model">
      <components><component p:path="/3D/Objects/b.model" objectid="3" transform="1 0 0 0 1 0 0 0 1 10 10 10"/></components>
    </object>
  </resources>
  <build>
    <item objectid="2" transform="1 0 0 0 1 0 0 0 1 25 36 0"/>
    <item objectid="4" transform="1 0 0 0 1 0 0 0 1 94.253454 14 0"/>
  </build>
</model>
"""
        path = tmp_path / "test.3mf"
        with ZipFile(path, "w", ZIP_DEFLATED) as zf:
            zf.writestr("Metadata/model_settings.config", model_settings)
            zf.writestr("3D/3dmodel.model", model_3d)

        result = parse_arranged_3mf(path, {"a.stl": "grid", "b.stl": "cube"})
        by_id = {r.instance_id: r for r in result}
        assert by_id["grid"].x == pytest.approx(100.0)
        assert by_id["grid"].y == pytest.approx(111.0)
        assert by_id["cube"].x == pytest.approx(104.253454)
        assert by_id["cube"].y == pytest.approx(24.0)
