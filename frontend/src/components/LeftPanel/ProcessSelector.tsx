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
    saveUserConfig,
    overrides,
  } = useStore();

  const [globalObjectsEnabled, setGlobalObjectsEnabled] = useState(true);
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

  // Auto-save when process profile changes
  useEffect(() => {
    if (selectedProcessProfile) {
      saveUserConfig().catch(err => console.error('Failed to auto-save config:', err));
    }
  }, [selectedProcessProfile, saveUserConfig]);

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

  return (
    <div className="space-y-3">
      <div className="min-w-0">
        <label htmlFor="process-profile" className="block text-xs font-medium text-gray-400 mb-1">
          Process Profile
          {!isLoading && selectedPrinterProfile && processProfiles.length > 0 && (
            <span className="ml-2 text-xs text-gray-500">
              ({processProfiles.length} compatible)
            </span>
          )}
        </label>

        <div className="flex items-center gap-2 min-w-0">
          <select
            id="process-profile"
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

        {!selectedPrinterProfile && (
          <p className="text-xs text-gray-500 mt-1">
            Select a printer to filter compatible profiles
          </p>
        )}
      </div>

      <div>
        <label className="flex items-center space-x-2 cursor-pointer group">
          <input type="checkbox" id="global-objects-toggle"
            checked={globalObjectsEnabled} onChange={e => setGlobalObjectsEnabled(e.target.checked)}
            className="w-4 h-4 bg-gray-700 border border-gray-600 rounded focus:ring-2
              focus:ring-purple-500 text-purple-600 cursor-pointer" />
          <span className="text-xs text-gray-300 group-hover:text-white transition-colors">
            Enable Global Objects
          </span>
        </label>
      </div>

      <SaveAsDialog isOpen={saveAsOpen} defaultName={saveDefaultName}
        onConfirm={handleSaveConfirm} onCancel={() => setSaveAsOpen(false)} />
    </div>
  );
};
