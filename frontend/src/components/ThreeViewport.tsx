import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useStore } from '../store';
import { buildPlateGrid } from '../lib/buildPlateGrid';
import { ViewPresetToolbar } from './ViewPresetToolbar';
import { fetchAndLoadModel, updateBoundsAndColor } from '../lib/modelLoader';

// Camera preset configurations
const CAMERA_PRESETS = {
  home: { position: new THREE.Vector3(0, -300, 300), target: new THREE.Vector3(0, 0, 0) },
  top: { position: new THREE.Vector3(0, 0, 400), target: new THREE.Vector3(0, 0, 0) },
  front: { position: new THREE.Vector3(0, -400, 0), target: new THREE.Vector3(0, 0, 0) },
  side: { position: new THREE.Vector3(400, 0, 0), target: new THREE.Vector3(0, 0, 0) },
};

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
  const modelMeshRef = useRef<THREE.Object3D | null>(null);

  // Axis gizmo refs
  const gizmoCanvasRef = useRef<HTMLCanvasElement>(null);
  const gizmoSceneRef = useRef<THREE.Scene | null>(null);
  const gizmoCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const gizmoRendererRef = useRef<THREE.WebGLRenderer | null>(null);

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
  
  // Get camera preset actions from store
  const setCameraPreset = useStore((state) => state.setCameraPreset);

  /**
   * Animate camera to a preset position
   * Uses smooth lerp interpolation over 500ms
   */
  const animateToPreset = useCallback((preset: 'home' | 'top' | 'front' | 'side') => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    
    if (!camera || !controls) return;

    const targetConfig = CAMERA_PRESETS[preset];
    
    // Start animation
    animationStateRef.current = {
      isAnimating: true,
      startPosition: camera.position.clone(),
      startTarget: controls.target.clone(),
      endPosition: targetConfig.position.clone(),
      endTarget: targetConfig.target.clone(),
      startTime: performance.now(),
      duration: 500, // 500ms animation duration
    };

    // Update store
    setCameraPreset(preset);
  }, [setCameraPreset]);

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
    // Home preset: positioned at (0, -300, 300) looking at origin
    camera.position.set(0, -300, 300);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Initialize Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
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

    // Initialize Axis Gizmo (80x80px bottom-left overlay)
    const gizmoCanvas = gizmoCanvasRef.current;
    if (gizmoCanvas) {
      const gizmoSize = 80;
      
      // Create gizmo scene
      const gizmoScene = new THREE.Scene();
      gizmoSceneRef.current = gizmoScene;

      // Create gizmo camera
      const gizmoCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
      gizmoCamera.position.set(0, 0, 5);
      gizmoCameraRef.current = gizmoCamera;

      // Create gizmo renderer
      const gizmoRenderer = new THREE.WebGLRenderer({
        canvas: gizmoCanvas,
        alpha: true, // Transparent background
        antialias: true,
      });
      gizmoRenderer.setSize(gizmoSize, gizmoSize);
      gizmoRenderer.setPixelRatio(window.devicePixelRatio);
      gizmoRendererRef.current = gizmoRenderer;

      // Add AxesHelper to gizmo scene
      // Size 2 makes it visible in the small viewport
      const axesHelper = new THREE.AxesHelper(2);
      gizmoScene.add(axesHelper);
    }

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

      // Render the main scene
      renderer.render(scene, camera);

      // Render the axis gizmo (sync with main camera orientation)
      if (gizmoRendererRef.current && gizmoSceneRef.current && gizmoCameraRef.current && cameraRef.current) {
        // Copy the main camera's quaternion to keep the gizmo in sync
        gizmoCameraRef.current.quaternion.copy(cameraRef.current.quaternion);
        gizmoRendererRef.current.render(gizmoSceneRef.current, gizmoCameraRef.current);
      }
    };

    // Start the animation loop
    animate();

    // Handle window resize
    const handleResize = () => {
      if (!containerRef.current) return;
      
      const newWidth = containerRef.current.clientWidth;
      const newHeight = containerRef.current.clientHeight;

      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();

      renderer.setSize(newWidth, newHeight);
    };

    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);

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
    };
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

    // Create and add new build plate if bedSize is available
    if (bedSize) {
      const buildPlateGroup = buildPlateGrid(bedSize.width, bedSize.depth);
      scene.add(buildPlateGroup);
      buildPlateGroupRef.current = buildPlateGroup;
    }
  }, [bedSize]); // Re-run when bedSize changes

  // Subscribe to uploadedFiles and load models when a new file is uploaded
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || uploadedFiles.length === 0) return;

    // Get the most recently uploaded file
    const latestFile = uploadedFiles[uploadedFiles.length - 1];

    // Load the model
    const loadModelAsync = async () => {
      try {
        // Remove old model if it exists
        if (modelMeshRef.current) {
          scene.remove(modelMeshRef.current);
          // Dispose of geometries and materials
          modelMeshRef.current.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.geometry.dispose();
              if (Array.isArray(child.material)) {
                child.material.forEach((mat) => mat.dispose());
              } else {
                child.material.dispose();
              }
            }
          });
          modelMeshRef.current = null;
        }

        // Load the new model using fetchAndLoadModel
        const result = await fetchAndLoadModel(
          latestFile.file_id,
          latestFile.filename,
          setModelBounds,
          setModelMetadata
        );

        // Add mesh to scene
        scene.add(result.mesh);
        modelMeshRef.current = result.mesh;

        // Check bounds and update color based on bed size
        if (bedSize) {
          updateBoundsAndColor(result.mesh, bedSize, setModelBounds);
        }
      } catch (error) {
        console.error('Failed to load model:', error);
        // TODO: Show error to user via store/notification system
      }
    };

    loadModelAsync();
  }, [uploadedFiles, bedSize, setModelBounds, setModelMetadata]); // Re-run when uploadedFiles or bedSize changes

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      style={{ minHeight: '400px' }}
    >
      {/* ViewPresetToolbar - positioned at top */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10">
        <ViewPresetToolbar onPresetSelect={animateToPreset} />
      </div>

      {/* Axis gizmo overlay - 80x80px bottom-left corner */}
      <canvas
        ref={gizmoCanvasRef}
        className="absolute bottom-4 left-4 border border-gray-600 rounded"
        style={{
          width: '80px',
          height: '80px',
          pointerEvents: 'none', // Don't interfere with main viewport interactions
        }}
      />
    </div>
  );
};
