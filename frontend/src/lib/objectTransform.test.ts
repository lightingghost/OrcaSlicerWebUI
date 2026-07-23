import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  computeObjectTransformSnapshot,
  applyPositionChange,
  applyRotationRelative,
  applyRotationAbsolute,
  applyScaleRatio,
  resetRotation,
  resetScale,
  getWorldBoundingBoxSize,
  getLocalBoundingBoxSize,
} from './objectTransform';

function makeBoxMesh(w = 10, h = 20, d = 5): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(w, h, d);
  const material = new THREE.MeshStandardMaterial();
  return new THREE.Mesh(geometry, material);
}

describe('computeObjectTransformSnapshot', () => {
  it('world mode: position matches mesh.position, size matches world AABB', () => {
    const mesh = makeBoxMesh(10, 20, 5);
    mesh.position.set(3, 4, 5);
    mesh.updateMatrixWorld(true);

    const snap = computeObjectTransformSnapshot(mesh, 'world');
    expect(snap.position).toEqual([3, 4, 5]);
    expect(snap.size[0]).toBeCloseTo(10, 5);
    expect(snap.size[1]).toBeCloseTo(20, 5);
    expect(snap.size[2]).toBeCloseTo(5, 5);
    expect(snap.scale).toEqual([100, 100, 100]); // unscaled, so 100%
  });

  it('object mode: position is always (0,0,0) regardless of world position', () => {
    const mesh = makeBoxMesh();
    mesh.position.set(50, -20, 3);
    mesh.updateMatrixWorld(true);

    const snap = computeObjectTransformSnapshot(mesh, 'object');
    expect(snap.position).toEqual([0, 0, 0]);
  });

  it('world mode size changes with rotation (world AABB), object mode size does not', () => {
    const mesh = makeBoxMesh(10, 20, 5);
    mesh.rotation.z = Math.PI / 4; // 45 degrees
    mesh.updateMatrixWorld(true);

    const worldSnap = computeObjectTransformSnapshot(mesh, 'world');
    const objectSnap = computeObjectTransformSnapshot(mesh, 'object');

    // World AABB of a rotated 10x20 box is larger than 10x20 in X/Y
    expect(worldSnap.size[0]).toBeGreaterThan(10.5);
    // Object-local size ignores rotation entirely
    expect(objectSnap.size[0]).toBeCloseTo(10, 5);
    expect(objectSnap.size[1]).toBeCloseTo(20, 5);
  });

  it('reflects current scale in world-mode scale percentage', () => {
    const mesh = makeBoxMesh(10, 20, 5);
    mesh.scale.set(2, 2, 2);
    mesh.updateMatrixWorld(true);

    const snap = computeObjectTransformSnapshot(mesh, 'world');
    expect(snap.scale[0]).toBeCloseTo(200, 3);
    expect(snap.scale[1]).toBeCloseTo(200, 3);
    expect(snap.scale[2]).toBeCloseTo(200, 3);
  });

  it('object mode scale percentage matches mesh.scale * 100 directly', () => {
    const mesh = makeBoxMesh();
    mesh.scale.set(1.5, 0.5, 3);
    mesh.updateMatrixWorld(true);

    const snap = computeObjectTransformSnapshot(mesh, 'object');
    expect(snap.scale[0]).toBeCloseTo(150, 3);
    expect(snap.scale[1]).toBeCloseTo(50, 3);
    expect(snap.scale[2]).toBeCloseTo(300, 3);
  });

  it('does not mutate the mesh position/rotation as a side effect', () => {
    const mesh = makeBoxMesh();
    mesh.position.set(5, 6, 7);
    mesh.rotation.set(0.1, 0.2, 0.3);
    mesh.updateMatrixWorld(true);

    computeObjectTransformSnapshot(mesh, 'world');
    computeObjectTransformSnapshot(mesh, 'object');

    expect(mesh.position.x).toBeCloseTo(5);
    expect(mesh.position.y).toBeCloseTo(6);
    expect(mesh.position.z).toBeCloseTo(7);
    expect(mesh.rotation.x).toBeCloseTo(0.1);
    expect(mesh.rotation.y).toBeCloseTo(0.2);
    expect(mesh.rotation.z).toBeCloseTo(0.3);
  });
});

describe('applyPositionChange', () => {
  it('world mode: sets the absolute world coordinate directly', () => {
    const mesh = makeBoxMesh();
    mesh.position.set(1, 2, 3);
    applyPositionChange(mesh, 0, 99, 'world');
    expect(mesh.position.x).toBeCloseTo(99);
    expect(mesh.position.y).toBeCloseTo(2);
    expect(mesh.position.z).toBeCloseTo(3);
  });

  it('object mode: translates along the object\'s own (rotated) local axis', () => {
    const mesh = makeBoxMesh();
    mesh.rotation.z = Math.PI / 2; // local X axis now points along world +Y
    mesh.updateMatrixWorld(true);

    applyPositionChange(mesh, 0, 10, 'object'); // move 10 along local X
    // local X (1,0,0) rotated by 90deg around Z -> world (0,1,0)
    expect(mesh.position.x).toBeCloseTo(0, 4);
    expect(mesh.position.y).toBeCloseTo(10, 4);
  });
});

describe('applyRotationRelative', () => {
  it('world mode: rotating around world Z changes absolute Z rotation by the delta', () => {
    const mesh = makeBoxMesh();
    applyRotationRelative(mesh, 2, 90, 'world');
    const euler = new THREE.Euler().setFromQuaternion(mesh.quaternion, 'XYZ');
    expect(THREE.MathUtils.radToDeg(euler.z)).toBeCloseTo(90, 3);
  });

  it('object mode: successive rotations compose around the object\'s own updated axes', () => {
    const meshWorld = makeBoxMesh();
    const meshObject = makeBoxMesh();

    // Two 45-degree world-mode rotations should equal one 90-degree rotation
    applyRotationRelative(meshWorld, 2, 45, 'world');
    applyRotationRelative(meshWorld, 2, 45, 'world');

    applyRotationRelative(meshObject, 2, 45, 'object');
    applyRotationRelative(meshObject, 2, 45, 'object');

    const eulerWorld = new THREE.Euler().setFromQuaternion(meshWorld.quaternion, 'XYZ');
    const eulerObject = new THREE.Euler().setFromQuaternion(meshObject.quaternion, 'XYZ');
    expect(THREE.MathUtils.radToDeg(eulerWorld.z)).toBeCloseTo(90, 3);
    expect(THREE.MathUtils.radToDeg(eulerObject.z)).toBeCloseTo(90, 3);
  });
});

describe('applyRotationAbsolute', () => {
  it('sets one axis to an absolute value while preserving the others', () => {
    const mesh = makeBoxMesh();
    applyRotationAbsolute(mesh, 0, 30);
    applyRotationAbsolute(mesh, 2, 60);

    const euler = new THREE.Euler().setFromQuaternion(mesh.quaternion, 'XYZ');
    expect(THREE.MathUtils.radToDeg(euler.x)).toBeCloseTo(30, 1);
    expect(THREE.MathUtils.radToDeg(euler.z)).toBeCloseTo(60, 1);
  });

  it('overwrites rather than accumulates on repeated calls to the same axis', () => {
    const mesh = makeBoxMesh();
    applyRotationAbsolute(mesh, 2, 45);
    applyRotationAbsolute(mesh, 2, 10);

    const euler = new THREE.Euler().setFromQuaternion(mesh.quaternion, 'XYZ');
    expect(THREE.MathUtils.radToDeg(euler.z)).toBeCloseTo(10, 1);
  });
});

describe('applyScaleRatio', () => {
  it('uniform=true scales all three axes by the same ratio', () => {
    const mesh = makeBoxMesh();
    mesh.scale.set(1, 1, 1);
    applyScaleRatio(mesh, 0, 2, true);
    expect(mesh.scale.x).toBeCloseTo(2);
    expect(mesh.scale.y).toBeCloseTo(2);
    expect(mesh.scale.z).toBeCloseTo(2);
  });

  it('uniform=false scales only the specified axis', () => {
    const mesh = makeBoxMesh();
    mesh.scale.set(1, 1, 1);
    applyScaleRatio(mesh, 1, 3, false);
    expect(mesh.scale.x).toBeCloseTo(1);
    expect(mesh.scale.y).toBeCloseTo(3);
    expect(mesh.scale.z).toBeCloseTo(1);
  });

  it('ignores non-positive or non-finite ratios', () => {
    const mesh = makeBoxMesh();
    mesh.scale.set(1, 1, 1);
    applyScaleRatio(mesh, 0, 0, true);
    applyScaleRatio(mesh, 0, -1, true);
    applyScaleRatio(mesh, 0, NaN, true);
    expect(mesh.scale.x).toBeCloseTo(1);
  });
});

describe('resetRotation / resetScale', () => {
  it('resetRotation sets quaternion to identity', () => {
    const mesh = makeBoxMesh();
    mesh.rotation.set(0.5, 0.5, 0.5);
    mesh.updateMatrixWorld(true);
    resetRotation(mesh);
    expect(mesh.quaternion.x).toBeCloseTo(0);
    expect(mesh.quaternion.y).toBeCloseTo(0);
    expect(mesh.quaternion.z).toBeCloseTo(0);
    expect(mesh.quaternion.w).toBeCloseTo(1);
  });

  it('resetScale sets scale to (1,1,1)', () => {
    const mesh = makeBoxMesh();
    mesh.scale.set(3, 4, 5);
    resetScale(mesh);
    expect(mesh.scale.x).toBeCloseTo(1);
    expect(mesh.scale.y).toBeCloseTo(1);
    expect(mesh.scale.z).toBeCloseTo(1);
  });
});

describe('getWorldBoundingBoxSize / getLocalBoundingBoxSize', () => {
  it('world bounding box grows under rotation, local bounding box does not', () => {
    const mesh = makeBoxMesh(10, 10, 10);
    const localBefore = getLocalBoundingBoxSize(mesh);
    mesh.rotation.y = Math.PI / 4;
    mesh.position.set(100, 100, 100);
    mesh.updateMatrixWorld(true);

    const worldAfter = getWorldBoundingBoxSize(mesh);
    const localAfter = getLocalBoundingBoxSize(mesh);

    expect(worldAfter.x).toBeGreaterThan(10.5);
    expect(localAfter.x).toBeCloseTo(localBefore.x, 4);
  });
});
