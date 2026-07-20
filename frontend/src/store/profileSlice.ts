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
  /** The canonical OrcaSlicer profile `name` from the resolved/materialized
   *  printer config JSON.  For system profiles this equals the profile's own
   *  name; for user-saved configs it equals the `inherits` field (the parent
   *  system profile name).  Used for filament/process compatibility matching. */
  printerSystemName: string | null;
  
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
  selectPrinterProfile: (profile: ProfileEntry, preserveAutosave?: boolean) => void;
  selectBedType: (bedType: string) => void;
  selectProcessProfile: (profile: ProfileEntry, preserveAutosave?: boolean) => Promise<void>;
  toggleFilamentProfile: (profile: ProfileEntry) => void;
  loadUserConfig: () => Promise<void>;
  /** Fetch process profiles compatible with the given canonical printer name
   *  in a single backend request, replacing the old per-profile serial loop. */
  fetchCompatibleProcessProfiles: (printerName: string) => Promise<void>;
  saveUserConfig: () => Promise<void>;
  fetchProcessProfileCompatibility: () => Promise<void>;
  fetchUserPrinterConfigs: () => Promise<void>;
  /** Delete the autosave for a config type (called when selection changes). */
  clearConfigAutosave: (type: 'printer' | 'process' | 'filament', index?: number) => Promise<void>;
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
  printerSystemName: null,
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

  fetchCompatibleProcessProfiles: async (printerName: string) => {
    try {
      const params = new URLSearchParams({ compatible_printer: printerName });
      const response = await fetch(`/api/profiles/process?${params}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
        },
      });
      if (!response.ok) throw new Error(`Failed to fetch compatible process profiles: ${response.status}`);
      const profiles: ProfileEntry[] = await response.json();
      set({ processProfiles: profiles });
    } catch (err) {
      console.error('Failed to fetch compatible process profiles:', err);
      throw err;
    }
  },

  fetchProcessProfileCompatibility: async () => {
    // Kept for backward compatibility — no-op since we now use
    // fetchCompatibleProcessProfiles for a single-request approach.
  },

  selectPrinterProfile: async (profile: ProfileEntry, preserveAutosave = false) => {
    // Extract manufacturer from profile path (e.g., "Flashforge/machine/..." -> "Flashforge")
    // For user configs (path starts with "user:"), don't overwrite the manufacturer —
    // it was already set correctly when the user first selected the system profile.
    const isUserConfig = profile.path.startsWith('user:');
    const manufacturer = isUserConfig ? get().selectedManufacturer : profile.path.split('/')[0];
    
    set({ 
      selectedPrinterProfile: profile,
      selectedManufacturer: manufacturer,
      bedSize: null,
      printerVariant: null,
      printerSystemName: null,
    });

    // Only clear the autosave on a manual selection change.
    // When restoring from saved config on page load (preserveAutosave=true),
    // keep the autosave so in-progress edits survive the reload.
    if (!preserveAutosave) {
      get().clearConfigAutosave('printer').catch(() => {});
    }

    const authHeader = { Authorization: `Bearer ${localStorage.getItem('api_token') || ''}` };

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

      // The `name` field in the resolved data is the canonical OrcaSlicer
      // profile name used in compatible_printers lists.
      // For system profiles: resolvedData.name is the profile's own name.
      // For user configs: resolvedData is the merged parent + user overrides,
      // so name comes from the parent (the profile the user config inherits).
      if (resolvedData.name) {
        set({ printerSystemName: String(resolvedData.name) });
      }

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

  selectProcessProfile: async (profile: ProfileEntry, preserveAutosave = false) => {
    set({ selectedProcessProfile: profile });

    // Only clear the process autosave on a manual selection change.
    if (!preserveAutosave) {
      get().clearConfigAutosave('process').catch(() => {});
    }

    // Fetch the process profile's fully resolved configuration and populate
    // the parameter panel defaults. Handles both system profiles and
    // user-saved configs (user: prefix).
    try {
      const authHeader = { Authorization: `Bearer ${localStorage.getItem('api_token') || ''}` };
      let resolvedConfig: Record<string, unknown>;

      if (profile.path.startsWith('user:')) {
        const configName = profile.path.slice('user:'.length);
        const userConfig: Record<string, unknown> = await fetch(
          `/api/process-configs/${encodeURIComponent(configName)}`,
          { headers: authHeader }
        ).then(r => r.json());

        const inherits = userConfig.inherits as string | undefined;
        let base: Record<string, unknown> = {};

        if (inherits) {
          const allProfiles: Array<{ name: string; path: string }> = await fetch(
            '/api/profiles', { headers: authHeader }
          ).then(r => r.json());

          const parent = allProfiles.find(p => p.name === inherits && p.path.includes('/process/'));
          if (parent) {
            const pts = parent.path.split('/');
            const resp = await fetch(
              `/api/profiles/${pts[0]}/${pts[1]}/${encodeURIComponent(pts.slice(2).join('/'))}/resolved`,
              { headers: authHeader }
            );
            if (resp.ok) base = await resp.json();
          }
        }

        resolvedConfig = { ...base, ...userConfig };
      } else {
        const response = await fetch(`/api/profiles/${profile.path}/resolved`, {
          headers: authHeader,
        });
        if (!response.ok) throw new Error(`Failed to fetch resolved process profile: ${response.status}`);
        resolvedConfig = await response.json();
      }

      const { parameterDescriptors, setProfileDefaults } = get();
      const newProfileDefaults: Record<string, string | number | boolean> = {};

      for (const descriptor of parameterDescriptors) {
        const rawValue = resolvedConfig[descriptor.key];
        if (rawValue === undefined) continue;
        const coercedValue = coerceProfileValue(rawValue, descriptor.type);
        if (coercedValue !== undefined) {
          newProfileDefaults[descriptor.key] = coercedValue;
        }
      }

      setProfileDefaults(newProfileDefaults);

      // When restoring on page load, try to reload saved parameter overrides
      // from the autosave so edits in the parameter panel survive refresh.
      if (preserveAutosave) {
        try {
          const autosaved = await apiClient.getAutosave('process_config');
          // Only apply if the autosave belongs to the same profile
          // (_inherits stores the profile path as a sanity check)
          const savedFor = autosaved['_inherits'] as string | undefined;
          if (!savedFor || savedFor === profile.path) {
            const { setOverride } = get();
            for (const [key, value] of Object.entries(autosaved)) {
              if (key.startsWith('_')) continue; // skip internal markers
              if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                setOverride(key, value);
              }
            }
          }
        } catch {
          // No autosave yet — that's fine, start with a clean slate
        }
      }
    } catch (error) {
      console.error('Failed to apply resolved process profile to parameters:', error);
    }
  },

  toggleFilamentProfile: (profile: ProfileEntry) => {
    set((state) => {
      const isSelected = state.selectedFilamentProfiles.some((p) => p.path === profile.path);
      if (isSelected) {
        // Find the index of the removed filament to delete its autosave
        const idx = state.selectedFilamentProfiles.findIndex(p => p.path === profile.path);
        get().clearConfigAutosave('filament', idx).catch(() => {});
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

      // Determine the real manufacturer name to use for fetching system profiles.
      // Saved configs may have a corrupted selected_manufacturer (e.g. "user:...")
      // if a user printer config was selected — derive from the printer path instead.
      let manufacturerName = config.selected_manufacturer;

      const printerPath = config.selected_printer_profile_path;
      if (printerPath && !printerPath.startsWith('user:')) {
        // System printer: manufacturer is the first path segment
        manufacturerName = printerPath.split('/')[0];
      } else if (printerPath && printerPath.startsWith('user:')) {
        // User printer: fetch its JSON to find inherits, extract manufacturer
        // from the parent's path. We do this by fetching all manufacturers and
        // looking up the parent profile.
        if (!manufacturerName || manufacturerName.startsWith('user:')) {
          try {
            const configName = printerPath.slice('user:'.length);
            const authHeader = { Authorization: `Bearer ${localStorage.getItem('api_token') || ''}` };
            const userResp = await fetch(`/api/printer-configs/${encodeURIComponent(configName)}`, { headers: authHeader });
            if (userResp.ok) {
              const userCfg = await userResp.json();
              const inherits = userCfg.inherits as string | undefined;
              if (inherits) {
                // Find the manufacturer by scanning all profiles for the inherits name
                const allResp = await fetch('/api/profiles', { headers: authHeader });
                if (allResp.ok) {
                  const allProfiles: ProfileEntry[] = await allResp.json();
                  const parent = allProfiles.find(p => p.name === inherits && p.category === 'machine');
                  if (parent) manufacturerName = parent.path.split('/')[0];
                }
              }
            }
          } catch { /* keep existing manufacturerName if this fails */ }
        }
      }

      if (!manufacturerName || manufacturerName.startsWith('user:')) {
        // Nothing useful to load
        return;
      }

      stateUpdate.selectedManufacturer = manufacturerName;
      
      // Fetch system profiles for this manufacturer
      try {
        const response = await fetch(`/api/profiles/${manufacturerName}`, {
            headers: {
              Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
            },
          });
          
          if (response.ok) {
            const profiles: ProfileEntry[] = await response.json();
            stateUpdate.printerProfiles = profiles.filter((p) => p.category === 'machine');
            stateUpdate.processProfiles = profiles.filter((p) => p.category === 'process');
            stateUpdate.filamentProfiles = profiles.filter((p) => p.category === 'filament');
            
            // Restore printer profile — handles both system paths and "user:..." paths
            if (config.selected_printer_profile_path) {
              const path = config.selected_printer_profile_path;
              let printerProfile: ProfileEntry | undefined;

              if (path.startsWith('user:')) {
                const name = path.slice('user:'.length);
                printerProfile = { name, path, category: 'machine' };
              } else {
                printerProfile = stateUpdate.printerProfiles?.find(p => p.path === path);
              }

              if (printerProfile) {
                stateUpdate.selectedPrinterProfile = printerProfile;
              }
            }
            
            // Restore process profile — handles both system paths and "user:..." paths
            if (config.selected_process_profile_path) {
              const path = config.selected_process_profile_path;
              let processProfile: ProfileEntry | undefined;

              if (path.startsWith('user:')) {
                const name = path.slice('user:'.length);
                processProfile = { name, path, category: 'process' };
              } else {
                processProfile = stateUpdate.processProfiles?.find(p => p.path === path);
              }

              if (processProfile) {
                stateUpdate.selectedProcessProfile = processProfile;
              }
            }
            
            // Restore filament profiles — handles both system paths and "user:..." paths
            if (config.selected_filament_profile_paths && config.selected_filament_profile_paths.length > 0) {
              const filamentProfiles = config.selected_filament_profile_paths.map(path => {
                if (path.startsWith('user:')) {
                  // User-saved filament: synthesise a ProfileEntry from the name
                  const name = path.slice('user:'.length);
                  return { name, path, category: 'filament' } as ProfileEntry;
                }
                return stateUpdate.filamentProfiles?.find(p => p.path === path);
              }).filter((p): p is ProfileEntry => p !== undefined);

              stateUpdate.selectedFilamentProfiles = filamentProfiles;
            }
          }
        } catch (err) {
          console.error('Failed to fetch profiles while loading config:', err);
        }
      
      // Restore bed type
      if (config.selected_bed_type) {
        stateUpdate.selectedBedType = config.selected_bed_type;
      }
      
      set(stateUpdate);

      // Re-apply the restored printer profile's resolved data (variant, bed size).
      // Pass preserveAutosave=true so page-load restore does NOT clear the autosave.
      if (stateUpdate.selectedPrinterProfile) {
        await get().selectPrinterProfile(stateUpdate.selectedPrinterProfile, true);
      }

      // Re-apply the restored process profile's resolved configuration.
      // Pass preserveAutosave=true for the same reason.
      if (stateUpdate.selectedProcessProfile) {
        await get().selectProcessProfile(stateUpdate.selectedProcessProfile, true);
      }
    } catch (err) {
      console.error('Failed to load user config:', err);
    }
  },

  saveUserConfig: async () => {
    const state = get();
    
    try {
      // For the manufacturer, always derive it from the printer profile path
      // rather than selectedManufacturer, which may be "user:..." for user configs.
      let manufacturer = state.selectedManufacturer;
      const printerPath = state.selectedPrinterProfile?.path;
      if (printerPath && !printerPath.startsWith('user:')) {
        manufacturer = printerPath.split('/')[0];
      }

      const config = {
        selected_manufacturer: manufacturer,
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

  clearConfigAutosave: async (type, index) => {
    const autosaveName =
      type === 'printer' ? 'printer_config' :
      type === 'process' ? 'process_config' :
      `filament_${(index ?? 0) + 1}`;
    try {
      await apiClient.deleteAutosave(autosaveName);
    } catch {
      // Autosave may not exist yet — ignore errors
    }
  },
});
