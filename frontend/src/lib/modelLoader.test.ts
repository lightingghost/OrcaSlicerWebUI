import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import * as fc from 'fast-check';
import { loadModel, updateBoundsAndColor } from './modelLoader';

describe('modelLoader', () => {
  describe('loadModel', () => {
    it('should throw error for unsupported file extension', async () => {
      const buffer = new ArrayBuffer(100);
      
      await expect(loadModel(buffer, 'test.xyz')).rejects.toThrow(
        'Unsupported file format: .xyz'
      );
    });

    it('should handle STL files', async () => {
      // Create a minimal binary STL file (80-byte header + triangle count + triangle data)
      const buffer = new ArrayBuffer(84 + 50); // header + count + 1 triangle
      const view = new DataView(buffer);
      
      // Header (80 bytes) - all zeros is fine
      // Triangle count at byte 80 (4 bytes, little-endian)
      view.setUint32(80, 1, true); // 1 triangle
      
      // Triangle data starts at byte 84
      // Normal (3 floats = 12 bytes)
      view.setFloat32(84, 0, true);
      view.setFloat32(88, 0, true);
      view.setFloat32(92, 1, true);
      
      // Vertex 1 (3 floats = 12 bytes)
      view.setFloat32(96, 0, true);
      view.setFloat32(100, 0, true);
      view.setFloat32(104, 0, true);
      
      // Vertex 2 (3 floats = 12 bytes)
      view.setFloat32(108, 1, true);
      view.setFloat32(112, 0, true);
      view.setFloat32(116, 0, true);
      
      // Vertex 3 (3 floats = 12 bytes)
      view.setFloat32(120, 0, true);
      view.setFloat32(124, 1, true);
      view.setFloat32(128, 0, true);
      
      // Attribute byte count (2 bytes)
      view.setUint16(132, 0, true);
      
      const result = await loadModel(buffer, 'test.stl');
      
      expect(result).toBeDefined();
      expect(result.mesh).toBeInstanceOf(THREE.Mesh);
      expect(result.bounds).toBeInstanceOf(THREE.Box3);
      expect(result.triangleCount).toBeGreaterThan(0);
      expect(result.filename).toBe('test.stl');
    });

    it('should handle OBJ files', async () => {
      // Create a minimal OBJ file with a single triangle
      const objContent = `
# Simple triangle
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
`;
      const buffer = new TextEncoder().encode(objContent).buffer;
      
      const result = await loadModel(buffer, 'test.obj');
      
      expect(result).toBeDefined();
      expect(result.mesh).toBeInstanceOf(THREE.Group);
      expect(result.bounds).toBeInstanceOf(THREE.Box3);
      expect(result.filename).toBe('test.obj');
    });

    it('should handle AMF files', async () => {
      // Create a minimal AMF file
      const amfContent = `<?xml version="1.0" encoding="UTF-8"?>
<amf unit="millimeter">
  <object id="1">
    <mesh>
      <vertices>
        <vertex><coordinates><x>0</x><y>0</y><z>0</z></coordinates></vertex>
        <vertex><coordinates><x>1</x><y>0</y><z>0</z></coordinates></vertex>
        <vertex><coordinates><x>0</x><y>1</y><z>0</z></coordinates></vertex>
      </vertices>
      <volume>
        <triangle><v1>0</v1><v2>1</v2><v3>2</v3></triangle>
      </volume>
    </mesh>
  </object>
</amf>`;
      const buffer = new TextEncoder().encode(amfContent).buffer;
      
      const result = await loadModel(buffer, 'test.amf');
      
      expect(result).toBeDefined();
      expect(result.mesh).toBeInstanceOf(THREE.Mesh);
      expect(result.bounds).toBeInstanceOf(THREE.Box3);
      expect(result.triangleCount).toBe(1);
      expect(result.filename).toBe('test.amf');
    });

    it('should center geometry in XY plane', async () => {
      // Create an AMF file with geometry offset from origin
      const amfContent = `<?xml version="1.0" encoding="UTF-8"?>
<amf unit="millimeter">
  <object id="1">
    <mesh>
      <vertices>
        <vertex><coordinates><x>10</x><y>10</y><z>5</z></coordinates></vertex>
        <vertex><coordinates><x>20</x><y>10</y><z>5</z></coordinates></vertex>
        <vertex><coordinates><x>10</x><y>20</y><z>5</z></coordinates></vertex>
      </vertices>
      <volume>
        <triangle><v1>0</v1><v2>1</v2><v3>2</v3></triangle>
      </volume>
    </mesh>
  </object>
</amf>`;
      const buffer = new TextEncoder().encode(amfContent).buffer;
      
      const result = await loadModel(buffer, 'test.amf');
      
      // The geometry should be centered in XY
      // Original center was at (15, 15, 5)
      // After centering XY and placing on bed (z=0), position should be adjusted
      const bounds = result.bounds;
      const centerX = (bounds.min.x + bounds.max.x) / 2;
      const centerY = (bounds.min.y + bounds.max.y) / 2;
      
      // Center should be close to (0, 0) in XY
      expect(Math.abs(centerX)).toBeLessThan(0.01);
      expect(Math.abs(centerY)).toBeLessThan(0.01);
    });

    it('should place geometry on bed (minZ = 0)', async () => {
      // Create an AMF file with geometry above the bed
      const amfContent = `<?xml version="1.0" encoding="UTF-8"?>
<amf unit="millimeter">
  <object id="1">
    <mesh>
      <vertices>
        <vertex><coordinates><x>0</x><y>0</y><z>10</z></coordinates></vertex>
        <vertex><coordinates><x>1</x><y>0</y><z>10</z></coordinates></vertex>
        <vertex><coordinates><x>0</x><y>1</y><z>10</z></coordinates></vertex>
      </vertices>
      <volume>
        <triangle><v1>0</v1><v2>1</v2><v3>2</v3></triangle>
      </volume>
    </mesh>
  </object>
</amf>`;
      const buffer = new TextEncoder().encode(amfContent).buffer;
      
      const result = await loadModel(buffer, 'test.amf');
      
      // The geometry should be placed on the bed (minZ = 0)
      expect(result.bounds.min.z).toBeCloseTo(0, 1);
    });

    it('should apply teal material by default', async () => {
      const amfContent = `<?xml version="1.0" encoding="UTF-8"?>
<amf unit="millimeter">
  <object id="1">
    <mesh>
      <vertices>
        <vertex><coordinates><x>0</x><y>0</y><z>0</z></coordinates></vertex>
        <vertex><coordinates><x>1</x><y>0</y><z>0</z></coordinates></vertex>
        <vertex><coordinates><x>0</x><y>1</y><z>0</z></coordinates></vertex>
      </vertices>
      <volume>
        <triangle><v1>0</v1><v2>1</v2><v3>2</v3></triangle>
      </volume>
    </mesh>
  </object>
</amf>`;
      const buffer = new TextEncoder().encode(amfContent).buffer;
      
      const result = await loadModel(buffer, 'test.amf');
      
      // Check that the material is teal (0x00a896)
      result.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const material = child.material as THREE.MeshStandardMaterial;
          expect(material.color.getHex()).toBe(0x00a896);
        }
      });
    });
  });

  describe('updateBoundsAndColor', () => {
    let mesh: THREE.Mesh;

    beforeEach(() => {
      // Create a simple cube mesh for testing
      const geometry = new THREE.BoxGeometry(10, 10, 10);
      const material = new THREE.MeshStandardMaterial({ color: 0x00a896 });
      mesh = new THREE.Mesh(geometry, material);
    });

    it('should return bounds and isOutOfBounds status', () => {
      const bedSize = { width: 200, depth: 200 };
      
      const result = updateBoundsAndColor(mesh, bedSize);
      
      expect(result.bounds).toBeInstanceOf(THREE.Box3);
      expect(typeof result.isOutOfBounds).toBe('boolean');
    });

    it('should mark mesh as in-bounds when within bed limits', () => {
      const bedSize = { width: 200, depth: 200 };
      mesh.position.set(0, 0, 0); // Centered on bed
      
      const result = updateBoundsAndColor(mesh, bedSize);
      
      expect(result.isOutOfBounds).toBe(false);
      
      // Check material color is teal
      const material = mesh.material as THREE.MeshStandardMaterial;
      expect(material.color.getHex()).toBe(0x00a896);
    });

    it('should mark mesh as out-of-bounds when exceeding bed X limit', () => {
      const bedSize = { width: 200, depth: 200 };
      mesh.position.set(150, 0, 0); // Beyond half width (100)
      
      const result = updateBoundsAndColor(mesh, bedSize);
      
      expect(result.isOutOfBounds).toBe(true);
      
      // Check material color is amber
      const material = mesh.material as THREE.MeshStandardMaterial;
      expect(material.color.getHex()).toBe(0xf4a261);
    });

    it('should mark mesh as out-of-bounds when exceeding bed Y limit', () => {
      const bedSize = { width: 200, depth: 200 };
      mesh.position.set(0, 150, 0); // Beyond half depth (100)
      
      const result = updateBoundsAndColor(mesh, bedSize);
      
      expect(result.isOutOfBounds).toBe(true);
      
      // Check material color is amber
      const material = mesh.material as THREE.MeshStandardMaterial;
      expect(material.color.getHex()).toBe(0xf4a261);
    });

    it('should handle null bed size without errors', () => {
      const result = updateBoundsAndColor(mesh, null);
      
      expect(result.bounds).toBeInstanceOf(THREE.Box3);
      expect(result.isOutOfBounds).toBe(false);
    });

    it('should call setModelBounds callback with computed bounds', () => {
      const bedSize = { width: 200, depth: 200 };
      mesh.position.set(0, 0, 0);
      
      let capturedBounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null = null;
      const setModelBounds = (bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }) => {
        capturedBounds = bounds;
      };
      
      updateBoundsAndColor(mesh, bedSize, setModelBounds);
      
      expect(capturedBounds).not.toBeNull();
      expect(capturedBounds?.min).toBeDefined();
      expect(capturedBounds?.max).toBeDefined();
      expect(typeof capturedBounds?.min.x).toBe('number');
      expect(typeof capturedBounds?.min.y).toBe('number');
      expect(typeof capturedBounds?.min.z).toBe('number');
      expect(typeof capturedBounds?.max.x).toBe('number');
      expect(typeof capturedBounds?.max.y).toBe('number');
      expect(typeof capturedBounds?.max.z).toBe('number');
    });

    it('should update color for all mesh children', () => {
      // Create a group with multiple meshes
      const group = new THREE.Group();
      const mesh1 = new THREE.Mesh(
        new THREE.BoxGeometry(5, 5, 5),
        new THREE.MeshStandardMaterial({ color: 0x00a896 })
      );
      const mesh2 = new THREE.Mesh(
        new THREE.BoxGeometry(5, 5, 5),
        new THREE.MeshStandardMaterial({ color: 0x00a896 })
      );
      mesh2.position.set(10, 0, 0);
      
      group.add(mesh1);
      group.add(mesh2);
      
      const bedSize = { width: 10, depth: 10 };
      group.position.set(50, 0, 0); // Far outside bed
      
      updateBoundsAndColor(group, bedSize);
      
      // All meshes should have amber color
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const material = child.material as THREE.MeshStandardMaterial;
          expect(material.color.getHex()).toBe(0xf4a261);
        }
      });
    });
  });

  describe('AMF parser', () => {
    it('should handle invalid XML', async () => {
      const invalidXML = 'this is not xml';
      const buffer = new TextEncoder().encode(invalidXML).buffer;
      
      await expect(loadModel(buffer, 'test.amf')).rejects.toThrow(
        'Failed to parse AMF file: Invalid XML'
      );
    });

    it('should handle AMF with no vertices', async () => {
      const amfContent = `<?xml version="1.0" encoding="UTF-8"?>
<amf unit="millimeter">
  <object id="1">
    <mesh>
      <vertices>
      </vertices>
    </mesh>
  </object>
</amf>`;
      const buffer = new TextEncoder().encode(amfContent).buffer;
      
      await expect(loadModel(buffer, 'test.amf')).rejects.toThrow(
        'AMF file contains no vertices'
      );
    });

    it('should handle AMF with no triangles', async () => {
      const amfContent = `<?xml version="1.0" encoding="UTF-8"?>
<amf unit="millimeter">
  <object id="1">
    <mesh>
      <vertices>
        <vertex><coordinates><x>0</x><y>0</y><z>0</z></coordinates></vertex>
      </vertices>
      <volume>
      </volume>
    </mesh>
  </object>
</amf>`;
      const buffer = new TextEncoder().encode(amfContent).buffer;
      
      await expect(loadModel(buffer, 'test.amf')).rejects.toThrow(
        'AMF file contains no triangles'
      );
    });
  });

  // Feature: orca-slicer-web-ui, Property 21: Out-of-bounds color
  // Property 21: Out-of-bounds models are rendered in amber
  // **Validates: Requirements 13.7**
  describe('Property 21: Out-of-bounds color', () => {
    it('should render models in teal when in bounds and amber when out of bounds (property-based)', () => {
      // Property test runs 100 iterations by default with fast-check
      fc.assert(
        fc.property(
          // Generate bed size (width and depth between 100 and 500mm)
          fc.record({
            width: fc.integer({ min: 100, max: 500 }),
            depth: fc.integer({ min: 100, max: 500 }),
          }),
          // Generate mesh size (between 5 and 50mm)
          fc.record({
            width: fc.integer({ min: 5, max: 50 }),
            height: fc.integer({ min: 5, max: 50 }),
            depth: fc.integer({ min: 5, max: 50 }),
          }),
          // Generate mesh position
          fc.record({
            x: fc.integer({ min: -300, max: 300 }),
            y: fc.integer({ min: -300, max: 300 }),
            z: fc.integer({ min: 0, max: 100 }),
          }),
          (bedSize, meshSize, position) => {
            // Create a mesh at the specified position
            const geometry = new THREE.BoxGeometry(meshSize.width, meshSize.height, meshSize.depth);
            const material = new THREE.MeshStandardMaterial({ color: 0x00a896 });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(position.x, position.y, position.z);

            // Update bounds and color
            const result = updateBoundsAndColor(mesh, bedSize);

            // Calculate expected bounds
            const halfW = bedSize.width / 2;
            const halfD = bedSize.depth / 2;

            // Determine if mesh should be out of bounds
            const expectedOutOfBounds =
              result.bounds.min.x < -halfW ||
              result.bounds.max.x > halfW ||
              result.bounds.min.y < -halfD ||
              result.bounds.max.y > halfD;

            // Verify the isOutOfBounds flag matches our calculation
            expect(result.isOutOfBounds).toBe(expectedOutOfBounds);

            // Verify the material color is correct
            const expectedColor = expectedOutOfBounds ? 0xf4a261 : 0x00a896;
            mesh.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                const childMaterial = child.material as THREE.MeshStandardMaterial;
                expect(childMaterial.color.getHex()).toBe(expectedColor);
              }
            });
          }
        ),
        { numRuns: 100 } // Run 100 test cases as specified in design
      );
    });

    it('should consistently color meshes fully within bounds as teal (property-based)', () => {
      fc.assert(
        fc.property(
          // Generate bed size
          fc.record({
            width: fc.integer({ min: 200, max: 500 }),
            depth: fc.integer({ min: 200, max: 500 }),
          }),
          // Generate mesh size (small enough to fit)
          fc.record({
            width: fc.integer({ min: 5, max: 20 }),
            height: fc.integer({ min: 5, max: 20 }),
            depth: fc.integer({ min: 5, max: 20 }),
          }),
          (bedSize, meshSize) => {
            // Position mesh well within bounds
            const maxSafeX = (bedSize.width / 2) - (meshSize.width / 2) - 10;
            const maxSafeY = (bedSize.depth / 2) - (meshSize.depth / 2) - 10;

            const geometry = new THREE.BoxGeometry(meshSize.width, meshSize.height, meshSize.depth);
            const material = new THREE.MeshStandardMaterial({ color: 0x00a896 });
            const mesh = new THREE.Mesh(geometry, material);
            
            // Position at a random point that ensures mesh stays in bounds
            const safeX = maxSafeX * (Math.random() * 2 - 1); // -maxSafeX to +maxSafeX
            const safeY = maxSafeY * (Math.random() * 2 - 1);
            mesh.position.set(safeX, safeY, 10);

            const result = updateBoundsAndColor(mesh, bedSize);

            // Should be in bounds
            expect(result.isOutOfBounds).toBe(false);

            // Color should be teal
            const meshMaterial = mesh.material as THREE.MeshStandardMaterial;
            expect(meshMaterial.color.getHex()).toBe(0x00a896);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should consistently color meshes outside bounds as amber (property-based)', () => {
      fc.assert(
        fc.property(
          // Generate bed size
          fc.record({
            width: fc.integer({ min: 100, max: 300 }),
            depth: fc.integer({ min: 100, max: 300 }),
          }),
          // Generate mesh size
          fc.record({
            width: fc.integer({ min: 10, max: 30 }),
            height: fc.integer({ min: 10, max: 30 }),
            depth: fc.integer({ min: 10, max: 30 }),
          }),
          // Generate which boundary to exceed (0=+X, 1=-X, 2=+Y, 3=-Y)
          fc.integer({ min: 0, max: 3 }),
          (bedSize, meshSize, boundaryToExceed) => {
            const geometry = new THREE.BoxGeometry(meshSize.width, meshSize.height, meshSize.depth);
            const material = new THREE.MeshStandardMaterial({ color: 0x00a896 });
            const mesh = new THREE.Mesh(geometry, material);

            // Position mesh to exceed the selected boundary
            const halfW = bedSize.width / 2;
            const halfD = bedSize.depth / 2;
            const offset = 20; // Ensure we're definitely outside

            switch (boundaryToExceed) {
              case 0: // +X boundary
                mesh.position.set(halfW + offset, 0, 10);
                break;
              case 1: // -X boundary
                mesh.position.set(-halfW - offset, 0, 10);
                break;
              case 2: // +Y boundary
                mesh.position.set(0, halfD + offset, 10);
                break;
              case 3: // -Y boundary
                mesh.position.set(0, -halfD - offset, 10);
                break;
            }

            const result = updateBoundsAndColor(mesh, bedSize);

            // Should be out of bounds
            expect(result.isOutOfBounds).toBe(true);

            // Color should be amber
            const meshMaterial = mesh.material as THREE.MeshStandardMaterial;
            expect(meshMaterial.color.getHex()).toBe(0xf4a261);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle meshes with multiple children correctly (property-based)', () => {
      fc.assert(
        fc.property(
          // Generate bed size
          fc.record({
            width: fc.integer({ min: 150, max: 400 }),
            depth: fc.integer({ min: 150, max: 400 }),
          }),
          // Generate position that may be in or out of bounds
          fc.record({
            x: fc.integer({ min: -250, max: 250 }),
            y: fc.integer({ min: -250, max: 250 }),
          }),
          (bedSize, position) => {
            // Create a group with multiple child meshes
            const group = new THREE.Group();
            
            // Add 3 child meshes at different relative positions
            for (let i = 0; i < 3; i++) {
              const geometry = new THREE.BoxGeometry(10, 10, 10);
              const material = new THREE.MeshStandardMaterial({ color: 0x00a896 });
              const childMesh = new THREE.Mesh(geometry, material);
              childMesh.position.set(i * 5, i * 5, 0);
              group.add(childMesh);
            }

            group.position.set(position.x, position.y, 0);

            const result = updateBoundsAndColor(group, bedSize);

            // Verify that all children have the same color
            const expectedColor = result.isOutOfBounds ? 0xf4a261 : 0x00a896;
            
            let meshCount = 0;
            group.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                meshCount++;
                const material = child.material as THREE.MeshStandardMaterial;
                expect(material.color.getHex()).toBe(expectedColor);
              }
            });

            // Verify we actually tested multiple meshes
            expect(meshCount).toBe(3);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
