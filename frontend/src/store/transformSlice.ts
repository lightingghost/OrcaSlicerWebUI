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

// NOTE on ensure_on_bed's default: the native OrcaSlicer CLI's own default
// is `false` — but that's because the CLI is normally fed a .3mf produced
// by the interactive desktop GUI, which unconditionally repositions every
// object onto the bed the moment it's imported (see Plater.cpp:
// `model_object->center_around_origin(); model_object->ensure_on_bed();`,
// called with no user-facing toggle). The GUI has no "keep floating above
// the bed" mode, so by the time a .3mf reaches the CLI, every object is
// already resting on Z=0 and `--ensure-on-bed` would be a no-op.
//
// This web UI's 3D viewport also visually places every object at Z=0 on
// import (see modelLoader.ts's `loadModel`), matching that same native
// behavior — but that repositioning is purely a Three.js transform and is
// NEVER communicated to the backend job, which slices the ORIGINAL
// uploaded file's raw coordinates. Since STL files routinely have
// non-zero Z origins (e.g. modeled with a pedestal, exported without
// re-centering), slicing without `--ensure-on-bed` fails outright with
// "plate is empty or has no object fully inside it" for a large fraction
// of real-world files. Defaulting this to `true` here is what actually
// reproduces native's real end-to-end behavior (GUI-imported objects are
// always on-bed by the time they're sliced), not a deviation from it.
// NOTE on arrange's default: native's CLI (OrcaSlicer.cpp) initializes
// `need_arrange = true` before any `--arrange` flag is processed — i.e.
// native auto-arranges by default. `--arrange=0` is a special opt-OUT
// ("0 means disable" per the flag's own `arrange_option == 0` handling),
// and `--arrange=2` ("others means auto, keep the original logic")
// reproduces that same default explicitly. This app previously defaulted
// to `0` (auto-arrange disabled), which — combined with never sending the
// viewport's actual X/Y object placement to the backend (see
// ensure_on_bed's comment above for the same root issue on the Z axis) —
// meant an object could be sliced at whatever raw X/Y the uploaded file
// happens to contain, entirely outside the bed, with nothing to correct
// it. Defaulting to `2` (native's own "auto" value) matches native's real
// default behavior instead of opting out of it.
const DEFAULT_TRANSFORMS: TransformOptions = {
  rotate: 0,
  rotate_x: 0,
  rotate_y: 0,
  scale: 1,
  arrange: 2,
  orient: 0,
  repetitions: 1,
  ensure_on_bed: true,
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
