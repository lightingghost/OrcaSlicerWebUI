import { StateCreator } from 'zustand';

export interface TransformOptions {
  rotate?: number; // Z-axis degrees
  rotate_x?: number;
  rotate_y?: number;
  scale?: number; // scale factor
  arrange?: 0 | 1 | 2;
  orient?: 0 | 1 | 2;
  repetitions?: number;
  ensure_on_bed?: boolean;
  assemble?: boolean;
  convert_unit?: boolean;
  // arrange sub-options (only when arrange == 1 or 2)
  allow_rotations?: boolean;
  allow_multicolor_oneplate?: boolean;
  avoid_extrusion_cali_region?: boolean;
}

export interface TransformSlice {
  transforms: TransformOptions;
  setTransform: (key: keyof TransformOptions, value: unknown) => void;
  resetTransforms: () => void;
}

const DEFAULT_TRANSFORMS: TransformOptions = {
  rotate: 0,
  rotate_x: 0,
  rotate_y: 0,
  scale: 1,
  arrange: 0,
  orient: 0,
  repetitions: 1,
  ensure_on_bed: false,
  assemble: false,
  convert_unit: false,
  allow_rotations: false,
  allow_multicolor_oneplate: false,
  avoid_extrusion_cali_region: false,
};

export const createTransformSlice: StateCreator<TransformSlice> = (set) => ({
  transforms: { ...DEFAULT_TRANSFORMS },

  setTransform: (key: keyof TransformOptions, value: unknown) => {
    set((state) => ({
      transforms: {
        ...state.transforms,
        [key]: value,
      },
    }));
  },

  resetTransforms: () => {
    set({ transforms: { ...DEFAULT_TRANSFORMS } });
  },
});
