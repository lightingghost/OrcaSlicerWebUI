import { StateCreator } from 'zustand';

export interface BoundingBox {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

export interface ModelMetadata {
  filename: string;
  triangleCount: number;
}

export interface ViewportSlice {
  modelBounds: BoundingBox | null; // updated on model load
  modelMetadata: ModelMetadata | null; // filename and triangle count
  isOutOfBounds: boolean; // derived
  // ID (file_id) of the currently selected object in the viewport, or null
  // if nothing is selected (background/build-plate click). When an object
  // is selected, drag-on-object moves it; drag-elsewhere always orbits.
  selectedObjectId: string | null;
  // Whether the object parameters overlay (dimensions/volume/triangles) is
  // visible. Closable via a button on the overlay; reopened by
  // double-clicking the object in the viewport (see ThreeViewport).
  isInfoOverlayOpen: boolean;
  setModelBounds: (bounds: BoundingBox) => void;
  setModelMetadata: (metadata: ModelMetadata) => void;
  setSelectedObjectId: (id: string | null) => void;
  setInfoOverlayOpen: (open: boolean) => void;

  /**
   * Registered by ThreeViewport once its renderer/scene/camera are ready.
   * Returns a PNG Blob of the current Prepare-tab 3D view (the plate +
   * model exactly as sliced), or null if the viewport isn't mounted/ready
   * yet. Used by jobSlice's job-completion handlers to generate a
   * thumbnail for the just-completed slice job — native OrcaSlicer's CLI
   * cannot produce one itself (its thumbnail generator callback is never
   * wired up outside the desktop GUI's OpenGL rendering pipeline), so this
   * app captures its own already-live model view as a substitute.
   */
  captureViewportThumbnail: (() => Promise<Blob | null>) | null;
  setCaptureViewportThumbnail: (fn: (() => Promise<Blob | null>) | null) => void;

  /**
   * Registered by ThreeViewport once its scene is ready. Returns every
   * plate object's CURRENT live position + orientation (bed-absolute mm,
   * THREE.js quaternion order) read directly from the Three.js scene's
   * mesh transforms, keyed by file_id — the source of truth for object
   * placement, since it's never mirrored into Zustand (see MainArea.tsx's
   * doc comment on why). Used by projectSlice's downloadProject to build
   * an accurate project.3mf reflecting exactly what's on the plate right
   * now, including any manual drag/rotate edits.
   */
  getPlateSnapshot:
    | (() => Array<{
        file_id: string;
        x: number;
        y: number;
        z: number;
        qx: number;
        qy: number;
        qz: number;
        qw: number;
        sx: number;
        sy: number;
        sz: number;
      }>)
    | null;
  setGetPlateSnapshot: (
    fn:
      | (() => Array<{
          file_id: string;
          x: number;
          y: number;
          z: number;
          qx: number;
          qy: number;
          qz: number;
          qw: number;
          sx: number;
          sy: number;
          sz: number;
        }>)
      | null
  ) => void;
}

export const createViewportSlice: StateCreator<ViewportSlice> = (set) => ({
  modelBounds: null,
  modelMetadata: null,
  isOutOfBounds: false,
  selectedObjectId: null,
  isInfoOverlayOpen: true,
  captureViewportThumbnail: null,
  getPlateSnapshot: null,

  setModelBounds: (bounds: BoundingBox) => {
    set({ modelBounds: bounds });

    // Update isOutOfBounds flag based on bed size
    // This will be called from the Three.js viewport component
    // which has access to the bed size from the profile slice
    // For now, just store the bounds
  },

  setModelMetadata: (metadata: ModelMetadata) => {
    set({ modelMetadata: metadata });
  },

  setSelectedObjectId: (id: string | null) => {
    set({ selectedObjectId: id });
  },

  setInfoOverlayOpen: (open: boolean) => {
    set({ isInfoOverlayOpen: open });
  },

  setCaptureViewportThumbnail: (fn) => {
    set({ captureViewportThumbnail: fn });
  },

  setGetPlateSnapshot: (fn) => {
    set({ getPlateSnapshot: fn });
  },
});
