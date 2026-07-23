import { StateCreator } from 'zustand';

/**
 * arrangeSettingsSlice
 *
 * State backing the Arrange settings popup (see ArrangeSettingsPanel.tsx),
 * modeled directly after OrcaSlicer's native `GLCanvas3D::ArrangeSettings`
 * struct and the ImGui popup rendered by `_render_arrange_menu`
 * (src/slic3r/GUI/GLCanvas3D.cpp/.hpp) — matching the reference screenshot:
 * a Spacing slider/input ("0 means auto spacing."), then "Auto rotate for
 * arrangement", "Allow multiple materials on same plate", and "Align to Y
 * axis" checkboxes, then Arrange/Reset buttons.
 *
 * Native defaults (GLCanvas3D::ArrangeSettings):
 *   distance = 0, enable_rotation = false,
 *   allow_multi_materials_on_same_plate = true, align_to_y_axis = false.
 *
 * Native also enforces "Align to Y axis" and "Auto rotate" being mutually
 * exclusive (the checkbox is disabled and forced off whenever rotation is
 * enabled) — replicated in ArrangeSettingsPanel's UI logic.
 */

export interface ArrangeSettingsState {
  /** mm. 0 means "auto spacing" per native's "0 means auto spacing." label. */
  spacing: number;
  enableRotation: boolean;
  allowMultiMaterialsOnSamePlate: boolean;
  alignToYAxis: boolean;
}

export const DEFAULT_ARRANGE_SETTINGS: ArrangeSettingsState = {
  spacing: 0,
  enableRotation: false,
  allowMultiMaterialsOnSamePlate: true,
  alignToYAxis: false,
};

export interface ArrangeSettingsSlice {
  arrangeSettings: ArrangeSettingsState;
  /** Whether the Arrange settings popup is open. */
  isArrangeSettingsOpen: boolean;
  setArrangeSetting: <K extends keyof ArrangeSettingsState>(key: K, value: ArrangeSettingsState[K]) => void;
  resetArrangeSettings: () => void;
  setArrangeSettingsOpen: (open: boolean) => void;
  /** One-shot trigger: ThreeViewport listens for this counter to increment and runs the arrange pass. */
  arrangeRequestId: number;
  triggerArrange: () => void;
}

export const createArrangeSettingsSlice: StateCreator<ArrangeSettingsSlice> = (set) => ({
  arrangeSettings: { ...DEFAULT_ARRANGE_SETTINGS },
  isArrangeSettingsOpen: false,
  arrangeRequestId: 0,

  setArrangeSetting: (key, value) => {
    set((state) => {
      const next = { ...state.arrangeSettings, [key]: value };
      // Native: "Align to Y axis" is mutually exclusive with rotation —
      // enabling rotation forces align-to-Y off (GLCanvas3D.cpp:
      // "do not allow align to Y axis if rotation is enabled").
      if (key === 'enableRotation' && value) {
        next.alignToYAxis = false;
      }
      return { arrangeSettings: next };
    });
  },

  resetArrangeSettings: () => {
    set({ arrangeSettings: { ...DEFAULT_ARRANGE_SETTINGS } });
  },

  setArrangeSettingsOpen: (open) => set({ isArrangeSettingsOpen: open }),

  triggerArrange: () => {
    set((state) => ({ arrangeRequestId: state.arrangeRequestId + 1 }));
  },
});
