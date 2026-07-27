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
// NOTE on arrange's default: previously defaulted to `2` (native's CLI
// "auto" value — `need_arrange = true` by default in OrcaSlicer.cpp
// before any `--arrange` flag is processed), on the reasoning that since
// the viewport's actual X/Y object placement was never sent to the
// backend at slice time, auto-arranging was the only way to guarantee
// objects landed on the bed rather than at whatever raw X/Y the uploaded
// file happens to contain.
//
// That reasoning no longer applies: the Prepare tab's Arrange button
// (ViewportTransformToolbar) now calls the REAL OrcaSlicer CLI's own
// arrange algorithm directly (see backend/app/routers/arrange.py) and
// applies its result to the actual objects on the plate, so by the time
// the user clicks Slice, objects are already correctly positioned via an
// explicit, visible action — not a slice-time side effect the user didn't
// ask for. Auto-arranging again during Slice would silently re-shuffle
// object positions the user just deliberately arranged (or manually
// placed by hand), which is surprising and not what "Slice" should do.
// Defaulting to `0` (disabled) makes Slice slice the plate as arranged,
// matching the explicit request to not auto-arrange at slice time; the
// user can still opt back into auto-arrange-on-slice via the Job
// Options > Transform panel's Arrange Mode dropdown.
const DEFAULT_TRANSFORMS: TransformOptions = {
  rotate: 0,
  rotate_x: 0,
  rotate_y: 0,
  scale: 1,
  arrange: 0,
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
