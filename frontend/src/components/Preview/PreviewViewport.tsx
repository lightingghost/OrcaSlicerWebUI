import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useStore } from '../../store';
import { buildPlateGrid } from '../../lib/buildPlateGrid';
import { LINE_TYPE_COLORS, type ToolpathSegment } from '../../lib/gcodeParser';

// Matches ThreeViewport's default bed size fallback and camera conventions
// so the Preview tab's 3D view feels identical to the Prepare tab's.
const DEFAULT_BED_SIZE = { width: 220, depth: 220 };
const DEFAULT_CAMERA_DISTANCE = 424;
const HOME_DIRECTION = new THREE.Vector3(0, -1, 1).normalize();

function colorToThree([r, g, b]: [number, number, number]): THREE.Color {
  return new THREE.Color(r / 255, g / 255, b / 255);
}

/**
 * PreviewViewport
 *
 * Renders the sliced gcode's toolpath as colored line segments on the same
 * build plate used by the Prepare tab's 3D viewport, following native
 * OrcaSlicer's Preview tab: each line type (wall, infill, support, etc)
 * is drawn in its own color (see gcodeParser.ts's LINE_TYPE_COLORS, ported
 * directly from libvgcode's DEFAULT_EXTRUSION_ROLES_COLORS), and only
 * segments up to the current layer/step (driven by the layer + step
 * scrubbers in PreviewSidebar) are shown — matching native's "build up"
 * preview as you drag the sliders.
 *
 * Deliberately a separate Three.js scene/renderer from ThreeViewport
 * (rather than reusing the same canvas) since the Prepare and Preview tabs
 * show fundamentally different content (editable plate objects vs a
 * read-only toolpath) and are never visible simultaneously.
 */
export const PreviewViewport: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const buildPlateGroupRef = useRef<THREE.Group | null>(null);
  const toolpathGroupRef = useRef<THREE.Group | null>(null);

  const bedSize = useStore((state) => state.bedSize);
  const bedCenter = useStore((state) => state.bedCenter);
  const parsedGcode = useStore((state) => state.parsedGcode);
  const currentLayerIndex = useStore((state) => state.currentLayerIndex);
  const currentStepIndex = useStore((state) => state.currentStepIndex);
  const hiddenRoles = useStore((state) => state.hiddenRoles);

  // Scene/camera/renderer setup (mirrors ThreeViewport's pattern).
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    // Falls back to a 1:1 aspect / minimal renderer size if this mounts
    // while hidden (MainArea keeps the Preview viewport mounted even when
    // the Prepare tab is active, toggling it via CSS display:none — see
    // MainArea — so clientWidth/clientHeight can be 0 on initial mount).
    // The ResizeObserver set up below corrects this the moment the
    // container is actually shown and has a real size.
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
    camera.up.set(0, 0, 1);
    camera.position.copy(HOME_DIRECTION).multiplyScalar(DEFAULT_CAMERA_DISTANCE);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Wrapped in try/catch: browsers cap the total number of simultaneous
    // WebGL contexts per page. If that limit is already exhausted (e.g.
    // ThreeViewport's own contexts, plus other tabs/apps using the GPU),
    // `new THREE.WebGLRenderer(...)` throws — previously uncaught, which
    // crashed the ENTIRE app via React Router's default error boundary
    // (no errorElement configured) instead of failing gracefully within
    // just this one viewport.
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (error) {
      console.error('[PreviewViewport] Failed to create WebGL context:', error);
      container.textContent =
        'Unable to initialize 3D preview (WebGL context creation failed). Try closing other tabs/apps using the GPU, or reloading the page.';
      container.className = 'w-full h-full flex items-center justify-center text-center text-sm text-gray-400 p-8';
      return;
    }
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
    directionalLight.position.set(100, -100, 200);
    scene.add(directionalLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    controlsRef.current = controls;

    const animate = () => {
      animationFrameIdRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current) return;
      const newWidth = containerRef.current.clientWidth;
      const newHeight = containerRef.current.clientHeight;
      // Skip while hidden (MainArea toggles this viewport's container via
      // CSS display:none rather than unmounting it, so switching away from
      // the Preview tab doesn't discard the loaded gcode/camera state —
      // but that leaves clientWidth/clientHeight at 0 while hidden, and
      // dividing by a zero height would set an invalid (NaN/Infinity)
      // camera aspect ratio).
      if (newWidth === 0 || newHeight === 0) return;
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    };
    window.addEventListener('resize', handleResize);

    // Also react to the container's own size changes (not just the
    // window's) — un-hiding this viewport when switching back to the
    // Preview tab doesn't fire a window resize event, so without this the
    // renderer/camera would stay stuck at whatever size (0x0) it had while
    // hidden.
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      if (animationFrameIdRef.current !== null) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
      buildPlateGroupRef.current = null;
      toolpathGroupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build plate (same visual as the Prepare tab).
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (buildPlateGroupRef.current) {
      scene.remove(buildPlateGroupRef.current);
      buildPlateGroupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      });
      buildPlateGroupRef.current = null;
    }

    const effectiveBedSize = bedSize ?? DEFAULT_BED_SIZE;
    const group = buildPlateGrid(effectiveBedSize.width, effectiveBedSize.depth);
    scene.add(group);
    buildPlateGroupRef.current = group;
  }, [bedSize]);

  // Toolpath rendering: rebuild the LineSegments buffer whenever the
  // parsed gcode or the layer/step scrubber position changes.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (toolpathGroupRef.current) {
      scene.remove(toolpathGroupRef.current);
      toolpathGroupRef.current.traverse((child) => {
        if (child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      });
      toolpathGroupRef.current = null;
    }

    if (!parsedGcode || parsedGcode.segments.length === 0) return;

    const layers = parsedGcode.layers;
    const layer = layers[currentLayerIndex];
    if (!layer) return;

    // Bed convention: models/plate use X/Y centered at the origin (see
    // buildPlateGrid.ts), but gcode coordinates are printer-absolute,
    // relative to the printer's own `printable_area` polygon — whose
    // center is NOT always (width/2, depth/2) (some profiles' bed_shape
    // is already centered at the origin, e.g.
    // "-110x-110,110x-110,110x110,-110x110"; others have their origin at
    // the front-left corner). Subtract the printable_area's actual center
    // (bedCenter, read from the profile) so the toolpath lines up with the
    // plate grid regardless of which convention this printer uses.
    const effectiveBedSize = bedSize ?? DEFAULT_BED_SIZE;
    const offsetX = -(bedCenter?.x ?? effectiveBedSize.width / 2);
    const offsetY = -(bedCenter?.y ?? effectiveBedSize.depth / 2);

    // All fully-completed layers below the current one are shown at full
    // opacity; the current layer is drawn up to `currentStepIndex`
    // segments — matching native's layer + horizontal move sliders, which
    // "build up" the current layer incrementally while lower layers stay
    // complete.
    const visibleEnd = layer.startSegmentIndex + currentStepIndex;
    const segments: ToolpathSegment[] = parsedGcode.segments
      .slice(0, Math.min(visibleEnd, parsedGcode.segments.length))
      // Hide roles the user has toggled off in the stats panel (Travel
      // hidden by default, matching native's Preview tab not drawing
      // rapid non-extruding moves until explicitly enabled).
      .filter((seg) => !hiddenRoles.has(seg.role));

    const positions: number[] = [];
    const colors: number[] = [];

    for (const seg of segments) {
      const color = colorToThree(LINE_TYPE_COLORS[seg.role] ?? [128, 128, 128]);
      positions.push(
        seg.x0 + offsetX, seg.y0 + offsetY, seg.z0,
        seg.x1 + offsetX, seg.y1 + offsetY, seg.z1
      );
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    }

    if (positions.length === 0) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.LineBasicMaterial({ vertexColors: true });
    const lines = new THREE.LineSegments(geometry, material);

    const group = new THREE.Group();
    group.add(lines);
    scene.add(group);
    toolpathGroupRef.current = group;
  }, [parsedGcode, currentLayerIndex, currentStepIndex, bedSize, bedCenter, hiddenRoles]);

  return <div ref={containerRef} className="w-full h-full relative" style={{ minHeight: '400px' }} />;
};
