import * as THREE from 'three';

/**
 * buildPlateGrid
 * 
 * Creates a Three.js Group representing the build plate with:
 * - Solid plate surface (dark gray)
 * - Grid lines with 10mm spacing
 * - Purple boundary outline
 * 
 * @param width - Build plate width in millimeters
 * @param depth - Build plate depth in millimeters
 * @returns THREE.Group containing all build plate visual elements
 */
export function buildPlateGrid(width: number, depth: number): THREE.Group {
  const group = new THREE.Group();

  // 1. Solid plate surface
  const plateGeometry = new THREE.PlaneGeometry(width, depth);
  const plateMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2a3e, // Dark gray-purple
    side: THREE.DoubleSide,
  });
  const plateMesh = new THREE.Mesh(plateGeometry, plateMaterial);
  
  // Rotate to lay flat in XY plane (plane geometry defaults to XY, but we want it horizontal)
  // The plate should be at Z=0
  plateMesh.rotation.x = -Math.PI / 2; // Rotate from vertical (XY) to horizontal (XZ)
  
  group.add(plateMesh);

  // 2. Grid lines with 10mm spacing
  const gridSize = Math.max(width, depth);
  const gridDivisions = Math.ceil(gridSize / 10); // 10mm spacing
  
  const grid = new THREE.GridHelper(
    gridSize,
    gridDivisions,
    0x444466, // Center line color (medium gray-blue)
    0x333355  // Grid line color (darker gray-blue)
  );
  
  // GridHelper is already horizontal, but we need to position it correctly
  // GridHelper creates a grid in the XZ plane by default, which is what we want
  grid.position.y = 0; // At the bed surface level
  
  group.add(grid);

  // 3. Boundary outline in purple
  const edgesGeometry = new THREE.EdgesGeometry(plateGeometry);
  const edgesMaterial = new THREE.LineBasicMaterial({
    color: 0x9178f0, // Purple
    linewidth: 2,
  });
  const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
  
  // Match the rotation of the plate
  edges.rotation.x = -Math.PI / 2;
  
  group.add(edges);

  return group;
}
