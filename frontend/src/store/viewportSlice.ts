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
  cameraPreset: 'home' | 'top' | 'front' | 'side' | 'free';
  setCameraPreset: (preset: ViewportSlice['cameraPreset']) => void;
  setModelBounds: (bounds: BoundingBox) => void;
  setModelMetadata: (metadata: ModelMetadata) => void;
}

export const createViewportSlice: StateCreator<ViewportSlice> = (set) => ({
  modelBounds: null,
  modelMetadata: null,
  isOutOfBounds: false,
  cameraPreset: 'home',

  setCameraPreset: (preset: 'home' | 'top' | 'front' | 'side' | 'free') => {
    set({ cameraPreset: preset });
  },

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
});
