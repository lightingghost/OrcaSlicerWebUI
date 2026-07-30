import { StateCreator } from 'zustand';
import { validateParameter } from '../lib/validation';

/**
 * Compares an override value against the current effective default,
 * treating equivalent representations of the same value as equal (e.g.
 * boolean `true` vs the string "1"/"true" a profile JSON might store it
 * as — see profileSlice.ts's coerceProfileValue for the same
 * string<->typed coercion applied when loading profileDefaults). Used by
 * getEffectiveValueForTarget to decide whether a field is genuinely
 * "changed" (shows the Reset button) rather than merely "present in the
 * overrides map", which would keep showing a value as overridden even
 * after that exact value has been saved into the profile itself.
 */
function valuesEqual(
  a: string | number | boolean,
  b: string | number | boolean
): boolean {
  if (a === b) return true;
  // Normalize booleans and their common string/numeric equivalents so
  // e.g. override `true` compares equal to a profile default of "1".
  const normalizeBool = (v: string | number | boolean): boolean | undefined => {
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    if (s === '1' || s === 'true') return true;
    if (s === '0' || s === 'false') return false;
    return undefined;
  };
  const boolA = normalizeBool(a);
  const boolB = normalizeBool(b);
  if (boolA !== undefined && boolB !== undefined) return boolA === boolB;
  // Fall back to string comparison so e.g. numeric 0.2 vs string "0.2" match.
  return String(a) === String(b);
}

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
  /**
   * Discards every GLOBAL override except the ones listed in
   * `preserveKeys`. Called when a different process config is loaded
   * (see profileSlice.ts's selectProcessProfile) so overrides left over
   * from editing the PREVIOUS profile don't carry forward and get
   * misattributed as edits against the newly loaded one — the loaded
   * config's own values (profileDefaults) become the sole baseline going
   * forward. `preserveKeys` exists for state that's orthogonal to which
   * process profile is loaded (e.g. `curr_bed_type`, driven by the
   * physical bed-plate selector, not by the process profile).
   */
  clearAllOverrides: (preserveKeys?: string[]) => void;
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

  clearAllOverrides: (preserveKeys: string[] = []) => {
    set((state) => {
      const preserve = new Set(preserveKeys);
      const newOverrides: Record<string, string | number | boolean> = {};
      for (const key of preserve) {
        if (key in state.overrides) newOverrides[key] = state.overrides[key];
      }
      const newValidationErrors: Record<string, string> = {};
      for (const key of preserve) {
        if (key in state.validationErrors) newValidationErrors[key] = state.validationErrors[key];
      }
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
    const effectiveDefault = state.getEffectiveDefault(descriptor);

    if (target === 'global') {
      const globalOverride = state.overrides[key];
      if (globalOverride !== undefined) {
        // "Changed" must reflect a real difference from the CURRENT
        // baseline (profileDefaults, which is rebuilt every time a
        // profile is (re)selected — see profileSlice.ts's
        // selectProcessProfile), not merely "this key exists in
        // overrides". Without this comparison, saving an edited value
        // into the profile itself (so profileDefaults now equals the
        // override) still left the field showing as overridden/
        // reset-able after reselecting the just-saved profile, since
        // nothing ever removes the now-redundant entry from `overrides`.
        return {
          value: globalOverride,
          isOverriddenAtTarget: !valuesEqual(globalOverride, effectiveDefault),
        };
      }
      return { value: effectiveDefault, isOverriddenAtTarget: false };
    }

    // A specific object: its own override wins; otherwise fall through
    // to Global's override (so a Global edit affects every object that
    // hasn't diverged — requirement #3), then the profile/descriptor
    // default. `isOverriddenAtTarget` only reflects THIS object's own
    // override (not an inherited Global one) AND only when it actually
    // differs from the current effective default — same reasoning as
    // the 'global' branch above.
    const objectOverride = state.objectOverrides[target]?.[key];
    if (objectOverride !== undefined) {
      return {
        value: objectOverride,
        isOverriddenAtTarget: !valuesEqual(objectOverride, effectiveDefault),
      };
    }
    const globalOverride = state.overrides[key];
    if (globalOverride !== undefined) {
      return { value: globalOverride, isOverriddenAtTarget: false };
    }
    return { value: effectiveDefault, isOverriddenAtTarget: false };
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