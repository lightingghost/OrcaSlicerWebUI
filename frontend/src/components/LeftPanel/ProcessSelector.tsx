/**
 * ProcessSelector Component
 *
 * Fetches compatible process profiles from the backend in a single request
 * (GET /api/profiles/process?compatible_printer=<name>) instead of
 * fetching every profile and filtering client-side.
 *
 * Includes a save button to persist the current process config as a user config.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Save } from 'lucide-react';
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
    fetchCompatibleProcessProfiles,
    overrides,
    processTarget,
    setProcessTarget,
  } = useStore();

  // Global/Objects toggle (matches native OrcaSlicer's Process panel):
  // "Global" shows/edits the plate-wide overrides map (this component's
  // existing profile dropdown + ParameterTabs below read `overrides`
  // directly); "Objects" replaces the dropdown with a per-object list
  // (ProcessObjectsList) and ParameterTabs switches to editing whichever
  // object is selected there. Derived from parameterSlice's
  // `processTarget` rather than owning separate local state, so
  // selecting an object elsewhere (e.g. clicking it in the viewport
  // could set processTarget in the future) keeps this toggle in sync.
  const isObjectsMode = processTarget !== 'global';
  const [isLoading, setIsLoading] = useState(false);
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

  const handleProcessChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (!value) return;
    if (value.startsWith('user:')) {
      const name = value.slice('user:'.length);
      selectProcessProfile({ name, path: value, category: 'process' } as ProfileEntry);
    } else {
      const profile = processProfiles.find(p => p.path === value);
      if (profile) selectProcessProfile(profile);
    }
  };

  const buildSavePayload = useCallback((): Record<string, unknown> => {
    const payload: Record<string, unknown> = {};
    if (selectedProcessProfile && !selectedProcessProfile.path.startsWith('user:')) {
      payload['inherits'] = selectedProcessProfile.name;
    }
    for (const [key, value] of Object.entries(overrides)) {
      payload[key] = value;
    }
    return payload;
  }, [selectedProcessProfile, overrides]);

  const handleSaveConfirm = async (name: string) => {
    setSaveAsOpen(false);
    setSaveStatus('saving');
    try {
      await apiClient.saveProcessConfig(name, buildSavePayload(), false);
      await refreshUserConfigs();
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const saveDefaultName = selectedProcessProfile
    ? `${selectedProcessProfile.name} - copy`
    : 'My process config';

  const noProfiles = processProfiles.length === 0 && userProcessConfigs.length === 0;

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
          panel pill switch. "Global" shows the profile dropdown below
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
              section has no such label either — just the dropdown itself
              under the "Process" section heading). The select keeps an
              aria-label so it's still identified for accessibility/tests. */}
          <div className="flex items-center gap-2 min-w-0">
            <select
              id="process-profile"
              aria-label="Process Profile"
              value={selectedProcessProfile?.path || ''}
              onChange={handleProcessChange}
              disabled={!selectedManufacturer || isLoading}
              className="min-w-0 flex-1 w-0 px-2 py-1.5 text-sm bg-gray-700 border border-gray-600
                rounded text-white focus:outline-none focus:ring-2 focus:ring-purple-500
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">
                {isLoading
                  ? 'Loading compatible profiles…'
                  : noProfiles
                    ? (selectedPrinterProfile ? 'No compatible process profiles' : 'No process profiles available')
                    : 'Select process profile'}
              </option>

              {processProfiles.length > 0 && (
                <optgroup label="System profiles">
                  {processProfiles.map(profile => (
                    <option key={profile.path} value={profile.path}>
                      {profile.name}
                    </option>
                  ))}
                </optgroup>
              )}

              {userProcessConfigs.length > 0 && (
                <optgroup label="My saved configs">
                  {userProcessConfigs.map(cfg => (
                    <option key={`user:${cfg.path}`} value={`user:${cfg.path}`}>
                      {cfg.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>

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

      <SaveAsDialog isOpen={saveAsOpen} defaultName={saveDefaultName}
        onConfirm={handleSaveConfirm} onCancel={() => setSaveAsOpen(false)} />
    </div>
  );
};
