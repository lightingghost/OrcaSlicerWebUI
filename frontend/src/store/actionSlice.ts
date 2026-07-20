import { StateCreator } from 'zustand';

export type Action = 'slice' | 'export_3mf' | 'export_stl' | 'export_stls' | 'export_settings';

export interface ActionFlags {
  min_save?: boolean;
  no_check?: boolean;
  normative_check?: boolean;
  uptodate?: boolean;
  load_defaultfila?: boolean;
  enable_timelapse?: boolean;
}

export interface ActionSlice {
  action: Action;
  plateNumber: number;
  outputFilename: string;
  actionFlags: ActionFlags;
  setAction: (action: Action) => void;
  setPlateNumber: (plateNumber: number) => void;
  setOutputFilename: (filename: string) => void;
  setActionFlag: (key: keyof ActionFlags, value: boolean) => void;
  resetAction: () => void;
}

const DEFAULT_ACTION_STATE = {
  action: 'slice' as Action,
  plateNumber: 0,
  outputFilename: '',
  actionFlags: {
    min_save: false,
    no_check: false,
    normative_check: false,
    uptodate: false,
    load_defaultfila: false,
    enable_timelapse: false,
  },
};

export const createActionSlice: StateCreator<ActionSlice> = (set) => ({
  ...DEFAULT_ACTION_STATE,

  setAction: (action: Action) => {
    set((state) => ({
      action,
      // Pre-fill default output filenames
      outputFilename:
        action === 'export_3mf'
          ? 'output.3mf'
          : action === 'export_settings'
          ? 'output.json'
          : state.outputFilename,
    }));
  },

  setPlateNumber: (plateNumber: number) => {
    set({ plateNumber });
  },

  setOutputFilename: (outputFilename: string) => {
    set({ outputFilename });
  },

  setActionFlag: (key: keyof ActionFlags, value: boolean) => {
    set((state) => ({
      actionFlags: {
        ...state.actionFlags,
        [key]: value,
      },
    }));
  },

  resetAction: () => {
    set(DEFAULT_ACTION_STATE);
  },
});
