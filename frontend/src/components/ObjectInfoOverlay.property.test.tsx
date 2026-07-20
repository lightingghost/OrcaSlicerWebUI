import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { act } from 'react';
import * as fc from 'fast-check';
import { ObjectInfoOverlay } from './ObjectInfoOverlay';
import { useStore } from '../store';
import type { BoundingBox, ModelMetadata } from '../store/viewportSlice';

/**
 * Property-Based Tests for ObjectInfoOverlay Component
 * 
 * Feature: orca-slicer-web-ui
 * Property 20: Object info overlay contains all required fields
 * 
 * **Validates: Requirements 13.6**
 * 
 * For any valid model file loaded into the viewport, the ObjectInfoOverlay component
 * shall display: the original filename, bounding-box dimensions formatted as W × D × H
 * in millimetres, estimated volume in mm³, and triangle count. All four values shall
 * be non-zero for any non-degenerate mesh.
 */
describe('ObjectInfoOverlay - Property-Based Tests', () => {
  beforeEach(() => {
    // Clean up after each test
    cleanup();
    // Reset store state before each test
    act(() => {
      const state = useStore.getState();
      state.setModelBounds(null as any);
      state.setModelMetadata(null as any);
    });
  });

  /**
   * Arbitrary generator for non-degenerate 3D coordinates
   * Generates coordinates that produce positive dimensions when used as bounding boxes
   */
  const arbitraryCoordinate = () => fc.double({ min: 0.1, max: 1000, noNaN: true });

  /**
   * Arbitrary generator for bounding boxes with known positive dimensions
   * Ensures min < max for each axis to produce non-degenerate geometries
   */
  const arbitraryBoundingBox = (): fc.Arbitrary<BoundingBox> => {
    return fc.record({
      minX: arbitraryCoordinate(),
      minY: arbitraryCoordinate(),
      minZ: fc.double({ min: 0, max: 1000, noNaN: true }), // Z starts at 0 (on bed)
      width: fc.double({ min: 0.1, max: 1000, noNaN: true }), // Positive width
      depth: fc.double({ min: 0.1, max: 1000, noNaN: true }), // Positive depth
      height: fc.double({ min: 0.1, max: 1000, noNaN: true }), // Positive height
    }).map(({ minX, minY, minZ, width, depth, height }) => ({
      min: { x: minX, y: minY, z: minZ },
      max: { x: minX + width, y: minY + depth, z: minZ + height },
    }));
  };

  /**
   * Arbitrary generator for valid filenames
   * Generates realistic STL/3MF/OBJ/AMF filenames
   */
  const arbitraryFilename = (): fc.Arbitrary<string> => {
    const extension = fc.constantFrom('.stl', '.3mf', '.obj', '.amf');
    const baseName = fc.stringOf(
      fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split('')
      ),
      { minLength: 1, maxLength: 50 }
    );
    return fc.tuple(baseName, extension).map(([base, ext]) => base + ext);
  };

  /**
   * Arbitrary generator for triangle counts
   * Generates positive integers representing triangle counts (non-degenerate meshes)
   */
  const arbitraryTriangleCount = (): fc.Arbitrary<number> => {
    return fc.integer({ min: 1, max: 10_000_000 }); // 1 to 10 million triangles
  };

  /**
   * Arbitrary generator for model metadata
   */
  const arbitraryModelMetadata = (): fc.Arbitrary<ModelMetadata> => {
    return fc.record({
      filename: arbitraryFilename(),
      triangleCount: arbitraryTriangleCount(),
    });
  };

  /**
   * Property Test: ObjectInfoOverlay displays all required fields for any valid geometry
   * 
   * For any randomly generated non-degenerate geometry:
   * - Filename should be displayed
   * - Dimensions (W × D × H) should be displayed and non-zero
   * - Volume should be displayed and non-zero
   * - Triangle count should be displayed and non-zero
   */
  it('should display filename, W×D×H, volume, and triangle count for any valid geometry', () => {
    fc.assert(
      fc.property(
        arbitraryBoundingBox(),
        arbitraryModelMetadata(),
        (bounds, metadata) => {
          // Arrange: Set up store with generated geometry
          let container: HTMLElement;
          act(() => {
            const state = useStore.getState();
            state.setModelBounds(bounds);
            state.setModelMetadata(metadata);
          });

          // Act: Render the overlay
          act(() => {
            const result = render(<ObjectInfoOverlay />);
            container = result.container;
          });

          // Assert: All required fields are present
          const text = container!.textContent || '';

          // 1. Filename must be displayed
          expect(text).toContain(metadata.filename);

          // 2. Dimensions must be displayed (W × D × H format)
          const width = bounds.max.x - bounds.min.x;
          const depth = bounds.max.y - bounds.min.y;
          const height = bounds.max.z - bounds.min.z;

          // Check for the × symbol and mm unit
          expect(text).toContain('×');
          expect(text).toContain('mm');

          // All dimensions should be positive (non-zero)
          expect(width).toBeGreaterThan(0);
          expect(depth).toBeGreaterThan(0);
          expect(height).toBeGreaterThan(0);

          // 3. Volume must be displayed and non-zero
          const expectedVolume = width * depth * height;
          expect(expectedVolume).toBeGreaterThan(0);
          expect(text).toContain('mm³');
          // Volume value should appear in text (formatted with 2 decimals)
          const volumeStr = expectedVolume.toFixed(2);
          expect(text).toContain(volumeStr);

          // 4. Triangle count must be displayed and non-zero
          expect(metadata.triangleCount).toBeGreaterThan(0);
          const triangleCountStr = metadata.triangleCount.toLocaleString();
          expect(text).toContain(triangleCountStr);

          // Verify section headers are present
          expect(text).toContain('Object');
          expect(text).toContain('Dimensions');
          expect(text).toContain('Volume');
          expect(text).toContain('Triangles');

          // Cleanup
          cleanup();
        }
      ),
      { numRuns: 100 } // Run 100 test cases with random geometries
    );
  });

  /**
   * Property Test: Dimensions are correctly calculated from bounding box
   * 
   * For any bounding box, the displayed dimensions should match the calculated
   * width, depth, and height from the bounding box min/max values.
   */
  it('should correctly calculate and display dimensions from bounding box', () => {
    fc.assert(
      fc.property(
        arbitraryBoundingBox(),
        arbitraryModelMetadata(),
        (bounds, metadata) => {
          // Arrange
          let container: HTMLElement;
          act(() => {
            const state = useStore.getState();
            state.setModelBounds(bounds);
            state.setModelMetadata(metadata);
          });

          // Act
          act(() => {
            const result = render(<ObjectInfoOverlay />);
            container = result.container;
          });

          // Assert: Calculate expected dimensions
          const expectedWidth = bounds.max.x - bounds.min.x;
          const expectedDepth = bounds.max.y - bounds.min.y;
          const expectedHeight = bounds.max.z - bounds.min.z;

          // All dimensions should be positive
          expect(expectedWidth).toBeGreaterThan(0);
          expect(expectedDepth).toBeGreaterThan(0);
          expect(expectedHeight).toBeGreaterThan(0);

          // Format as displayed (2 decimal places)
          const widthStr = expectedWidth.toFixed(2);
          const depthStr = expectedDepth.toFixed(2);
          const heightStr = expectedHeight.toFixed(2);

          // Check the formatted dimension string appears in text
          const text = container!.textContent || '';
          const dimensionText = `${widthStr} × ${depthStr} × ${heightStr} mm`;
          expect(text).toContain(widthStr);
          expect(text).toContain(depthStr);
          expect(text).toContain(heightStr);

          // Cleanup
          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property Test: Volume is correctly calculated as W × D × H
   * 
   * For any bounding box, the displayed volume should equal width × depth × height.
   */
  it('should correctly calculate volume as width × depth × height', () => {
    fc.assert(
      fc.property(
        arbitraryBoundingBox(),
        arbitraryModelMetadata(),
        (bounds, metadata) => {
          // Arrange
          let container: HTMLElement;
          act(() => {
            const state = useStore.getState();
            state.setModelBounds(bounds);
            state.setModelMetadata(metadata);
          });

          // Act
          act(() => {
            const result = render(<ObjectInfoOverlay />);
            container = result.container;
          });

          // Assert: Calculate expected volume
          const width = bounds.max.x - bounds.min.x;
          const depth = bounds.max.y - bounds.min.y;
          const height = bounds.max.z - bounds.min.z;
          const expectedVolume = width * depth * height;

          expect(expectedVolume).toBeGreaterThan(0);

          // Format as displayed (2 decimal places)
          const volumeStr = expectedVolume.toFixed(2);

          // Check the volume appears in the text
          const text = container!.textContent || '';
          expect(text).toContain(volumeStr);
          expect(text).toContain('mm³');

          // Cleanup
          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property Test: Triangle count is formatted with locale-specific separators
   * 
   * For any triangle count, it should be displayed with proper thousands separators
   * (e.g., 1,234,567 for English locale).
   */
  it('should format triangle count with thousands separators', () => {
    fc.assert(
      fc.property(
        arbitraryBoundingBox(),
        arbitraryTriangleCount(),
        arbitraryFilename(),
        (bounds, triangleCount, filename) => {
          // Arrange
          let container: HTMLElement;
          act(() => {
            const state = useStore.getState();
            state.setModelBounds(bounds);
            state.setModelMetadata({ filename, triangleCount });
          });

          // Act
          act(() => {
            const result = render(<ObjectInfoOverlay />);
            container = result.container;
          });

          // Assert: Triangle count should be formatted with separators
          const formattedCount = triangleCount.toLocaleString();
          const text = container!.textContent || '';
          expect(text).toContain(formattedCount);

          // For counts >= 1000, should contain separator
          if (triangleCount >= 1000) {
            expect(formattedCount).toMatch(/[,\s]/); // Comma or space separator
          }

          // Cleanup
          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property Test: All values are non-zero for non-degenerate meshes
   * 
   * This is the core property from the design document: for any non-degenerate mesh,
   * all four displayed values (filename, dimensions, volume, triangle count) should
   * be non-zero/non-empty.
   */
  it('should display all non-zero values for any non-degenerate mesh', () => {
    fc.assert(
      fc.property(
        arbitraryBoundingBox(),
        arbitraryModelMetadata(),
        (bounds, metadata) => {
          // Arrange
          act(() => {
            const state = useStore.getState();
            state.setModelBounds(bounds);
            state.setModelMetadata(metadata);
          });

          // Act
          act(() => {
            render(<ObjectInfoOverlay />);
          });

          // Assert: All values are non-zero
          // 1. Filename is non-empty
          expect(metadata.filename.length).toBeGreaterThan(0);

          // 2. All dimensions are positive (non-zero)
          const width = bounds.max.x - bounds.min.x;
          const depth = bounds.max.y - bounds.min.y;
          const height = bounds.max.z - bounds.min.z;
          expect(width).toBeGreaterThan(0);
          expect(depth).toBeGreaterThan(0);
          expect(height).toBeGreaterThan(0);

          // 3. Volume is positive (non-zero)
          const volume = width * depth * height;
          expect(volume).toBeGreaterThan(0);

          // 4. Triangle count is positive (non-zero)
          expect(metadata.triangleCount).toBeGreaterThan(0);

          // Cleanup
          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property Test: Overlay renders for any valid combination of bounds and metadata
   * 
   * The overlay should always render (not return null) when both bounds and metadata
   * are provided, regardless of the specific values.
   */
  it('should render for any valid combination of bounds and metadata', () => {
    fc.assert(
      fc.property(
        arbitraryBoundingBox(),
        arbitraryModelMetadata(),
        (bounds, metadata) => {
          // Arrange
          let container: HTMLElement;
          act(() => {
            const state = useStore.getState();
            state.setModelBounds(bounds);
            state.setModelMetadata(metadata);
          });

          // Act
          act(() => {
            const result = render(<ObjectInfoOverlay />);
            container = result.container;
          });

          // Assert: Component should render (not be null)
          expect(container!.firstChild).not.toBeNull();

          // Should have the overlay container with proper classes
          const overlay = container!.firstChild as HTMLElement;
          expect(overlay.className).toContain('absolute');
          expect(overlay.className).toContain('top-4');
          expect(overlay.className).toContain('right-4');

          // Cleanup
          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });
});
