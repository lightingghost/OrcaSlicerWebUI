import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  buildViewCube,
  pickViewCubeRegion,
  applyViewCubeHover,
  faceDirectionForIndex,
} from './viewCube';

describe('buildViewCube', () => {
  it('creates a cube body, seam lines, face highlight, and 20 edge/vertex regions', () => {
    const cube = buildViewCube();
    expect(cube.group).toBeInstanceOf(THREE.Group);
    expect(cube.cubeBody).toBeInstanceOf(THREE.Mesh);
    // 12 edges + 8 vertices = 20 clickable/hoverable regions
    expect(cube.regions.length).toBe(20);
    // group children: cubeBody, seam lines, faceHighlight, 20 region meshes, 3 axis lines
    expect(cube.group.children.length).toBe(3 + 20 + 3);
  });

  it('every edge/vertex region has a unit-length direction', () => {
    const cube = buildViewCube();
    for (const region of cube.regions) {
      expect(region.direction.length()).toBeCloseTo(1);
    }
  });

  it('has exactly 12 edge regions and 8 vertex regions', () => {
    const cube = buildViewCube();
    expect(cube.regions.filter((r) => r.kind === 'edge').length).toBe(12);
    expect(cube.regions.filter((r) => r.kind === 'vertex').length).toBe(8);
  });

  it('cube body has 6 face materials', () => {
    const cube = buildViewCube();
    expect(Array.isArray(cube.cubeBody.material)).toBe(true);
    expect((cube.cubeBody.material as THREE.Material[]).length).toBe(6);
  });
});

describe('faceDirectionForIndex', () => {
  it('maps material indices to unit-length outward normals', () => {
    for (let i = 0; i < 6; i++) {
      const dir = faceDirectionForIndex(i);
      expect(dir.length()).toBeCloseTo(1);
    }
  });
});

describe('pickViewCubeRegion', () => {
  function makeLookDownCamera() {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.up.set(0, 0, 1);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    return camera;
  }

  it('returns a face hit with the Top (+Z) direction when the ray hits the +Z face head-on', () => {
    const cube = buildViewCube();
    cube.group.updateMatrixWorld();

    const camera = makeLookDownCamera();
    const raycaster = new THREE.Raycaster();
    const picked = pickViewCubeRegion(raycaster, camera, { x: 0, y: 0 }, cube);

    expect(picked).not.toBeNull();
    expect(picked!.kind).toBe('face');
    expect(picked!.direction.x).toBeCloseTo(0);
    expect(picked!.direction.y).toBeCloseTo(0);
    expect(picked!.direction.z).toBeCloseTo(1);
  });

  it('returns null when the ray misses the cube entirely', () => {
    const cube = buildViewCube();
    cube.group.updateMatrixWorld();

    const camera = makeLookDownCamera();
    const raycaster = new THREE.Raycaster();
    const picked = pickViewCubeRegion(raycaster, camera, { x: 0.99, y: 0.99 }, cube);

    expect(picked).toBeNull();
  });

  it('picks an edge region near a cube seam', () => {
    const cube = buildViewCube();
    cube.group.updateMatrixWorld();

    // Find a known edge region and aim the camera straight at it.
    const edgeRegion = cube.regions.find((r) => r.kind === 'edge')!;
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.up.set(0, 0, 1);
    camera.position.copy(edgeRegion.direction.clone().multiplyScalar(10));
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const raycaster = new THREE.Raycaster();
    const picked = pickViewCubeRegion(raycaster, camera, { x: 0, y: 0 }, cube);

    expect(picked).not.toBeNull();
    expect(picked!.kind).toBe('edge');
  });

  it('picks a vertex region near a cube corner', () => {
    const cube = buildViewCube();
    cube.group.updateMatrixWorld();

    const vertexRegion = cube.regions.find((r) => r.kind === 'vertex')!;
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.up.set(0, 0, 1);
    camera.position.copy(vertexRegion.direction.clone().multiplyScalar(10));
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const raycaster = new THREE.Raycaster();
    const picked = pickViewCubeRegion(raycaster, camera, { x: 0, y: 0 }, cube);

    expect(picked).not.toBeNull();
    expect(picked!.kind).toBe('vertex');
  });
});

describe('applyViewCubeHover', () => {
  it('sets the face highlight opacity when hovering a face', () => {
    const cube = buildViewCube();
    applyViewCubeHover(cube, {
      direction: new THREE.Vector3(0, 0, 1),
      kind: 'face',
      region: null,
    });

    const material = cube.faceHighlight.material as THREE.MeshBasicMaterial;
    expect(material.opacity).toBeGreaterThan(0);
  });

  it('sets an edge/vertex region highlight opacity when hovering it', () => {
    const cube = buildViewCube();
    const edgeRegion = cube.regions.find((r) => r.kind === 'edge')!;

    applyViewCubeHover(cube, {
      direction: edgeRegion.direction,
      kind: 'edge',
      region: edgeRegion,
    });

    const material = edgeRegion.highlightMesh.material as THREE.MeshBasicMaterial;
    expect(material.opacity).toBeGreaterThan(0);
  });

  it('clears all highlights when passed null', () => {
    const cube = buildViewCube();
    const edgeRegion = cube.regions.find((r) => r.kind === 'edge')!;

    applyViewCubeHover(cube, { direction: edgeRegion.direction, kind: 'edge', region: edgeRegion });
    applyViewCubeHover(cube, null);

    const faceMaterial = cube.faceHighlight.material as THREE.MeshBasicMaterial;
    const edgeMaterial = edgeRegion.highlightMesh.material as THREE.MeshBasicMaterial;
    expect(faceMaterial.opacity).toBe(0);
    expect(edgeMaterial.opacity).toBe(0);
  });

  it('only highlights one region at a time', () => {
    const cube = buildViewCube();
    const [regionA, regionB] = cube.regions.filter((r) => r.kind === 'edge');

    applyViewCubeHover(cube, { direction: regionA.direction, kind: 'edge', region: regionA });
    applyViewCubeHover(cube, { direction: regionB.direction, kind: 'edge', region: regionB });

    const materialA = regionA.highlightMesh.material as THREE.MeshBasicMaterial;
    const materialB = regionB.highlightMesh.material as THREE.MeshBasicMaterial;
    expect(materialA.opacity).toBe(0);
    expect(materialB.opacity).toBeGreaterThan(0);
  });
});
