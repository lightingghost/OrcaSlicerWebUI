import * as THREE from 'three';

/**
 * viewportInteraction
 *
 * Pure, framework-free helpers backing the ThreeViewport's mouse
 * interaction model:
 *
 *   - Nothing selected  -> drag anywhere orbits the camera.
 *   - Object selected   -> drag that STARTS on the selected object moves it
 *                          (translated across the bed's Z=0 plane); a drag
 *                          that starts anywhere else still orbits.
 *   - A plain click (press+release with negligible movement) on an object
 *     selects it; a plain click on empty space deselects.
 *
 * Kept separate from ThreeViewport.tsx so the picking/translation math can
 * be unit-tested without a WebGL context.
 */

/** Distance (in pixels) below which a pointer down->up is a "click" rather than a drag. */
export const CLICK_MOVE_THRESHOLD_PX = 5;

/**
 * Convert a mouse/pointer event's client coordinates to normalized device
 * coordinates (NDC), i.e. [-1, 1] on both axes, relative to a canvas rect.
 */
export function toNdc(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number }
): { x: number; y: number } {
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -((clientY - rect.top) / rect.height) * 2 + 1,
  };
}

/**
 * Given a set of "pickable root" objects (e.g. one per loaded model), find
 * which root (if any) is hit by a ray cast from the camera through the
 * given NDC pointer coordinates. Returns the root object, or null if no
 * pickable root was hit (e.g. the ray hit only the build plate, or nothing).
 */
export function pickRootObject(
  raycaster: THREE.Raycaster,
  camera: THREE.Camera,
  ndc: { x: number; y: number },
  roots: THREE.Object3D[]
): THREE.Object3D | null {
  raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);

  for (const root of roots) {
    const intersections = raycaster.intersectObject(root, true);
    if (intersections.length > 0) {
      return root;
    }
  }
  return null;
}

/**
 * Intersect a ray (from camera through NDC pointer coords) with the
 * horizontal bed plane (Z = planeZ), returning the world-space intersection
 * point, or null if the ray is parallel to the plane (no intersection).
 */
export function intersectBedPlane(
  raycaster: THREE.Raycaster,
  camera: THREE.Camera,
  ndc: { x: number; y: number },
  planeZ: number = 0
): THREE.Vector3 | null {
  raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);

  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZ);
  const point = new THREE.Vector3();
  const hit = raycaster.ray.intersectPlane(plane, point);
  return hit ? point : null;
}

/**
 * Determine whether a pointer down->up sequence should be treated as a
 * "click" (select/deselect) as opposed to a drag (orbit or move).
 */
export function isClick(
  startClient: { x: number; y: number },
  endClient: { x: number; y: number },
  thresholdPx: number = CLICK_MOVE_THRESHOLD_PX
): boolean {
  const dx = endClient.x - startClient.x;
  const dy = endClient.y - startClient.y;
  return Math.sqrt(dx * dx + dy * dy) <= thresholdPx;
}

/**
 * Compute the new XY position for an object being dragged across the bed
 * plane, preserving its current Z (height above bed) and the initial grab
 * offset (the vector from the pointer's initial bed-plane intersection to
 * the object's origin), so the object doesn't "snap" to the pointer.
 */
export function computeDragPosition(
  currentBedPoint: THREE.Vector3,
  grabOffsetXY: { x: number; y: number },
  currentZ: number
): THREE.Vector3 {
  return new THREE.Vector3(
    currentBedPoint.x + grabOffsetXY.x,
    currentBedPoint.y + grabOffsetXY.y,
    currentZ
  );
}
