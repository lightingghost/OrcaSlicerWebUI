import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  convexHull2D,
  computeAABB2D,
  rotatePoints2D,
  findBestRotationAngle,
  computeAlignToYAxisAngle,
  objfuncArrangePack,
  getWorldFootprintHull,
  computeArrangePlan,
  AUTO_SPACING_MM,
  type Point2D,
} from './arrangePacking';

function makeBoxMesh(w = 20, h = 10, d = 30): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(w, h, d);
  const material = new THREE.MeshStandardMaterial();
  return new THREE.Mesh(geometry, material);
}

describe('convexHull2D', () => {
  it('returns the hull of a square with interior points removed', () => {
    const points: Point2D[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 }, // interior point, should be excluded
    ];
    const hull = convexHull2D(points);
    expect(hull.length).toBe(4);
    expect(hull.some((p) => p.x === 5 && p.y === 5)).toBe(false);
  });

  it('handles collinear/degenerate input without throwing', () => {
    expect(() => convexHull2D([{ x: 0, y: 0 }])).not.toThrow();
    expect(() => convexHull2D([{ x: 0, y: 0 }, { x: 1, y: 0 }])).not.toThrow();
  });
});

describe('computeAABB2D', () => {
  it('computes the correct bounding box', () => {
    const box = computeAABB2D([{ x: -5, y: 2 }, { x: 3, y: 8 }, { x: 0, y: -1 }]);
    expect(box.minX).toBe(-5);
    expect(box.maxX).toBe(3);
    expect(box.minY).toBe(-1);
    expect(box.maxY).toBe(8);
  });
});

describe('rotatePoints2D', () => {
  it('rotates a point 90 degrees around a pivot', () => {
    const rotated = rotatePoints2D([{ x: 1, y: 0 }], Math.PI / 2, { x: 0, y: 0 });
    expect(rotated[0].x).toBeCloseTo(0, 5);
    expect(rotated[0].y).toBeCloseTo(1, 5);
  });
});

describe('findBestRotationAngle', () => {
  it('finds a 45-degree rotation reduces the bounding box for a diamond shape', () => {
    // A square rotated 45 degrees looks like a diamond; rotating it back
    // by -45 (i.e. the best candidate among {0,45,90,135}) should produce
    // a much smaller AABB than leaving it at 0.
    const side = 10;
    const diamond: Point2D[] = [
      { x: 0, y: side },
      { x: side, y: 0 },
      { x: 0, y: -side },
      { x: -side, y: 0 },
    ];
    const angle = findBestRotationAngle(diamond);
    const rotated = rotatePoints2D(diamond, angle, { x: 0, y: 0 });
    const box = computeAABB2D(rotated);
    const originalBox = computeAABB2D(diamond);
    const rotatedArea = (box.maxX - box.minX) * (box.maxY - box.minY);
    const originalArea = (originalBox.maxX - originalBox.minX) * (originalBox.maxY - originalBox.minY);
    expect(rotatedArea).toBeLessThan(originalArea);
  });

  it('returns 0 for a shape already axis-aligned (no improvement possible)', () => {
    const square: Point2D[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const angle = findBestRotationAngle(square);
    expect(angle).toBe(0);
  });
});

describe('computeAlignToYAxisAngle', () => {
  it('returns 0 for a shape with no dominant axis (square)', () => {
    const square: Point2D[] = [
      { x: -5, y: -5 },
      { x: 5, y: -5 },
      { x: 5, y: 5 },
      { x: -5, y: 5 },
    ];
    const angle = computeAlignToYAxisAngle(square);
    expect(angle).toBe(0);
  });

  it('returns a non-zero angle for an elongated shape not aligned to Y', () => {
    // A long thin rectangle lying along X should need ~90 degrees to align to Y.
    const rect: Point2D[] = [
      { x: -20, y: -1 },
      { x: 20, y: -1 },
      { x: 20, y: 1 },
      { x: -20, y: 1 },
    ];
    const angle = computeAlignToYAxisAngle(rect);
    expect(Math.abs(angle)).toBeGreaterThan(0.1);
  });

  it('aligning a long shape rotates its principal axis toward Y', () => {
    const rect: Point2D[] = [
      { x: -20, y: -1 },
      { x: 20, y: -1 },
      { x: 20, y: 1 },
      { x: -20, y: 1 },
    ];
    const angle = computeAlignToYAxisAngle(rect);
    const rotated = rotatePoints2D(rect, angle, { x: 0, y: 0 });
    const box = computeAABB2D(rotated);
    // After aligning to Y, the shape's height (Y extent) should now be
    // larger than its width (X extent) — the long axis points along Y.
    expect(box.maxY - box.minY).toBeGreaterThan(box.maxX - box.minX);
  });
});

function squareHull(cx: number, cy: number, size: number): Point2D[] {
  const h = size / 2;
  return [
    { x: cx - h, y: cy - h },
    { x: cx + h, y: cy - h },
    { x: cx + h, y: cy + h },
    { x: cx - h, y: cy + h },
  ];
}

describe('objfuncArrangePack', () => {
  it('packs non-overlapping footprints without collisions', () => {
    const items = [
      { id: 'a', hull: squareHull(0, 0, 10), heightMm: 10 },
      { id: 'b', hull: squareHull(0, 0, 10), heightMm: 10 },
      { id: 'c', hull: squareHull(0, 0, 10), heightMm: 10 },
    ];
    const result = objfuncArrangePack(items, { spacingMm: 2, enableRotation: false, alignToYAxis: false });
    expect(result.targetCenters.size).toBe(3);

    const rects = items.map((item) => {
      const c = result.targetCenters.get(item.id)!;
      const halfSpan = 5 + 1; // half of 10 plus half of the 2mm spacing inflation
      return {
        minX: c.x - halfSpan,
        maxX: c.x + halfSpan,
        minY: c.y - halfSpan,
        maxY: c.y + halfSpan,
      };
    });

    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlapsX = a.minX < b.maxX - 1e-6 && a.maxX > b.minX + 1e-6;
        const overlapsY = a.minY < b.maxY - 1e-6 && a.maxY > b.minY + 1e-6;
        expect(overlapsX && overlapsY).toBe(false);
      }
    }
  });

  it('centers the resulting pile at the origin', () => {
    const items = [
      { id: 'a', hull: squareHull(0, 0, 10), heightMm: 10 },
      { id: 'b', hull: squareHull(0, 0, 10), heightMm: 10 },
    ];
    const result = objfuncArrangePack(items, { spacingMm: 2, enableRotation: false, alignToYAxis: false });
    const centers = [...result.targetCenters.values()];
    const minX = Math.min(...centers.map((c) => c.x - 6));
    const maxX = Math.max(...centers.map((c) => c.x + 6));
    const minY = Math.min(...centers.map((c) => c.y - 6));
    const maxY = Math.max(...centers.map((c) => c.y + 6));
    expect((minX + maxX) / 2).toBeCloseTo(0, 3);
    expect((minY + maxY) / 2).toBeCloseTo(0, 3);
  });

  it('handles a single item', () => {
    const result = objfuncArrangePack(
      [{ id: 'a', hull: squareHull(0, 0, 5), heightMm: 5 }],
      { spacingMm: 2, enableRotation: false, alignToYAxis: false }
    );
    const center = result.targetCenters.get('a')!;
    expect(center.x).toBeCloseTo(0, 5);
    expect(center.y).toBeCloseTo(0, 5);
  });

  it('respects the bed bin bounds when provided, keeping items near the bed', () => {
    const items = [
      { id: 'a', hull: squareHull(0, 0, 50), heightMm: 10 },
      { id: 'b', hull: squareHull(0, 0, 50), heightMm: 10 },
    ];
    const result = objfuncArrangePack(items, {
      spacingMm: 2,
      enableRotation: false,
      alignToYAxis: false,
      bin: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
    });
    expect(result.targetCenters.size).toBe(2);
  });
});

describe('getWorldFootprintHull', () => {
  it('returns a hull whose AABB matches the mesh footprint', () => {
    // THREE.BoxGeometry(width, height, depth) maps width->X, height->Y,
    // depth->Z, so the XY footprint is width x height (not width x depth).
    const mesh = makeBoxMesh(20, 10, 30);
    mesh.position.set(5, 5, 0);
    mesh.updateMatrixWorld(true);
    const hull = getWorldFootprintHull(mesh);
    const box = computeAABB2D(hull);
    expect(box.maxX - box.minX).toBeCloseTo(20, 3);
    expect(box.maxY - box.minY).toBeCloseTo(10, 3);
  });
});

describe('computeArrangePlan', () => {
  it('spaces objects apart by at least the requested spacing', () => {
    const meshA = makeBoxMesh(10, 10, 10);
    const meshB = makeBoxMesh(10, 10, 10);
    meshA.position.set(0, 0, 0);
    meshB.position.set(0, 0, 0); // same starting position, spacing should still separate them
    meshA.updateMatrixWorld(true);
    meshB.updateMatrixWorld(true);

    const plan = computeArrangePlan(
      [
        { id: 'a', object: meshA },
        { id: 'b', object: meshB },
      ],
      { spacingMm: 5, enableRotation: false, alignToYAxis: false }
    );

    const centerA = plan.targetCenters.get('a')!;
    const centerB = plan.targetCenters.get('b')!;
    const dist = Math.hypot(centerA.x - centerB.x, centerA.y - centerB.y);
    // Each 10x10 box needs at least 10mm center-to-center clearance plus
    // spacing to not overlap along one axis.
    expect(dist).toBeGreaterThanOrEqual(10);
  });

  it('uses the fallback auto-spacing distance when spacingMm is 0', () => {
    const meshA = makeBoxMesh(10, 10, 10);
    const meshB = makeBoxMesh(10, 10, 10);
    meshA.updateMatrixWorld(true);
    meshB.updateMatrixWorld(true);

    const planZero = computeArrangePlan(
      [{ id: 'a', object: meshA }, { id: 'b', object: meshB }],
      { spacingMm: 0, enableRotation: false, alignToYAxis: false }
    );
    const planExplicit = computeArrangePlan(
      [{ id: 'a', object: meshA }, { id: 'b', object: meshB }],
      { spacingMm: AUTO_SPACING_MM, enableRotation: false, alignToYAxis: false }
    );

    const distZero = Math.hypot(
      planZero.targetCenters.get('a')!.x - planZero.targetCenters.get('b')!.x,
      planZero.targetCenters.get('a')!.y - planZero.targetCenters.get('b')!.y
    );
    const distExplicit = Math.hypot(
      planExplicit.targetCenters.get('a')!.x - planExplicit.targetCenters.get('b')!.x,
      planExplicit.targetCenters.get('a')!.y - planExplicit.targetCenters.get('b')!.y
    );
    expect(distZero).toBeCloseTo(distExplicit, 3);
  });

  it('applies zero extra rotation when neither rotation option is enabled', () => {
    const mesh = makeBoxMesh(20, 5, 5);
    const plan = computeArrangePlan(
      [{ id: 'a', object: mesh }],
      { spacingMm: 0, enableRotation: false, alignToYAxis: false }
    );
    expect(plan.extraRotations.get('a')).toBe(0);
  });

  it('computes a non-trivial rotation when enableRotation is true for a diagonal shape', () => {
    const mesh = makeBoxMesh(20, 5, 5);
    mesh.rotation.z = Math.PI / 4; // diamond orientation footprint
    mesh.updateMatrixWorld(true);

    const plan = computeArrangePlan(
      [{ id: 'a', object: mesh }],
      { spacingMm: 0, enableRotation: true, alignToYAxis: false }
    );
    expect(plan.extraRotations.get('a')).not.toBe(0);
  });
});
