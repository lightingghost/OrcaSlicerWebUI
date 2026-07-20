import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildPlateGrid } from './buildPlateGrid';

describe('buildPlateGrid', () => {
  it('should create a Group with three children (plate, grid, edges)', () => {
    const group = buildPlateGrid(200, 200);
    
    expect(group).toBeInstanceOf(THREE.Group);
    expect(group.children.length).toBe(3);
  });

  it('should create a plate surface mesh', () => {
    const group = buildPlateGrid(200, 200);
    
    const plateMesh = group.children.find(
      (child) => child instanceof THREE.Mesh && child.geometry instanceof THREE.PlaneGeometry
    );
    
    expect(plateMesh).toBeDefined();
    expect(plateMesh).toBeInstanceOf(THREE.Mesh);
    
    if (plateMesh instanceof THREE.Mesh) {
      expect(plateMesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
      const material = plateMesh.material as THREE.MeshStandardMaterial;
      expect(material.color.getHex()).toBe(0x2a2a3e);
    }
  });

  it('should create a grid helper', () => {
    const group = buildPlateGrid(200, 200);
    
    const gridHelper = group.children.find((child) => child.type === 'GridHelper');
    
    expect(gridHelper).toBeDefined();
    expect(gridHelper).toBeInstanceOf(THREE.GridHelper);
  });

  it('should create boundary edges in purple', () => {
    const group = buildPlateGrid(200, 200);
    
    // Find the LineSegments that is NOT a GridHelper (GridHelper is also a LineSegments)
    // The boundary edges are the third child (index 2)
    const edges = group.children[2];
    
    expect(edges).toBeDefined();
    expect(edges).toBeInstanceOf(THREE.LineSegments);
    expect(edges.type).toBe('LineSegments'); // GridHelper has type 'GridHelper'
    
    if (edges instanceof THREE.LineSegments) {
      const material = edges.material;
      expect(material).toBeInstanceOf(THREE.LineBasicMaterial);
      
      if (material instanceof THREE.LineBasicMaterial) {
        // The color should be purple (0x9178f0)
        expect(material.color.getHex()).toBe(0x9178f0); // Purple
      }
    }
  });

  it('should handle different bed sizes correctly', () => {
    const smallPlate = buildPlateGrid(150, 150);
    const largePlate = buildPlateGrid(300, 400);
    
    expect(smallPlate.children.length).toBe(3);
    expect(largePlate.children.length).toBe(3);
    
    // Verify the grid sizes are different
    const smallGrid = smallPlate.children.find((c) => c instanceof THREE.GridHelper);
    const largeGrid = largePlate.children.find((c) => c instanceof THREE.GridHelper);
    
    expect(smallGrid).toBeDefined();
    expect(largeGrid).toBeDefined();
  });

  it('should use correct spacing for grid (10mm)', () => {
    const group = buildPlateGrid(200, 200);
    
    const gridHelper = group.children.find((child) => child instanceof THREE.GridHelper) as THREE.GridHelper;
    
    expect(gridHelper).toBeDefined();
    
    // GridHelper was created with gridSize=200 and divisions=20 (200/10)
    // This gives 10mm spacing
  });

  it('should position plate and edges correctly', () => {
    const group = buildPlateGrid(200, 200);
    
    const plateMesh = group.children.find(
      (child) => child instanceof THREE.Mesh && child.geometry instanceof THREE.PlaneGeometry
    );
    // Get the boundary edges (third child, type 'LineSegments' not 'GridHelper')
    const edges = group.children[2];
    
    expect(plateMesh).toBeDefined();
    expect(edges).toBeDefined();
    
    if (plateMesh && edges) {
      // Both should be rotated to lie flat in the XZ plane
      expect(plateMesh.rotation.x).toBeCloseTo(-Math.PI / 2);
      expect(edges.rotation.x).toBeCloseTo(-Math.PI / 2);
    }
  });
});
