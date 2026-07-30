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
  /** Absolute filesystem path — identifies both system profiles and
   *  user-saved configs uniformly (see api/client.ts's ProfileEntry doc
   *  comment). No "user:name" string-prefix convention — use `is_user`. */
  path: string;
  category: 'machine' | 'process' | 'filament';
  /** Manufacturer directory name for system profiles; undefined for
   *  user-saved configs. */
  manufacturer?: string;
  /** Path relative to resources/profiles/{manufacturer}/{category}/;
   *  undefined for user-saved configs. */
  filename?: string;
  /** True for a user-saved config, false/undefined for a system profile. */
  is_user?: boolean;
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
  /** Center of the printer's `printable_area` polygon, in gcode-absolute
   * mm coordinates. Some printers' bed_shape is centered at the origin
   * (e.g. "-110x-110,110x-110,110x110,-110x110"), others have their
   * origin at the front-left corner (e.g. "0x0,220x0,220x220,0x220") —
   * this is NOT always (width/2, depth/2), so it must be read from the
   * polygon itself rather than assumed. Used by the Preview tab's 3D
   * viewport to translate gcode coordinates onto the plate grid (which is
   * always drawn centered at the Three.js scene origin). */
  bedCenter: { x: number; y: number } | null;
  
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
  /** Clears the current printer selection (e.g. after the user-saved
   *  config it pointed at was deleted), so the app doesn't keep
   *  referencing a config that no longer exists on disk. */
  clearSelectedPrinterProfile: () => void;
  /** Clears the current process selection for the same reason as
   *  clearSelectedPrinterProfile. Also resets in-memory overrides
   *  (except curr_bed_type) and profileDefaults, matching what
   *  selectProcessProfile does when loading a new profile — there is no
   *  longer a profile backing the current parameter state. */
  clearSelectedProcessProfile: () => void;
  /** Removes one user-saved filament config from the selection (e.g.
   *  after it was deleted) — a thin wrapper over toggleFilamentProfile
   *  for callers that only have the config's path, not the full
   *  ProfileEntry object currently selected. */
  removeSelectedFilamentProfileByPath: (path: string) => void;
  /** Replaces the filament at a specific slot (index into
   *  selectedFilamentProfiles) with a different profile — used after
   *  saving a filament config from FilamentConfigDialog, so the newly
   *  saved config becomes the one loaded in that slot. Unlike
   *  toggleFilamentProfile (which adds/removes by matching path), this
   *  targets a slot by position since the dialog only knows the index
   *  it was opened for, not necessarily the profile that ends up there. */
  replaceSelectedFilamentProfileAt: (index: number, profile: ProfileEntry) => void;
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

/**
 * Maps each of this app's `BED_TYPES` display labels to the exact
 * `curr_bed_type` enum VALUE string native OrcaSlicer's CLI expects (as
 * opposed to the enum's separate, differently-worded display LABEL — see
 * `PrintConfig.cpp`'s `curr_bed_type` definition:
 * enum_values = ["Cool Plate", "Engineering Plate", "High Temp Plate",
 * "Textured PEI Plate", "Textured Cool Plate", "Supertack Plate"], while
 * enum_labels (what this app's own BED_TYPES array's wording is based on)
 * = ["Smooth Cool Plate", "Engineering Plate", "Smooth High Temp Plate",
 * "Textured PEI Plate", "Textured Cool Plate", "Cool Plate (SuperTack)"]).
 * Passing a LABEL string as `--curr_bed_type=` would not match any of the
 * enum's real values, so OrcaSlicer would silently fall back to its
 * compiled-in default (Cool Plate) regardless of what the user picked —
 * this table is what makes selecting "Textured Cool Plate" in the UI
 * actually select `textured_cool_plate_temp` from the filament profile
 * (see `get_bed_temp_key`/`get_bed_temp_1st_layer_key` in
 * `libslic3r/PrintConfig.hpp`) rather than always using the default.
 */
const BED_TYPE_LABEL_TO_ENUM_VALUE: Record<string, string> = {
  'Cool Plate (SuperTack)': 'Supertack Plate',
  'Smooth Cool Plate': 'Cool Plate',
  'Textured Cool Plate': 'Textured Cool Plate',
  'Textured PEI Plate': 'Textured PEI Plate',
  'Engineering Plate': 'Engineering Plate',
  'Smooth High Temp Plate': 'High Temp Plate',
};

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
  bedCenter: null,
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
    // For user configs, don't overwrite the manufacturer — it was
    // already set correctly when the user first selected the system
    // profile the config is based on.
    const isUserConfig = profile.is_user === true;
    const manufacturer = isUserConfig ? get().selectedManufacturer : profile.manufacturer ?? get().selectedManufacturer;
    
    set({ 
      selectedPrinterProfile: profile,
      selectedManufacturer: manufacturer,
      bedSize: null,
      bedCenter: null,
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
        const userResp = await fetch(
          `/api/printer-configs/${encodeURIComponent(profile.name)}`,
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
            if (parentProfile && parentProfile.manufacturer && parentProfile.filename) {
              const parentResp = await fetch(
                `/api/profiles/${parentProfile.manufacturer}/${parentProfile.category}/${encodeURIComponent(parentProfile.filename)}/resolved`,
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
      } else if (profile.manufacturer && profile.filename) {
        // Standard system profile: use the resolved endpoint directly
        const resp = await fetch(
          `/api/profiles/${profile.manufacturer}/${profile.category}/${encodeURIComponent(profile.filename)}/resolved`,
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

      // Extract bed size from printable_area polygon. printable_area
      // points may be number pairs OR "XxY" strings, depending on where
      // the profile came from (materialized JSON vs raw OrcaSlicer config
      // text) — handle both rather than assuming array-of-numbers.
      if (resolvedData.printable_area && Array.isArray(resolvedData.printable_area)) {
        const rawPoints = resolvedData.printable_area as unknown[];
        const points = rawPoints.map((p) => {
          if (Array.isArray(p)) return [Number(p[0]), Number(p[1])];
          if (typeof p === 'string') {
            const [px, py] = p.split('x').map(Number);
            return [px, py];
          }
          return [0, 0];
        });
        const xCoords = points.map((p) => p[0]);
        const yCoords = points.map((p) => p[1]);
        const minX = Math.min(...xCoords);
        const maxX = Math.max(...xCoords);
        const minY = Math.min(...yCoords);
        const maxY = Math.max(...yCoords);
        const width = maxX - minX;
        const depth = maxY - minY;
        if (width > 0 && depth > 0) {
          set({
            bedSize: { width, depth },
            bedCenter: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
          });
        }
      }
    } catch (error) {
      console.error('Failed to extract printer info from profile:', error);
    }
  },

  selectBedType: (bedType: string) => {
    set({ selectedBedType: bedType });

    // Previously this only updated UI/autosave state — `selectedBedType`
    // was never actually sent to the CLI, so the bed temperature always
    // used whichever plate OrcaSlicer's own compiled-in default picks
    // (Cool Plate), completely ignoring what the user selected here (e.g.
    // choosing "Textured Cool Plate" had no effect on bed temp at all).
    // Push the corresponding `curr_bed_type` enum value into
    // parameter_overrides so the CLI invocation actually carries it —
    // OrcaSlicer's own `get_bed_temp_key`/`get_bed_temp_1st_layer_key`
    // (libslic3r/PrintConfig.hpp) then correctly reads e.g.
    // `textured_cool_plate_temp` out of the selected filament profile.
    const enumValue = BED_TYPE_LABEL_TO_ENUM_VALUE[bedType];
    if (enumValue) {
      get().setOverride('curr_bed_type', enumValue);
    }
  },

  selectProcessProfile: async (profile: ProfileEntry, preserveAutosave = false) => {
    set({ selectedProcessProfile: profile });

    // Only clear the process autosave + in-memory overrides on a manual
    // load (whether switching to a different config or reloading the
    // same one) — page-load restore (preserveAutosave=true) must NOT do
    // this, since it needs to keep whatever pending edits were autosaved
    // for this exact profile (see the `preserveAutosave` branch below).
    if (!preserveAutosave) {
      get().clearConfigAutosave('process').catch(() => {});
      // Discard any leftover in-memory overrides from whatever was
      // previously loaded, so they don't get misattributed as edits on
      // top of the config just (re)loaded — its own values (about to be
      // fetched and set as profileDefaults below) become the new, sole
      // baseline. Without this, a value edited against the PREVIOUS
      // profile would linger in `overrides`, and the next autosave write
      // (see ConfigAutoSave.tsx's effect #3) would re-stamp its
      // `_inherits` pointer to the newly loaded profile despite actually
      // carrying stale values from the old one — exactly the "pointer"
      // that must reset to the config now being loaded, not the one it
      // replaced. `curr_bed_type` is preserved since it's driven by the
      // physical bed-plate selector, not by which process profile is
      // loaded.
      get().clearAllOverrides(['curr_bed_type']);
    }

    // Fetch the process profile's fully resolved configuration and populate
    // the parameter panel defaults. Handles both system profiles and
    // user-saved configs (user: prefix).
    try {
      const authHeader = { Authorization: `Bearer ${localStorage.getItem('api_token') || ''}` };
      let resolvedConfig: Record<string, unknown>;

      if (profile.is_user) {
        const userConfig: Record<string, unknown> = await fetch(
          `/api/process-configs/${encodeURIComponent(profile.name)}`,
          { headers: authHeader }
        ).then(r => r.json());

        const inherits = userConfig.inherits as string | undefined;
        let base: Record<string, unknown> = {};

        if (inherits) {
          const allProfiles: ProfileEntry[] = await fetch(
            '/api/profiles', { headers: authHeader }
          ).then(r => r.json());

          const parent = allProfiles.find(p => p.name === inherits && p.category === 'process');
          if (parent && parent.manufacturer && parent.filename) {
            const resp = await fetch(
              `/api/profiles/${parent.manufacturer}/${parent.category}/${encodeURIComponent(parent.filename)}/resolved`,
              { headers: authHeader }
            );
            if (resp.ok) base = await resp.json();
          }
        }

        resolvedConfig = { ...base, ...userConfig };
      } else if (profile.manufacturer && profile.filename) {
        const resp = await fetch(
          `/api/profiles/${profile.manufacturer}/${profile.category}/${encodeURIComponent(profile.filename)}/resolved`,
          { headers: authHeader }
        );
        if (!resp.ok) throw new Error(`Failed to fetch resolved process profile: ${resp.status}`);
        resolvedConfig = await resp.json();
      } else {
        resolvedConfig = {};
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

  clearSelectedPrinterProfile: () => {
    set({
      selectedPrinterProfile: null,
      bedSize: null,
      bedCenter: null,
      printerVariant: null,
      printerSystemName: null,
    });
    get().clearConfigAutosave('printer').catch(() => {});
  },

  clearSelectedProcessProfile: () => {
    set({ selectedProcessProfile: null });
    get().clearConfigAutosave('process').catch(() => {});
    // No profile backs the current parameter state anymore — clear both
    // the resolved-profile baseline and any leftover overrides (except
    // curr_bed_type, which is independent of the process profile), same
    // reasoning as selectProcessProfile's own manual-load reset.
    get().clearProfileDefaults();
    get().clearAllOverrides(['curr_bed_type']);
  },

  removeSelectedFilamentProfileByPath: (path: string) => {
    const profile = get().selectedFilamentProfiles.find((p) => p.path === path);
    if (profile) {
      get().toggleFilamentProfile(profile);
    }
  },

  replaceSelectedFilamentProfileAt: (index: number, profile: ProfileEntry) => {
    set((state) => {
      if (index < 0 || index >= state.selectedFilamentProfiles.length) {
        return {};
      }
      const next = [...state.selectedFilamentProfiles];
      next[index] = profile;
      return { selectedFilamentProfiles: next };
    });
    // The slot now points at a newly saved config with no pending edits
    // of its own — clear its autosave so a stale diff from the config it
    // replaced doesn't linger and get misattributed to the new one (same
    // reasoning as selectProcessProfile's manual-load reset).
    get().clearConfigAutosave('filament', index).catch(() => {});
  },

  loadUserConfig: async () => {
    try {
      const config = await apiClient.getUserConfig();
      
      // Build state update object
      const stateUpdate: Partial<ProfileSlice> = {};

      // Determine the real manufacturer name to use for fetching system
      // profiles. `selected_is_user_printer` (persisted alongside the
      // path — see saveUserConfig) tells us whether the saved printer
      // selection was a user config, in which case selected_manufacturer
      // still holds the real manufacturer name (derived from the
      // config's `inherits` chain when it was originally selected — see
      // selectPrinterProfile), so no extra lookup is needed here at all.
      const manufacturerName = config.selected_manufacturer;

      if (!manufacturerName) {
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
            
            // Restore printer profile — a user-saved config's ProfileEntry
            // is synthesised from just its (name, path); the real content
            // gets fetched by selectPrinterProfile below via profile.is_user.
            if (config.selected_printer_profile_path) {
              const path = config.selected_printer_profile_path;
              let printerProfile: ProfileEntry | undefined;

              if (config.selected_printer_is_user) {
                const name = path.split('/').pop()?.replace(/\.json$/, '') ?? path;
                printerProfile = { name, path, category: 'machine', is_user: true };
              } else {
                printerProfile = stateUpdate.printerProfiles?.find(p => p.path === path);
              }

              if (printerProfile) {
                stateUpdate.selectedPrinterProfile = printerProfile;
              }
            }
            
            // Restore process profile — same pattern as printer above.
            if (config.selected_process_profile_path) {
              const path = config.selected_process_profile_path;
              let processProfile: ProfileEntry | undefined;

              if (config.selected_process_is_user) {
                const name = path.split('/').pop()?.replace(/\.json$/, '') ?? path;
                processProfile = { name, path, category: 'process', is_user: true };
              } else {
                processProfile = stateUpdate.processProfiles?.find(p => p.path === path);
              }

              if (processProfile) {
                stateUpdate.selectedProcessProfile = processProfile;
              }
            }
            
            // Restore filament profiles — same pattern, index-aligned
            // with selected_filament_is_user.
            if (config.selected_filament_profile_paths && config.selected_filament_profile_paths.length > 0) {
              const isUserFlags = config.selected_filament_is_user ?? [];
              const filamentProfiles = config.selected_filament_profile_paths.map((path, idx) => {
                if (isUserFlags[idx]) {
                  const name = path.split('/').pop()?.replace(/\.json$/, '') ?? path;
                  return { name, path, category: 'filament', is_user: true } as ProfileEntry;
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

      // Re-apply the curr_bed_type parameter_overrides entry for the
      // restored bed type — set(stateUpdate) above only restores
      // selectedBedType's UI/display state directly, bypassing
      // selectBedType()'s override-setting logic, so without this a
      // reloaded page would show the correct bed type dropdown selection
      // but silently lose the actual CLI-facing override (falling back to
      // OrcaSlicer's default bed temp on the next slice).
      if (stateUpdate.selectedBedType) {
        const enumValue = BED_TYPE_LABEL_TO_ENUM_VALUE[stateUpdate.selectedBedType];
        if (enumValue) {
          get().setOverride('curr_bed_type', enumValue);
        }
      }

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
      // For the manufacturer, prefer the selected printer's own
      // manufacturer field when it's a system profile; a user-saved
      // printer config has no manufacturer of its own, so keep whatever
      // selectedManufacturer already tracks (set when the user first
      // picked the system profile the config is based on — see
      // selectPrinterProfile).
      const manufacturer = state.selectedPrinterProfile?.manufacturer ?? state.selectedManufacturer;

      // Pull in any pending (unsaved) dialog/parameter-panel edits so the
      // persisted yaml carries the actual in-progress config, not just a
      // pointer to the unmodified base profile. Each autosave may not
      // exist yet (404) — that's the normal "no pending edits" case.
      const [printerAutosave, processAutosave, filamentAutosaves] = await Promise.all([
        apiClient.getAutosave('printer_config').catch(() => null),
        apiClient.getAutosave('process_config').catch(() => null),
        Promise.all(
          state.selectedFilamentProfiles.map((_, idx) =>
            apiClient.getAutosave(`filament_${idx + 1}`).catch(() => null)
          )
        ),
      ]);

      const config = {
        selected_manufacturer: manufacturer,
        selected_printer_profile_path: state.selectedPrinterProfile?.path || null,
        selected_printer_is_user: state.selectedPrinterProfile?.is_user === true,
        selected_bed_type: state.selectedBedType,
        selected_process_profile_path: state.selectedProcessProfile?.path || null,
        selected_process_is_user: state.selectedProcessProfile?.is_user === true,
        selected_filament_profile_paths: state.selectedFilamentProfiles.map(p => p.path),
        selected_filament_is_user: state.selectedFilamentProfiles.map(p => p.is_user === true),
        printer_config_autosave: printerAutosave,
        process_config_autosave: processAutosave,
        filament_config_autosaves: filamentAutosaves,
        // Per-object process overrides already live directly in the store
        // (parameterSlice's objectOverrides), unlike the printer/process/
        // filament dialogs' edits above, so there's no need to round-trip
        // through /api/autosave here — this just mirrors that in-memory
        // state into user_config.yaml as the "pointer to the config
        // files" the user asked for, keyed by file_id. The actual
        // restore-on-load path (see ConfigAutoSave.tsx) reads each
        // object's own process_config_object_{file_id} autosave directly,
        // which is more robust to the plate's contents changing between
        // saves than replaying this yaml snapshot would be.
        object_config_autosaves: state.objectOverrides,
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
