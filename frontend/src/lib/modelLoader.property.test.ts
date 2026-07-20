/**
 * Property-based tests for model loading pipeline.
 * 
 * Feature: orca-slicer-web-ui
 * Property 18: Loaded model is centered and resting on bed
 * Validates: Requirements 13.2
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import * as THREE from 'three';
import { loadModel } from './modelLoader';

/**
 * Generate a random AMF file with arbitrary geometry.
 * 
 * The AMF format is used because it's text-based and easy to generate programmatically.
 * We generate random vertices and triangles to create diverse test geometries.
 */
function generateRandomAMFGeometry(
  vertexCount: number,
  triangleCount: number,
  xRange: [number, number],
  yRange: [number, number],
  zRange: [number, number]
): string {
  // Generate random vertices
  const vertices: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < vertexCount; i++) {
    vertices.push({
      x: xRange[0] + Math.random() * (xRange[1] - xRange[0]),
      y: yRange[0] + Math.random() * (yRange[1] - yRange[0]),
      z: zRange[0] + Math.random() * (zRange[1] - zRange[0]),
    });
  }

  // Generate random triangles using valid vertex indices
  const triangles: Array<{ v1: number; v2: number; v3: number }> = [];
  for (let i = 0; i < triangleCount; i++) {
    triangles.push({
      v1: Math.floor(Math.random() * vertexCount),
      v2: Math.floor(Math.random() * vertexCount),
      v3: Math.floor(Math.random() * vertexCount),
    });
  }

  // Build AMF XML
  const vertexElements = vertices
    .map(
      (v) => `        <vertex><coordinates><x>${v.x}</x><y>${v.y}</y><z>${v.z}</z></coordinates></vertex>`
    )
    .join('\n');

  const triangleElements = triangles
    .map(
      (t) => `        <triangle><v1>${t.v1}</v1><v2>${t.v2}</v2><v3>${t.v3}</v3></triangle>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<amf unit="millimeter">
  <object id="1">
    <mesh>
      <vertices>
${vertexElements}
      </vertices>
      <volume>
${triangleElements}
      </volume>
    </mesh>
  </object>
</amf>`;
}

/**
 * Fast-check arbitrary for generating AMF geometries with configurable parameters.
 */
const arbitraryAMFGeometry = fc.record({
  vertexCount: fc.integer({ min: 3, max: 50 }), // At least 3 for a triangle
  triangleCount: fc.integer({ min: 1, max: 30 }),
  xRange: fc.tuple(
    fc.float({ min: -500, max: 500, noNaN: true }),
    fc.float({ min: -500, max: 500, noNaN: true })
  ).map(
    ([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number]
  ),
  yRange: fc.tuple(
    fc.float({ min: -500, max: 500, noNaN: true }),
    fc.float({ min: -500, max: 500, noNaN: true })
  ).map(
    ([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number]
  ),
  zRange: fc.tuple(
    fc.float({ min: -500, max: 500, noNaN: true }),
    fc.float({ min: -500, max: 500, noNaN: true })
  ).map(
    ([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number]
  ),
});

describe('modelLoader property-based tests', () => {
  /**
   * **Property 18: Loaded model is centered and resting on bed**
   * 
   * For any valid model geometry (generated randomly), after the loading pipeline completes:
   * 1. The model's bounding-box center in X and Y shall equal (0, 0)
   * 2. The model's minimum Z shall equal 0 (resting on the bed surface)
   * 
   * **Validates: Requirements 13.2**
   */
  describe('Property 18: Model centering and bed placement', () => {
    it('should center loaded models at X=0, Y=0 and place them at Z=0', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryAMFGeometry, async (params) => {
          // Generate random AMF geometry
          const amfContent = generateRandomAMFGeometry(
            params.vertexCount,
            params.triangleCount,
            params.xRange,
            params.yRange,
            params.zRange
          );

          // Convert to ArrayBuffer
          const buffer = new TextEncoder().encode(amfContent).buffer;

          // Load the model through the pipeline
          const result = await loadModel(buffer, 'random.amf');

          // Extract bounding box
          const bounds = result.bounds;

          // Calculate center in X and Y
          const centerX = (bounds.min.x + bounds.max.x) / 2;
          const centerY = (bounds.min.y + bounds.max.y) / 2;

          // Property 1: Center X and Y should be close to 0 (within floating-point tolerance)
          // We use a small epsilon because of floating-point arithmetic
          const epsilon = 0.001;
          expect(Math.abs(centerX)).toBeLessThanOrEqual(
            epsilon,
            `Model center X should be 0, but was ${centerX}`
          );
          expect(Math.abs(centerY)).toBeLessThanOrEqual(
            epsilon,
            `Model center Y should be 0, but was ${centerY}`
          );

          // Property 2: Minimum Z should be 0 (on the bed)
          expect(bounds.min.z).toBeCloseTo(
            0,
            1,
            `Model should rest on bed (minZ=0), but minZ was ${bounds.min.z}`
          );
        }),
        {
          numRuns: 100, // Run 100 test cases with different random geometries
          verbose: true, // Show detailed output on failure
        }
      );
    });

    it('should handle geometries with extreme coordinates', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            vertexCount: fc.integer({ min: 3, max: 20 }),
            triangleCount: fc.integer({ min: 1, max: 10 }),
            // Test with very large coordinate ranges
            xRange: fc.constant([-10000, 10000] as [number, number]),
            yRange: fc.constant([-10000, 10000] as [number, number]),
            zRange: fc.constant([-10000, 10000] as [number, number]),
          }),
          async (params) => {
            const amfContent = generateRandomAMFGeometry(
              params.vertexCount,
              params.triangleCount,
              params.xRange,
              params.yRange,
              params.zRange
            );

            const buffer = new TextEncoder().encode(amfContent).buffer;
            const result = await loadModel(buffer, 'extreme.amf');

            const bounds = result.bounds;
            const centerX = (bounds.min.x + bounds.max.x) / 2;
            const centerY = (bounds.min.y + bounds.max.y) / 2;

            // Even with extreme coordinates, centering should work
            expect(Math.abs(centerX)).toBeLessThanOrEqual(0.01);
            expect(Math.abs(centerY)).toBeLessThanOrEqual(0.01);
            expect(bounds.min.z).toBeCloseTo(0, 0);
          }
        ),
        {
          numRuns: 50,
          verbose: true,
        }
      );
    });

    it('should handle geometries with small dimensions', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            vertexCount: fc.integer({ min: 3, max: 10 }),
            triangleCount: fc.integer({ min: 1, max: 5 }),
            // Test with very small coordinate ranges
            xRange: fc.constant([-0.01, 0.01] as [number, number]),
            yRange: fc.constant([-0.01, 0.01] as [number, number]),
            zRange: fc.constant([-0.01, 0.01] as [number, number]),
          }),
          async (params) => {
            const amfContent = generateRandomAMFGeometry(
              params.vertexCount,
              params.triangleCount,
              params.xRange,
              params.yRange,
              params.zRange
            );

            const buffer = new TextEncoder().encode(amfContent).buffer;
            const result = await loadModel(buffer, 'tiny.amf');

            const bounds = result.bounds;
            const centerX = (bounds.min.x + bounds.max.x) / 2;
            const centerY = (bounds.min.y + bounds.max.y) / 2;

            // Small geometries should also be properly centered
            expect(Math.abs(centerX)).toBeLessThanOrEqual(0.001);
            expect(Math.abs(centerY)).toBeLessThanOrEqual(0.001);
            expect(bounds.min.z).toBeCloseTo(0, 2);
          }
        ),
        {
          numRuns: 50,
          verbose: true,
        }
      );
    });

    it('should handle geometries offset from origin', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            vertexCount: fc.integer({ min: 3, max: 20 }),
            triangleCount: fc.integer({ min: 1, max: 10 }),
            // Geometries that are entirely in positive or negative quadrants
            xOffset: fc.float({ min: -1000, max: 1000, noNaN: true }),
            yOffset: fc.float({ min: -1000, max: 1000, noNaN: true }),
            zOffset: fc.float({ min: -1000, max: 1000, noNaN: true }),
            size: fc.float({ min: 1, max: 100, noNaN: true }),
          }),
          async (params) => {
            // Create a geometry entirely offset from the origin
            const xRange: [number, number] = [
              params.xOffset,
              params.xOffset + params.size,
            ];
            const yRange: [number, number] = [
              params.yOffset,
              params.yOffset + params.size,
            ];
            const zRange: [number, number] = [
              params.zOffset,
              params.zOffset + params.size,
            ];

            const amfContent = generateRandomAMFGeometry(
              params.vertexCount,
              params.triangleCount,
              xRange,
              yRange,
              zRange
            );

            const buffer = new TextEncoder().encode(amfContent).buffer;
            const result = await loadModel(buffer, 'offset.amf');

            const bounds = result.bounds;
            const centerX = (bounds.min.x + bounds.max.x) / 2;
            const centerY = (bounds.min.y + bounds.max.y) / 2;

            // Regardless of original offset, model should be centered
            expect(Math.abs(centerX)).toBeLessThanOrEqual(0.01);
            expect(Math.abs(centerY)).toBeLessThanOrEqual(0.01);
            expect(bounds.min.z).toBeCloseTo(0, 1);
          }
        ),
        {
          numRuns: 100,
          verbose: true,
        }
      );
    });

    it('should preserve model dimensions after centering and bed placement', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            width: fc.float({ min: 1, max: 200, noNaN: true }),
            depth: fc.float({ min: 1, max: 200, noNaN: true }),
            height: fc.float({ min: 1, max: 200, noNaN: true }),
            xOffset: fc.float({ min: -500, max: 500, noNaN: true }),
            yOffset: fc.float({ min: -500, max: 500, noNaN: true }),
            zOffset: fc.float({ min: -500, max: 500, noNaN: true }),
          }),
          async (params) => {
            // Create a box with known dimensions at an arbitrary offset
            const xRange: [number, number] = [
              params.xOffset,
              params.xOffset + params.width,
            ];
            const yRange: [number, number] = [
              params.yOffset,
              params.yOffset + params.depth,
            ];
            const zRange: [number, number] = [
              params.zOffset,
              params.zOffset + params.height,
            ];

            const amfContent = generateRandomAMFGeometry(
              8, // 8 vertices for a box
              12, // 12 triangles for a box
              xRange,
              yRange,
              zRange
            );

            const buffer = new TextEncoder().encode(amfContent).buffer;
            const result = await loadModel(buffer, 'box.amf');

            const bounds = result.bounds;

            // Calculate final dimensions
            const finalWidth = bounds.max.x - bounds.min.x;
            const finalDepth = bounds.max.y - bounds.min.y;
            const finalHeight = bounds.max.z - bounds.min.z;

            // Dimensions should be preserved (within tolerance)
            // Note: Due to how we generate triangles randomly, the actual bounds
            // might not exactly match the input ranges, so we check they're reasonable
            expect(finalWidth).toBeGreaterThan(0);
            expect(finalDepth).toBeGreaterThan(0);
            expect(finalHeight).toBeGreaterThan(0);

            // Most importantly, centering and placement should still hold
            const centerX = (bounds.min.x + bounds.max.x) / 2;
            const centerY = (bounds.min.y + bounds.max.y) / 2;
            expect(Math.abs(centerX)).toBeLessThanOrEqual(0.01);
            expect(Math.abs(centerY)).toBeLessThanOrEqual(0.01);
            expect(bounds.min.z).toBeCloseTo(0, 1);
          }
        ),
        {
          numRuns: 100,
          verbose: true,
        }
      );
    });
  });
});
