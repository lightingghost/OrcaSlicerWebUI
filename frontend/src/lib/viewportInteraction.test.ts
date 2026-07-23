import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  toNdc,
  pickRootObject,
  intersectBedPlane,
  isClick,
  computeDragPosition,
  CLICK_MOVE_THRESHOLD_PX,
} from './viewportInteraction';

describe('viewportInteraction', () => {
  describe('toNdc', () => {
    it('maps the center of the rect to (0, 0)', () => {
      const rect = { left: 0, top: 0, width: 200, height: 100 };
      const ndc = toNdc(100, 50, rect);
      expect(ndc.x).toBeCloseTo(0);
      expect(ndc.y).toBeCloseTo(0);
    });

    it('maps top-left corner to (-1, 1)', () => {
      const rect = { left: 0, top: 0, width: 200, height: 100 };
      const ndc = toNdc(0, 0, rect);
      expect(ndc.x).toBeCloseTo(-1);
      expect(ndc.y).toBeCloseTo(1);
    });

    it('maps bottom-right corner to (1, -1)', () => {
      const rect = { left: 0, top: 0, width: 200, height: 100 };
      const ndc = toNdc(200, 100, rect);
      expect(ndc.x).toBeCloseTo(1);
      expect(ndc.y).toBeCloseTo(-1);
    });

    it('accounts for rect offset', () => {
      const rect = { left: 50, top: 20, width: 200, height: 100 };
      const ndc = toNdc(150, 70, rect); // center relative to offset rect
      expect(ndc.x).toBeCloseTo(0);
      expect(ndc.y).toBeCloseTo(0);
    });
  });

  describe('isClick', () => {
    it('returns true when pointer barely moved', () => {
      expect(isClick({ x: 10, y: 10 }, { x: 12, y: 11 })).toBe(true);
    });

    it('returns false when pointer moved beyond the threshold', () => {
      expect(
        isClick({ x: 10, y: 10 }, { x: 10 + CLICK_MOVE_THRESHOLD_PX + 5, y: 10 })
      ).toBe(false);
    });

    it('returns true exactly at the threshold boundary', () => {
      expect(
        isClick({ x: 0, y: 0 }, { x: CLICK_MOVE_THRESHOLD_PX, y: 0 })
      ).toBe(true);
    });
  });

  describe('intersectBedPlane', () => {
    it('finds the intersection point on the Z=0 plane for a downward-looking camera', () => {
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
      camera.up.set(0, 0, 1);
      camera.position.set(0, 0, 100);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      const raycaster = new THREE.Raycaster();
      const point = intersectBedPlane(raycaster, camera, { x: 0, y: 0 }, 0);

      expect(point).not.toBeNull();
      expect(point!.x).toBeCloseTo(0, 1);
      expect(point!.y).toBeCloseTo(0, 1);
      expect(point!.z).toBeCloseTo(0, 1);
    });

    it('respects a non-zero plane height', () => {
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
      camera.up.set(0, 0, 1);
      camera.position.set(0, 0, 100);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      const raycaster = new THREE.Raycaster();
      const point = intersectBedPlane(raycaster, camera, { x: 0, y: 0 }, 25);

      expect(point).not.toBeNull();
      expect(point!.z).toBeCloseTo(25, 1);
    });
  });

  describe('pickRootObject', () => {
    it('returns the mesh hit by a ray cast straight down its center', () => {
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
      camera.up.set(0, 0, 1);
      camera.position.set(0, 0, 100);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(10, 10, 10),
        new THREE.MeshStandardMaterial()
      );
      mesh.position.set(0, 0, 5);
      mesh.updateMatrixWorld();

      const raycaster = new THREE.Raycaster();
      const hit = pickRootObject(raycaster, camera, { x: 0, y: 0 }, [mesh]);

      expect(hit).toBe(mesh);
    });

    it('returns null when the ray misses all roots', () => {
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
      camera.up.set(0, 0, 1);
      camera.position.set(0, 0, 100);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(10, 10, 10),
        new THREE.MeshStandardMaterial()
      );
      mesh.position.set(500, 500, 5); // far away from the ray
      mesh.updateMatrixWorld();

      const raycaster = new THREE.Raycaster();
      const hit = pickRootObject(raycaster, camera, { x: 0, y: 0 }, [mesh]);

      expect(hit).toBeNull();
    });

    it('picks the correct root among multiple candidates', () => {
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
      camera.up.set(0, 0, 1);
      camera.position.set(50, 0, 100);
      camera.lookAt(50, 0, 0);
      camera.updateMatrixWorld();

      const meshA = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshStandardMaterial());
      meshA.position.set(0, 0, 5);
      meshA.updateMatrixWorld();

      const meshB = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshStandardMaterial());
      meshB.position.set(50, 0, 5);
      meshB.updateMatrixWorld();

      const raycaster = new THREE.Raycaster();
      const hit = pickRootObject(raycaster, camera, { x: 0, y: 0 }, [meshA, meshB]);

      expect(hit).toBe(meshB);
    });
  });

  describe('computeDragPosition', () => {
    it('applies the grab offset to the current bed point', () => {
      const bedPoint = new THREE.Vector3(10, 20, 0);
      const result = computeDragPosition(bedPoint, { x: 5, y: -5 }, 3);

      expect(result.x).toBeCloseTo(15);
      expect(result.y).toBeCloseTo(15);
      expect(result.z).toBeCloseTo(3);
    });

    it('preserves the Z height regardless of bed point Z', () => {
      const bedPoint = new THREE.Vector3(0, 0, 999); // Z should be ignored
      const result = computeDragPosition(bedPoint, { x: 0, y: 0 }, 42);
      expect(result.z).toBe(42);
    });
  });
});
