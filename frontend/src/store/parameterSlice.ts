import { StateCreator } from 'zustand';
import { validateParameter } from '../lib/validation';

export interface ParameterDescriptor {
  key: string;
  label: string;
  tooltip: string;
  type: 'float' | 'int' | 'bool' | 'enum' | 'string';
  default_value: string | number | boolean;
  min?: number | null;
  max?: number | null;
  enum_values?: string[];
  section: 'quality' | 'strength' | 'speed' | 'support' | 'multi_material' | 'gcode' | 'other';
  /** Native UI optgroup title (e.g. "Layer height", "Line width"). Null for
   * parameters that are not part of the Process tab in the native UI. */
  group?: string | null;
  /** Position of `group` within its section, matching native UI order. */
  group_order?: number | null;
  /** Position of this parameter within its group, matching native UI order. */
  order?: number | null;
  /** Unit suffix shown next to the value, e.g. "mm", "mm or %", "%", "°". */
  unit?: string | null;
}

/**
 * Which set of process overrides ParameterField/ParameterPanel currently
 * read from and write into — either the plate-wide "Global" settings
 * (the pre-existing `overrides` map), or one specific plate object's own
 * overrides (keyed by its file_id in `objectOverrides`). Mirrors native
 * OrcaSlicer's Process panel's Global/Objects toggle + object list (see
 * ProcessSelector.tsx's Global/Objects toggle and the per-object list
 * this drives).
 */
export type ProcessTarget = 'global' | string;

export interface ParameterSlice {
  parameterDescriptors: ParameterDescriptor[];
  overrides: Record<string, string | number | boolean>;
  validationErrors: Record<string, string>;
  /**
   * Per-object process overrides, keyed by file_id (the plate object's
   * own id — see fileSlice.ts's UploadedFile.file_id). Each object's own
   * override map works exactly like the global `overrides` map, but
   * ALSO inherits every key it doesn't itself override from `overrides`
   * (see getEffectiveValue) — matching native's behavior: an object's
   * settings start out identical to Global's, and only the keys the user
   * explicitly changes for that object diverge (requirement: switching
   * Global's brim setting affects every object that hasn't overridden
   * brim itself).
   */
  objectOverrides: Record<string, Record<string, string | number | boolean>>;
  objectValidationErrors: Record<string, Record<string, string>>;
  /** Which target ParameterField/ParameterPanel currently edit — 'global'
   * or a specific object's file_id. Toggling to "Objects" in
   * ProcessSelector without yet picking a specific object leaves this on
   * 'global' until the user clicks an object in the list (matching
   * native, which keeps showing Global's own values until an object row
   * is actually selected). */
  processTarget: ProcessTarget;
  setProcessTarget: (target: ProcessTarget) => void;
  /**
   * Values loaded from the currently selected process profile (its
   * `inherits` chain resolved), keyed by parameter key. These act as the
   * "default" shown in each field and used by Reset, taking precedence
   * over `descriptor.default_value` (the PrintConfig.cpp global default)
   * whenever a profile defines the key.
   */
  profileDefaults: Record<string, string | number | boolean>;
  fetchDescriptors: () => Promise<void>;
  setOverride: (key: string, value: string | number | boolean) => void;
  clearOverride: (key: string) => void;
  setObjectOverride: (fileId: string, key: string, value: string | number | boolean) => void;
  clearObjectOverride: (fileId: string, key: string) => void;
  /** Discards ALL per-object overrides for one object (called when the
   * object is removed from the plate, so stale overrides for a
   * long-gone file_id never linger in state/autosave). */
  clearAllObjectOverrides: (fileId: string) => void;
  /** Get the effective default for a parameter: the profile-loaded value
   * if present, otherwise the descriptor's global default_value. */
  getEffectiveDefault: (descriptor: ParameterDescriptor) => string | number | boolean;
  /**
   * Get the effective value + whether it's overridden AT the given
   * target's own level (not merely inherited) for a descriptor. For
   * target 'global': global override, else profile/descriptor default.
   * For a specific fileId: that object's own override if present,
   * else the GLOBAL override (so global edits propagate to every object
   * that hasn't diverged), else profile/descriptor default.
   */
  getEffectiveValueForTarget: (
    descriptor: ParameterDescriptor,
    target: ProcessTarget
  ) => { value: string | number | boolean; isOverriddenAtTarget: boolean };
  setProfileDefaults: (defaults: Record<string, string | number | boolean>) => void;
  clearProfileDefaults: () => void;
  validateAll: () => boolean;
}

export const createParameterSlice: StateCreator<ParameterSlice> = (set, get) => ({
  parameterDescriptors: [],
  overrides: {},
  validationErrors: {},
  objectOverrides: {},
  objectValidationErrors: {},
  processTarget: 'global',
  profileDefaults: {},

  setProcessTarget: (target: ProcessTarget) => {
    set({ processTarget: target });
  },

  fetchDescriptors: async () => {
    try {
      const response = await fetch('/api/parameters', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch parameter descriptors: ${response.status}`);
      }

      const descriptors: ParameterDescriptor[] = await response.json();
      set({ parameterDescriptors: descriptors });
    } catch (error) {
      console.error('Failed to fetch parameter descriptors:', error);
      throw error;
    }
  },

  setOverride: (key: string, value: string | number | boolean) => {
    set((state) => {
      const newOverrides = { ...state.overrides, [key]: value };
      const newValidationErrors = { ...state.validationErrors };

      // Validate the value
      const descriptor = state.parameterDescriptors.find((d) => d.key === key);
      if (descriptor) {
        const error = validateParameter(descriptor, value);
        if (error) {
          newValidationErrors[key] = error;
        } else {
          delete newValidationErrors[key];
        }
      }

      return {
        overrides: newOverrides,
        validationErrors: newValidationErrors,
      };
    });
  },

  clearOverride: (key: string) => {
    set((state) => {
      const newOverrides = { ...state.overrides };
      const newValidationErrors = { ...state.validationErrors };

      delete newOverrides[key];
      delete newValidationErrors[key];

      return {
        overrides: newOverrides,
        validationErrors: newValidationErrors,
      };
    });
  },

  setObjectOverride: (fileId: string, key: string, value: string | number | boolean) => {
    set((state) => {
      const currentForObject = state.objectOverrides[fileId] ?? {};
      const newObjectOverrides = {
        ...state.objectOverrides,
        [fileId]: { ...currentForObject, [key]: value },
      };

      const currentErrorsForObject = state.objectValidationErrors[fileId] ?? {};
      const newErrorsForObject = { ...currentErrorsForObject };
      const descriptor = state.parameterDescriptors.find((d) => d.key === key);
      if (descriptor) {
        const error = validateParameter(descriptor, value);
        if (error) {
          newErrorsForObject[key] = error;
        } else {
          delete newErrorsForObject[key];
        }
      }

      return {
        objectOverrides: newObjectOverrides,
        objectValidationErrors: { ...state.objectValidationErrors, [fileId]: newErrorsForObject },
      };
    });
  },

  clearObjectOverride: (fileId: string, key: string) => {
    set((state) => {
      const currentForObject = state.objectOverrides[fileId];
      if (!currentForObject || !(key in currentForObject)) return {};

      const newForObject = { ...currentForObject };
      delete newForObject[key];

      const currentErrorsForObject = state.objectValidationErrors[fileId] ?? {};
      const newErrorsForObject = { ...currentErrorsForObject };
      delete newErrorsForObject[key];

      return {
        objectOverrides: { ...state.objectOverrides, [fileId]: newForObject },
        objectValidationErrors: { ...state.objectValidationErrors, [fileId]: newErrorsForObject },
      };
    });
  },

  clearAllObjectOverrides: (fileId: string) => {
    set((state) => {
      if (!(fileId in state.objectOverrides) && !(fileId in state.objectValidationErrors)) return {};
      const newObjectOverrides = { ...state.objectOverrides };
      delete newObjectOverrides[fileId];
      const newObjectValidationErrors = { ...state.objectValidationErrors };
      delete newObjectValidationErrors[fileId];
      return { objectOverrides: newObjectOverrides, objectValidationErrors: newObjectValidationErrors };
    });
  },

  getEffectiveDefault: (descriptor: ParameterDescriptor) => {
    const { profileDefaults } = get();
    const profileValue = profileDefaults[descriptor.key];
    return profileValue !== undefined ? profileValue : descriptor.default_value;
  },

  getEffectiveValueForTarget: (descriptor: ParameterDescriptor, target: ProcessTarget) => {
    const state = get();
    const key = descriptor.key;

    if (target === 'global') {
      const globalOverride = state.overrides[key];
      if (globalOverride !== undefined) {
        return { value: globalOverride, isOverriddenAtTarget: true };
      }
      return { value: state.getEffectiveDefault(descriptor), isOverriddenAtTarget: false };
    }

    // A specific object: its own override wins; otherwise fall through
    // to Global's override (so a Global edit affects every object that
    // hasn't diverged — requirement #3), then the profile/descriptor
    // default. `isOverriddenAtTarget` only reflects THIS object's own
    // override (not an inherited Global one) — used to decide whether
    // the Reset button appears for this specific object's row.
    const objectOverride = state.objectOverrides[target]?.[key];
    if (objectOverride !== undefined) {
      return { value: objectOverride, isOverriddenAtTarget: true };
    }
    const globalOverride = state.overrides[key];
    if (globalOverride !== undefined) {
      return { value: globalOverride, isOverriddenAtTarget: false };
    }
    return { value: state.getEffectiveDefault(descriptor), isOverriddenAtTarget: false };
  },

  setProfileDefaults: (defaults: Record<string, string | number | boolean>) => {
    set({ profileDefaults: defaults });
  },

  clearProfileDefaults: () => {
    set({ profileDefaults: {} });
  },

  validateAll: () => {
    const state = get();
    const errors: Record<string, string> = {};

    Object.entries(state.overrides).forEach(([key, value]) => {
      const descriptor = state.parameterDescriptors.find((d) => d.key === key);
      if (descriptor) {
        const error = validateParameter(descriptor, value);
        if (error) {
          errors[key] = error;
        }
      }
    });

    const objectErrors: Record<string, Record<string, string>> = {};
    Object.entries(state.objectOverrides).forEach(([fileId, overridesForObject]) => {
      const errorsForObject: Record<string, string> = {};
      Object.entries(overridesForObject).forEach(([key, value]) => {
        const descriptor = state.parameterDescriptors.find((d) => d.key === key);
        if (descriptor) {
          const error = validateParameter(descriptor, value);
          if (error) errorsForObject[key] = error;
        }
      });
      if (Object.keys(errorsForObject).length > 0) {
        objectErrors[fileId] = errorsForObject;
      }
    });

    set({ validationErrors: errors, objectValidationErrors: objectErrors });
    return Object.keys(errors).length === 0 && Object.keys(objectErrors).length === 0;
  },
});