"""
Minimal 3mf (3D Manufacturing Format) reader/writer for "Project" support.

A .3mf file is an OPC (Open Packaging Conventions) zip package. This
module only implements the small subset of the format needed to round-trip
a flat list of triangle meshes + per-instance placement (position/rotation)
between this app's "project" concept (a set of uploaded STL files, each
with a live position/rotation in the Prepare-tab viewport) and a single
.3mf file a user can download and later re-import, or open in native
OrcaSlicer.

Written packages use the CORE 3mf spec's plain embedded-mesh form
(`<object><mesh><vertices>/<triangles></mesh></object>`), NOT the
BambuStudio/OrcaSlicer-specific split-into-component-files form seen in
CLI-exported 3mfs (see arrange_3mf.py's doc comment for that format) —
both are valid 3mf, but embedding the mesh directly keeps the writer
self-contained (no per-object secondary part files/rels needed) while
still being readable by native OrcaSlicer, standard 3mf viewers, and this
module's own reader.

Format details (confirmed against the 3mf core spec and cross-checked
against a real OrcaSlicer-CLI-produced 3mf — see arrange_3mf.py):

  [Content_Types].xml   — declares the "model" and "rels" content types.
  _rels/.rels           — package-level relationship pointing at the root model part.
  3D/3dmodel.model       — <model><resources><object id=".."><mesh>...</mesh></object>...
                           </resources><build><item objectid=".." transform="..."/>...
                           </build></model>

  `transform` on a <build><item> is 12 numbers: a 3x4 matrix serialized
  COLUMN-major (rotation/scale 3x3 block first, then translation) — i.e.
  [r00,r10,r20, r01,r11,r21, r02,r12,r22, tx,ty,tz]. This matches
  OrcaSlicer's own _BBS_3MF_Exporter::add_transformation loop order
  (`for c in 0..4: for r in 0..3: emit tr(r,c)`), confirmed directly
  against a real CLI-produced 3mf in arrange_3mf.py — reusing the exact
  same convention here means positions/rotations round-trip correctly
  whether the file was written by this module or by OrcaSlicer itself.

  Rotation is carried as a full quaternion (not just a Z angle) since a
  plate object may have ANY orientation (manual rotate, Lay on Face, Auto
  Orient) — see ProjectObject's own doc comment for why this differs from
  arrange_3mf.py's Z-only rotation.
"""

from __future__ import annotations

import math
import re
import struct
from dataclasses import dataclass, field
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

CONTENT_TYPES_XML = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
    ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
    ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n'
    '</Types>\n'
)

ROOT_RELS_XML = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
    ' <Relationship Target="/3D/3dmodel.model" Id="rel-1"'
    ' Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n'
    '</Relationships>\n'
)


@dataclass
class MeshData:
    """A single object's raw triangle mesh, in its own local coordinates
    (i.e. NOT yet placed on the bed — placement is `transform`)."""

    vertices: list[tuple[float, float, float]]
    triangles: list[tuple[int, int, int]]


@dataclass
class ProjectObject:
    """One plate object: its mesh plus its placement transform.

    Rotation is a full quaternion (x, y, z, w), NOT just a Z angle —
    unlike routers/arrange.py's ArrangedInstanceModel (which only ever
    needs a Z yaw, since native's arrange algorithm only ever reorients
    an object's footprint about Z), a plate object here may have ANY
    orientation: manual X/Y/Z rotation via the Move/Rotate/Scale tool,
    "Lay on Face", or Auto Orient can all tilt an object arbitrarily.
    Losing that on export/re-import would silently corrupt the user's
    work, so the full orientation is carried through instead of being
    reduced to a single angle. Matches THREE.js's own quaternion
    component order/convention (see ThreeViewport, which reads
    `object.quaternion` directly), so the frontend never needs to convert.
    """

    name: str
    mesh: MeshData
    # Bed-absolute position in mm. Z defaults to 0 (resting on the bed)
    # since this app's viewport always keeps objects' bounding box resting
    # at Z=0 (see modelLoader.ts's loadModel) unless manually moved.
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    qx: float = 0.0
    qy: float = 0.0
    qz: float = 0.0
    qw: float = 1.0
    # Per-axis scale (THREE.js Object3D.scale convention: multiplies the
    # LOCAL axis before rotation, i.e. the transform matrix's rotation
    # columns are each scaled by the respective scale component — see
    # _quaternion_scale_to_matrix_columns below). Defaults to 1,1,1
    # (unscaled), matching every object's default state on import.
    sx: float = 1.0
    sy: float = 1.0
    sz: float = 1.0
    # Per-object print (process) config overrides — e.g. {"brim_type":
    # "outer_brim_only", "brim_width": "5"}. Every value is ALREADY the
    # native CLI's own string-serialized form (matching
    # ModelConfig::opt_serialize's output, e.g. "1"/"0" for booleans,
    # plain decimal for numbers), since that's exactly what native
    # OrcaSlicer itself writes into Metadata/model_settings.config (see
    # this module's write_3mf, which emits these 1:1 as
    # <metadata key="..." value="..."/> inside this object's <object>
    # block — see bbs_3mf.cpp's _add_model_config_file_to_archive/
    # _handle_start_config_metadata, which is the exact mechanism native
    # OrcaSlicer itself uses to read a per-object config override back
    # into `ModelObject::config` via `config.set_deserialize(key, value,
    # ...)`). Empty dict (the default) means this object has no
    # overrides of its own and fully inherits the plate-wide process
    # profile/CLI parameter_overrides — matching this app's
    # objectOverrides Global/Objects inheritance semantics.
    config_overrides: dict[str, str] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# STL parsing (binary + ASCII) — used to build a ProjectObject's MeshData
# from an uploaded file's on-disk bytes before writing a 3mf.
# ---------------------------------------------------------------------------

def parse_stl_bytes(data: bytes) -> MeshData:
    """
    Parse an STL file's bytes (binary or ASCII) into deduplicated
    vertices + triangle index tuples.

    STL itself stores every triangle as 3 independent, unindexed vertices
    (no sharing) — a 3mf mesh is expected to be indexed, so this
    deduplicates identical vertex positions via a dict keyed by the exact
    float triple. This is the same tradeoff any STL-to-indexed-mesh
    converter makes; exact float equality is fine here since the vertices
    being deduplicated are literal byte-for-byte repeats from the STL
    itself (each shared vertex is written out identically by every
    triangle that touches it), not independently-computed values that
    could differ by floating-point rounding.
    """
    if _looks_like_binary_stl(data):
        return _parse_binary_stl(data)
    return _parse_ascii_stl(data)


def _looks_like_binary_stl(data: bytes) -> bool:
    """
    STL has no magic number — ASCII STL always starts with "solid" (after
    optional leading whitespace), but a binary STL's 80-byte header can
    ALSO happen to start with those bytes (some binary STL exporters
    literally write "solid" as decoration in the free-form header,
    precisely to look valid at a glance). The robust check used by every
    real STL parser: an ASCII STL always contains a literal "facet
    normal" token; check for that in the first chunk after the header
    boundary instead of trusting the leading bytes alone. Falls back to
    size-based validation (real binary STLs have an exact byte count:
    80 + 4 + 50*N) which further disambiguates the rare pathological case.
    """
    if len(data) < 84:
        return False
    header_and_beyond = data[:512]
    if b"solid" not in header_and_beyond[:6].lower().strip() and not header_and_beyond.lstrip().lower().startswith(b"solid"):
        return True
    # Looks like it starts with "solid" — but check whether the binary
    # triangle-count-implied size matches the actual file size, which
    # ASCII STLs (text, not a fixed record size) will essentially never
    # coincidentally satisfy.
    triangle_count = struct.unpack("<I", data[80:84])[0]
    expected_size = 80 + 4 + triangle_count * 50
    if expected_size == len(data):
        return True
    return b"facet normal" not in data[:2048]


def _parse_binary_stl(data: bytes) -> MeshData:
    triangle_count = struct.unpack("<I", data[80:84])[0]
    offset = 84
    vertex_to_index: dict[tuple[float, float, float], int] = {}
    vertices: list[tuple[float, float, float]] = []
    triangles: list[tuple[int, int, int]] = []

    for _ in range(triangle_count):
        # Each record: 12 floats (normal + 3 vertices) + 2-byte attribute.
        record = struct.unpack("<12fH", data[offset:offset + 50])
        offset += 50
        tri_indices = []
        for v in range(3):
            vx, vy, vz = record[3 + v * 3], record[4 + v * 3], record[5 + v * 3]
            key = (vx, vy, vz)
            idx = vertex_to_index.get(key)
            if idx is None:
                idx = len(vertices)
                vertices.append(key)
                vertex_to_index[key] = idx
            tri_indices.append(idx)
        triangles.append((tri_indices[0], tri_indices[1], tri_indices[2]))

    return MeshData(vertices=vertices, triangles=triangles)


_ASCII_VERTEX_RE = re.compile(
    r"vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)"
)


def _parse_ascii_stl(data: bytes) -> MeshData:
    text = data.decode("utf-8", errors="replace")
    vertex_to_index: dict[tuple[float, float, float], int] = {}
    vertices: list[tuple[float, float, float]] = []
    triangles: list[tuple[int, int, int]] = []

    current: list[int] = []
    for match in _ASCII_VERTEX_RE.finditer(text):
        vx, vy, vz = float(match.group(1)), float(match.group(2)), float(match.group(3))
        key = (vx, vy, vz)
        idx = vertex_to_index.get(key)
        if idx is None:
            idx = len(vertices)
            vertices.append(key)
            vertex_to_index[key] = idx
        current.append(idx)
        if len(current) == 3:
            triangles.append((current[0], current[1], current[2]))
            current = []

    if not vertices:
        raise ValueError("ASCII STL contains no vertices")

    return MeshData(vertices=vertices, triangles=triangles)


def write_stl_bytes(mesh: MeshData, solid_name: str = "object") -> bytes:
    """Serialize a MeshData back to binary STL (used when a 3mf's imported
    object needs to be re-registered as a plain uploaded file — see
    routers/projects.py's import endpoint)."""
    header = solid_name.encode("ascii", errors="replace")[:80].ljust(80, b"\x00")
    out = bytearray(header)
    out += struct.pack("<I", len(mesh.triangles))
    for i0, i1, i2 in mesh.triangles:
        v0, v1, v2 = mesh.vertices[i0], mesh.vertices[i1], mesh.vertices[i2]
        normal = _triangle_normal(v0, v1, v2)
        out += struct.pack("<12fH", *normal, *v0, *v1, *v2, 0)
    return bytes(out)


def _triangle_normal(
    v0: tuple[float, float, float], v1: tuple[float, float, float], v2: tuple[float, float, float]
) -> tuple[float, float, float]:
    ux, uy, uz = v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]
    vx, vy, vz = v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    length = math.sqrt(nx * nx + ny * ny + nz * nz)
    if length == 0:
        return (0.0, 0.0, 0.0)
    return (nx / length, ny / length, nz / length)


# ---------------------------------------------------------------------------
# 3mf writing
# ---------------------------------------------------------------------------

def _quaternion_scale_to_matrix_columns(
    qx: float, qy: float, qz: float, qw: float, sx: float, sy: float, sz: float
) -> tuple[float, float, float, float, float, float, float, float, float]:
    """
    quaternion + per-axis scale -> 3x3 matrix, returned column-major
    (r00,r10,r20, r01,r11,r21, r02,r12,r22) to match the transform
    serialization convention documented at the top of this module. Same
    composition order THREE.js's own Matrix4.compose uses (build the pure
    rotation basis, then scale each COLUMN by the corresponding local
    axis's scale factor — i.e. M = R * diag(sx,sy,sz)), so an
    Object3D's position/quaternion/scale round-trips exactly.
    """
    x2, y2, z2 = qx + qx, qy + qy, qz + qz
    xx, xy, xz = qx * x2, qx * y2, qx * z2
    yy, yz, zz = qy * y2, qy * z2, qz * z2
    wx, wy, wz = qw * x2, qw * y2, qw * z2

    r00 = (1 - (yy + zz)) * sx
    r10 = (xy + wz) * sx
    r20 = (xz - wy) * sx
    r01 = (xy - wz) * sy
    r11 = (1 - (xx + zz)) * sy
    r21 = (yz + wx) * sy
    r02 = (xz + wy) * sz
    r12 = (yz - wx) * sz
    r22 = (1 - (xx + yy)) * sz
    return (r00, r10, r20, r01, r11, r21, r02, r12, r22)


def _format_float(value: float) -> str:
    # Avoid scientific notation / excessive precision noise in the XML —
    # matches the plain decimal style real 3mf writers use.
    return repr(round(value, 6))


def write_3mf(objects: list[ProjectObject]) -> bytes:
    """
    Build a minimal, valid 3mf package (as bytes) from a flat list of
    plate objects. Each object's mesh is embedded directly (core-spec
    form, no split component files) and placed via a <build><item>
    transform matching this module's documented column-major convention.

    Any object with a non-empty `config_overrides` also gets a
    Metadata/model_settings.config part written alongside the core
    model, one <object id="N"><metadata key=.. value=../>...</object>
    block per such object (id matching the <object> in 3D/3dmodel.model —
    see ProjectObject.config_overrides's doc comment for exactly why this
    format/path was chosen: it's the real format+part name native
    OrcaSlicer's own CLI reads back into ModelObject::config, discovered
    directly from bbs_3mf.cpp). Objects with no overrides are simply
    omitted from that file — native OrcaSlicer only requires it to be
    present at all if at least one object has model-settings data to
    carry, and omitting objects entirely from it is exactly how "no
    override, inherit everything from the process profile" is expressed.
    """
    resources_xml_parts: list[str] = []
    build_xml_parts: list[str] = []
    model_config_object_parts: list[str] = []

    for object_id, obj in enumerate(objects, start=1):
        vertices_xml = "".join(
            f'<vertex x="{_format_float(v[0])}" y="{_format_float(v[1])}" z="{_format_float(v[2])}"/>'
            for v in obj.mesh.vertices
        )
        triangles_xml = "".join(
            f'<triangle v1="{t[0]}" v2="{t[1]}" v3="{t[2]}"/>' for t in obj.mesh.triangles
        )
        resources_xml_parts.append(
            f'<object id="{object_id}" type="model" name="{_xml_escape(obj.name)}">'
            f"<mesh><vertices>{vertices_xml}</vertices>"
            f"<triangles>{triangles_xml}</triangles></mesh></object>"
        )

        r00, r10, r20, r01, r11, r21, r02, r12, r22 = _quaternion_scale_to_matrix_columns(
            obj.qx, obj.qy, obj.qz, obj.qw, obj.sx, obj.sy, obj.sz
        )
        transform = " ".join(
            _format_float(n)
            for n in (r00, r10, r20, r01, r11, r21, r02, r12, r22, obj.x, obj.y, obj.z)
        )
        build_xml_parts.append(f'<item objectid="{object_id}" transform="{transform}"/>')

        if obj.config_overrides:
            # Native OrcaSlicer's own importer sets ModelObject::name FROM
            # this file's "name" metadata key whenever an <object> block
            # is present at all (see bbs_3mf.cpp's model-settings-config
            # apply loop: `if (metadata.key == "name") model_object->name
            # = metadata.value;`), rather than falling back to the
            # <object name="..."> attribute already in 3D/3dmodel.model.
            # Omitting it here would silently blank out this object's
            # name in the CLI's own internal model (confirmed directly:
            # without this, sliced gcode's "; printing object <name>"
            # comment loses the name for exactly the objects that carry
            # a config override) — so it must always be included
            # alongside the actual overrides, matching native's own
            # writer, which unconditionally emits it whenever non-empty.
            metadata_xml = f'<metadata key="name" value="{_xml_escape(obj.name)}"/>'
            metadata_xml += "".join(
                f'<metadata key="{_xml_escape(key)}" value="{_xml_escape(str(value))}"/>'
                for key, value in obj.config_overrides.items()
            )
            model_config_object_parts.append(
                f'<object id="{object_id}">{metadata_xml}</object>'
            )

    model_xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<model unit="millimeter" xml:lang="en-US" '
        'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n'
        f" <resources>{''.join(resources_xml_parts)}</resources>\n"
        f" <build>{''.join(build_xml_parts)}</build>\n"
        "</model>\n"
    )

    files = {
        "[Content_Types].xml": CONTENT_TYPES_XML,
        "_rels/.rels": ROOT_RELS_XML,
        "3D/3dmodel.model": model_xml,
    }

    if model_config_object_parts:
        files["Metadata/model_settings.config"] = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            f"<config>{''.join(model_config_object_parts)}</config>\n"
        )

    return _build_zip(files)


def _xml_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _build_zip(files: dict[str, str]) -> bytes:
    import io

    buffer = io.BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as zf:
        for name, content in files.items():
            zf.writestr(name, content.encode("utf-8"))
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# 3mf reading
# ---------------------------------------------------------------------------

@dataclass
class ParsedProjectObject:
    name: str
    mesh: MeshData
    x: float
    y: float
    z: float
    qx: float
    qy: float
    qz: float
    qw: float
    sx: float
    sy: float
    sz: float


_VERTEX_TAG_RE = re.compile(r'<vertex\s+x="([^"]*)"\s+y="([^"]*)"\s+z="([^"]*)"')
_TRIANGLE_TAG_RE = re.compile(r'<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"')
_OBJECT_TAG_RE = re.compile(r'<object\s+([^>]*)>(.*?)</object>', re.DOTALL)
_OBJECT_ID_ATTR_RE = re.compile(r'\bid="(\d+)"')
_OBJECT_NAME_ATTR_RE = re.compile(r'\bname="([^"]*)"')
_COMPONENT_TAG_RE = re.compile(r'<component\s+[^>]*\bp:path="([^"]*)"[^>]*\bobjectid="(\d+)"')
_ITEM_TAG_RE = re.compile(r'<item\s+objectid="(\d+)"[^>]*\btransform="([^"]*)"')


def _matrix_columns_to_scale(
    nine_numbers: list[float],
) -> tuple[float, float, float]:
    """Each column's length is that axis's scale factor — same
    decomposition THREE.js's Matrix4.decompose uses."""
    r00, r10, r20, r01, r11, r21, r02, r12, r22 = nine_numbers
    sx = math.sqrt(r00 * r00 + r10 * r10 + r20 * r20)
    sy = math.sqrt(r01 * r01 + r11 * r11 + r21 * r21)
    sz = math.sqrt(r02 * r02 + r12 * r12 + r22 * r22)
    return (sx or 1.0, sy or 1.0, sz or 1.0)


def _matrix_columns_to_quaternion(
    nine_numbers: list[float],
) -> tuple[float, float, float, float]:
    """
    Inverse of _quaternion_scale_to_matrix_columns's rotation component:
    standard 3x3 rotation matrix (given column-major, per this module's
    transform convention) -> quaternion, using the standard "largest
    diagonal term" numerically stable extraction (same algorithm THREE.js's
    Quaternion.setFromRotationMatrix uses), so a matrix read from any 3mf
    (this module's own writer, native OrcaSlicer's CLI, or another
    compliant tool) round-trips back into a THREE.js-compatible
    quaternion. Callers must first normalize out any scale (divide each
    column by its own length, from _matrix_columns_to_scale) before
    calling this, or a scaled object's extracted quaternion will be
    wrong.
    """
    r00, r10, r20, r01, r11, r21, r02, r12, r22 = nine_numbers
    trace = r00 + r11 + r22

    if trace > 0:
        s = 0.5 / math.sqrt(trace + 1.0)
        qw = 0.25 / s
        qx = (r21 - r12) * s
        qy = (r02 - r20) * s
        qz = (r10 - r01) * s
    elif r00 > r11 and r00 > r22:
        s = 2.0 * math.sqrt(1.0 + r00 - r11 - r22)
        qw = (r21 - r12) / s
        qx = 0.25 * s
        qy = (r01 + r10) / s
        qz = (r02 + r20) / s
    elif r11 > r22:
        s = 2.0 * math.sqrt(1.0 + r11 - r00 - r22)
        qw = (r02 - r20) / s
        qx = (r01 + r10) / s
        qy = 0.25 * s
        qz = (r12 + r21) / s
    else:
        s = 2.0 * math.sqrt(1.0 + r22 - r00 - r11)
        qw = (r10 - r01) / s
        qx = (r02 + r20) / s
        qy = (r12 + r21) / s
        qz = 0.25 * s

    return (qx, qy, qz, qw)


def parse_3mf_objects(path: Path) -> list[ParsedProjectObject]:
    """
    Parse a .3mf file's objects + their build-time placement.

    Supports BOTH 3mf shapes this app may encounter:
      1. Core-spec embedded mesh (written by write_3mf above, or any
         generic/standard 3mf exporter): <object><mesh>...</mesh></object>.
      2. OrcaSlicer/BambuStudio's split-into-component-files shape (a real
         3mf downloaded from native OrcaSlicer, or produced by this
         backend's own CLI invocations — see arrange_3mf.py's doc
         comment): <object><components><component p:path="..."
         objectid="..."/></components></object>, with the actual mesh
         living in a separate part file referenced by that path.

    Returns one ParsedProjectObject per <build><item>, in build order —
    matching arrange_3mf.py's established pattern of iterating <item>
    elements (each item is one PLATE INSTANCE, which is what this app's
    "project objects" concept actually maps to; a single <object> COULD
    theoretically be referenced by multiple <item>s for repeated
    instances, though this module's own writer never produces that).
    """
    with ZipFile(path) as zf:
        model_xml = zf.read("3D/3dmodel.model").decode("utf-8")

        # Map each top-level <object id> to either its own embedded mesh,
        # or (for the split-file shape) the objectid + part path of its
        # referenced component, resolved recursively below.
        object_meshes: dict[str, MeshData] = {}
        object_names: dict[str, str] = {}
        object_component_refs: dict[str, tuple[str, str]] = {}  # id -> (part_path, inner_objectid)

        for match in _OBJECT_TAG_RE.finditer(model_xml):
            attrs_str, body = match.group(1), match.group(2)
            id_match = _OBJECT_ID_ATTR_RE.search(attrs_str)
            if not id_match:
                continue
            object_id = id_match.group(1)
            name_match = _OBJECT_NAME_ATTR_RE.search(attrs_str)
            object_names[object_id] = name_match.group(1) if name_match else f"object_{object_id}"

            component_match = _COMPONENT_TAG_RE.search(body)
            if component_match:
                part_path, inner_objectid = component_match.group(1), component_match.group(2)
                object_component_refs[object_id] = (part_path, inner_objectid)
                continue

            vertices = [
                (float(v[0]), float(v[1]), float(v[2]))
                for v in _VERTEX_TAG_RE.findall(body)
            ]
            triangles = [
                (int(t[0]), int(t[1]), int(t[2])) for t in _TRIANGLE_TAG_RE.findall(body)
            ]
            if vertices and triangles:
                object_meshes[object_id] = MeshData(vertices=vertices, triangles=triangles)

        def resolve_mesh(object_id: str) -> MeshData | None:
            if object_id in object_meshes:
                return object_meshes[object_id]
            ref = object_component_refs.get(object_id)
            if ref is None:
                return None
            part_path, inner_objectid = ref
            part_zip_path = part_path.lstrip("/")
            try:
                part_xml = zf.read(part_zip_path).decode("utf-8")
            except KeyError:
                return None
            part_match = re.search(
                rf'<object\s+id="{re.escape(inner_objectid)}"[^>]*>(.*?)</object>',
                part_xml,
                re.DOTALL,
            )
            if not part_match:
                return None
            body = part_match.group(1)
            vertices = [
                (float(v[0]), float(v[1]), float(v[2]))
                for v in _VERTEX_TAG_RE.findall(body)
            ]
            triangles = [
                (int(t[0]), int(t[1]), int(t[2])) for t in _TRIANGLE_TAG_RE.findall(body)
            ]
            if not vertices or not triangles:
                return None
            mesh = MeshData(vertices=vertices, triangles=triangles)
            object_meshes[object_id] = mesh
            return mesh

        results: list[ParsedProjectObject] = []
        for match in _ITEM_TAG_RE.finditer(model_xml):
            object_id, transform_str = match.group(1), match.group(2)
            mesh = resolve_mesh(object_id)
            if mesh is None:
                continue
            numbers = [float(n) for n in transform_str.split()]
            if len(numbers) != 12:
                continue
            nine = numbers[0:9]
            sx, sy, sz = _matrix_columns_to_scale(nine)
            # Normalize out scale before extracting the quaternion — the
            # quaternion-extraction formula assumes a pure (unscaled)
            # rotation matrix; skipping this would produce a wrong
            # quaternion for any object with non-1.0 scale (see
            # _matrix_columns_to_quaternion's doc comment).
            normalized_nine = [
                nine[0] / sx, nine[1] / sx, nine[2] / sx,
                nine[3] / sy, nine[4] / sy, nine[5] / sy,
                nine[6] / sz, nine[7] / sz, nine[8] / sz,
            ]
            qx, qy, qz, qw = _matrix_columns_to_quaternion(normalized_nine)
            tx, ty, tz = numbers[9], numbers[10], numbers[11]
            results.append(
                ParsedProjectObject(
                    name=object_names.get(object_id, f"object_{object_id}"),
                    mesh=mesh,
                    x=tx,
                    y=ty,
                    z=tz,
                    qx=qx,
                    qy=qy,
                    qz=qz,
                    qw=qw,
                    sx=sx,
                    sy=sy,
                    sz=sz,
                )
            )

        return results
