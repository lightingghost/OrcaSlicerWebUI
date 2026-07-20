import { StateCreator } from 'zustand';

/**
 * MiscOptions interface matching the design document
 */
export interface MiscOptions {
  datadir?: string;
  debug?: 0 | 1 | 2 | 3 | 4 | 5;
  load_custom_gcodes_file_id?: string;
  load_filament_ids?: number[];
  skip_objects?: number[];
  clone_objects?: number[];
  allow_newer_file?: boolean;
  allow_mix_temp?: boolean;
  skip_modified_gcodes?: boolean;
  downward_check?: boolean;
  enable_timelapse?: boolean;
}

/**
 * Validation errors for misc options
 */
export interface MiscValidationErrors {
  load_filament_ids?: string;
  skip_objects?: string;
  clone_objects?: string;
}

export interface MiscSlice {
  misc: MiscOptions;
  miscValidationErrors: MiscValidationErrors;
  setMiscOption: <K extends keyof MiscOptions>(key: K, value: MiscOptions[K]) => void;
  setMiscValidationError: (key: keyof MiscValidationErrors, error: string | undefined) => void;
  resetMisc: () => void;
}

const initialMiscState: MiscOptions = {
  datadir: undefined,
  debug: undefined,
  load_custom_gcodes_file_id: undefined,
  load_filament_ids: undefined,
  skip_objects: undefined,
  clone_objects: undefined,
  allow_newer_file: false,
  allow_mix_temp: false,
  skip_modified_gcodes: false,
  downward_check: false,
  enable_timelapse: false,
};

export const createMiscSlice: StateCreator<MiscSlice> = (set) => ({
  misc: initialMiscState,
  miscValidationErrors: {},

  setMiscOption: (key, value) => {
    set((state) => ({
      misc: {
        ...state.misc,
        [key]: value,
      },
    }));
  },

  setMiscValidationError: (key, error) => {
    set((state) => ({
      miscValidationErrors: {
        ...state.miscValidationErrors,
        [key]: error,
      },
    }));
  },

  resetMisc: () => {
    set({
      misc: initialMiscState,
      miscValidationErrors: {},
    });
  },
});
