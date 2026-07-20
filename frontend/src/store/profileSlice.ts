import { StateCreator } from 'zustand';
import { apiClient, PrinterConfigEntry } from '../api/client';
import { ParameterSlice, ParameterDescriptor } from './parameterSlice';

/**
 * Convert a raw value from a resolved OrcaSlicer profile JSON (which stores
 * every setting as a string, e.g. "0.2", "1", "aligned") into the type
 * expected by a parameter descriptor's control (number, boolean, or string).
 *
 * Returns undefined if the value cannot be meaningfully coerced, so the
 * caller can skip applying it (falling back to the descriptor's default).
 */
function coerceProfileValue(
  rawValue: unknown,
  type: ParameterDescriptor['type']
): string | number | boolean | undefined {
  // Profile values are sometimes arrays (e.g. per-extruder settings like
  // ["0.4"]); use the first element in that case.
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;

  if (value === undefined || value === null) {
    return undefined;
  }

  switch (type) {
    case 'bool': {
      if (typeof value === 'boolean') return value;
      const str = String(value).trim().toLowerCase();
      if (str === '1' || str === 'true') return true;
      if (str === '0' || str === 'false') return false;
      return undefined;
    }
    case 'int': {
      const parsed = parseInt(String(value), 10);
      return isNaN(parsed) ? undefined : parsed;
    }
    case 'float': {
      // Percent-style values (e.g. "15%") are kept as strings since the
      // numeric input control expects a plain number; skip them rather
      // than truncating meaning.
      const str = String(value).trim();
      if (str.endsWith('%')) {
        const parsed = parseFloat(str);
        return isNaN(parsed) ? undefined : parsed;
      }
      const parsed = parseFloat(str);
      return isNaN(parsed) ? undefined : parsed;
    }
    case 'enum':
    case 'string':
    default:
      return String(value);
  }
}

export interface ProfileEntry {
  name: string;
  path: string; // relative to resources/profiles/
  category: 'machine' | 'process' | 'filament';
}

export interface ProfileSlice {
  manufacturers: string[];
  selectedManufacturer: string | null;
  printerProfiles: ProfileEntry[];
  processProfiles: ProfileEntry[];
  filamentProfiles: ProfileEntry[];
  
  // Printer selection (select full profile directly, including nozzle size)
  selectedPrinterProfile: ProfileEntry | null;
  printerVariant: string | null; // nozzle size from printer_variant field
  
  // Bed type selection (independent from printer profile)
  availableBedTypes: string[];
  selectedBedType: string | null;
  
  selectedProcessProfile: ProfileEntry | null;
  selectedFilamentProfiles: ProfileEntry[];
  bedSize: { width: number; depth: number } | null; // derived from printer profile
  
  // Cache for process profile compatibility
  processProfileCompatibility: Map<string, string[]>;

  // User-saved printer configs (from /api/printer-configs), shown in picker
  userPrinterConfigs: PrinterConfigEntry[];
  
  fetchManufacturers: () => Promise<void>;
  fetchProfiles: (manufacturer: string) => Promise<void>;
  fetchAllProfiles: () => Promise<void>;
  selectPrinterProfile: (profile: ProfileEntry) => void;
  selectBedType: (bedType: string) => void;
  selectProcessProfile: (profile: ProfileEntry) => Promise<void>;
  toggleFilamentProfile: (profile: ProfileEntry) => void;
  loadUserConfig: () => Promise<void>;
  saveUserConfig: () => Promise<void>;
  fetchProcessProfileCompatibility: () => Promise<void>;
  fetchUserPrinterConfigs: () => Promise<void>;
}

// Available bed types (standardized across all printers)
// These are the physical bed plates that can be used
const BED_TYPES = [
  'Cool Plate (SuperTack)',
  'Smooth Cool Plate',
  'Textured Cool Plate',
  'Textured PEI Plate',
  'Engineering Plate',
  'Smooth High Temp Plate',
] as const;

export const createProfileSlice: StateCreator<
  ProfileSlice & ParameterSlice,
  [],
  [],
  ProfileSlice
> = (set, get) => ({
  manufacturers: [],
  selectedManufacturer: null,
  printerProfiles: [],
  processProfiles: [],
  filamentProfiles: [],
  
  selectedPrinterProfile: null,
  printerVariant: null,
  availableBedTypes: [...BED_TYPES],
  selectedBedType: null,
  
  selectedProcessProfile: null,
  selectedFilamentProfiles: [],
  bedSize: null,
  processProfileCompatibility: new Map(),
  userPrinterConfigs: [],

  fetchManufacturers: async () => {
    try {
      const response = await fetch('/api/profiles/manufacturers', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch manufacturers: ${response.status}`);
      }

      const manufacturers: string[] = await response.json();
      set({ manufacturers });
    } catch (error) {
      console.error('Failed to fetch manufacturers:', error);
      throw error;
    }
  },

  fetchAllProfiles: async () => {
    try {
      const response = await fetch('/api/profiles', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch all profiles: ${response.status}`);
      }

      const profiles: ProfileEntry[] = await response.json();

      const printerProfiles = profiles.filter((p) => p.category === 'machine');
      const processProfiles = profiles.filter((p) => p.category === 'process');
      const filamentProfiles = profiles.filter((p) => p.category === 'filament');

      set({
        printerProfiles,
        processProfiles,
        filamentProfiles,
      });
    } catch (error) {
      console.error('Failed to fetch all profiles:', error);
      throw error;
    }
  },

  fetchProfiles: async (manufacturer: string) => {
    try {
      const response = await fetch(`/api/profiles/${manufacturer}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch profiles for ${manufacturer}: ${response.status}`);
      }

      const profiles: ProfileEntry[] = await response.json();

      const newPrinterProfiles = profiles.filter((p) => p.category === 'machine');
      const newProcessProfiles = profiles.filter((p) => p.category === 'process');
      const newFilamentProfiles = profiles.filter((p) => p.category === 'filament');

      // Get current state to accumulate profiles
      const currentState = get();
      
      // Accumulate profiles (avoid duplicates by path)
      const existingPrinterPaths = new Set(currentState.printerProfiles.map(p => p.path));
      const existingProcessPaths = new Set(currentState.processProfiles.map(p => p.path));
      const existingFilamentPaths = new Set(currentState.filamentProfiles.map(p => p.path));
      
      const mergedPrinterProfiles = [
        ...currentState.printerProfiles,
        ...newPrinterProfiles.filter(p => !existingPrinterPaths.has(p.path))
      ];
      
      const mergedProcessProfiles = [
        ...currentState.processProfiles,
        ...newProcessProfiles.filter(p => !existingProcessPaths.has(p.path))
      ];
      
      const mergedFilamentProfiles = [
        ...currentState.filamentProfiles,
        ...newFilamentProfiles.filter(p => !existingFilamentPaths.has(p.path))
      ];

      set({
        selectedManufacturer: manufacturer,
        printerProfiles: mergedPrinterProfiles,
        processProfiles: mergedProcessProfiles,
        filamentProfiles: mergedFilamentProfiles,
      });
    } catch (error) {
      console.error('Failed to fetch profiles:', error);
      throw error;
    }
  },

  fetchProcessProfileCompatibility: async () => {
    const { processProfiles } = get();
    const compatibility = new Map<string, string[]>();
    
    // Fetch compatible_printers for each process profile
    for (const profile of processProfiles) {
      try {
        const response = await fetch(`/api/profiles/${profile.path}`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
          },
        });
        
        if (response.ok) {
          const profileData = await response.json();
          if (profileData.compatible_printers && Array.isArray(profileData.compatible_printers)) {
            compatibility.set(profile.path, profileData.compatible_printers);
          }
        }
      } catch (err) {
        console.error(`Failed to fetch compatibility for ${profile.path}:`, err);
      }
    }
    
    set({ processProfileCompatibility: compatibility });
  },

  selectPrinterProfile: async (profile: ProfileEntry) => {
    // Extract manufacturer from profile path (e.g., "Flashforge/machine/..." -> "Flashforge")
    const manufacturer = profile.path.split('/')[0];
    
    set({ 
      selectedPrinterProfile: profile,
      selectedManufacturer: manufacturer,
      bedSize: null,
      printerVariant: null,
    });

    const authHeader = { Authorization: `Bearer ${localStorage.getItem('api_token') || ''}` };

    // Handle user-saved configs (path starts with "user:")
    const isUserConfig = profile.path.startsWith('user:');

    try {
      let resolvedData: Record<string, unknown> | null = null;

      if (isUserConfig) {
        // User config: load the saved JSON to find its `inherits` field,
        // then resolve that parent profile to get printer_variant and bed size.
        const configName = profile.path.slice('user:'.length);
        const userResp = await fetch(
          `/api/printer-configs/${encodeURIComponent(configName)}`,
          { headers: authHeader }
        );
        if (userResp.ok) {
          const userConfig: Record<string, unknown> = await userResp.json();
          // printer_variant may be stored directly in the user config
          if (userConfig.printer_variant) {
            set({ printerVariant: String(userConfig.printer_variant) });
          }
          // If inherits is set, resolve the parent to get remaining fields
          const inheritsName = userConfig.inherits as string | undefined;
          if (inheritsName && !userConfig.printer_variant) {
            // Find the parent profile path by searching loaded profiles
            const { printerProfiles } = get();
            const parentProfile = printerProfiles.find(p => p.name === inheritsName);
            if (parentProfile) {
              const parentResp = await fetch(
                `/api/profiles/${parentProfile.path}/resolved`,
                { headers: authHeader }
              );
              if (parentResp.ok) resolvedData = await parentResp.json();
            }
          }
          // Merge: user config overrides parent resolved data
          if (resolvedData) {
            resolvedData = { ...resolvedData, ...userConfig };
          } else {
            resolvedData = userConfig;
          }
        }
      } else {
        // Standard system profile: use the resolved endpoint directly
        const resp = await fetch(
          `/api/profiles/${profile.path}/resolved`,
          { headers: authHeader }
        );
        if (resp.ok) resolvedData = await resp.json();
      }

      if (!resolvedData) return;

      // Extract printer_variant (nozzle size) from the resolved profile
      if (resolvedData.printer_variant) {
        set({ printerVariant: String(resolvedData.printer_variant) });
      }

      // Extract bed size from printable_area polygon
      if (resolvedData.printable_area && Array.isArray(resolvedData.printable_area)) {
        const points = resolvedData.printable_area as number[][];
        const xCoords = points.map((p) => (Array.isArray(p) ? p[0] : 0));
        const yCoords = points.map((p) => (Array.isArray(p) ? p[1] : 0));
        const width = Math.max(...xCoords) - Math.min(...xCoords);
        const depth = Math.max(...yCoords) - Math.min(...yCoords);
        if (width > 0 && depth > 0) set({ bedSize: { width, depth } });
      }
    } catch (error) {
      console.error('Failed to extract printer info from profile:', error);
    }
  },

  selectBedType: (bedType: string) => {
    set({ selectedBedType: bedType });
  },

  selectProcessProfile: async (profile: ProfileEntry) => {
    set({ selectedProcessProfile: profile });

    // Fetch the process profile's fully resolved configuration (its
    // `inherits` chain merged in, matching what the native OrcaSlicer
    // desktop app applies) and populate the parameter panel's overrides
    // with it, so displayed values reflect the selected profile instead of
    // the PrintConfig.cpp defaults.
    try {
      const response = await fetch(`/api/profiles/${profile.path}/resolved`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch resolved process profile: ${response.status}`);
      }

      const resolvedConfig: Record<string, unknown> = await response.json();
      const { parameterDescriptors, setProfileDefaults } = get();

      // Values loaded from the process profile become the field's
      // "default" (shown when the user hasn't overridden it, and what
      // Reset restores to) rather than a user override. This keeps the
      // purple "overridden" styling and Reset button reserved for values
      // the user has actually changed themselves.
      const newProfileDefaults: Record<string, string | number | boolean> = {};

      for (const descriptor of parameterDescriptors) {
        const rawValue = resolvedConfig[descriptor.key];
        if (rawValue === undefined) {
          continue;
        }

        const coercedValue = coerceProfileValue(rawValue, descriptor.type);
        if (coercedValue !== undefined) {
          newProfileDefaults[descriptor.key] = coercedValue;
        }
      }

      // Replace wholesale (rather than merge) so keys from a previously
      // selected profile that the new profile doesn't define fall back to
      // the global PrintConfig.cpp default instead of lingering.
      setProfileDefaults(newProfileDefaults);
    } catch (error) {
      console.error('Failed to apply resolved process profile to parameters:', error);
    }
  },

  toggleFilamentProfile: (profile: ProfileEntry) => {
    set((state) => {
      const isSelected = state.selectedFilamentProfiles.some((p) => p.path === profile.path);

      if (isSelected) {
        return {
          selectedFilamentProfiles: state.selectedFilamentProfiles.filter(
            (p) => p.path !== profile.path
          ),
        };
      } else {
        return {
          selectedFilamentProfiles: [...state.selectedFilamentProfiles, profile],
        };
      }
    });
  },

  loadUserConfig: async () => {
    try {
      const config = await apiClient.getUserConfig();
      
      // Build state update object
      const stateUpdate: Partial<ProfileSlice> = {};
      
      // Restore manufacturer selection
      if (config.selected_manufacturer) {
        stateUpdate.selectedManufacturer = config.selected_manufacturer;
        
        // Fetch profiles for this manufacturer
        try {
          const response = await fetch(`/api/profiles/${config.selected_manufacturer}`, {
            headers: {
              Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
            },
          });
          
          if (response.ok) {
            const profiles: ProfileEntry[] = await response.json();
            stateUpdate.printerProfiles = profiles.filter((p) => p.category === 'machine');
            stateUpdate.processProfiles = profiles.filter((p) => p.category === 'process');
            stateUpdate.filamentProfiles = profiles.filter((p) => p.category === 'filament');
            
            // Restore printer profile
            if (config.selected_printer_profile_path) {
              const printerProfile = stateUpdate.printerProfiles?.find(
                p => p.path === config.selected_printer_profile_path
              );
              if (printerProfile) {
                stateUpdate.selectedPrinterProfile = printerProfile;
              }
            }
            
            // Restore process profile
            if (config.selected_process_profile_path) {
              const processProfile = stateUpdate.processProfiles?.find(
                p => p.path === config.selected_process_profile_path
              );
              if (processProfile) {
                stateUpdate.selectedProcessProfile = processProfile;
              }
            }
            
            // Restore filament profiles
            if (config.selected_filament_profile_paths && config.selected_filament_profile_paths.length > 0) {
              const filamentProfiles = config.selected_filament_profile_paths
                .map(path => stateUpdate.filamentProfiles?.find(p => p.path === path))
                .filter((p): p is ProfileEntry => p !== undefined);
              stateUpdate.selectedFilamentProfiles = filamentProfiles;
            }
          }
        } catch (err) {
          console.error('Failed to fetch profiles while loading config:', err);
        }
      }
      
      // Restore bed type
      if (config.selected_bed_type) {
        stateUpdate.selectedBedType = config.selected_bed_type;
      }
      
      set(stateUpdate);

      // Re-apply the restored process profile's resolved configuration to
      // the parameter overrides, since `set()` above only restores the
      // profile reference, not its effective parameter values.
      if (stateUpdate.selectedProcessProfile) {
        await get().selectProcessProfile(stateUpdate.selectedProcessProfile);
      }
    } catch (err) {
      console.error('Failed to load user config:', err);
    }
  },

  saveUserConfig: async () => {
    const state = get();
    
    try {
      const config = {
        selected_manufacturer: state.selectedManufacturer,
        selected_printer_profile_path: state.selectedPrinterProfile?.path || null,
        selected_bed_type: state.selectedBedType,
        selected_process_profile_path: state.selectedProcessProfile?.path || null,
        selected_filament_profile_paths: state.selectedFilamentProfiles.map(p => p.path),
      };
      
      await apiClient.saveUserConfig(config);
    } catch (err) {
      console.error('Failed to save user config:', err);
    }
  },

  fetchUserPrinterConfigs: async () => {
    try {
      const configs = await apiClient.listPrinterConfigs();
      set({ userPrinterConfigs: configs });
    } catch (err) {
      console.error('Failed to fetch user printer configs:', err);
    }
  },
});
