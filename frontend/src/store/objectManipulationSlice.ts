import { StateCreator } from 'zustand';
import type { CoordinateMode, ObjectTransformSnapshot } from '../lib/objectTransform';

/**
 * objectManipulationSlice
 *
 * State backing the Move/Rotate/Scale object manipulation panel (see
 * ObjectManipulationPanel.tsx), modeled after OrcaSlicer's native
 * GizmoObjectManipulation panel. This app's 3D scene lives in
 * ThreeViewport (imperative Three.js, not declarative React-three-fiber),
 * so the actual mesh mutation can't happen inside the panel component —
 * instead the panel dispatches a `PendingTransformCommand` here, and
 * ThreeViewport's render-loop effect consumes and clears it, exactly like
 * a one-shot message queue (depth of 1: a new command overwrites any
 * unconsumed previous one, since edits are user-paced and it's fine for
 * the visual state to always reflect only the latest edit).
 */

export type TransformTool = 'move' | 'rotate' | 'scale';

export type PendingTransformCommand =
  | { type: 'position'; axis: 0 | 1 | 2; value: number }
  | { type: 'rotateRelative'; axis: 0 | 1 | 2; deltaDegrees: number }
  | { type: 'rotateAbsolute'; axis: 0 | 1 | 2; degrees: number }
  | { type: 'scaleRatio'; axis: 0 | 1 | 2; ratio: number }
  | { type: 'sizeRatio'; axis: 0 | 1 | 2; ratio: number }
  | { type: 'resetRotation' }
  | { type: 'resetScale' }
  /** Lay on Face: rotate the selected object so the clicked hull face lies flat. */
  | { type: 'layOnFace'; targetId: string; worldNormal: [number, number, number] }
  /** Auto Orient: re-orient one object (or all loaded objects) for best bed contact / least overhang. */
  | { type: 'autoOrient'; scope: 'selected' | 'all' };

export interface ObjectManipulationSlice {
  /** Which tool's fields are shown in the panel (Move / Rotate / Scale). */
  activeTransformTool: TransformTool;
  /**
   * Whether "Lay on Face" pick mode is active: clicking a face of the
   * selected object's convex hull in the viewport lays that face flat.
   * Separate from activeTransformTool since it's a one-shot picking mode,
   * not a persistent field-editing panel.
   */
  isLayOnFacePickModeActive: boolean;
  /**
   * Whether the ObjectManipulationPanel is actually visible. Deliberately
   * separate from `activeTransformTool` (which just remembers which tool
   * was last used): selecting a NEW object must NOT auto-open the panel
   * using whatever tool was active last time — the panel only opens when
   * the user explicitly clicks a Move/Rotate/Scale button.
   */
  isManipulationPanelOpen: boolean;
  /** World: values in world space. Object: values relative to the object's own axes. */
  coordinateMode: CoordinateMode;
  /** Whether editing one Scale/Size axis proportionally scales the other two. */
  uniformScale: boolean;
  /**
   * The latest live snapshot of the selected object's transform, computed
   * by ThreeViewport from the actual THREE.Object3D and pushed here so the
   * panel can render current Position/Rotation/Scale/Size values.
   */
  objectTransformSnapshot: ObjectTransformSnapshot | null;
  /** A single queued edit for ThreeViewport to apply on its next tick. */
  pendingTransformCommand: PendingTransformCommand | null;

  setActiveTransformTool: (tool: TransformTool) => void;
  setManipulationPanelOpen: (open: boolean) => void;
  setLayOnFacePickModeActive: (active: boolean) => void;
  setCoordinateMode: (mode: CoordinateMode) => void;
  setUniformScale: (uniform: boolean) => void;
  setObjectTransformSnapshot: (snapshot: ObjectTransformSnapshot | null) => void;
  dispatchTransformCommand: (command: PendingTransformCommand) => void;
  clearTransformCommand: () => void;
}

export const createObjectManipulationSlice: StateCreator<ObjectManipulationSlice> = (set) => ({
  activeTransformTool: 'move',
  isManipulationPanelOpen: false,
  isLayOnFacePickModeActive: false,
  coordinateMode: 'world',
  uniformScale: true,
  objectTransformSnapshot: null,
  pendingTransformCommand: null,

  setActiveTransformTool: (tool) => set({ activeTransformTool: tool }),
  setManipulationPanelOpen: (open) => set({ isManipulationPanelOpen: open }),
  setLayOnFacePickModeActive: (active) => set({ isLayOnFacePickModeActive: active }),
  setCoordinateMode: (mode) => set({ coordinateMode: mode }),
  setUniformScale: (uniform) => set({ uniformScale: uniform }),
  setObjectTransformSnapshot: (snapshot) => set({ objectTransformSnapshot: snapshot }),
  dispatchTransformCommand: (command) => set({ pendingTransformCommand: command }),
  clearTransformCommand: () => set({ pendingTransformCommand: null }),
});
