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

export interface ParameterSlice {
  parameterDescriptors: ParameterDescriptor[];
  overrides: Record<string, string | number | boolean>;
  validationErrors: Record<string, string>;
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
  /** Get the effective default for a parameter: the profile-loaded value
   * if present, otherwise the descriptor's global default_value. */
  getEffectiveDefault: (descriptor: ParameterDescriptor) => string | number | boolean;
  setProfileDefaults: (defaults: Record<string, string | number | boolean>) => void;
  clearProfileDefaults: () => void;
  validateAll: () => boolean;
}

export const createParameterSlice: StateCreator<ParameterSlice> = (set, get) => ({
  parameterDescriptors: [],
  overrides: {},
  validationErrors: {},
  profileDefaults: {},

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

  getEffectiveDefault: (descriptor: ParameterDescriptor) => {
    const { profileDefaults } = get();
    const profileValue = profileDefaults[descriptor.key];
    return profileValue !== undefined ? profileValue : descriptor.default_value;
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

    set({ validationErrors: errors });
    return Object.keys(errors).length === 0;
  },
});