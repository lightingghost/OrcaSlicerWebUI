import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

/**
 * orientation
 *
 * "Lay on Face" and "Auto Orient" logic, modeled after OrcaSlicer's native
 * implementations:
 *   - Lay on Face: GLGizmoFlatten.cpp + Selection::flattening_rotate
 *     (src/slic3r/GUI/Gizmos/GLGizmoFlatten.cpp, src/slic3r/GUI/Selection.cpp)
 *   - Auto Orient: libslic3r/Orient.cpp's AutoOrienter + Orient.cpp's
 *     orient(ModelInstance*) (candidate-direction search over hull face
 *     normals + a fixed supplemental direction set, scored by resting
 *     contact area vs. overhang area)
 *
 * This is a deliberately simplified port of the SCORING (native's cost
 * function is a heavily-tuned empirical formula with many more terms —
 * see Orient.cpp's AutoOrienter::target_function). We replicate the two
 * dominant terms it actually optimizes: maximizing stable bed contact area
 * and minimizing overhang area needing support.
 *
 * IMPORTANT — matching native's "cancel out any existing rotation" behavior:
 * Native's orient(ModelInstance*) builds the AutoOrienter from
 * `instance->get_object()->mesh()`, which bakes in the instance's CURRENT
 * rotation (i.e. candidates are found in world space). But the winning
 * candidate is then aligned to world-up via `instance->rotate(rotation_matrix)`,
 * which composes onto the CURRENT rotation. Because the winning candidate
 * already encodes the current rotation, this composition works out to an
 * ABSOLUTE realignment: whichever of the object's own faces "wins" always
 * ends up flat on the bed, regardless of how the object was rotated
 * beforehand (see native Orient.cpp + Model.hpp's ModelInstance::rotate).
 * We replicate this exactly by computing candidates in the object's LOCAL
 * (rotation-independent) frame and then SETTING the quaternion absolutely
 * (not composing it onto the existing rotation) — algebraically equivalent
 * to native's world-space-candidate + compose approach, but avoids
 * floating-point/candidate-selection drift from repeatedly transforming
 * already-transformed geometry.
 */

const EPSILON = 1e-6;

/** Canonical supplemental directions, matching Orient.cpp's add_supplements()
 * (down, 4 diagonals-down, 4 cardinal + 4 diagonal horizontals, 4
 * diagonals-up, up) — ensures candidates exist even for meshes whose hull
 * faces don't naturally cover every useful resting direction. */
const SUPPLEMENTAL_DIRECTIONS: THREE.Vector3[] = [
  [0, 0, -1],
  [0.70710678, 0, -0.70710678],
  [0, 0.70710678, -0.70710678],
  [-0.70710678, 0, -0.70710678],
  [0, -0.70710678, -0.70710678],
  [1, 0, 0],
  [0.70710678, 0.70710678, 0],
  [0, 1, 0],
  [-0.70710678, 0.70710678, 0],
  [-1, 0, 0],
  [-0.70710678, -0.70710678, 0],
  [0, -1, 0],
  [0.70710678, -0.70710678, 0],
  [0.70710678, 0, 0.70710678],
  [0, 0.70710678, 0.70710678],
  [-0.70710678, 0, 0.70710678],
  [0, -0.70710678, 0.70710678],
  [0, 0, 1],
].map(([x, y, z]) => new THREE.Vector3(x, y, z));

/** Default overhang threshold, matching OrcaSlicer's default overhang_angle (degrees from vertical). */
export const DEFAULT_OVERHANG_ANGLE_DEG = 55;

export interface FaceCandidate {
  /** Outward face normal, in whatever frame the caller measured (local or world). */
  normal: THREE.Vector3;
  /** Centroid of the (merged coplanar) face region, in the same frame as `normal`. */
  centroid: THREE.Vector3;
  /** Area of the face region. */
  area: number;
}

/**
 * Run `fn` with the object's position and rotation temporarily zeroed
 * (scale is left untouched), then restore them afterward. Used to measure
 * / act on the object's own LOCAL geometry, independent of whatever
 * rotation it currently happens to have — this is what makes Auto Orient
 * "cancel out" any pre-existing rotation instead of compounding onto it.
 */
function withZeroedPositionAndRotation<T>(object: THREE.Object3D, fn: () => T): T {
  const savedPosition = object.position.clone();
  const savedQuaternion = object.quaternion.clone();
  object.position.set(0, 0, 0);
  object.quaternion.identity();
  object.updateMatrixWorld(true);
  try {
    return fn();
  } finally {
    object.position.copy(savedPosition);
    object.quaternion.copy(savedQuaternion);
    object.updateMatrixWorld(true);
  }
}

/**
 * Extract per-triangle normals + areas + centroids from a mesh (merging
 * all Mesh children if the loaded object is a Group), using each child's
 * CURRENT matrixWorld — so the caller controls the frame of reference by
 * choosing whether the root object's own transform is applied or zeroed
 * first (see withZeroedPositionAndRotation).
 */
function collectRawFaces(object: THREE.Object3D): FaceCandidate[] {
  object.updateMatrixWorld(true);

  const rawFaces: FaceCandidate[] = [];

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = child.geometry;
    const positionAttr = geometry.getAttribute('position');
    if (!positionAttr) return;

    const worldMatrix = child.matrixWorld;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(worldMatrix);

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const cross = new THREE.Vector3();

    const index = geometry.getIndex();
    const triangleCount = index ? index.count / 3 : positionAttr.count / 3;

    for (let i = 0; i < triangleCount; i++) {
      const i0 = index ? index.getX(i * 3) : i * 3;
      const i1 = index ? index.getX(i * 3 + 1) : i * 3 + 1;
      const i2 = index ? index.getX(i * 3 + 2) : i * 3 + 2;

      a.fromBufferAttribute(positionAttr, i0).applyMatrix4(worldMatrix);
      b.fromBufferAttribute(positionAttr, i1).applyMatrix4(worldMatrix);
      c.fromBufferAttribute(positionAttr, i2).applyMatrix4(worldMatrix);

      ab.subVectors(b, a);
      ac.subVectors(c, a);
      cross.crossVectors(ab, ac);
      const area = cross.length() * 0.5;
      if (area < EPSILON) continue;

      const normal = cross.clone().normalize().applyMatrix3(normalMatrix).normalize();
      const centroid = a.clone().add(b).add(c).multiplyScalar(1 / 3);

      rawFaces.push({ normal, centroid, area });
    }
  });

  return rawFaces;
}

/** Merge near-duplicate normals from a list of raw faces into grouped candidates. */
function groupByNormal(rawFaces: FaceCandidate[], normalTolerance = 0.01): FaceCandidate[] {
  const groups: FaceCandidate[] = [];
  for (const face of rawFaces) {
    let group = groups.find((g) => g.normal.angleTo(face.normal) < normalTolerance);
    if (!group) {
      group = { normal: face.normal.clone(), centroid: new THREE.Vector3(), area: 0 };
      groups.push(group);
    }
    const totalArea = group.area + face.area;
    if (totalArea > EPSILON) {
      group.centroid.multiplyScalar(group.area / totalArea).addScaledVector(face.centroid, face.area / totalArea);
    }
    group.area = totalArea;
  }
  return groups.sort((x, y) => y.area - x.area);
}

/**
 * Extract per-triangle world-space normals + areas from a mesh, grouped
 * into merged "face" candidates — a simplified stand-in for
 * GLGizmoFlatten's coplanar flood-fill grouping. Uses the object's
 * CURRENT world transform (i.e. includes whatever rotation it has now).
 */
export function collectFaceCandidates(object: THREE.Object3D, normalTolerance = 0.01): FaceCandidate[] {
  return groupByNormal(collectRawFaces(object), normalTolerance);
}

/** World-space vertex positions of a mesh, respecting its current transform. */
function collectWorldVertices(object: THREE.Object3D): THREE.Vector3[] {
  object.updateMatrixWorld(true);
  const points: THREE.Vector3[] = [];
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const positionAttr = child.geometry.getAttribute('position');
    if (!positionAttr) return;
    const worldMatrix = child.matrixWorld;
    for (let i = 0; i < positionAttr.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(positionAttr, i).applyMatrix4(worldMatrix);
      points.push(v);
    }
  });
  return points;
}

/**
 * Rotate the mesh so the given face normal (in world space) points
 * straight down (-Z), then drop it back onto the bed (min Z = 0).
 *
 * Matches native's Selection::flattening_rotate: rotate the current world
 * orientation by the quaternion that aligns `normal` with -Z, applied on
 * top of (premultiplied onto) the object's existing orientation. This is
 * correct here (unlike auto-orient) because `normal` comes directly from
 * a raycast hit against the object's CURRENT (already-rotated) geometry,
 * so it already reflects the current rotation — premultiplying composes
 * the additional delta needed on top of it, same as native.
 */
export function layOnFace(mesh: THREE.Object3D, worldNormal: THREE.Vector3): void {
  const down = new THREE.Vector3(0, 0, -1);
  const rotation = new THREE.Quaternion().setFromUnitVectors(worldNormal.clone().normalize(), down);
  mesh.quaternion.premultiply(rotation);
  mesh.updateMatrixWorld(true);
  dropToBed(mesh);
}

/** Translate the mesh in Z so its lowest world-space vertex touches Z=0. */
export function dropToBed(mesh: THREE.Object3D): void {
  mesh.updateMatrixWorld(true);
  // Measure transformed vertices: rotating the local bounding box can put
  // its corners below the actual surface, leaving sloped models floating.
  const box = new THREE.Box3().setFromObject(mesh, true);
  if (box.isEmpty()) return;
  const delta = -box.min.z;
  if (Math.abs(delta) > EPSILON) {
    mesh.position.z += delta;
    mesh.updateMatrixWorld(true);
  }
}

interface OrientationScore {
  direction: THREE.Vector3;
  bottomArea: number;
  overhangArea: number;
  cost: number;
}

/**
 * Score a candidate face normal `direction`: if the object were rotated so
 * this normal points straight down (matching layOnFace's convention),
 * `bottomArea` is the area of faces that would rest flat on the bed, and
 * `overhangArea` is the area of faces steeper than the overhang angle.
 * Lower cost is better (mirrors OrcaSlicer's two dominant cost terms:
 * maximize bed contact, minimize overhang).
 */
function scoreDirection(
  rawFaces: FaceCandidate[],
  direction: THREE.Vector3,
  overhangAngleDeg: number
): OrientationScore {
  const bedContactCos = Math.cos(THREE.MathUtils.degToRad(5)); // faces within ~5deg of the resting normal
  const overhangCos = Math.cos(THREE.MathUtils.degToRad(90 - overhangAngleDeg));

  let bottomArea = 0;
  let overhangArea = 0;

  for (const face of rawFaces) {
    const alignment = face.normal.dot(direction);
    if (alignment > bedContactCos) {
      bottomArea += face.area;
    } else if (alignment < overhangCos && alignment > -bedContactCos) {
      overhangArea += face.area;
    }
  }

  const cost = overhangArea / (bottomArea + 1) + (bottomArea < 1 ? 100 : 0);
  return { direction: direction.clone(), bottomArea, overhangArea, cost };
}

/**
 * Build the full candidate direction list for auto-orient: the object's
 * own grouped face normals (ranked by area), its convex hull's face
 * normals, and the fixed canonical supplemental directions — matching
 * native's AutoOrienter::preprocess()/area_cumulation_accurate()/
 * add_supplements().
 */
function buildCandidateDirections(rawFaces: FaceCandidate[], hullPoints: THREE.Vector3[]): THREE.Vector3[] {
  const candidates: THREE.Vector3[] = [];
  const pushUnique = (dir: THREE.Vector3) => {
    if (!candidates.some((existing) => existing.angleTo(dir) < 0.02)) {
      candidates.push(dir.clone().normalize());
    }
  };

  for (const face of groupByNormal(rawFaces)) pushUnique(face.normal);

  if (hullPoints.length >= 4) {
    try {
      const hullGeometry = new ConvexGeometry(hullPoints);
      const positionAttr = hullGeometry.getAttribute('position');
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      const ab = new THREE.Vector3();
      const ac = new THREE.Vector3();
      const cross = new THREE.Vector3();
      for (let i = 0; i < positionAttr.count; i += 3) {
        a.fromBufferAttribute(positionAttr, i);
        b.fromBufferAttribute(positionAttr, i + 1);
        c.fromBufferAttribute(positionAttr, i + 2);
        ab.subVectors(b, a);
        ac.subVectors(c, a);
        cross.crossVectors(ab, ac);
        if (cross.lengthSq() < EPSILON) continue;
        pushUnique(cross.normalize());
      }
    } catch {
      // ConvexGeometry throws on degenerate point sets (e.g. all coplanar
      // or too few unique points); fall back to just the mesh's own faces
      // + the fixed supplemental directions below.
    }
  }

  for (const dir of SUPPLEMENTAL_DIRECTIONS) pushUnique(dir);

  return candidates;
}

/**
 * Compute the best "auto orient" resting face for an object: search a set
 * of candidate face normals (the object's own faces, its convex hull's
 * faces, and fixed canonical directions) and pick the one minimizing
 * overhang area while maximizing stable bed contact area.
 *
 * Always computed in the object's LOCAL (rotation-independent) frame, so
 * the result — and the absolute realignment autoOrientObject performs
 * with it — is unaffected by whatever rotation the object currently has,
 * matching native OrcaSlicer's "un-rotate and lay flat" behavior.
 *
 * Returns the winning face's LOCAL outward normal (the face that should
 * end up pointing straight down, same convention as layOnFace), or null
 * if the object has no usable geometry.
 */
export function computeAutoOrientDirection(
  object: THREE.Object3D,
  overhangAngleDeg: number = DEFAULT_OVERHANG_ANGLE_DEG
): THREE.Vector3 | null {
  return withZeroedPositionAndRotation(object, () => {
    const rawFaces = collectRawFaces(object);
    if (rawFaces.length === 0) return null;

    const hullPoints = collectWorldVertices(object); // "world" == local here, since position/rotation are zeroed
    const candidateDirections = buildCandidateDirections(rawFaces, hullPoints);

    let best: OrientationScore | null = null;
    for (const direction of candidateDirections) {
      const score = scoreDirection(rawFaces, direction, overhangAngleDeg);
      if (!best || score.cost < best.cost - EPSILON) {
        best = score;
      }
    }

    return best ? best.direction : null;
  });
}

/**
 * Run auto-orient on a single mesh: find the best local resting face and
 * ABSOLUTELY set the mesh's rotation so that face's normal points down,
 * then drop back onto the bed. This intentionally REPLACES the object's
 * current rotation rather than composing onto it — an object rotated 30°
 * off-axis and then auto-oriented ends up perfectly flat on a real face,
 * exactly like native OrcaSlicer (see module docstring for why this must
 * be an absolute set, not a relative one). No-op if no usable geometry is
 * found.
 */
export function autoOrientObject(
  mesh: THREE.Object3D,
  overhangAngleDeg: number = DEFAULT_OVERHANG_ANGLE_DEG
): boolean {
  const localDownNormal = computeAutoOrientDirection(mesh, overhangAngleDeg);
  if (!localDownNormal) return false;

  const down = new THREE.Vector3(0, 0, -1);
  mesh.quaternion.setFromUnitVectors(localDownNormal.normalize(), down);
  mesh.updateMatrixWorld(true);
  dropToBed(mesh);
  return true;
}

// ---------------------------------------------------------------------------
// Lay on Face — clickable highlighted face overlays
// ---------------------------------------------------------------------------

export interface LayOnFaceRegion {
  /** The region's outward normal, in the mesh's LOCAL frame (before the mesh's own transform). */
  localNormal: THREE.Vector3;
  /** The overlay mesh rendered for this region (added as a child of the target object). */
  overlayMesh: THREE.Mesh;
}

export interface LayOnFaceOverlay {
  /** Group containing all region overlay meshes; add this as a child of the target object. */
  group: THREE.Group;
  regions: LayOnFaceRegion[];
}

const OVERLAY_COLOR = 0x5ec8bd; // light teal highlight, matching the reference screenshot
const OVERLAY_HOVER_COLOR = 0x8fe0d6;
const OVERLAY_OPACITY = 0.55;
const OVERLAY_HOVER_OPACITY = 0.85;

/**
 * Build clickable "lay flat" face overlays for an object, matching native
 * GLGizmoFlatten::update_planes(): merge the object's convex hull, group
 * its triangles by coplanar normal, and render one translucent highlight
 * mesh per group — so the user sees exactly which flat faces are
 * available to click, even on models with surface detail (carved logos,
 * small holes, etc.) that would otherwise fragment a naive per-triangle
 * grouping. Faces are computed in the object's LOCAL frame and the
 * returned group is meant to be added as a CHILD of the object, so the
 * overlays automatically track its current position/rotation/scale.
 */
export function buildLayOnFaceOverlays(object: THREE.Object3D, normalTolerance = 0.01): LayOnFaceOverlay {
  const group = new THREE.Group();
  group.name = 'LayOnFaceOverlay';
  const regions: LayOnFaceRegion[] = [];

  withZeroedPositionAndRotation(object, () => {
    const points = collectWorldVertices(object); // local frame, since transform is zeroed
    if (points.length < 4) return;

    let hullGeometry: ConvexGeometry;
    try {
      hullGeometry = new ConvexGeometry(points);
    } catch {
      return;
    }

    const positionAttr = hullGeometry.getAttribute('position');
    const triangleCount = positionAttr.count / 3;

    interface HullTriangle {
      normal: THREE.Vector3;
      vertices: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
      area: number;
    }
    const triangles: HullTriangle[] = [];
    for (let i = 0; i < triangleCount; i++) {
      const a = new THREE.Vector3().fromBufferAttribute(positionAttr, i * 3);
      const b = new THREE.Vector3().fromBufferAttribute(positionAttr, i * 3 + 1);
      const c = new THREE.Vector3().fromBufferAttribute(positionAttr, i * 3 + 2);
      const ab = b.clone().sub(a);
      const ac = c.clone().sub(a);
      const cross = ab.clone().cross(ac);
      const area = cross.length() * 0.5;
      if (area < EPSILON) continue;
      triangles.push({ normal: cross.clone().normalize(), vertices: [a, b, c], area });
    }

    // Group hull triangles by coplanar (near-duplicate) normal.
    const groups: HullTriangle[][] = [];
    const groupNormals: THREE.Vector3[] = [];
    for (const tri of triangles) {
      let idx = groupNormals.findIndex((n) => n.angleTo(tri.normal) < normalTolerance);
      if (idx === -1) {
        groupNormals.push(tri.normal.clone());
        groups.push([]);
        idx = groups.length - 1;
      }
      groups[idx].push(tri);
    }

    // Minimum area (in mm^2) for a region to be worth showing, matching
    // native's minimal_area filter (avoids highlighting tiny hull facets).
    const MIN_REGION_AREA = 4;
    const OUTWARD_OFFSET = 0.05; // raise slightly above the surface to avoid z-fighting

    groups.forEach((group_, idx) => {
      const totalArea = group_.reduce((sum, t) => sum + t.area, 0);
      if (totalArea < MIN_REGION_AREA) return;

      const normal = groupNormals[idx].clone().normalize();
      const geometry = new THREE.BufferGeometry();
      const positions: number[] = [];
      for (const tri of group_) {
        for (const v of tri.vertices) {
          const offset = v.clone().addScaledVector(normal, OUTWARD_OFFSET);
          positions.push(offset.x, offset.y, offset.z);
        }
      }
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();

      const material = new THREE.MeshBasicMaterial({
        color: OVERLAY_COLOR,
        transparent: true,
        opacity: OVERLAY_OPACITY,
        depthTest: true,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const overlayMesh = new THREE.Mesh(geometry, material);
      overlayMesh.userData.layOnFaceNormal = normal.clone();
      group.add(overlayMesh);
      regions.push({ localNormal: normal, overlayMesh });
    });
  });

  return { group, regions };
}

/** Apply (or clear) the hover highlight for a Lay on Face region. Pass `null` to clear. */
export function applyLayOnFaceHover(overlay: LayOnFaceOverlay, hoveredMesh: THREE.Mesh | null): void {
  for (const region of overlay.regions) {
    const material = region.overlayMesh.material as THREE.MeshBasicMaterial;
    const isHovered = region.overlayMesh === hoveredMesh;
    material.color.setHex(isHovered ? OVERLAY_HOVER_COLOR : OVERLAY_COLOR);
    material.opacity = isHovered ? OVERLAY_HOVER_OPACITY : OVERLAY_OPACITY;
  }
}

/** Dispose all overlay mesh geometries/materials (call when removing the overlay from the scene). */
export function disposeLayOnFaceOverlay(overlay: LayOnFaceOverlay): void {
  for (const region of overlay.regions) {
    region.overlayMesh.geometry.dispose();
    (region.overlayMesh.material as THREE.Material).dispose();
  }
}
