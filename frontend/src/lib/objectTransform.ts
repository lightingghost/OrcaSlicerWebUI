import * as THREE from 'three';

/**
 * objectTransform
 *
 * Pure THREE.Object3D transform math backing the Move/Rotate/Scale object
 * manipulation panel (see ObjectManipulationPanel.tsx), modeled after
 * OrcaSlicer's native GizmoObjectManipulation panel
 * (OrcaSlicer/src/slic3r/GUI/Gizmos/GizmoObjectManipulation.cpp).
 *
 * This app has a simpler scene graph than the native app (one mesh per
 * imported object; no separate ModelInstance/ModelVolume nesting), so the
 * native "World / Object(Instance) / Part(Local)" three-way coordinate
 * switch collapses to two meaningful modes here:
 *
 *   - 'world':  values are the object's transform expressed directly in
 *               world space (mesh.position, world-aligned bounding box).
 *   - 'object': values are expressed relative to the object's OWN rotated
 *               axes — Position is always shown as (0,0,0) (an object is
 *               always at the origin of its own frame; editing it moves
 *               the object along its own local axes by that delta, exactly
 *               like native's Instance-coordinates Position field), and
 *               Size/Scale reflect the object's un-rotated local bounding
 *               box instead of the (rotation-dependent) world AABB.
 *
 * Native reference behavior this mirrors:
 *  - Transformation composition order: translate * rotateX * rotateY *
 *    rotateZ * scale (Geometry::assemble_transform in libslic3r/Geometry.cpp).
 *  - World-mode scale % = worldSize / unscaledLocalSize * 100
 *    (GizmoObjectManipulation::update_settings_value, is_world_coordinates branch).
 *  - Object-mode scale % = mesh.scale * 100 (local, rotation-independent).
 *  - Scale/Size edits are ratio-based relative to the currently displayed
 *    value (change_scale_value / change_size_value), not a closed-form
 *    solve — this app follows the same approach for consistency.
 */

export type CoordinateMode = 'world' | 'object';
export type Axis = 0 | 1 | 2;

export interface ObjectTransformSnapshot {
  /** mm. World mode: absolute world position. Object mode: always (0,0,0). */
  position: [number, number, number];
  /** degrees. Always (0,0,0) — an incremental accumulator, not a stored state. */
  rotationRelative: [number, number, number];
  /** degrees. Absolute orientation, Euler XYZ extracted from the mesh's quaternion. */
  rotationAbsolute: [number, number, number];
  /** percent, 100 = original imported size. */
  scale: [number, number, number];
  /** mm. World mode: world-aligned AABB size. Object mode: local (un-rotated) size. */
  size: [number, number, number];
}

const AXIS_UNIT_VECTORS: THREE.Vector3[] = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
];

/**
 * Run `fn` with the mesh's position and rotation temporarily zeroed (scale
 * is left untouched), then restore the original position/rotation
 * afterward. Used to measure the mesh's bounding box in its own local
 * frame without needing to separately track/cache an "unrotated" copy of
 * the geometry.
 */
function withZeroedPositionAndRotation<T>(mesh: THREE.Object3D, fn: () => T): T {
  const savedPosition = mesh.position.clone();
  const savedQuaternion = mesh.quaternion.clone();
  mesh.position.set(0, 0, 0);
  mesh.quaternion.identity();
  mesh.updateMatrixWorld(true);
  try {
    return fn();
  } finally {
    mesh.position.copy(savedPosition);
    mesh.quaternion.copy(savedQuaternion);
    mesh.updateMatrixWorld(true);
  }
}

/** Bounding box size in the mesh's own local frame (rotation/position removed, current scale kept). */
export function getLocalBoundingBoxSize(mesh: THREE.Object3D): THREE.Vector3 {
  return withZeroedPositionAndRotation(mesh, () => {
    const box = new THREE.Box3().setFromObject(mesh);
    return box.getSize(new THREE.Vector3());
  });
}

/** Bounding box size in the mesh's own local frame, ignoring scale too (the "original imported size"). */
export function getUnscaledLocalBoundingBoxSize(mesh: THREE.Object3D): THREE.Vector3 {
  const savedScale = mesh.scale.clone();
  mesh.scale.set(1, 1, 1);
  const size = getLocalBoundingBoxSize(mesh);
  mesh.scale.copy(savedScale);
  mesh.updateMatrixWorld(true);
  return size;
}

/** World-aligned bounding box size of the mesh as currently positioned/rotated/scaled. */
export function getWorldBoundingBoxSize(mesh: THREE.Object3D): THREE.Vector3 {
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  return box.getSize(new THREE.Vector3());
}

/** Absolute orientation as Euler XYZ degrees, extracted from the mesh's quaternion. */
export function getAbsoluteRotationDegrees(mesh: THREE.Object3D): THREE.Vector3 {
  const euler = new THREE.Euler().setFromQuaternion(mesh.quaternion, 'XYZ');
  return new THREE.Vector3(
    THREE.MathUtils.radToDeg(euler.x),
    THREE.MathUtils.radToDeg(euler.y),
    THREE.MathUtils.radToDeg(euler.z)
  );
}

/**
 * Compute the full Position/Rotation/Scale/Size snapshot for a mesh in the
 * given coordinate mode. This is what the manipulation panel displays.
 */
export function computeObjectTransformSnapshot(
  mesh: THREE.Object3D,
  mode: CoordinateMode
): ObjectTransformSnapshot {
  const unscaledSize = getUnscaledLocalBoundingBoxSize(mesh);
  const rotationAbsolute = getAbsoluteRotationDegrees(mesh);

  let position: THREE.Vector3;
  let size: THREE.Vector3;
  let scale: THREE.Vector3;

  if (mode === 'world') {
    position = mesh.position.clone();
    size = getWorldBoundingBoxSize(mesh);
    scale = new THREE.Vector3(
      unscaledSize.x > 1e-9 ? (size.x / unscaledSize.x) * 100 : 100,
      unscaledSize.y > 1e-9 ? (size.y / unscaledSize.y) * 100 : 100,
      unscaledSize.z > 1e-9 ? (size.z / unscaledSize.z) * 100 : 100
    );
  } else {
    // Object mode: an object is always at the origin of its own frame.
    position = new THREE.Vector3(0, 0, 0);
    size = getLocalBoundingBoxSize(mesh);
    scale = new THREE.Vector3(mesh.scale.x * 100, mesh.scale.y * 100, mesh.scale.z * 100);
  }

  return {
    position: [position.x, position.y, position.z],
    rotationRelative: [0, 0, 0],
    rotationAbsolute: [rotationAbsolute.x, rotationAbsolute.y, rotationAbsolute.z],
    scale: [scale.x, scale.y, scale.z],
    size: [size.x, size.y, size.z],
  };
}

/**
 * Apply a Position field edit. In 'world' mode, `newValue` is the new
 * absolute world coordinate for that axis. In 'object' mode the displayed
 * baseline is always 0, so `newValue` is a delta applied along the
 * object's own (rotated) local axis — matching native's Instance
 * Position field ("Relative"), which translates along the instance's own
 * rotated axes (Selection::translate's `inst_trafo.get_rotation_matrix() *
 * displacement`).
 */
export function applyPositionChange(
  mesh: THREE.Object3D,
  axis: Axis,
  newValue: number,
  mode: CoordinateMode
): void {
  if (mode === 'world') {
    mesh.position.setComponent(axis, newValue);
  } else {
    const localAxisWorld = AXIS_UNIT_VECTORS[axis].clone().applyQuaternion(mesh.quaternion);
    mesh.position.addScaledVector(localAxisWorld, newValue);
  }
  mesh.updateMatrixWorld(true);
}

/**
 * Apply an incremental ("relative") rotation of `deltaDegrees` around the
 * given axis. In 'world' mode the rotation is composed around the fixed
 * world X/Y/Z axes (premultiply); in 'object' mode it's composed around
 * the object's own current local axes (postmultiply — equivalent to
 * THREE.Object3D.rotateX/Y/Z).
 */
export function applyRotationRelative(
  mesh: THREE.Object3D,
  axis: Axis,
  deltaDegrees: number,
  mode: CoordinateMode
): void {
  const rad = THREE.MathUtils.degToRad(deltaDegrees);
  const deltaQuat = new THREE.Quaternion().setFromAxisAngle(AXIS_UNIT_VECTORS[axis], rad);
  if (mode === 'world') {
    mesh.quaternion.premultiply(deltaQuat);
  } else {
    mesh.quaternion.multiply(deltaQuat);
  }
  mesh.updateMatrixWorld(true);
}

/**
 * Apply an "absolute" rotation: set the given Euler axis to `newDegrees`
 * directly, keeping the other two axes at their current absolute values.
 * Same behavior regardless of coordinate mode, since this app has no
 * separate instance/volume transform levels for the distinction to affect.
 */
export function applyRotationAbsolute(mesh: THREE.Object3D, axis: Axis, newDegrees: number): void {
  const current = getAbsoluteRotationDegrees(mesh);
  const next: [number, number, number] = [current.x, current.y, current.z];
  next[axis] = newDegrees;
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(next[0]),
    THREE.MathUtils.degToRad(next[1]),
    THREE.MathUtils.degToRad(next[2]),
    'XYZ'
  );
  mesh.quaternion.setFromEuler(euler);
  mesh.updateMatrixWorld(true);
}

/**
 * Apply a multiplicative scale ratio to the mesh, either uniformly (all 3
 * axes) or to a single axis. `ratio` is relative to the mesh's CURRENT
 * THREE.js scale — callers (Scale%/Size panel handlers) compute this
 * ratio from the displayed value vs. the new value, matching native's
 * ratio-based change_scale_value/change_size_value.
 */
export function applyScaleRatio(
  mesh: THREE.Object3D,
  axis: Axis,
  ratio: number,
  uniform: boolean
): void {
  if (!Number.isFinite(ratio) || ratio <= 0) return;
  if (uniform) {
    mesh.scale.multiplyScalar(ratio);
  } else {
    mesh.scale.setComponent(axis, mesh.scale.getComponent(axis) * ratio);
  }
  mesh.updateMatrixWorld(true);
}

/** Reset the object's rotation to identity (world orientation zero). */
export function resetRotation(mesh: THREE.Object3D): void {
  mesh.quaternion.identity();
  mesh.updateMatrixWorld(true);
}

/** Reset the object's scale to 100% (original imported size) on all axes. */
export function resetScale(mesh: THREE.Object3D): void {
  mesh.scale.set(1, 1, 1);
  mesh.updateMatrixWorld(true);
}
