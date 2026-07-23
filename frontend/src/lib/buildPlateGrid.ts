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

  // The rest of this codebase (modelLoader's bed placement + out-of-bounds
  // checks) uses a Z-up convention: models rest at Z=0 and their footprint
  // is measured in X/Y against bedSize.width/depth. THREE.PlaneGeometry
  // already lies flat in the XY plane by default (normal facing +Z), so no
  // rotation is needed for the plate/edges to represent the Z=0 bed surface.

  // 1. Solid plate surface
  const plateGeometry = new THREE.PlaneGeometry(width, depth);
  const plateMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2a3e, // Dark gray-purple
    side: THREE.DoubleSide,
  });
  const plateMesh = new THREE.Mesh(plateGeometry, plateMaterial);

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
  
  // GridHelper lies flat in the XZ plane (Y-up) by default. Rotate +90deg
  // about X so it lies flat in the XY plane instead (Z-up, matching the bed).
  grid.rotation.x = Math.PI / 2;
  
  group.add(grid);

  // 3. Boundary outline in purple
  const edgesGeometry = new THREE.EdgesGeometry(plateGeometry);
  const edgesMaterial = new THREE.LineBasicMaterial({
    color: 0x9178f0, // Purple
    linewidth: 2,
  });
  const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);

  group.add(edges);

  // 4. Origin coordinate axes (X red, Y green), matching the native
  // OrcaSlicer UI which draws colored X/Y axis lines through the plate
  // center (the bed's origin, (0, 0), is the center of the plate in this
  // app's coordinate convention). Slightly raised above the plate (Z) so
  // they render on top without z-fighting.
  const axisLength = Math.max(width, depth) / 2;
  const axisZ = 0.05;

  const xAxisGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-axisLength, 0, axisZ),
    new THREE.Vector3(axisLength, 0, axisZ),
  ]);
  const xAxisMaterial = new THREE.LineBasicMaterial({ color: 0xff5555 }); // red = X
  const xAxisLine = new THREE.Line(xAxisGeometry, xAxisMaterial);
  group.add(xAxisLine);

  const yAxisGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -axisLength, axisZ),
    new THREE.Vector3(0, axisLength, axisZ),
  ]);
  const yAxisMaterial = new THREE.LineBasicMaterial({ color: 0x55cc55 }); // green = Y
  const yAxisLine = new THREE.Line(yAxisGeometry, yAxisMaterial);
  group.add(yAxisLine);

  return group;
}
