import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useStore } from '../store';
import { buildPlateGrid } from '../lib/buildPlateGrid';
import { buildViewCube, pickViewCubeRegion, applyViewCubeHover, type ViewCube } from '../lib/viewCube';
import { ViewportTransformToolbar } from './ViewportTransformToolbar';
import { fetchAndLoadModel, updateBoundsAndColor } from '../lib/modelLoader';
import {
  toNdc,
  pickRootObject,
  intersectBedPlane,
  isClick,
  computeDragPosition,
} from '../lib/viewportInteraction';
import {
  computeObjectTransformSnapshot,
  applyPositionChange,
  applyRotationRelative,
  applyRotationAbsolute,
  applyScaleRatio,
  resetRotation,
  resetScale,
} from '../lib/objectTransform';
import {
  layOnFace,
  autoOrientObject,
  buildLayOnFaceOverlays,
  applyLayOnFaceHover,
  disposeLayOnFaceOverlay,
  type LayOnFaceOverlay,
} from '../lib/orientation';
import { computeArrangePlan } from '../lib/arrangePacking';
import type { PendingTransformCommand } from '../store/objectManipulationSlice';

// Spacing (mm) used to lay out newly-imported objects side-by-side on the
// bed so they don't spawn stacked on top of each other. Purely a placement
// convenience — the user can drag objects anywhere afterward.
const NEW_OBJECT_SPACING_MM = 60;

// Dimensions (px) the Prepare-tab viewport snapshot is downscaled to
// before being uploaded as a job's gcode thumbnail. Matches native
// OrcaSlicer's own commonly-configured gcode thumbnail size (profiles'
// "thumbnails" option is frequently set to "140x110/PNG" — this is what
// a reference native-sliced gcode's embedded `; thumbnail begin 140x110
// ...` block uses) so the resulting comment block in our spliced gcode
// (see backend `_splice_thumbnail_into_gcode`) matches the size gcode
// viewers/printers actually expect, rather than embedding the much
// larger raw canvas resolution.
const GCODE_THUMBNAIL_SIZE = { width: 140, height: 110 };

/**
 * Points the camera at the combined bounding box of the given meshes and
 * pulls it back along its current viewing direction just far enough for
 * that box to fill the frame — i.e. "zoom to fit selection", but for the
 * whole model set. Used only for the thumbnail-capture snapshot (see
 * setCaptureViewportThumbnail below): native's own gcode thumbnail frames
 * the model itself, not the build plate, so simply hiding the plate
 * without also reframing would leave the model tiny/off-center in
 * whatever crop of the plate's empty area the user happened to be
 * viewing.
 *
 * Keeps the camera's current viewing direction (doesn't reset to a fixed
 * preset angle) so the thumbnail still reflects whatever orientation the
 * user was looking at the model from.
 */
function fitCameraToObjects(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  objects: THREE.Object3D[]
): void {
  const box = new THREE.Box3();
  for (const obj of objects) {
    box.expandByObject(obj);
  }
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const boundingRadius = size.length() / 2;
  if (boundingRadius <= 0) return;

  // Distance needed for the bounding sphere to fit within the camera's
  // vertical FOV, with a small margin so the model isn't cropped flush
  // against the frame edges.
  const fovRadians = (camera.fov * Math.PI) / 180;
  const fitDistance = (boundingRadius / Math.sin(fovRadians / 2)) * 1.15;

  const viewDirection = camera.position.clone().sub(controls.target).normalize();
  // Degenerate case (camera exactly at its own target — shouldn't happen
  // in practice, but avoid producing a zero-length/NaN direction).
  if (viewDirection.lengthSq() === 0) viewDirection.set(0, -1, 1).normalize();

  camera.position.copy(center).addScaledVector(viewDirection, fitDistance);
  controls.target.copy(center);
  camera.lookAt(center);
}

/**
 * Downscales a PNG Blob to the given pixel dimensions via an offscreen
 * <canvas>, preserving aspect ratio by letterboxing (drawing centered
 * within the target box rather than stretching) so the model doesn't get
 * squashed/distorted just because the viewport's own aspect ratio
 * doesn't match the target thumbnail's.
 */
async function resizeImageBlob(blob: Blob, width: number, height: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return blob;
  }

  const scale = Math.min(width / bitmap.width, height / bitmap.height);
  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  const offsetX = (width - drawWidth) / 2;
  const offsetY = (height - drawHeight) / 2;

  ctx.drawImage(bitmap, offsetX, offsetY, drawWidth, drawHeight);
  bitmap.close();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((resized) => {
      if (resized) resolve(resized);
      else reject(new Error('Failed to encode resized thumbnail'));
    }, 'image/png');
  });
}

// Fallback bed size (mm) used to render the build plate before a printer
// profile has been selected/resolved (bedSize is null until then). The
// native OrcaSlicer UI always shows a plate on startup — never a blank
// scene — so the viewport must never depend on the printer fetch
// succeeding just to draw *something*. 220x220 mm matches a common desktop
// FDM bed size and is only a placeholder; it's replaced the moment a real
// printer profile resolves.
const DEFAULT_BED_SIZE = { width: 220, depth: 220 };

interface DragState {
  fileId: string;
  mesh: THREE.Object3D;
  // Offset from the pointer's bed-plane intersection to the mesh's origin,
  // captured at drag start, so the mesh doesn't "snap" to the pointer.
  grabOffset: { x: number; y: number };
  currentZ: number;
}

// Default camera distance (mm) from the origin for view-cube-driven camera
// jumps. Kept as a single constant so every cube face/edge/vertex click
// lands the camera at a consistent distance regardless of direction.
const DEFAULT_CAMERA_DISTANCE = 424; // ~ home preset's sqrt(300^2 + 300^2)

// Home view (isometric-ish) direction, used on initial mount.
const HOME_DIRECTION = new THREE.Vector3(0, -1, 1).normalize();

// Distance of the gizmo's own camera from the view-cube. Chosen so the
// cube's full bounding radius (including the axis triad's tips, which
// extend further than the cube's own corners — see viewCube.ts) fits
// comfortably inside the gizmo camera's frustum. The previous value (5,
// paired with a 30deg FOV and a larger cube) was too tight and clipped the
// cube's corners/axis tips at the edges of the gizmo canvas.
const GIZMO_CAMERA_DISTANCE = 5.2;
const GIZMO_CAMERA_FOV = 32;

/**
 * ThreeViewport Component
 * 
 * Initializes a Three.js scene with:
 * - Dark background (0x1a1a2e)
 * - PerspectiveCamera at home preset position
 * - WebGLRenderer with antialiasing
 * - AmbientLight + DirectionalLight
 * - OrbitControls for interaction
 * - Continuous render loop
 * - Build plate grid that updates when bedSize changes
 * - Camera preset animation with ViewPresetToolbar
 */
export const ThreeViewport: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const buildPlateGroupRef = useRef<THREE.Group | null>(null);
  // One mesh per loaded object, keyed by file_id, so multiple imported
  // models can coexist on the bed and be selected/moved independently.
  const meshesRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const loadedFileIdsRef = useRef<Set<string>>(new Set());
  const selectionOutlineRef = useRef<THREE.BoxHelper | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  // Lay-on-Face pick mode: highlighted clickable face overlays, added as a
  // child of the selected mesh so they automatically track its transform.
  const layOnFaceOverlayRef = useRef<LayOnFaceOverlay | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);

  // View-cube gizmo refs (navigation cube overlay, bottom-left corner)
  const gizmoCanvasRef = useRef<HTMLCanvasElement>(null);
  const gizmoSceneRef = useRef<THREE.Scene | null>(null);
  const gizmoCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const gizmoRendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const gizmoCubeRef = useRef<ViewCube | null>(null);
  const gizmoRaycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  // Tracks whether the pointer is currently dragging the cube to orbit the
  // main camera (as opposed to a plain click/hover), and the drag origin.
  const gizmoDragRef = useRef<{ lastX: number; lastY: number } | null>(null);
  const gizmoPointerDownRef = useRef<{ x: number; y: number } | null>(null);

  // Animation state for camera preset transitions
  const animationStateRef = useRef<{
    isAnimating: boolean;
    startPosition: THREE.Vector3;
    startTarget: THREE.Vector3;
    endPosition: THREE.Vector3;
    endTarget: THREE.Vector3;
    startTime: number;
    duration: number; // milliseconds
  } | null>(null);

  // Get bedSize from store
  const bedSize = useStore((state) => state.bedSize);
  
  // Get uploaded files from store
  const uploadedFiles = useStore((state) => state.uploadedFiles);
  
  // Get viewport actions from store
  const setModelBounds = useStore((state) => state.setModelBounds);
  const setModelMetadata = useStore((state) => state.setModelMetadata);
  const selectedObjectId = useStore((state) => state.selectedObjectId);
  const setSelectedObjectId = useStore((state) => state.setSelectedObjectId);
  const coordinateMode = useStore((state) => state.coordinateMode);
  const uniformScale = useStore((state) => state.uniformScale);
  const pendingTransformCommand = useStore((state) => state.pendingTransformCommand);
  const clearTransformCommand = useStore((state) => state.clearTransformCommand);
  const setObjectTransformSnapshot = useStore((state) => state.setObjectTransformSnapshot);
  const setManipulationPanelOpen = useStore((state) => state.setManipulationPanelOpen);
  const isLayOnFacePickModeActive = useStore((state) => state.isLayOnFacePickModeActive);
  const setLayOnFacePickModeActive = useStore((state) => state.setLayOnFacePickModeActive);
  const arrangeRequestId = useStore((state) => state.arrangeRequestId);
  const arrangeSettings = useStore((state) => state.arrangeSettings);
  const setCaptureViewportThumbnail = useStore((state) => state.setCaptureViewportThumbnail);



  /**
   * Recompute the aggregate bounds/out-of-bounds coloring across ALL
   * loaded meshes (not just the most recently loaded one), so info
   * overlay + amber/teal coloring stay correct once multiple objects
   * are on the plate.
   */
  const refreshAllBoundsAndColors = useCallback(() => {
    meshesRef.current.forEach((mesh) => {
      updateBoundsAndColor(mesh, bedSize, setModelBounds);
    });
  }, [bedSize, setModelBounds]);

  /** Remove and dispose the Lay on Face overlay, if one is currently shown. */
  const clearLayOnFaceOverlay = useCallback(() => {
    const overlay = layOnFaceOverlayRef.current;
    if (!overlay) return;
    overlay.group.parent?.remove(overlay.group);
    disposeLayOnFaceOverlay(overlay);
    layOnFaceOverlayRef.current = null;
  }, []);

  /**
   * Publish a fresh Position/Rotation/Scale/Size snapshot of the selected
   * mesh to the store, so ObjectManipulationPanel has values to render.
   * Also refreshes bounds/out-of-bounds coloring, since any edit that
   * moves/resizes the object can change whether it's within the bed.
   * Declared early (before the effects that use it below) so reading
   * order matches execution order.
   */
  const refreshSelectedObjectSnapshot = useCallback(() => {
    if (!selectedObjectId) {
      setObjectTransformSnapshot(null);
      return;
    }
    const mesh = meshesRef.current.get(selectedObjectId);
    if (!mesh) {
      setObjectTransformSnapshot(null);
      return;
    }
    setObjectTransformSnapshot(computeObjectTransformSnapshot(mesh, coordinateMode));
    updateBoundsAndColor(mesh, useStore.getState().bedSize, setModelBounds);
  }, [selectedObjectId, coordinateMode, setObjectTransformSnapshot, setModelBounds]);

  /**
   * Update (or remove) the selection outline box around the currently
   * selected object, so the user can see which object is selected.
   */
  const updateSelectionOutline = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (selectionOutlineRef.current) {
      scene.remove(selectionOutlineRef.current);
      selectionOutlineRef.current.dispose();
      selectionOutlineRef.current = null;
    }

    if (selectedObjectId) {
      const mesh = meshesRef.current.get(selectedObjectId);
      if (mesh) {
        const outline = new THREE.BoxHelper(mesh, 0xffcc00);
        scene.add(outline);
        selectionOutlineRef.current = outline;
      }
    }
  }, [selectedObjectId]);

  /**
   * Animate the camera to look at the origin from a given direction (a
   * unit vector), landing at DEFAULT_CAMERA_DISTANCE away. Used by the
   * view-cube gizmo: every face/edge/vertex click supplies its own
   * direction (e.g. (0,0,1) for "Top", (1,1,1) for a corner vertex), so
   * this single function drives all view-cube navigation instead of a
   * fixed set of Home/Top/Front/Side presets.
   * Uses smooth lerp interpolation over 500ms.
   */
  const animateToDirection = useCallback((direction: THREE.Vector3) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;

    if (!camera || !controls) return;

    const endPosition = direction.clone().normalize().multiplyScalar(DEFAULT_CAMERA_DISTANCE);

    animationStateRef.current = {
      isAnimating: true,
      startPosition: camera.position.clone(),
      startTarget: controls.target.clone(),
      endPosition,
      endTarget: new THREE.Vector3(0, 0, 0),
      startTime: performance.now(),
      duration: 500, // 500ms animation duration
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Initialize Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    // Initialize Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
    // The build plate and models use a Z-up convention (Z = height off the
    // bed, matching OrcaSlicer's native coordinate system). Three.js cameras
    // default to a Y-up orientation, so we must override `up` to (0, 0, 1)
    // — otherwise OrbitControls would orbit around the wrong axis and the
    // "up" direction on screen would not correspond to the printer's Z axis.
    camera.up.set(0, 0, 1);
    // Home view: isometric-ish, looking at the origin
    camera.position.copy(HOME_DIRECTION).multiplyScalar(DEFAULT_CAMERA_DISTANCE);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Initialize Renderer
    // preserveDrawingBuffer: true is required for canvas.toBlob()/
    // toDataURL() (used by captureThumbnail, registered below) to reliably
    // read back the actually-rendered pixels — WITHOUT it, the browser is
    // free to clear the drawing buffer immediately after compositing each
    // frame, and a toBlob() call made any time after that (e.g. from the
    // job-completion handler, potentially frames later) can capture a
    // blank/garbage canvas instead of the model.
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Initialize Lighting
    // Ambient light for overall illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    // Directional light for shadows and depth
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(100, -100, 200);
    scene.add(directionalLight);

    // Initialize OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    
    // Configure mouse controls:
    // - Left drag: orbit (rotate view)
    // - Middle drag: pan (translate view)
    // - Scroll: zoom
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN, // Allow right-click pan as well
    };
    
    controlsRef.current = controls;

    // ---------------------------------------------------------------
    // Selection + drag-to-move interaction
    //
    // Behavior (per spec):
    //  - No object selected: drag anywhere orbits the camera (default
    //    OrbitControls behavior, untouched).
    //  - Object selected: a drag that STARTS on the selected object moves
    //    it across the bed plane; a drag that starts anywhere else still
    //    orbits. A plain click (no drag) on an object selects it; a plain
    //    click on empty space deselects.
    //
    // We temporarily disable OrbitControls while dragging an object so the
    // camera doesn't also rotate underneath the move.
    // ---------------------------------------------------------------
    const canvas = renderer.domElement;
    const raycaster = raycasterRef.current;

    const getRect = () => canvas.getBoundingClientRect();

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return; // Only left button drives select/move
      pointerDownRef.current = { x: event.clientX, y: event.clientY };

      // While Lay on Face pick mode is active, clicks are handled entirely
      // in handlePointerUp (raycast against the highlighted face overlays).
      // Skip starting an object-move drag here — otherwise pressing down
      // on a highlighted overlay (which is a CHILD of the selected mesh,
      // so it's hit by the same recursive raycast below) would begin a
      // drag, making handlePointerUp's `wasDragging` check bail out before
      // ever reaching the Lay on Face click logic.
      if (useStore.getState().isLayOnFacePickModeActive) return;

      const currentSelectedId = useStore.getState().selectedObjectId;
      if (!currentSelectedId) return; // Nothing selected -> let OrbitControls orbit

      const selectedMesh = meshesRef.current.get(currentSelectedId);
      if (!selectedMesh) return;

      const rect = getRect();
      const ndc = toNdc(event.clientX, event.clientY, rect);

      const hitRoot = pickRootObject(raycaster, camera, ndc, [selectedMesh]);
      if (hitRoot !== selectedMesh) return; // Drag didn't start on the selected object -> orbit

      const bedPoint = intersectBedPlane(raycaster, camera, ndc, 0);
      if (!bedPoint) return;

      dragStateRef.current = {
        fileId: currentSelectedId,
        mesh: selectedMesh,
        grabOffset: {
          x: selectedMesh.position.x - bedPoint.x,
          y: selectedMesh.position.y - bedPoint.y,
        },
        currentZ: selectedMesh.position.z,
      };

      // Disable orbiting while dragging the object
      controls.enabled = false;
    };

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag) {
        handleHoverCursor(event);
        return;
      }

      const rect = getRect();
      const ndc = toNdc(event.clientX, event.clientY, rect);
      const bedPoint = intersectBedPlane(raycaster, camera, ndc, 0);
      if (!bedPoint) return;

      const newPos = computeDragPosition(bedPoint, drag.grabOffset, drag.currentZ);
      drag.mesh.position.set(newPos.x, newPos.y, newPos.z);

      updateBoundsAndColor(drag.mesh, useStore.getState().bedSize, setModelBounds);

      // Keep the manipulation panel's Position fields live while dragging.
      const currentMode = useStore.getState().coordinateMode;
      useStore.getState().setObjectTransformSnapshot(
        computeObjectTransformSnapshot(drag.mesh, currentMode)
      );
    };

    const endDrag = () => {
      if (dragStateRef.current) {
        dragStateRef.current = null;
        controls.enabled = true;
      }
    };

    const handleHoverCursor = (event: PointerEvent) => {
      if (dragStateRef.current) {
        canvas.style.cursor = 'grabbing';
        return;
      }

      if (useStore.getState().isLayOnFacePickModeActive) {
        const overlay = layOnFaceOverlayRef.current;
        if (overlay) {
          const rect = getRect();
          const ndc = toNdc(event.clientX, event.clientY, rect);
          raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
          const hits = raycaster.intersectObjects(
            overlay.regions.map((r) => r.overlayMesh),
            false
          );
          const hoveredMesh = hits.length > 0 ? (hits[0].object as THREE.Mesh) : null;
          applyLayOnFaceHover(overlay, hoveredMesh);
          canvas.style.cursor = hoveredMesh ? 'pointer' : 'crosshair';
        } else {
          canvas.style.cursor = 'crosshair';
        }
        return;
      }

      const currentSelectedId = useStore.getState().selectedObjectId;
      if (!currentSelectedId) {
        canvas.style.cursor = 'grab';
        return;
      }

      const selectedMesh = meshesRef.current.get(currentSelectedId);
      if (!selectedMesh) {
        canvas.style.cursor = 'grab';
        return;
      }

      const rect = getRect();
      const ndc = toNdc(event.clientX, event.clientY, rect);
      const hitRoot = pickRootObject(raycaster, camera, ndc, [selectedMesh]);
      canvas.style.cursor = hitRoot === selectedMesh ? 'move' : 'grab';
    };

    const handlePointerUp = (event: PointerEvent) => {
      const wasDragging = dragStateRef.current !== null;
      endDrag();

      const downPos = pointerDownRef.current;
      pointerDownRef.current = null;
      if (event.button !== 0 || !downPos) return;

      // Only treat as a selection click if the pointer barely moved (i.e.
      // this wasn't an orbit drag or an object-move drag).
      if (!isClick(downPos, { x: event.clientX, y: event.clientY })) return;
      if (wasDragging) return;

      const rect = getRect();
      const ndc = toNdc(event.clientX, event.clientY, rect);

      // Lay on Face pick mode: clicking one of the highlighted face
      // overlays (rendered while pick mode is active — see the effect
      // above) lays that face flat, instead of changing the selection.
      if (useStore.getState().isLayOnFacePickModeActive) {
        const currentSelectedId = useStore.getState().selectedObjectId;
        const selectedMesh = currentSelectedId ? meshesRef.current.get(currentSelectedId) : null;
        const overlay = layOnFaceOverlayRef.current;
        if (selectedMesh && overlay) {
          raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
          const hits = raycaster.intersectObjects(
            overlay.regions.map((r) => r.overlayMesh),
            false
          );
          if (hits.length > 0) {
            const hitMesh = hits[0].object as THREE.Mesh;
            const region = overlay.regions.find((r) => r.overlayMesh === hitMesh);
            if (region) {
              // The region's normal is in the mesh's LOCAL frame (the
              // overlay is a child of the mesh); transform it to world
              // space using the mesh's current orientation so layOnFace
              // (which expects a world-space normal) rotates correctly.
              const worldNormal = region.localNormal.clone().applyQuaternion(selectedMesh.quaternion).normalize();
              useStore.getState().dispatchTransformCommand({
                type: 'layOnFace',
                targetId: currentSelectedId!,
                worldNormal: [worldNormal.x, worldNormal.y, worldNormal.z],
              });
            }
          }
        }
        setLayOnFacePickModeActive(false);
        return;
      }

      const roots = Array.from(meshesRef.current.entries());
      const hit = pickRootObject(
        raycaster,
        camera,
        ndc,
        roots.map(([, mesh]) => mesh)
      );

      if (hit) {
        const entry = roots.find(([, mesh]) => mesh === hit);
        setSelectedObjectId(entry ? entry[0] : null);
      } else {
        setSelectedObjectId(null);
      }
    };

    // Double-clicking the object reopens the object parameters overlay
    // (dimensions/volume/triangles) if it was closed via its own close
    // button. Only reopens for a double-click that actually hits the
    // object, not empty space/build plate.
    const handleDoubleClick = (event: MouseEvent) => {
      const roots = Array.from(meshesRef.current.entries());
      if (roots.length === 0) return;
      const rect = getRect();
      const ndc = toNdc(event.clientX, event.clientY, rect);
      const hit = pickRootObject(
        raycaster,
        camera,
        ndc,
        roots.map(([, mesh]) => mesh)
      );
      if (hit) {
        useStore.getState().setInfoOverlayOpen(true);
      }
    };

    // Right-clicking a plate object opens the object context menu
    // (Remove / Clone / Set number of instances — see ObjectContextMenu.tsx),
    // matching native OrcaSlicer's object-list right-click menu. Right-click
    // on empty space/build plate falls through to OrbitControls' default
    // right-click pan (no menu, no selection change) and closes any open
    // menu. The clicked object also becomes selected, matching native's
    // behavior of right-click selecting before showing the menu.
    const handleContextMenu = (event: MouseEvent) => {
      const rect = getRect();
      const ndc = toNdc(event.clientX, event.clientY, rect);
      const roots = Array.from(meshesRef.current.entries());
      const hit = pickRootObject(
        raycaster,
        camera,
        ndc,
        roots.map(([, mesh]) => mesh)
      );

      if (!hit) {
        useStore.getState().closeContextMenu();
        return; // let the default right-click pan happen
      }

      event.preventDefault();
      const entry = roots.find(([, mesh]) => mesh === hit);
      const fileId = entry ? entry[0] : null;
      if (!fileId) return;

      setSelectedObjectId(fileId);
      useStore.getState().openContextMenu(fileId, { x: event.clientX, y: event.clientY });
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointerleave', endDrag);
    canvas.addEventListener('dblclick', handleDoubleClick);
    canvas.addEventListener('contextmenu', handleContextMenu);

    // Initialize View-Cube Gizmo (100x100px bottom-left overlay). Every
    // face, edge, and vertex of the cube is clickable and jumps the camera
    // to the corresponding view direction, replacing the old plain
    // Home/Top/Front/Side text buttons with a navigation cube like the
    // reference OrcaSlicer/CAD-style gizmo. Hovering highlights the region
    // under the pointer; dragging orbits the main camera (mirroring the
    // reference UI's behavior of the cube itself being draggable).
    const gizmoCanvas = gizmoCanvasRef.current;
    // Larger on-screen footprint than before (was 100px) so the cube reads
    // clearly, while the cube's own geometry is smaller (see viewCube.ts)
    // and framed with margin so nothing gets clipped.
    const GIZMO_SIZE = 130;
    if (gizmoCanvas) {
      const gizmoScene = new THREE.Scene();
      gizmoSceneRef.current = gizmoScene;

      const gizmoCamera = new THREE.PerspectiveCamera(GIZMO_CAMERA_FOV, 1, 0.1, 1000);
      gizmoCamera.up.set(0, 0, 1);
      gizmoCamera.position.set(0, 0, GIZMO_CAMERA_DISTANCE);
      gizmoCamera.lookAt(0, 0, 0);
      gizmoCameraRef.current = gizmoCamera;

      const gizmoRenderer = new THREE.WebGLRenderer({
        canvas: gizmoCanvas,
        alpha: true, // Transparent background
        antialias: true,
      });
      gizmoRenderer.setSize(GIZMO_SIZE, GIZMO_SIZE);
      gizmoRenderer.setPixelRatio(window.devicePixelRatio);
      gizmoRendererRef.current = gizmoRenderer;

      const cube = buildViewCube();
      gizmoScene.add(cube.group);
      gizmoCubeRef.current = cube;

      const gizmoLight = new THREE.AmbientLight(0xffffff, 1.2);
      gizmoScene.add(gizmoLight);
    }

    const getGizmoNdc = (event: { clientX: number; clientY: number }) => {
      const canvasEl = gizmoCanvasRef.current;
      if (!canvasEl) return null;
      const rect = canvasEl.getBoundingClientRect();
      return toNdc(event.clientX, event.clientY, rect);
    };

    // Orbit the MAIN camera around the origin by the given pixel delta,
    // using the same yaw/pitch-around-target approach OrbitControls uses
    // internally, so dragging the gizmo cube feels identical to dragging
    // the main viewport (satisfies "dragging the cube should move the
    // view as well").
    const orbitMainCameraBy = (deltaX: number, deltaY: number) => {
      const mainCamera = cameraRef.current;
      const mainControls = controlsRef.current;
      if (!mainCamera || !mainControls) return;

      const ROTATE_SPEED = 0.008;
      const offset = mainCamera.position.clone().sub(mainControls.target);
      const radius = offset.length();

      // Spherical coordinates around the target, using the camera's own up
      // axis (Z) as the polar axis, matching OrbitControls' convention.
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta -= deltaX * ROTATE_SPEED;
      spherical.phi -= deltaY * ROTATE_SPEED;
      spherical.phi = Math.max(0.001, Math.min(Math.PI - 0.001, spherical.phi));
      spherical.radius = radius;

      const newOffset = new THREE.Vector3().setFromSpherical(spherical);
      mainCamera.position.copy(mainControls.target).add(newOffset);
      mainCamera.lookAt(mainControls.target);
    };

    const handleGizmoPointerDown = (event: PointerEvent) => {
      gizmoDragRef.current = { lastX: event.clientX, lastY: event.clientY };
      gizmoPointerDownRef.current = { x: event.clientX, y: event.clientY };
      gizmoCanvas?.setPointerCapture(event.pointerId);
    };

    const handleGizmoPointerMove = (event: PointerEvent) => {
      const drag = gizmoDragRef.current;
      const cube = gizmoCubeRef.current;
      const gizmoCamera = gizmoCameraRef.current;

      if (drag) {
        // Dragging: orbit the main camera and clear any hover highlight
        // (Fusion360/OrcaSlicer suppress hover feedback mid-drag too).
        const deltaX = event.clientX - drag.lastX;
        const deltaY = event.clientY - drag.lastY;
        orbitMainCameraBy(deltaX, deltaY);
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
        if (cube) applyViewCubeHover(cube, null);
        return;
      }

      // Not dragging: update hover highlight under the pointer.
      if (!cube || !gizmoCamera) return;
      const ndc = getGizmoNdc(event);
      if (!ndc) return;
      const picked = pickViewCubeRegion(gizmoRaycasterRef.current, gizmoCamera, ndc, cube);
      applyViewCubeHover(cube, picked);
      if (gizmoCanvas) {
        gizmoCanvas.style.cursor = picked ? 'pointer' : 'grab';
      }
    };

    const handleGizmoPointerUp = (event: PointerEvent) => {
      gizmoDragRef.current = null;
      try {
        gizmoCanvas?.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may already be released; safe to ignore.
      }

      const downPos = gizmoPointerDownRef.current;
      gizmoPointerDownRef.current = null;

      // Only a plain click (negligible total movement) snaps the camera
      // to the region's view direction — matching the reference UI, where
      // dragging orbits freely but clicking a face/edge/vertex jumps to
      // that exact view. A real drag (handled frame-by-frame above) should
      // not also trigger a snap on release.
      if (!downPos || !isClick(downPos, { x: event.clientX, y: event.clientY })) return;

      const cube = gizmoCubeRef.current;
      const gizmoCamera = gizmoCameraRef.current;
      if (!cube || !gizmoCamera) return;

      const ndc = getGizmoNdc(event);
      if (!ndc) return;
      const picked = pickViewCubeRegion(gizmoRaycasterRef.current, gizmoCamera, ndc, cube);
      if (picked) {
        animateToDirection(picked.direction);
      }
    };

    const handleGizmoPointerLeave = () => {
      gizmoDragRef.current = null;
      const cube = gizmoCubeRef.current;
      if (cube) applyViewCubeHover(cube, null);
    };

    gizmoCanvas?.addEventListener('pointerdown', handleGizmoPointerDown);
    gizmoCanvas?.addEventListener('pointermove', handleGizmoPointerMove);
    gizmoCanvas?.addEventListener('pointerup', handleGizmoPointerUp);
    gizmoCanvas?.addEventListener('pointerleave', handleGizmoPointerLeave);

    // Animation loop using requestAnimationFrame
    const animate = () => {
      animationFrameIdRef.current = requestAnimationFrame(animate);

      // Handle camera preset animation
      const animState = animationStateRef.current;
      if (animState && animState.isAnimating) {
        const elapsed = performance.now() - animState.startTime;
        const progress = Math.min(elapsed / animState.duration, 1.0);
        
        // Smooth easing function (ease-in-out)
        const t = progress < 0.5
          ? 2 * progress * progress
          : -1 + (4 - 2 * progress) * progress;

        // Interpolate camera position
        camera.position.lerpVectors(animState.startPosition, animState.endPosition, t);
        
        // Interpolate controls target
        controls.target.lerpVectors(animState.startTarget, animState.endTarget, t);
        
        // Mark animation as complete when finished
        if (progress >= 1.0 && animationStateRef.current) {
          animationStateRef.current.isAnimating = false;
        }
      }

      // Update controls (required for damping)
      controls.update();

      // Keep the selection outline glued to its target mesh as it moves
      if (selectionOutlineRef.current) {
        selectionOutlineRef.current.update();
      }

      // Render the main scene
      renderer.render(scene, camera);

      // Render the view-cube gizmo, keeping it oriented the same way the
      // main camera is currently looking at the scene. It's not enough to
      // copy the main camera's quaternion while leaving the gizmo camera's
      // position fixed — that only rotates it in place and it stops
      // pointing at the cube (which sits at the origin). Instead, place
      // the gizmo camera along the same direction from the origin as the
      // main camera (normalized to a fixed gizmo distance) and re-aim it
      // at the cube's center every frame, so the cube's orientation always
      // mirrors the current 3D view.
      if (gizmoRendererRef.current && gizmoSceneRef.current && gizmoCameraRef.current && cameraRef.current) {
        const mainCam = cameraRef.current;
        const gizmoCam = gizmoCameraRef.current;

        const direction = mainCam.position.clone().normalize();
        gizmoCam.position.copy(direction.multiplyScalar(GIZMO_CAMERA_DISTANCE));
        gizmoCam.up.copy(mainCam.up);
        gizmoCam.lookAt(0, 0, 0);

        gizmoRendererRef.current.render(gizmoSceneRef.current, gizmoCam);
      }
    };

    // Start the animation loop
    animate();

    // Register the thumbnail-capture function used by jobSlice's
    // job-completion handlers (see viewportSlice.ts's doc comment on
    // captureViewportThumbnail for why this exists: the CLI itself can
    // never produce a gcode thumbnail, so this app captures its own
    // already-live Prepare-tab view as a substitute). Waits one extra
    // animation frame before reading pixels back so the render loop above
    // has definitely painted the current camera/model state into the
    // (preserveDrawingBuffer: true) canvas before toBlob() reads it.
    //
    // Resized down to GCODE_THUMBNAIL_SIZE (140x110) to match native
    // OrcaSlicer's own default gcode thumbnail dimensions (see the
    // "thumbnails" ConfigOptionString's default value,
    // `"48x48/PNG,300x300/PNG"` — profiles commonly override this to
    // "140x110/PNG", which is what a reference native-sliced gcode
    // embeds) rather than uploading the full, much larger viewport
    // canvas resolution as-is.
    setCaptureViewportThumbnail(() => {
      return new Promise<Blob | null>((resolve) => {
        // Native's own gcode thumbnail shows only the model(s), not the
        // build plate grid/axes — temporarily hide the plate (and the
        // selection outline, which is a UI affordance, not part of the
        // model) for exactly the one frame we capture, then restore both
        // and re-render so the on-screen view is never visibly affected.
        const buildPlateGroup = buildPlateGroupRef.current;
        const selectionOutline = selectionOutlineRef.current;
        if (buildPlateGroup) buildPlateGroup.visible = false;
        if (selectionOutline) selectionOutline.visible = false;

        // Also reframe the camera to fit the loaded objects' combined
        // bounding box, rather than reusing the user's current camera
        // position — otherwise the thumbnail just shows whatever
        // arbitrary crop of the (now-invisible) build plate's area the
        // user happened to be looking at, with the model itself
        // potentially tiny in a corner. Snapshotted position/target are
        // restored right after capture so this never visibly affects the
        // user's own view.
        const savedCameraPosition = camera.position.clone();
        const savedControlsTarget = controls.target.clone();
        const objectMeshes = Array.from(meshesRef.current.values());
        if (objectMeshes.length > 0) {
          fitCameraToObjects(camera, controls, objectMeshes);
        }
        controls.update();
        renderer.render(scene, camera);

        requestAnimationFrame(() => {
          renderer.domElement.toBlob((blob) => {
            // Restore visibility/camera and re-render immediately so the
            // regular animation loop's next frame (and anything the user
            // is actually looking at right now) isn't left plate-less or
            // reframed out from under them.
            if (buildPlateGroup) buildPlateGroup.visible = true;
            if (selectionOutline) selectionOutline.visible = true;
            camera.position.copy(savedCameraPosition);
            controls.target.copy(savedControlsTarget);
            controls.update();
            renderer.render(scene, camera);

            if (!blob) {
              resolve(null);
              return;
            }
            resizeImageBlob(blob, GCODE_THUMBNAIL_SIZE.width, GCODE_THUMBNAIL_SIZE.height)
              .then(resolve)
              .catch(() => resolve(blob)); // fall back to the unresized capture rather than losing the thumbnail entirely
          }, 'image/png');
        });
      });
    });

    // Handle window resize
    const handleResize = () => {
      if (!containerRef.current) return;
      
      const newWidth = containerRef.current.clientWidth;
      const newHeight = containerRef.current.clientHeight;

      // Skip while hidden (this viewport's container is toggled via CSS
      // display:none rather than unmounted when the Preview tab is
      // active — see MainArea — which leaves clientWidth/clientHeight at
      // 0; dividing by a zero height would set an invalid camera aspect).
      if (newWidth === 0 || newHeight === 0) return;

      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();

      renderer.setSize(newWidth, newHeight);
    };

    window.addEventListener('resize', handleResize);

    // Also react to the container's own size changes, not just the
    // window's. This matters now that MainArea keeps both the Prepare and
    // Preview viewports mounted at once (toggling visibility via CSS
    // display:none instead of unmounting them, so switching tabs doesn't
    // discard model placement) — the hidden viewport has a zero-size
    // container until it's shown again, and un-hiding it doesn't fire a
    // window resize event, so the renderer/camera would otherwise stay
    // stuck at whatever size (often 0x0) it had at initial mount.
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointerleave', endDrag);
      canvas.removeEventListener('dblclick', handleDoubleClick);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      gizmoCanvas?.removeEventListener('pointerdown', handleGizmoPointerDown);
      gizmoCanvas?.removeEventListener('pointermove', handleGizmoPointerMove);
      gizmoCanvas?.removeEventListener('pointerup', handleGizmoPointerUp);
      gizmoCanvas?.removeEventListener('pointerleave', handleGizmoPointerLeave);

      // Stop animation loop
      if (animationFrameIdRef.current !== null) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }

      // Dispose of controls
      if (controlsRef.current) {
        controlsRef.current.dispose();
      }

      // Dispose of renderer
      if (rendererRef.current) {
        rendererRef.current.dispose();
        if (container.contains(rendererRef.current.domElement)) {
          container.removeChild(rendererRef.current.domElement);
        }
      }

      // Dispose of gizmo renderer
      if (gizmoRendererRef.current) {
        gizmoRendererRef.current.dispose();
      }

      // Clear references
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
      buildPlateGroupRef.current = null;
      gizmoSceneRef.current = null;
      gizmoCameraRef.current = null;
      gizmoRendererRef.current = null;
      gizmoCubeRef.current = null;
      gizmoDragRef.current = null;
      gizmoPointerDownRef.current = null;
      meshesRef.current.clear();
      loadedFileIdsRef.current.clear();
      selectionOutlineRef.current = null;
      dragStateRef.current = null;
      clearLayOnFaceOverlay();
      setObjectTransformSnapshot(null);
      setCaptureViewportThumbnail(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to bedSize changes and update build plate grid
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove old build plate if it exists
    if (buildPlateGroupRef.current) {
      scene.remove(buildPlateGroupRef.current);
      // Dispose of geometries and materials to free memory
      buildPlateGroupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((mat) => mat.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      buildPlateGroupRef.current = null;
    }

    // Always render a build plate — fall back to a default size until a
    // printer profile resolves, so the plate is visible immediately on
    // startup (matching native OrcaSlicer) instead of only appearing once
    // a printer fetch completes.
    const effectiveBedSize = bedSize ?? DEFAULT_BED_SIZE;
    const buildPlateGroup = buildPlateGrid(effectiveBedSize.width, effectiveBedSize.depth);
    scene.add(buildPlateGroup);
    buildPlateGroupRef.current = buildPlateGroup;
  }, [bedSize]); // Re-run when bedSize changes

  // Subscribe to uploadedFiles and load any newly-uploaded files as
  // additional objects on the plate (existing objects are left in place,
  // so importing a second/third file doesn't remove the first).
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const newFiles = uploadedFiles.filter(
      (f) => !loadedFileIdsRef.current.has(f.file_id)
    );
    if (newFiles.length === 0) return;

    const loadModelsAsync = async () => {
      for (const [index, file] of newFiles.entries()) {
        loadedFileIdsRef.current.add(file.file_id); // mark as "loading" immediately to avoid double-load
        try {
          // Clones (created via the right-click context menu's Clone / Set
          // number of instances actions — see ContextMenu.tsx) reuse the
          // ALREADY-LOADED source mesh's geometry instead of re-fetching
          // from the backend, since a clone's file_id is a synthetic id
          // that was never actually uploaded. Deep-clone the Object3D
          // (geometry shared by reference, which is fine — it's never
          // mutated in place) but give it its own material INSTANCES so
          // per-object out-of-bounds coloring/selection doesn't bleed
          // across instances.
          if (file.is_clone) {
            const sourceMesh = meshesRef.current.get(file.source_file_id);
            if (!sourceMesh) {
              // Source not loaded yet (shouldn't normally happen, since a
              // clone can only be created from an already-loaded object) —
              // retry on the next uploadedFiles change instead of failing.
              loadedFileIdsRef.current.delete(file.file_id);
              continue;
            }
            const clonedMesh = sourceMesh.clone(true);
            clonedMesh.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                const material = child.material;
                child.material = Array.isArray(material)
                  ? material.map((m) => m.clone())
                  : material.clone();
              }
            });
            // Offset so the clone doesn't spawn exactly on top of its source.
            clonedMesh.position.x += NEW_OBJECT_SPACING_MM;

            scene.add(clonedMesh);
            meshesRef.current.set(file.file_id, clonedMesh);
            updateBoundsAndColor(clonedMesh, useStore.getState().bedSize, setModelBounds);
            setSelectedObjectId(file.file_id);
            continue;
          }

          const result = await fetchAndLoadModel(
            file.file_id,
            file.filename,
            setModelBounds,
            setModelMetadata
          );

          // Offset each newly-imported object so multiple files don't spawn
          // stacked at the origin. Existing objects are untouched.
          const slot = meshesRef.current.size + index;
          result.mesh.position.x += slot * NEW_OBJECT_SPACING_MM;

          scene.add(result.mesh);
          meshesRef.current.set(file.file_id, result.mesh);

          updateBoundsAndColor(result.mesh, useStore.getState().bedSize, setModelBounds);

          // Match the native UI: a freshly imported object becomes selected
          // automatically, so Move/Rotate/Scale act on it immediately.
          setSelectedObjectId(file.file_id);
        } catch (error) {
          console.error('Failed to load model:', error);
          loadedFileIdsRef.current.delete(file.file_id);
          // TODO: Show error to user via store/notification system
        }
      }
    };

    loadModelsAsync();
  }, [uploadedFiles, setModelBounds, setModelMetadata, setSelectedObjectId]);

  // Remove meshes for any uploadedFiles entry that disappeared (Remove /
  // reducing instance count in the context menu) — meshesRef/loadedFileIdsRef
  // are otherwise only ever added to, so this keeps the scene in sync when
  // the store shrinks the list.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const currentIds = new Set(uploadedFiles.map((f) => f.file_id));
    for (const [id, mesh] of Array.from(meshesRef.current.entries())) {
      if (currentIds.has(id)) continue;

      scene.remove(mesh);
      mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const material = child.material;
          if (Array.isArray(material)) {
            material.forEach((m) => m.dispose());
          } else {
            material?.dispose();
          }
        }
      });
      meshesRef.current.delete(id);
      loadedFileIdsRef.current.delete(id);

      if (useStore.getState().selectedObjectId === id) {
        setSelectedObjectId(null);
      }
    }
  }, [uploadedFiles, setSelectedObjectId]);

  // Recompute out-of-bounds coloring for all objects whenever the bed size
  // changes (e.g. user switches printer profile).
  useEffect(() => {
    refreshAllBoundsAndColors();
  }, [bedSize, refreshAllBoundsAndColors]);

  // Keep the selection outline in sync with the store's selectedObjectId.
  // Also close the Move/Rotate/Scale manipulation panel whenever the
  // selection changes (including selecting a brand-new object) — it must
  // never auto-open using whichever tool was last active; it only opens
  // via an explicit toolbar click or a double-click on the object (see
  // handleDoubleClick below).
  useEffect(() => {
    updateSelectionOutline();
    setManipulationPanelOpen(false);
    setLayOnFacePickModeActive(false);
  }, [selectedObjectId, updateSelectionOutline, setManipulationPanelOpen, setLayOnFacePickModeActive]);

  // Build/remove the Lay on Face highlighted-face overlays whenever pick
  // mode is toggled on/off, matching native GLGizmoFlatten's behavior of
  // rendering clickable highlighted planes on the selected object's
  // convex hull while the tool is active.
  useEffect(() => {
    clearLayOnFaceOverlay();
    if (!isLayOnFacePickModeActive || !selectedObjectId) return;

    const mesh = meshesRef.current.get(selectedObjectId);
    if (!mesh) return;

    const overlay = buildLayOnFaceOverlays(mesh);
    mesh.add(overlay.group);
    layOnFaceOverlayRef.current = overlay;

    return () => {
      clearLayOnFaceOverlay();
    };
  }, [isLayOnFacePickModeActive, selectedObjectId, clearLayOnFaceOverlay]);

  // Run an Arrange pass whenever arrangeRequestId increments (dispatched
  // by ArrangeSettingsPanel's "Arrange" button — see arrangeSettingsSlice
  // for why this is a one-shot counter rather than a boolean flag).
  // Matches native's Arrange toolbar action: it always arranges every
  // object currently on the plate (not just the selection), applies the
  // current settings (spacing / auto-rotate / align-to-Y), and finishes
  // by centering the resulting pile on the bed (computeArrangePlan's
  // bottomLeftFillPack already centers the pile at the origin).
  useEffect(() => {
    if (arrangeRequestId === 0) return; // skip the initial mount (no-op default value)

    const entries = Array.from(meshesRef.current.entries()).map(([id, object]) => ({ id, object }));
    if (entries.length === 0) return;

    const plan = computeArrangePlan(entries, {
      spacingMm: arrangeSettings.spacing,
      enableRotation: arrangeSettings.enableRotation,
      alignToYAxis: arrangeSettings.alignToYAxis,
      bedSize: bedSize ?? undefined,
    });

    for (const { id, object } of entries) {
      const extraRotation = plan.extraRotations.get(id) ?? 0;
      if (Math.abs(extraRotation) > 1e-9) {
        // Rotate about world Z (yaw only — arrange only reorients the
        // footprint, matching native's 2D nester), composed on top of the
        // object's current orientation, same convention as
        // applyRotationRelative's 'world' mode.
        const deltaQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), extraRotation);
        object.quaternion.premultiply(deltaQuat);
      }

      const targetCenter = plan.targetCenters.get(id);
      if (targetCenter) {
        object.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(object);
        const currentCenter = box.getCenter(new THREE.Vector3());
        const dx = targetCenter.x - currentCenter.x;
        const dy = targetCenter.y - currentCenter.y;
        object.position.x += dx;
        object.position.y += dy;
      }
      object.updateMatrixWorld(true);
      updateBoundsAndColor(object, useStore.getState().bedSize, setModelBounds);
    }

    refreshSelectedObjectSnapshot();
    selectionOutlineRef.current?.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrangeRequestId]);

  // Keep the manipulation panel's snapshot in sync with the selected
  // object and the active World/Object coordinate mode.
  useEffect(() => {
    refreshSelectedObjectSnapshot();
  }, [refreshSelectedObjectSnapshot]);

  // Consume a single queued edit command from ObjectManipulationPanel and
  // apply it to the actual THREE.Object3D, then republish the snapshot and
  // clear the command (see objectManipulationSlice.ts for why this is a
  // one-shot queue rather than derived state).
  useEffect(() => {
    if (!pendingTransformCommand) return;

    const command: PendingTransformCommand = pendingTransformCommand;

    // Auto Orient All doesn't require (or use) a selected object — it
    // rotates every loaded mesh independently, matching the native
    // per-plate "orient all" toolbar action.
    if (command.type === 'autoOrient' && command.scope === 'all') {
      meshesRef.current.forEach((mesh) => {
        autoOrientObject(mesh);
        updateBoundsAndColor(mesh, useStore.getState().bedSize, setModelBounds);
      });
      clearTransformCommand();
      refreshSelectedObjectSnapshot();
      selectionOutlineRef.current?.update();
      return;
    }

    if (!selectedObjectId) {
      clearTransformCommand();
      return;
    }
    const mesh = meshesRef.current.get(selectedObjectId);
    if (!mesh) {
      clearTransformCommand();
      return;
    }

    switch (command.type) {
      case 'position':
        applyPositionChange(mesh, command.axis, command.value, coordinateMode);
        break;
      case 'rotateRelative':
        applyRotationRelative(mesh, command.axis, command.deltaDegrees, coordinateMode);
        break;
      case 'rotateAbsolute':
        applyRotationAbsolute(mesh, command.axis, command.degrees);
        break;
      case 'scaleRatio':
        applyScaleRatio(mesh, command.axis, command.ratio, uniformScale);
        break;
      case 'sizeRatio':
        applyScaleRatio(mesh, command.axis, command.ratio, uniformScale);
        break;
      case 'resetRotation':
        resetRotation(mesh);
        break;
      case 'resetScale':
        resetScale(mesh);
        break;
      case 'layOnFace': {
        const normal = new THREE.Vector3(...command.worldNormal);
        layOnFace(mesh, normal);
        break;
      }
      case 'autoOrient': // scope === 'selected' (scope === 'all' handled above)
        autoOrientObject(mesh);
        break;
    }

    clearTransformCommand();
    refreshSelectedObjectSnapshot();

    // Keep the selection outline glued to the mesh's new bounds immediately
    // (the render loop also calls .update(), but this avoids a 1-frame lag).
    selectionOutlineRef.current?.update();
  }, [
    pendingTransformCommand,
    selectedObjectId,
    coordinateMode,
    uniformScale,
    clearTransformCommand,
    refreshSelectedObjectSnapshot,
    setModelBounds,
  ]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      style={{ minHeight: '400px' }}
    >
      {/* Move/Rotate/Scale/Arrange toolbar - inside the viewport, top-left */}
      <div className="absolute top-4 left-4 z-10">
        <ViewportTransformToolbar />
      </div>

      {/* Navigation view-cube gizmo - 100x100px bottom-left corner.
          pointerEvents is NOT disabled here (unlike the old axis-only
          overlay) since every face/edge/vertex is clickable. */}
      <canvas
        ref={gizmoCanvasRef}
        className="absolute bottom-4 left-4"
        style={{
          width: '130px',
          height: '130px',
          cursor: 'grab',
          touchAction: 'none', // prevent touch scrolling while dragging the cube
        }}
      />
    </div>
  );
};
