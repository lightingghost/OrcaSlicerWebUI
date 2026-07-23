import { StateCreator } from 'zustand';
import { parseGcode, ParsedGcode } from '../lib/gcodeParser';

export type MainTab = 'prepare' | 'preview' | 'device' | 'project' | 'calibration';

export interface PreviewSlice {
  /** Which top-level tab is active (Prepare | Preview | Device | Project |
   * Calibration). Lives in the store (rather than component-local state,
   * as it used to before this feature) so job completion can drive it
   * directly — see jobSlice's onCompleted/polling handlers, which call
   * `setActiveTab('preview')` the moment a slice job finishes, matching
   * native OrcaSlicer switching to its Preview tab automatically once
   * slicing completes. */
  activeTab: MainTab;
  setActiveTab: (tab: MainTab) => void;

  /** Parsed gcode for the current preview (line-type stats, toolpath
   * segments, per-layer breakdown, total estimation). Null until a
   * completed slice job's .gcode output has been fetched and parsed. */
  parsedGcode: ParsedGcode | null;
  isLoadingGcode: boolean;
  gcodeLoadError: string | null;

  /** Currently displayed layer (0-indexed) and, within that layer, how
   * many of its segments are shown (for the horizontal "step" scrubber —
   * matching native's per-layer move slider under the 3D view). */
  currentLayerIndex: number;
  currentStepIndex: number;

  /** Line-type roles (plus the synthetic "Travel" role) currently hidden
   * from the 3D toolpath view — toggled via the eye icon in
   * LineTypeStatsPanel's stats table, matching native's per-role legend
   * checkboxes. "Travel" starts hidden by default, matching native's
   * Preview tab (rapid non-extruding moves are not drawn by default,
   * only shown once the user explicitly enables them). */
  hiddenRoles: Set<string>;
  toggleRoleVisibility: (role: string) => void;

  /** Fetches the given job's sliced gcode output and parses it, replacing
   * any previously loaded preview data. No-ops if `downloadUrl` doesn't
   * point to a .gcode file (e.g. export_stl jobs have no meaningful
   * preview). */
  loadGcodePreview: (downloadUrl: string) => Promise<void>;
  clearGcodePreview: () => void;
  setCurrentLayerIndex: (index: number) => void;
  setCurrentStepIndex: (index: number) => void;
}

export const createPreviewSlice: StateCreator<PreviewSlice> = (set, get) => ({
  activeTab: 'prepare',
  setActiveTab: (tab) => set({ activeTab: tab }),

  parsedGcode: null,
  isLoadingGcode: false,
  gcodeLoadError: null,
  currentLayerIndex: 0,
  currentStepIndex: 0,
  hiddenRoles: new Set(['Travel']),

  toggleRoleVisibility: (role: string) => {
    set((state) => {
      const next = new Set(state.hiddenRoles);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return { hiddenRoles: next };
    });
  },

  loadGcodePreview: async (downloadUrl: string) => {
    set({ isLoadingGcode: true, gcodeLoadError: null });
    try {
      const response = await fetch(downloadUrl, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to download gcode: ${response.status}`);
      }

      const text = await response.text();
      const parsed = parseGcode(text);
      const lastLayerIndex = Math.max(0, parsed.layers.length - 1);
      const lastLayer = parsed.layers[lastLayerIndex];
      const lastLayerStepCount = lastLayer
        ? lastLayer.endSegmentIndex - lastLayer.startSegmentIndex
        : 0;

      set({
        parsedGcode: parsed,
        isLoadingGcode: false,
        // Default to showing the complete model (last layer, fully drawn),
        // matching native's initial preview state after slicing.
        currentLayerIndex: lastLayerIndex,
        currentStepIndex: lastLayerStepCount,
        // Reset per-role visibility for the new preview (Travel hidden by
        // default, matching native; everything else visible).
        hiddenRoles: new Set(['Travel']),
      });
    } catch (error) {
      console.error('[PreviewSlice] Failed to load gcode preview:', error);
      set({
        isLoadingGcode: false,
        gcodeLoadError: error instanceof Error ? error.message : 'Failed to load gcode preview',
      });
    }
  },

  clearGcodePreview: () => {
    set({
      parsedGcode: null,
      gcodeLoadError: null,
      currentLayerIndex: 0,
      currentStepIndex: 0,
    });
  },

  setCurrentLayerIndex: (index: number) => {
    const parsed = get().parsedGcode;
    if (!parsed) {
      set({ currentLayerIndex: index });
      return;
    }
    const clamped = Math.max(0, Math.min(index, Math.max(0, parsed.layers.length - 1)));
    const layer = parsed.layers[clamped];
    const stepCount = layer ? layer.endSegmentIndex - layer.startSegmentIndex : 0;
    set({ currentLayerIndex: clamped, currentStepIndex: stepCount });
  },

  setCurrentStepIndex: (index: number) => {
    const parsed = get().parsedGcode;
    const layer = parsed?.layers[get().currentLayerIndex];
    const maxStep = layer ? layer.endSegmentIndex - layer.startSegmentIndex : 0;
    set({ currentStepIndex: Math.max(0, Math.min(index, maxStep)) });
  },
});
