import * as THREE from 'three';

/**
 * viewCube
 *
 * Builds a navigation cube gizmo matching the reference OrcaSlicer/CAD
 * style: a plain solid gray cube with labeled faces (Top / Front / Right
 * visible by default from the home view) and thin seam lines, plus a
 * small always-visible red/green/blue X/Y/Z axis triad anchored at one
 * corner. Faces, edges, and vertices are all clickable and each jump the
 * camera to the corresponding view direction; hovering any of them shows a
 * translucent purple highlight so it's clear the region is interactive.
 *
 * Design notes (kept intentionally simple / few objects, unlike the first
 * pass which cluttered the cube with 26 permanently-visible gray bezel
 * meshes):
 *  - The cube body is a SINGLE BoxGeometry mesh with 6 face materials
 *    (canvas-texture labels). This alone renders exactly like the
 *    reference image with no extra geometry.
 *  - A thin EdgesGeometry outline draws the seams between faces.
 *  - Edge/vertex HIT REGIONS are small invisible boxes protruding just
 *    past the cube's surface (so they win raycasts at the seams); they
 *    have opacity 0 by default and are only made visible when hovered.
 *  - A single reusable "face highlight" plane is repositioned to whichever
 *    face is hovered, rather than allocating one overlay per face.
 *
 * Face -> label -> direction mapping (Z-up world):
 *   +Z -> "Top"    -Z -> "Bottom"
 *   -Y -> "Front"  +Y -> "Back"
 *   +X -> "Right"  -X -> "Left"
 */

// Cube spans -HALF..HALF on each axis. Kept smaller than 1 (with the gizmo
// camera pulled back correspondingly further in ThreeViewport.tsx) so the
// cube's corners/axis tips never get clipped by the camera frustum — the
// previous HALF=1 + tight camera distance combination truncated the cube
// at the edges of the gizmo canvas.
const HALF = 0.72;
const HOVER_COLOR = 0x9178f0; // matches the app's purple accent
const FACE_LABEL_BG = '#c9c9d2';
const FACE_PLAIN_BG = '#b4b4bd';
const FACE_BORDER = '#8c8c98';
const FACE_TEXT = '#2a2a3a';

export type ViewCubeRegionKind = 'face' | 'edge' | 'vertex';

export interface ViewCubeRegion {
  direction: THREE.Vector3;
  kind: ViewCubeRegionKind;
  /** The Object3D used to render the hover highlight for this region. */
  highlightMesh: THREE.Object3D;
}

function makeFaceTexture(label: string | null): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  // jsdom (unit tests) doesn't implement CanvasRenderingContext2D;
  // `getContext('2d')` logs a "not implemented" warning and returns null
  // there. Fall back to a blank texture rather than throwing.
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  if (ctx) {
    ctx.fillStyle = label ? FACE_LABEL_BG : FACE_PLAIN_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = FACE_BORDER;
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, canvas.width - 3, canvas.height - 3);
    if (label) {
      ctx.fillStyle = FACE_TEXT;
      ctx.font = 'italic 600 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, canvas.width / 2, canvas.height / 2);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

interface FaceDef {
  label: string | null;
  normal: THREE.Vector3;
}

// BoxGeometry material order is [+X, -X, +Y, -Y, +Z, -Z].
const FACE_DEFS: FaceDef[] = [
  { label: 'Right', normal: new THREE.Vector3(1, 0, 0) },
  { label: 'Left', normal: new THREE.Vector3(-1, 0, 0) },
  { label: 'Back', normal: new THREE.Vector3(0, 1, 0) },
  { label: 'Front', normal: new THREE.Vector3(0, -1, 0) },
  { label: 'Top', normal: new THREE.Vector3(0, 0, 1) },
  { label: 'Bottom', normal: new THREE.Vector3(0, 0, -1) },
];

function buildCubeBody(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(HALF * 2, HALF * 2, HALF * 2);
  const materials = FACE_DEFS.map(
    ({ label }) => new THREE.MeshBasicMaterial({ map: makeFaceTexture(label) })
  );
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.userData.viewCubeHitType = 'face';
  return mesh;
}

function buildSeamLines(): THREE.LineSegments {
  const geometry = new THREE.BoxGeometry(HALF * 2, HALF * 2, HALF * 2);
  const edgesGeometry = new THREE.EdgesGeometry(geometry);
  const material = new THREE.LineBasicMaterial({ color: 0x55555f });
  const lines = new THREE.LineSegments(edgesGeometry, material);
  lines.userData.viewCubeHitType = undefined; // decorative, not clickable
  return lines;
}

// 12 edges: every pair of orthogonal axes, each with 4 sign combinations.
function buildEdgeRegions(group: THREE.Group, regions: ViewCubeRegion[]): void {
  const axisPairs: Array<['x' | 'y' | 'z', 'x' | 'y' | 'z']> = [
    ['y', 'z'], // edges parallel to X
    ['x', 'z'], // edges parallel to Y
    ['x', 'y'], // edges parallel to Z
  ];
  const axisAlong: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
  const edgeLength = HALF * 2 * 0.7;
  const edgeThickness = HALF * 0.22;
  const protrusion = HALF * 1.02; // just past the surface, wins raycasts at seams

  axisPairs.forEach((pair, axisIndex) => {
    const along = axisAlong[axisIndex];
    for (const signA of [1, -1]) {
      for (const signB of [1, -1]) {
        const pos = new THREE.Vector3();
        const dir = new THREE.Vector3();
        pos[pair[0]] = signA * protrusion;
        pos[pair[1]] = signB * protrusion;
        dir[pair[0]] = signA;
        dir[pair[1]] = signB;
        dir.normalize();

        const size = new THREE.Vector3(edgeThickness, edgeThickness, edgeThickness);
        size[along] = edgeLength;

        const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
        const material = new THREE.MeshBasicMaterial({
          color: HOVER_COLOR,
          transparent: true,
          opacity: 0, // invisible until hovered
          depthTest: false,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(pos);
        mesh.userData.viewCubeHitType = 'edge';
        mesh.renderOrder = 2;
        group.add(mesh);

        regions.push({ direction: dir.clone(), kind: 'edge', highlightMesh: mesh });
      }
    }
  });
}

function buildVertexRegions(group: THREE.Group, regions: ViewCubeRegion[]): void {
  const vertexSize = HALF * 0.34;
  const protrusion = HALF * 1.05;

  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      for (const sz of [1, -1]) {
        const dir = new THREE.Vector3(sx, sy, sz).normalize();
        const geometry = new THREE.BoxGeometry(vertexSize, vertexSize, vertexSize);
        const material = new THREE.MeshBasicMaterial({
          color: HOVER_COLOR,
          transparent: true,
          opacity: 0, // invisible until hovered
          depthTest: false,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(sx * protrusion, sy * protrusion, sz * protrusion);
        mesh.userData.viewCubeHitType = 'vertex';
        mesh.renderOrder = 3;
        group.add(mesh);

        regions.push({ direction: dir.clone(), kind: 'vertex', highlightMesh: mesh });
      }
    }
  }
}

/**
 * A single reusable highlight plane, repositioned/reoriented to whichever
 * face is currently hovered (rather than allocating 6 separate overlays).
 */
function buildFaceHighlight(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(HALF * 1.94, HALF * 1.94);
  const material = new THREE.MeshBasicMaterial({
    color: HOVER_COLOR,
    transparent: true,
    opacity: 0,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1;
  mesh.userData.viewCubeHitType = undefined; // never itself a raycast target
  return mesh;
}

/**
 * Always-visible X (red) / Y (green) / Z (blue) axis triad, anchored at
 * the cube's bottom-front-left corner and extending outward well past the
 * cube's own edges — matching the reference image, where the axis lines
 * are clearly longer than the cube itself and remain visible regardless
 * of hover state or cube rotation (depthTest disabled).
 */
function buildAxisTriad(group: THREE.Group): void {
  const axes: Array<{ dir: THREE.Vector3; color: number }> = [
    { dir: new THREE.Vector3(1, 0, 0), color: 0xff5555 }, // X - red
    { dir: new THREE.Vector3(0, 1, 0), color: 0x55cc55 }, // Y - green
    { dir: new THREE.Vector3(0, 0, 1), color: 0x5599ff }, // Z - blue
  ];

  const origin = new THREE.Vector3(-HALF, -HALF, -HALF);
  const length = HALF * 2.2; // extends well beyond the opposite cube face

  for (const { dir, color } of axes) {
    const points = [origin.clone(), origin.clone().add(dir.clone().multiplyScalar(length))];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color, depthTest: false, linewidth: 2 });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 4;
    line.userData.viewCubeHitType = undefined; // decorative, not clickable
    group.add(line);
  }
}

export interface ViewCube {
  group: THREE.Group;
  /** All clickable/hoverable edge & vertex regions (faces are hit via `cubeBody`). */
  regions: ViewCubeRegion[];
  /** The solid cube body mesh — raycast against this for face hits. */
  cubeBody: THREE.Mesh;
  /** Reusable overlay repositioned to highlight whichever face is hovered. */
  faceHighlight: THREE.Mesh;
}

export function buildViewCube(): ViewCube {
  const group = new THREE.Group();
  const regions: ViewCubeRegion[] = [];

  const cubeBody = buildCubeBody();
  group.add(cubeBody);

  group.add(buildSeamLines());

  const faceHighlight = buildFaceHighlight();
  group.add(faceHighlight);

  buildEdgeRegions(group, regions);
  buildVertexRegions(group, regions);
  buildAxisTriad(group);

  return { group, regions, cubeBody, faceHighlight };
}

/**
 * Get the outward normal (and hence view direction) for a given face index
 * of the cube body's BoxGeometry, matching FACE_DEFS' material order.
 */
export function faceDirectionForIndex(faceMaterialIndex: number): THREE.Vector3 {
  const def = FACE_DEFS[faceMaterialIndex] ?? FACE_DEFS[0];
  return def.normal.clone();
}

/**
 * Raycast against a ViewCube and classify what's under the pointer:
 * an edge/vertex region (checked first, since they protrude slightly past
 * the cube surface and should win at the seams) or a face of the cube body.
 * Returns null if nothing was hit.
 */
export function pickViewCubeRegion(
  raycaster: THREE.Raycaster,
  camera: THREE.Camera,
  ndc: { x: number; y: number },
  cube: ViewCube
): { direction: THREE.Vector3; kind: ViewCubeRegionKind; region: ViewCubeRegion | null } | null {
  raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);

  const regionMeshes = cube.regions.map((r) => r.highlightMesh);
  const regionHits = raycaster.intersectObjects(regionMeshes, false);
  if (regionHits.length > 0) {
    const hitMesh = regionHits[0].object;
    const region = cube.regions.find((r) => r.highlightMesh === hitMesh);
    if (region) {
      return { direction: region.direction.clone(), kind: region.kind, region };
    }
  }

  const faceHits = raycaster.intersectObject(cube.cubeBody, false);
  if (faceHits.length > 0 && faceHits[0].face) {
    const materialIndex = faceHits[0].face.materialIndex;
    const direction = faceDirectionForIndex(materialIndex);
    return { direction, kind: 'face', region: null };
  }

  return null;
}

/**
 * Apply (or clear) the hover highlight for a picked region. Pass `null` to
 * clear any active highlight. Only one region is ever highlighted at a
 * time — any previously-hovered region's highlight is reset first.
 */
export function applyViewCubeHover(
  cube: ViewCube,
  picked: { direction: THREE.Vector3; kind: ViewCubeRegionKind; region: ViewCubeRegion | null } | null
): void {
  // Clear all edge/vertex region highlights
  for (const region of cube.regions) {
    const material = region.highlightMesh.material as THREE.MeshBasicMaterial;
    material.opacity = 0;
  }
  // Clear the face highlight overlay
  (cube.faceHighlight.material as THREE.MeshBasicMaterial).opacity = 0;

  if (!picked) return;

  if (picked.kind === 'face') {
    const normal = picked.direction;
    cube.faceHighlight.position.copy(normal).multiplyScalar(HALF * 1.001);
    cube.faceHighlight.lookAt(cube.faceHighlight.position.clone().add(normal));
    (cube.faceHighlight.material as THREE.MeshBasicMaterial).opacity = 0.35;
  } else if (picked.region) {
    (picked.region.highlightMesh.material as THREE.MeshBasicMaterial).opacity = 0.6;
  }
}
