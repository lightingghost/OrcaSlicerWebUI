"""
Parser for the 3mf file OrcaSlicer's CLI writes when invoked with
--arrange=1/2 --export-3mf (see routers/arrange.py for how/why this is
invoked). Extracts each object instance's arranged X/Y position and Z
rotation in bed-absolute mm coordinates, keyed by the caller-supplied
instance token used to name the CLI's input file (see routers/arrange.py
for why this must be a per-plate-instance token rather than the file_id
itself).

Why this exists: the CLI's real arrangement is computed by
libslic3r/Arrange.cpp's libnest2d-based NFP nester (the same code the
native desktop GUI's Arrange button calls into) — reimplementing that
algorithm in the browser (see frontend/src/lib/arrangePacking.ts) can only
ever approximate it, which is why the WebUI's own "Arrange" button
produced different object positions than what Slice → Preview later
showed (the CLI always re-arranges raw STL/OBJ/AMF uploads with its own
native algorithm, ignoring whatever the browser displayed — see
cli_builder.py's "Transform options" section). Calling the CLI itself to
compute (and only compute — no --slice flag) the arrangement, then
reading the result back here, makes the Prepare tab's Arrange button
produce the exact same layout Slice will use.

3mf format details this relies on (confirmed by direct inspection of a
real CLI-produced 3mf, and cross-referenced against
libslic3r/Format/bbs_3mf.cpp's writer):

  Metadata/model_settings.config:
      <object id="4">
        <metadata key="name" value="cube_small.stl"/>
        ...
        <part id="3" subtype="normal_part">
          <metadata key="source_file" value="cube_small.stl"/>
          ...

    `source_file` is the basename of whatever path was passed as a CLI
    input argument — confirmed by directly testing with symlinks: the
    reported value tracks the argument path's basename, NOT the real
    underlying file it resolves to. This matters because two plate
    instances of the SAME uploaded file (a "clone", e.g.
    duplicateObject()/setInstanceCount() in the frontend) share one
    on-disk storage path; if that raw path were passed to the CLI twice,
    both resulting objects would report the identical `source_file` and
    there would be no way to tell which arranged position belongs to
    which plate instance. routers/arrange.py works around this by
    creating one uniquely-named symlink per plate instance (named after
    an opaque `instance_id`, not the shared file_id) before invoking the
    CLI, so `source_file` here is always "{instance_id}.{ext}" and
    disambiguates every instance, cloned or not.

  3D/3dmodel.model:
      <resources>
        <object id="2" type="model">
          <components>
            <component p:path="..." objectid="1" transform="1 0 0 0 1 0 0 0 1 20 5 2.5"/>
          </components>
        </object>
      </resources>
      <build>
        <item objectid="2" transform="1 0 0 0 1 0 0 0 1 80 101 0" .../>
      </build>

    `objectid` on <item> cross-references the outer <object id="..."> in
    both model_settings.config (for source_file, see above) and here.
    Each `transform` is 12 numbers: a Transform3d serialized column-major,
    3 rows x 4 columns (confirmed against _BBS_3MF_Exporter::
    add_transformation's `for c in 0..4: for r in 0..3: emit tr(r,c)`
    loop order) — [r00,r10,r20, r01,r11,r21, r02,r12,r22, tx,ty,tz]: the
    first 9 numbers are the 3x3 rotation/scale matrix in column-major
    order, the last 3 are the translation.

    CRITICAL: an object's TRUE world position/rotation is a composition
    of TWO transforms, not just the <item> transform alone — confirmed by
    direct testing (a 40x10x5mm box arranged onto the plate produced
    <component transform="1 0 0 0 1 0 0 0 1 20 5 2.5"/> together with
    <item transform="1 0 0 0 1 0 0 0 1 80 101 0"/>; the box's true world
    center is (80+20, 101+5, 0+2.5) = (100, 106, 2.5), NOT (80, 101, 0)):

      - The <component> transform (inside <object><components>) is
        OrcaSlicer's own mesh-loading step recentering each part's raw
        mesh data to its own local origin — this is ALWAYS a pure
        translation (rotation part is always identity; confirmed by
        testing --allow-rotations too), equal to roughly the object's own
        local bounding-box center.
      - The <item> transform (inside <build>) carries BOTH the arrange
        rotation AND the placement translation applied on top of that
        already-recentered mesh.

      True world position = R_item · component_translation + item_translation
      True world rotation = R_item (the item transform's own rotation is
        already the correct absolute world rotation — component never
        rotates, so no composition is needed for rotation itself, only
        for using R_item to correctly rotate the component's translation
        offset before adding it).

    Ignoring the <component> transform (an earlier version of this module
    did) silently reports a position that's off by the mesh's own
    recentering offset for any object not already centered at its local
    origin — which is effectively every real-world STL — explaining
    objects appearing shifted from where native's own arrange actually
    placed them.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from pathlib import Path
from zipfile import ZipFile


@dataclass
class ArrangedInstance:
    """One object instance's arranged placement, as computed by the CLI."""

    instance_id: str
    x: float
    y: float
    z: float
    rotation_z_deg: float


_OBJECT_SOURCE_FILE_RE = re.compile(
    r'<object id="(\d+)">.*?<metadata key="source_file" value="([^"]*)"',
    re.DOTALL,
)
_ITEM_RE = re.compile(
    r'<item objectid="(\d+)"[^>]*\btransform="([^"]*)"',
)
# Matches the OUTER <object>...<components><component transform="..."/>
# ...</object> block in 3D/3dmodel.model (NOT model_settings.config) — see
# module doc comment for why this second transform must be composed with
# the <item> transform to get an object's true world position.
_OBJECT_COMPONENT_RE = re.compile(
    r'<object id="(\d+)"[^>]*>\s*<components>\s*<component\b[^>]*\btransform="([^"]*)"',
)


def _extract_z_rotation_deg(transform_numbers: list[float]) -> float:
    """
    Given the 9-number column-major 3x3 rotation/scale block from a 3mf
    item transform (see module doc comment), return the rotation about Z
    in degrees. Arrange only ever reorients an object's footprint by
    yawing it about Z (see native's fill_config rotation candidates:
    {0, 45, 90, 135} degrees) — X/Y tilt is never introduced by arranging,
    so atan2 on the first column's X/Y components is sufficient (this is
    exactly what a pure Z-rotation matrix's first column encodes: 
    [cos(theta), sin(theta), 0]).
    """
    r00, r10 = transform_numbers[0], transform_numbers[1]
    return math.degrees(math.atan2(r10, r00))


def _apply_rotation(
    rotation_9: list[float], vec: tuple[float, float, float]
) -> tuple[float, float, float]:
    """Rotate a 3-vector by a column-major 3x3 matrix (r00,r10,r20,
    r01,r11,r21,r02,r12,r22) — i.e. compute R @ vec."""
    r00, r10, r20, r01, r11, r21, r02, r12, r22 = rotation_9
    vx, vy, vz = vec
    return (
        r00 * vx + r01 * vy + r02 * vz,
        r10 * vx + r11 * vy + r12 * vz,
        r20 * vx + r21 * vy + r22 * vz,
    )


def parse_arranged_3mf(
    threemf_path: Path, source_file_to_instance_id: dict[str, str]
) -> list[ArrangedInstance]:
    """
    Parse a 3mf produced by `orca-slicer ... --arrange=N --export-3mf
    out.3mf` (no --slice) and return each instance's arranged placement.

    Args:
        threemf_path: path to the .3mf file on disk.
        source_file_to_instance_id: maps each input file's on-disk
            basename (exactly the basename of the per-instance symlink
            path passed as a CLI argument — see routers/arrange.py) to
            the caller's opaque instance_id for that plate object. Every
            entry in the returned list has an `instance_id` looked up
            from this dict; any 3mf object whose `source_file` isn't a
            recognized key is silently skipped (defensive: should not
            happen given this module's caller always passes the exact
            same file list to the CLI, but a partial/corrupt result
            should never crash the whole arrange request over one
            unexpected entry).

    Returns:
        One ArrangedInstance per <item> in the 3mf's <build> section,
        each carrying the instance_id, bed-absolute X/Y/Z (mm) and the
        instance's Z rotation in degrees.
    """
    with ZipFile(threemf_path) as zf:
        model_settings = zf.read("Metadata/model_settings.config").decode("utf-8")
        model_3d = zf.read("3D/3dmodel.model").decode("utf-8")

    object_id_to_source_file: dict[str, str] = {}
    for match in _OBJECT_SOURCE_FILE_RE.finditer(model_settings):
        object_id, source_file = match.group(1), match.group(2)
        object_id_to_source_file[object_id] = source_file

    # Component (mesh-recentering) translation per outer object id — see
    # module doc comment for why this must be composed with each <item>'s
    # own transform to get the object's true world position.
    object_id_to_component_translation: dict[str, tuple[float, float, float]] = {}
    for match in _OBJECT_COMPONENT_RE.finditer(model_3d):
        object_id, transform_str = match.group(1), match.group(2)
        numbers = [float(n) for n in transform_str.split()]
        if len(numbers) != 12:
            continue
        object_id_to_component_translation[object_id] = (numbers[9], numbers[10], numbers[11])

    instances: list[ArrangedInstance] = []
    for match in _ITEM_RE.finditer(model_3d):
        object_id, transform_str = match.group(1), match.group(2)
        source_file = object_id_to_source_file.get(object_id)
        if source_file is None:
            continue
        instance_id = source_file_to_instance_id.get(source_file)
        if instance_id is None:
            # Also try matching by basename alone, in case the 3mf
            # normalized/stripped a path prefix somewhere along the way.
            instance_id = source_file_to_instance_id.get(Path(source_file).name)
        if instance_id is None:
            continue

        numbers = [float(n) for n in transform_str.split()]
        if len(numbers) != 12:
            continue

        rotation_9 = numbers[0:9]
        rotation_z_deg = _extract_z_rotation_deg(rotation_9)
        item_translation = (numbers[9], numbers[10], numbers[11])

        # Compose with the component's own recentering translation (see
        # module doc comment): true_position = R_item @ component_t + item_t.
        # Defaults to (0,0,0) if this object has no split-component-file
        # shape at all (e.g. a core-spec embedded-mesh 3mf, which never
        # needs this correction since there's no separate recentering
        # step in that shape).
        component_translation = object_id_to_component_translation.get(object_id, (0.0, 0.0, 0.0))
        rotated_component = _apply_rotation(rotation_9, component_translation)
        tx = item_translation[0] + rotated_component[0]
        ty = item_translation[1] + rotated_component[1]
        tz = item_translation[2] + rotated_component[2]

        instances.append(
            ArrangedInstance(instance_id=instance_id, x=tx, y=ty, z=tz, rotation_z_deg=rotation_z_deg)
        )

    return instances
