import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';

/**
 * Model loading pipeline for OrcaSlicer Web UI.
 * 
 * Pipeline steps:
 * 1. Select loader by file extension
 * 2. Load and parse the file
 * 3. Compute bounding box
 * 4. Center geometry in XY plane
 * 5. Translate so minZ = 0 (place on bed)
 * 6. Apply MeshStandardMaterial with teal color
 * 
 * The loaded mesh is ready to be added to the scene and will need
 * updateBoundsAndColor called to check out-of-bounds status.
 */

export interface LoadModelResult {
  mesh: THREE.Object3D;
  bounds: THREE.Box3;
  triangleCount: number;
  filename: string;
}

/**
 * Load a 3D model from ArrayBuffer data.
 * 
 * @param arrayBuffer - Raw file data
 * @param filename - Original filename (used to determine format)
 * @returns LoadModelResult containing the mesh and metadata
 * @throws Error if file format is unsupported or parsing fails
 */
export async function loadModel(
  arrayBuffer: ArrayBuffer,
  filename: string
): Promise<LoadModelResult> {
  const extension = getFileExtension(filename);
  
  let geometry: THREE.BufferGeometry | null = null;
  let mesh: THREE.Object3D;
  
  // Select loader by extension
  switch (extension) {
    case 'stl':
      geometry = await loadSTL(arrayBuffer);
      mesh = new THREE.Mesh(geometry, createDefaultMaterial());
      break;
    
    case 'obj':
      mesh = await loadOBJ(arrayBuffer);
      break;
    
    case '3mf':
      mesh = await load3MF(arrayBuffer);
      break;
    
    case 'amf':
      mesh = await loadAMF(arrayBuffer);
      break;
    
    default:
      throw new Error(`Unsupported file format: .${extension}`);
  }
  
  // Compute bounding box before transformations
  const bounds = new THREE.Box3().setFromObject(mesh);
  
  // Center geometry in XY plane
  const center = bounds.getCenter(new THREE.Vector3());
  mesh.position.x = -center.x;
  mesh.position.y = -center.y;
  
  // Translate so minZ = 0 (place on bed)
  mesh.position.z = -bounds.min.z;
  
  // Ensure all children have the default material
  applyMaterialToMesh(mesh, createDefaultMaterial());
  
  // Recompute bounds after transformations
  const finalBounds = new THREE.Box3().setFromObject(mesh);
  
  // Count triangles
  const triangleCount = countTriangles(mesh);
  
  return {
    mesh,
    bounds: finalBounds,
    triangleCount,
    filename,
  };
}

/**
 * Load STL file.
 */
async function loadSTL(arrayBuffer: ArrayBuffer): Promise<THREE.BufferGeometry> {
  const loader = new STLLoader();
  return loader.parse(arrayBuffer);
}

/**
 * Load OBJ file.
 */
async function loadOBJ(arrayBuffer: ArrayBuffer): Promise<THREE.Group> {
  const loader = new OBJLoader();
  const text = new TextDecoder().decode(arrayBuffer);
  const group = loader.parse(text);
  
  // OBJ loader returns a Group, ensure all children have geometry
  if (group.children.length === 0) {
    throw new Error('OBJ file contains no geometry');
  }
  
  return group;
}

/**
 * Load 3MF file.
 */
async function load3MF(arrayBuffer: ArrayBuffer): Promise<THREE.Group> {
  const loader = new ThreeMFLoader();
  
  // ThreeMFLoader.parse signature: parse(data: ArrayBuffer): Group
  // It returns the group directly, not via callback
  return new Promise<THREE.Group>((resolve, reject) => {
    try {
      const group = loader.parse(arrayBuffer as any);
      if (group.children.length === 0) {
        reject(new Error('3MF file contains no geometry'));
      } else {
        resolve(group);
      }
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Load AMF file.
 * 
 * AMF (Additive Manufacturing File Format) is an XML-based format.
 * This is a basic implementation that parses AMF XML and extracts vertices and triangles.
 * 
 * Note: This is a simplified parser and may not support all AMF features.
 */
async function loadAMF(arrayBuffer: ArrayBuffer): Promise<THREE.Mesh> {
  const text = new TextDecoder().decode(arrayBuffer);
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/xml');
  
  // Check for parsing errors
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error('Failed to parse AMF file: Invalid XML');
  }
  
  // Extract vertices
  const vertices: THREE.Vector3[] = [];
  const vertexElements = doc.querySelectorAll('vertices > vertex');
  
  vertexElements.forEach((vertexEl) => {
    const coordinates = vertexEl.querySelector('coordinates');
    if (coordinates) {
      const x = parseFloat(coordinates.querySelector('x')?.textContent || '0');
      const y = parseFloat(coordinates.querySelector('y')?.textContent || '0');
      const z = parseFloat(coordinates.querySelector('z')?.textContent || '0');
      vertices.push(new THREE.Vector3(x, y, z));
    }
  });
  
  if (vertices.length === 0) {
    throw new Error('AMF file contains no vertices');
  }
  
  // Extract triangles
  const positions: number[] = [];
  const triangleElements = doc.querySelectorAll('volume > triangle');
  
  triangleElements.forEach((triangleEl) => {
    const v1 = parseInt(triangleEl.querySelector('v1')?.textContent || '0', 10);
    const v2 = parseInt(triangleEl.querySelector('v2')?.textContent || '0', 10);
    const v3 = parseInt(triangleEl.querySelector('v3')?.textContent || '0', 10);
    
    if (v1 < vertices.length && v2 < vertices.length && v3 < vertices.length) {
      positions.push(vertices[v1].x, vertices[v1].y, vertices[v1].z);
      positions.push(vertices[v2].x, vertices[v2].y, vertices[v2].z);
      positions.push(vertices[v3].x, vertices[v3].y, vertices[v3].z);
    }
  });
  
  if (positions.length === 0) {
    throw new Error('AMF file contains no triangles');
  }
  
  // Create BufferGeometry
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  
  return new THREE.Mesh(geometry, createDefaultMaterial());
}

/**
 * Create default teal material for loaded models.
 */
function createDefaultMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x00a896, // teal
    roughness: 0.5,
    metalness: 0.1,
    flatShading: false,
  });
}

/**
 * Apply material to all mesh children recursively.
 */
function applyMaterialToMesh(
  object: THREE.Object3D,
  material: THREE.Material
): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material = material;
    }
  });
}

/**
 * Count total triangles in mesh (including all children).
 */
function countTriangles(object: THREE.Object3D): number {
  let count = 0;
  
  object.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const geometry = child.geometry;
      if (geometry.index !== null) {
        count += geometry.index.count / 3;
      } else if (geometry.attributes.position) {
        count += geometry.attributes.position.count / 3;
      }
    }
  });
  
  return Math.floor(count);
}

/**
 * Extract file extension from filename.
 */
function getFileExtension(filename: string): string {
  const match = filename.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : '';
}

/**
 * Update mesh color based on whether it's out of bounds.
 * 
 * This function:
 * 1. Computes a Box3 bounding box from the mesh
 * 2. Checks if any corner exceeds bed boundary in X or Y
 * 3. Sets material color to amber (0xf4a261) if out-of-bounds, or teal (0x00a896) if in-bounds
 * 4. Optionally updates the viewport store with the computed bounds
 * 
 * @param mesh - The mesh to update
 * @param bedSize - Build plate dimensions {width, depth}
 * @param setModelBounds - Optional callback to update the viewport store with bounds.
 *                         When using with Zustand store, pass: useStore.getState().setModelBounds
 * @returns Updated bounding box and out-of-bounds status
 * 
 * @example
 * // Without store update (for tests)
 * const result = updateBoundsAndColor(mesh, bedSize);
 * 
 * @example
 * // With store update (in components)
 * import { useStore } from '../store';
 * const setModelBounds = useStore((state) => state.setModelBounds);
 * updateBoundsAndColor(mesh, bedSize, setModelBounds);
 */
export function updateBoundsAndColor(
  mesh: THREE.Object3D,
  bedSize: { width: number; depth: number } | null,
  setModelBounds?: (bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }) => void
): { bounds: THREE.Box3; isOutOfBounds: boolean } {
  const bounds = new THREE.Box3().setFromObject(mesh);
  
  let isOutOfBounds = false;
  
  if (bedSize) {
    const halfW = bedSize.width / 2;
    const halfD = bedSize.depth / 2;
    
    isOutOfBounds =
      bounds.min.x < -halfW ||
      bounds.max.x > halfW ||
      bounds.min.y < -halfD ||
      bounds.max.y > halfD;
  }
  
  // Set color based on bounds status
  const color = isOutOfBounds ? 0xf4a261 : 0x00a896; // amber : teal
  
  mesh.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const material = child.material as THREE.MeshStandardMaterial;
      if (material && material.color) {
        material.color.setHex(color);
      }
    }
  });
  
  // Update viewport store with the computed bounds
  if (setModelBounds) {
    setModelBounds({
      min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
      max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
    });
  }
  
  return { bounds, isOutOfBounds };
}

/**
 * Fetch file data from the API and load it as a model.
 * 
 * @param fileId - File ID from the backend
 * @param filename - Original filename
 * @param setModelBounds - Optional callback to update viewport store with bounds
 * @param setModelMetadata - Optional callback to update viewport store with metadata
 * @returns LoadModelResult
 */
export async function fetchAndLoadModel(
  fileId: string,
  filename: string,
  setModelBounds?: (bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }) => void,
  setModelMetadata?: (metadata: { filename: string; triangleCount: number }) => void
): Promise<LoadModelResult> {
  const token = localStorage.getItem('api_token') || '';
  
  const response = await fetch(`/api/files/${fileId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.statusText}`);
  }
  
  // For model files, we need to fetch the actual file data
  // The GET /api/files/{file_id} endpoint returns metadata
  // We need to fetch the actual binary data from the storage path
  // For now, we'll construct a download URL
  const downloadResponse = await fetch(`/api/files/${fileId}/download`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  
  if (!downloadResponse.ok) {
    throw new Error(`Failed to download file: ${downloadResponse.statusText}`);
  }
  
  const arrayBuffer = await downloadResponse.arrayBuffer();
  
  const result = await loadModel(arrayBuffer, filename);
  
  // Update store with model data if callbacks provided
  if (setModelBounds) {
    setModelBounds({
      min: { x: result.bounds.min.x, y: result.bounds.min.y, z: result.bounds.min.z },
      max: { x: result.bounds.max.x, y: result.bounds.max.y, z: result.bounds.max.z },
    });
  }
  
  if (setModelMetadata) {
    setModelMetadata({
      filename: result.filename,
      triangleCount: result.triangleCount,
    });
  }
  
  return result;
}
