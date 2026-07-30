/**
 * ProcessSelector Component
 *
 * Fetches compatible process profiles from the backend in a single request
 * (GET /api/profiles/process?compatible_printer=<name>) instead of
 * fetching every profile and filtering client-side.
 *
 * Uses a custom picker modal (rather than a native <select>) so each
 * user-saved config can carry its own inline delete button while
 * browsing — a native <select>'s dropdown is rendered by the OS/browser
 * and can't host arbitrary HTML controls, which is why an earlier
 * version of this component (a native select) could only ever show a
 * delete button for whichever config was ALREADY selected, never while
 * just browsing the list. Mirrors PrinterSelector's/FilamentRow's own
 * picker-modal pattern for the same reason.
 *
 * Includes a save button to persist the current process config as a user config.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Save, Trash2, ChevronDown } from 'lucide-react';
import { useStore } from '../../store';
import { apiClient, PrinterConfigEntry } from '../../api/client';
import type { ProfileEntry } from '../../store';
import { ProcessObjectsList } from './ProcessObjectsList';

// ---------------------------------------------------------------------------
// Save As dialog
// ---------------------------------------------------------------------------

const SaveAsDialog: React.FC<{
  isOpen: boolean;
  defaultName: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}> = ({ isOpen, defaultName, onConfirm, onCancel }) => {
  const [name, setName] = useState(defaultName);
  useEffect(() => { if (isOpen) setName(defaultName); }, [isOpen, defaultName]);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[10000]"
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="bg-gray-800 rounded-lg shadow-2xl p-6 w-[440px] max-w-[95vw]">
        <h2 className="text-white font-semibold text-base mb-4">Save process config</h2>
        <label className="block text-sm text-gray-300 mb-1">Config name</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onConfirm(name.trim()); }}
          autoFocus
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white
            focus:outline-none focus:ring-1 focus:ring-teal-500 mb-5" />
        <div className="flex justify-end gap-3">
          <button onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors">
            Cancel
          </button>
          <button onClick={() => name.trim() && onConfirm(name.trim())} disabled={!name.trim()}
            className="px-4 py-2 text-sm text-white bg-teal-600 hover:bg-teal-500 disabled:opacity-50
              rounded transition-colors flex items-center gap-1.5">
            <Save className="w-4 h-4" /> Save
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Process Picker Modal
// ---------------------------------------------------------------------------

interface ProcessPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  systemProfiles: ProfileEntry[];
  userConfigs: PrinterConfigEntry[];
  selectedPath: string | null;
  isLoading: boolean;
  onSelect: (profile: { name: string; path: string; category: 'process'; is_user?: boolean }) => void;
  onDeleteUserConfig: (cfg: { name: string; path: string }) => void;
}

const ProcessPickerModal: React.FC<ProcessPickerModalProps> = ({
  isOpen,
  onClose,
  systemProfiles,
  userConfigs,
  selectedPath,
  isLoading,
  onSelect,
  onDeleteUserConfig,
}) => {
  if (!isOpen) return null;

  const noProfiles = systemProfiles.length === 0 && userConfigs.length === 0;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-lg p-6 w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold text-white mb-4">Select Process Profile</h2>

        <div className="flex-1 overflow-y-auto space-y-2 mb-4">
          {isLoading ? (
            <p className="text-gray-400 text-sm py-4 text-center">Loading compatible profiles…</p>
          ) : noProfiles ? (
            <p className="text-gray-400 text-sm py-4 text-center">No compatible process profiles</p>
          ) : (
            systemProfiles.map((profile) => {
              const isSelected = selectedPath === profile.path;
              return (
                <button
                  key={profile.path}
                  onClick={() => { onSelect({ name: profile.name, path: profile.path, category: 'process' }); onClose(); }}
                  className={`w-full p-3 rounded text-left transition-colors ${
                    isSelected ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate">{profile.name}</span>
                    {isSelected && (
                      <span className="text-xs bg-purple-800 px-2 py-1 rounded ml-2 flex-shrink-0">
                        ✓ Selected
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* User-saved process configs — each row has its own delete
            button, visible while just browsing the list (not only once
            selected) since this is a custom-rendered list, unlike a
            native <select>'s dropdown. */}
        {userConfigs.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                My saved configs
              </span>
              <div className="flex-1 h-px bg-gray-700" />
            </div>
            <div className="space-y-2">
              {userConfigs.map((cfg) => {
                const isSelected = selectedPath === cfg.path;
                return (
                  <div
                    key={cfg.path}
                    className={`w-full flex items-center gap-2 p-3 rounded transition-colors ${
                      isSelected
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-700/80 text-gray-200 hover:bg-gray-600 border border-dashed border-gray-600'
                    }`}
                  >
                    <button
                      onClick={() => {
                        onSelect({ name: cfg.name, path: cfg.path, category: 'process', is_user: true });
                        onClose();
                      }}
                      className="flex-1 min-w-0 flex items-center justify-between text-left"
                    >
                      <span className="text-sm font-medium truncate">{cfg.name}</span>
                      <span className="text-xs bg-teal-700 text-teal-100 px-2 py-0.5 rounded ml-2 flex-shrink-0">
                        user
                      </span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteUserConfig(cfg);
                      }}
                      title={`Delete "${cfg.name}"`}
                      aria-label={`Delete ${cfg.name}`}
                      className="flex-shrink-0 p-1 rounded text-gray-400 hover:text-red-400 hover:bg-gray-800/60 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ProcessSelector
// ---------------------------------------------------------------------------

export const ProcessSelector: React.FC = () => {
  const {
    processProfiles,
    selectedProcessProfile,
    selectedManufacturer,
    selectedPrinterProfile,
    printerSystemName,
    selectProcessProfile,
    clearSelectedProcessProfile,
    fetchCompatibleProcessProfiles,
    overrides,
    processTarget,
    setProcessTarget,
  } = useStore();

  // Canonical printer name used for compatibility matching — same value
  // fetchCompatibleProcessProfiles below is keyed on.
  const nameForMatch = printerSystemName ?? selectedPrinterProfile?.name ?? null;

  // Global/Objects toggle (matches native OrcaSlicer's Process panel):
  // "Global" shows/edits the plate-wide overrides map (this component's
  // existing profile picker + ParameterTabs below read `overrides`
  // directly); "Objects" replaces the picker with a per-object list
  // (ProcessObjectsList) and ParameterTabs switches to editing whichever
  // object is selected there. Derived from parameterSlice's
  // `processTarget` rather than owning separate local state, so
  // selecting an object elsewhere (e.g. clicking it in the viewport
  // could set processTarget in the future) keeps this toggle in sync.
  const isObjectsMode = processTarget !== 'global';
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Track which printer name we last loaded profiles for to avoid redundant fetches
  const loadedForPrinter = useRef<string | null>(null);

  // User-saved process configs
  const [userProcessConfigs, setUserProcessConfigs] = useState<PrinterConfigEntry[]>([]);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const refreshUserConfigs = useCallback(async () => {
    try {
      const saved = await apiClient.listProcessConfigs();
      setUserProcessConfigs(saved.filter(c => !c.autosave));
    } catch (err) {
      console.error('Failed to fetch user process configs:', err);
    }
  }, []);

  useEffect(() => { refreshUserConfigs(); }, [refreshUserConfigs]);

  // A saved config carries no `compatible_printers` of its own — only
  // the SYSTEM profile it `inherits` from does. `processProfiles` (once
  // fetchCompatibleProcessProfiles below has run) is already the list of
  // system profiles compatible with the selected printer, so a saved
  // config is compatible iff its own `inherits` name matches one of
  // THEIR names. Configs with no printer selected, or with an
  // unrecognized/missing `inherits`, are excluded — a saved config with
  // no known parent has no way to establish compatibility, so showing it
  // unconditionally would defeat the point of filtering at all.
  const compatibleUserProcessConfigs = useMemo(() => {
    if (!nameForMatch) return [];
    const compatibleSystemNames = new Set(processProfiles.map(p => p.name));
    return userProcessConfigs.filter(cfg => cfg.inherits && compatibleSystemNames.has(cfg.inherits));
  }, [userProcessConfigs, processProfiles, nameForMatch]);

  // When the canonical printer name changes, fetch compatible profiles immediately.
  // This replaces the old lazy-on-focus + serial-per-profile approach.
  useEffect(() => {
    const nameForMatch = printerSystemName ?? selectedPrinterProfile?.name ?? null;
    if (!nameForMatch) return;
    if (loadedForPrinter.current === nameForMatch) return;

    loadedForPrinter.current = nameForMatch;
    setIsLoading(true);
    fetchCompatibleProcessProfiles(nameForMatch)
      .catch(err => console.error('Failed to load compatible process profiles:', err))
      .finally(() => setIsLoading(false));
  }, [printerSystemName, selectedPrinterProfile, fetchCompatibleProcessProfiles]);

  // Note: auto-save on process profile change is handled centrally by
  // ConfigAutoSave.tsx (debounced), avoiding duplicate saveUserConfig() calls.

  const handleSelectProfile = (profile: { name: string; path: string; category: 'process'; is_user?: boolean }) => {
    selectProcessProfile(profile as ProfileEntry);
  };

  const handleDeleteUserConfig = async (cfg: { name: string; path: string }) => {
    if (!window.confirm(`Delete saved process config "${cfg.name}"? This cannot be undone.`)) {
      return;
    }
    try {
      await apiClient.deleteProcessConfig(cfg.name);
      await refreshUserConfigs();
      // If the deleted config was the one currently selected, clear the
      // selection so the app doesn't keep referencing a config that no
      // longer exists on disk.
      if (selectedProcessProfile?.path === cfg.path) {
        clearSelectedProcessProfile();
      }
    } catch (err) {
      console.error('Failed to delete process config:', err);
    }
  };

  const buildSavePayload = useCallback((): Record<string, unknown> => {
    const payload: Record<string, unknown> = {};
    if (selectedProcessProfile && !selectedProcessProfile.is_user) {
      payload['inherits'] = selectedProcessProfile.name;
    }
    for (const [key, value] of Object.entries(overrides)) {
      payload[key] = value;
    }
    return payload;
  }, [selectedProcessProfile, overrides]);

  const saveUserConfig = useStore((state) => state.saveUserConfig);

  const handleSaveConfirm = async (name: string) => {
    setSaveAsOpen(false);
    setSaveStatus('saving');
    try {
      const saved = await apiClient.saveProcessConfig(name, buildSavePayload(), false);
      await refreshUserConfigs();
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);

      // Automatically load the newly saved config — mirrors
      // PrinterConfigDialog/FilamentConfigDialog's own auto-select-after-
      // save behavior. Uses preserveAutosave=false (the default) since
      // this is a fresh manual load, same as picking it from the modal.
      await selectProcessProfile({ name: saved.name, path: saved.path, category: saved.category, is_user: true });
      await saveUserConfig();
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const saveDefaultName = selectedProcessProfile
    ? `${selectedProcessProfile.name} - copy`
    : 'My process config';

  const noProfiles = processProfiles.length === 0 && compatibleUserProcessConfigs.length === 0;
  const isDisabled = !selectedManufacturer || isLoading;

  const handleSwitchToObjectsMode = () => {
    if (isObjectsMode) return;
    // Default to the first plate object so switching to "Objects"
    // immediately shows a real object's settings (and highlights it in
    // the viewport) rather than an empty list with no active row —
    // matches native, which auto-selects the first object on mode switch.
    // Falls back to staying on 'global' (ProcessObjectsList still renders,
    // just with no row selected) if the plate is empty.
    const firstFileId = useStore.getState().uploadedFiles[0]?.file_id;
    if (firstFileId) {
      setProcessTarget(firstFileId);
      useStore.getState().setSelectedObjectId(firstFileId);
    } else {
      setProcessTarget('objects-mode-no-selection');
    }
  };

  return (
    <div className="space-y-3">
      {/* Global/Objects toggle — matches native OrcaSlicer's Process
          panel pill switch. "Global" shows the profile picker below
          (plate-wide settings); "Objects" replaces it with a per-object
          list (ProcessObjectsList) so each object's own overrides can be
          edited — see parameterSlice.ts's processTarget doc comment. */}
      <div className="flex items-center justify-center">
        <div className="inline-flex bg-gray-900 border border-gray-700 rounded-full p-0.5" role="tablist" aria-label="Process target">
          <button
            type="button"
            role="tab"
            aria-selected={!isObjectsMode}
            onClick={() => setProcessTarget('global')}
            className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
              !isObjectsMode ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Global
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isObjectsMode}
            onClick={handleSwitchToObjectsMode}
            className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
              isObjectsMode ? 'bg-teal-600 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Objects
          </button>
        </div>
      </div>

      {!isObjectsMode ? (
        <div className="min-w-0">
          {/* Visible "Process Profile" label and the "Select a printer to
              filter compatible profiles" hint were removed to save vertical
              space in the left panel (native OrcaSlicer's own Process
              section has no such label either — just the picker itself
              under the "Process" section heading). The button keeps an
              aria-label so it's still identified for accessibility/tests. */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              aria-label="Process Profile"
              onClick={() => { if (!isDisabled) setIsModalOpen(true); }}
              disabled={isDisabled}
              className="min-w-0 flex-1 w-0 flex items-center justify-between px-2 py-1.5 text-sm bg-gray-700
                border border-gray-600 rounded text-white hover:bg-gray-600 transition-colors
                focus:outline-none focus:ring-2 focus:ring-purple-500
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="truncate">
                {isLoading
                  ? 'Loading compatible profiles…'
                  : selectedProcessProfile
                    ? selectedProcessProfile.name
                    : noProfiles
                      ? (selectedPrinterProfile ? 'No compatible process profiles' : 'No process profiles available')
                      : 'Select process profile'}
              </span>
              <ChevronDown className="w-4 h-4 flex-shrink-0" />
            </button>

            <button
              onClick={() => setSaveAsOpen(true)}
              disabled={!selectedProcessProfile || saveStatus === 'saving'}
              title={selectedProcessProfile ? 'Save process config' : 'Select a profile first'}
              className="flex items-center gap-1 px-2 py-1.5 rounded text-sm bg-gray-700 border
                border-gray-600 text-gray-400 hover:text-white hover:bg-gray-600
                disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              <Save className="w-3.5 h-3.5" />
              {saveStatus === 'saving' ? '…' : saveStatus === 'saved' ? '✓' : saveStatus === 'error' ? '!' : ''}
            </button>
          </div>
        </div>
      ) : (
        <ProcessObjectsList />
      )}

      <ProcessPickerModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        systemProfiles={processProfiles}
        userConfigs={compatibleUserProcessConfigs}
        selectedPath={selectedProcessProfile?.path ?? null}
        isLoading={isLoading}
        onSelect={handleSelectProfile}
        onDeleteUserConfig={handleDeleteUserConfig}
      />

      <SaveAsDialog isOpen={saveAsOpen} defaultName={saveDefaultName}
        onConfirm={handleSaveConfirm} onCancel={() => setSaveAsOpen(false)} />
    </div>
  );
};
