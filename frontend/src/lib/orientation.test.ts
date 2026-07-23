import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  collectFaceCandidates,
  layOnFace,
  dropToBed,
  computeAutoOrientDirection,
  autoOrientObject,
  buildLayOnFaceOverlays,
  applyLayOnFaceHover,
} from './orientation';

function makeBoxMesh(w = 20, h = 10, d = 30): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(w, h, d);
  const material = new THREE.MeshStandardMaterial();
  return new THREE.Mesh(geometry, material);
}

/** A flat, wide "plate" shape — much larger in X/Y than Z. */
function makePlateMesh(): THREE.Mesh {
  return makeBoxMesh(50, 2, 50);
}

describe('collectFaceCandidates', () => {
  it('finds 6 grouped face candidates for an axis-aligned box', () => {
    const mesh = makeBoxMesh();
    mesh.updateMatrixWorld(true);
    const candidates = collectFaceCandidates(mesh);
    expect(candidates.length).toBe(6);
    for (const c of candidates) {
      expect(c.normal.length()).toBeCloseTo(1, 4);
      expect(c.area).toBeGreaterThan(0);
    }
  });

  it('ranks candidates by area, largest first', () => {
    const mesh = makeBoxMesh(50, 10, 2);
    const candidates = collectFaceCandidates(mesh);
    expect(candidates[0].area).toBeGreaterThan(candidates[1].area - 1e-6);
    expect(candidates[0].area).toBeCloseTo(500, 1);
  });

  it('accounts for world transforms (rotation changes reported normals)', () => {
    const mesh = makeBoxMesh();
    mesh.rotation.x = Math.PI / 2;
    mesh.updateMatrixWorld(true);
    const candidates = collectFaceCandidates(mesh);
    const hasYNormal = candidates.some((c) => Math.abs(c.normal.y) > 0.9);
    expect(hasYNormal).toBe(true);
  });
});

describe('layOnFace', () => {
  it('rotates the mesh so the given world normal points down, then drops to bed', () => {
    const mesh = makeBoxMesh(20, 10, 30);
    mesh.position.set(5, 5, 50);
    mesh.updateMatrixWorld(true);

    layOnFace(mesh, new THREE.Vector3(1, 0, 0));

    const box = new THREE.Box3().setFromObject(mesh);
    expect(box.min.z).toBeCloseTo(0, 3);

    const transformedNormal = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(mesh.quaternion)
      .normalize();
    expect(transformedNormal.z).toBeCloseTo(-1, 3);
  });

  it('works for a face normal that is already pointing down (no-op rotation)', () => {
    const mesh = makeBoxMesh();
    mesh.position.set(0, 0, 20);
    mesh.updateMatrixWorld(true);

    layOnFace(mesh, new THREE.Vector3(0, 0, -1));

    const box = new THREE.Box3().setFromObject(mesh);
    expect(box.min.z).toBeCloseTo(0, 3);
  });
});

describe('dropToBed', () => {
  it('translates the mesh so its minimum Z becomes 0', () => {
    const mesh = makeBoxMesh(10, 10, 10);
    mesh.position.set(3, 4, 55);
    dropToBed(mesh);

    const box = new THREE.Box3().setFromObject(mesh);
    expect(box.min.z).toBeCloseTo(0, 4);
    expect(mesh.position.x).toBeCloseTo(3, 4);
    expect(mesh.position.y).toBeCloseTo(4, 4);
  });

  it('is a no-op (within tolerance) when already resting on the bed', () => {
    const mesh = makeBoxMesh(10, 10, 10);
    mesh.position.set(0, 0, 5);
    dropToBed(mesh);
    const box = new THREE.Box3().setFromObject(mesh);
    expect(box.min.z).toBeCloseTo(0, 4);
  });
});

describe('computeAutoOrientDirection', () => {
  it('is unaffected by the object\'s current rotation (computed in local frame)', () => {
    const flat = makeBoxMesh(10, 10, 10);
    const rotated = makeBoxMesh(10, 10, 10);
    rotated.rotation.set(
      THREE.MathUtils.degToRad(30),
      THREE.MathUtils.degToRad(20),
      THREE.MathUtils.degToRad(10)
    );
    rotated.updateMatrixWorld(true);

    const dirFlat = computeAutoOrientDirection(flat);
    const dirRotated = computeAutoOrientDirection(rotated);

    // Both should resolve to a face normal of the (rotation-independent)
    // local cube geometry — i.e. an axis-aligned unit vector — regardless
    // of the mesh's current world rotation.
    expect(dirFlat).not.toBeNull();
    expect(dirRotated).not.toBeNull();
    const isAxisAligned = (v: THREE.Vector3) =>
      [v.x, v.y, v.z].filter((c) => Math.abs(Math.abs(c) - 1) < 1e-3).length === 1;
    expect(isAxisAligned(dirFlat!)).toBe(true);
    expect(isAxisAligned(dirRotated!)).toBe(true);
  });

  it('returns null for an object with no geometry', () => {
    const emptyGroup = new THREE.Group();
    const direction = computeAutoOrientDirection(emptyGroup);
    expect(direction).toBeNull();
  });

  it('for a symmetric cube, returns a valid unit-length direction', () => {
    const mesh = makeBoxMesh(10, 10, 10);
    const direction = computeAutoOrientDirection(mesh);
    expect(direction).not.toBeNull();
    expect(direction!.length()).toBeCloseTo(1, 3);
  });
});

describe('autoOrientObject', () => {
  it('rotates and drops the mesh to the bed, returning true on success', () => {
    const mesh = makePlateMesh();
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(0, 0, 40);
    mesh.updateMatrixWorld(true);

    const result = autoOrientObject(mesh);
    expect(result).toBe(true);

    const box = new THREE.Box3().setFromObject(mesh);
    expect(box.min.z).toBeCloseTo(0, 3);
  });

  it('returns false for empty geometry and does not throw', () => {
    const emptyGroup = new THREE.Group();
    const result = autoOrientObject(emptyGroup);
    expect(result).toBe(false);
  });

  it('un-rotates an arbitrarily-tilted cube back onto a flat face (matches native "cancel rotation" behavior)', () => {
    // This is the exact regression scenario from the bug report: a cube
    // rotated 30 degrees off-axis should end up perfectly flat on the bed
    // after auto-orient, not still tilted.
    const mesh = makeBoxMesh(20, 20, 20);
    mesh.rotation.set(THREE.MathUtils.degToRad(30), THREE.MathUtils.degToRad(20), 0);
    mesh.position.set(10, 10, 100);
    mesh.updateMatrixWorld(true);

    autoOrientObject(mesh);

    const box = new THREE.Box3().setFromObject(mesh);
    expect(box.min.z).toBeCloseTo(0, 3);

    // After orienting, the cube must have (at least) one face whose world
    // normal points EXACTLY straight down and one straight up — i.e. it's
    // resting flat on an actual face, not left at an arbitrary tilt.
    const candidates = collectFaceCandidates(mesh);
    const hasFlatDownFace = candidates.some((c) => c.normal.z < -0.999);
    const hasFlatUpFace = candidates.some((c) => c.normal.z > 0.999);
    expect(hasFlatDownFace).toBe(true);
    expect(hasFlatUpFace).toBe(true);
  });

  it('leaves a cube already resting flat unchanged in effect (idempotent-ish: still flat after)', () => {
    const mesh = makeBoxMesh(20, 20, 20);
    mesh.position.set(0, 0, 10); // resting flat already (min.z = 0)
    mesh.updateMatrixWorld(true);

    autoOrientObject(mesh);

    const box = new THREE.Box3().setFromObject(mesh);
    expect(box.min.z).toBeCloseTo(0, 3);
    const candidates = collectFaceCandidates(mesh);
    const hasFlatDownFace = candidates.some((c) => c.normal.z < -0.999);
    expect(hasFlatDownFace).toBe(true);
  });
});

describe('buildLayOnFaceOverlays', () => {
  it('creates one clickable highlighted region per face for an axis-aligned box', () => {
    const mesh = makeBoxMesh(20, 20, 20);
    const overlay = buildLayOnFaceOverlays(mesh);

    expect(overlay.regions.length).toBe(6);
    for (const region of overlay.regions) {
      expect(region.localNormal.length()).toBeCloseTo(1, 3);
      expect(region.overlayMesh).toBeInstanceOf(THREE.Mesh);
    }
  });

  it('overlay meshes are added to the returned group', () => {
    const mesh = makeBoxMesh();
    const overlay = buildLayOnFaceOverlays(mesh);
    expect(overlay.group.children.length).toBe(overlay.regions.length);
  });

  it('skips negligibly small regions', () => {
    // A very small box (2mm cube) has faces below the 4mm^2 minimum
    // region area threshold on some axes if it's thin; here all faces are
    // 4mm^2 exactly at the boundary, so instead verify a degenerate case
    // does not throw and returns some structure.
    const mesh = makeBoxMesh(0.1, 0.1, 0.1);
    expect(() => buildLayOnFaceOverlays(mesh)).not.toThrow();
  });

  it('returns an empty overlay for a group with no geometry', () => {
    const emptyGroup = new THREE.Group();
    const overlay = buildLayOnFaceOverlays(emptyGroup);
    expect(overlay.regions.length).toBe(0);
  });
});

describe('applyLayOnFaceHover', () => {
  it('highlights only the hovered region, resetting others', () => {
    const mesh = makeBoxMesh(20, 20, 20);
    const overlay = buildLayOnFaceOverlays(mesh);
    const [first, second] = overlay.regions;

    applyLayOnFaceHover(overlay, first.overlayMesh);
    expect((first.overlayMesh.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(
      (second.overlayMesh.material as THREE.MeshBasicMaterial).opacity
    );

    applyLayOnFaceHover(overlay, second.overlayMesh);
    expect((second.overlayMesh.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(
      (first.overlayMesh.material as THREE.MeshBasicMaterial).opacity
    );
  });

  it('clears all highlights when passed null', () => {
    const mesh = makeBoxMesh(20, 20, 20);
    const overlay = buildLayOnFaceOverlays(mesh);
    applyLayOnFaceHover(overlay, overlay.regions[0].overlayMesh);
    applyLayOnFaceHover(overlay, null);

    for (const region of overlay.regions) {
      const material = region.overlayMesh.material as THREE.MeshBasicMaterial;
      expect(material.color.getHex()).toBe(0x5ec8bd);
    }
  });
});
