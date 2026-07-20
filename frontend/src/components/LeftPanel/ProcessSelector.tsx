/**
 * ProcessSelector Component
 * 
 * Provides a dropdown for selecting process profiles and a GlobalObjectsToggle checkbox.
 * 
 * - ProfileDropdown: Displays process profiles from profileSlice.processProfiles
 *   FILTERED by compatibility with selected printer (fetched on dropdown click)
 * - GlobalObjectsToggle: Checkbox for enabling/disabling global objects in process
 * 
 * All selections are wired to profileSlice for global state management.
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { useStore } from '../../store';

export const ProcessSelector: React.FC = () => {
  const {
    processProfiles,
    selectedProcessProfile,
    selectedManufacturer,
    selectedPrinterProfile,
    processProfileCompatibility,
    selectProcessProfile,
    fetchProcessProfileCompatibility,
    saveUserConfig,
  } = useStore();

  // Local state for GlobalObjectsToggle
  const [globalObjectsEnabled, setGlobalObjectsEnabled] = useState(true);
  const [isLoadingCompatibility, setIsLoadingCompatibility] = useState(false);
  const hasLoadedCompatibility = useRef(false);

  // Handle dropdown focus/click - fetch compatibility data lazily
  const handleDropdownFocus = async () => {
    if (selectedPrinterProfile && !hasLoadedCompatibility.current && !isLoadingCompatibility) {
      setIsLoadingCompatibility(true);
      try {
        await fetchProcessProfileCompatibility();
        hasLoadedCompatibility.current = true;
      } catch (err) {
        console.error('Failed to fetch process profile compatibility:', err);
      } finally {
        setIsLoadingCompatibility(false);
      }
    }
  };

  // Auto-save when process profile changes
  useEffect(() => {
    if (selectedProcessProfile) {
      saveUserConfig().catch(err => {
        console.error('Failed to auto-save config:', err);
      });
    }
  }, [selectedProcessProfile, saveUserConfig]);

  // Filter process profiles to only show those compatible with selected printer
  const compatibleProcessProfiles = useMemo(() => {
    if (!selectedPrinterProfile) {
      // No printer selected - show all process profiles
      return processProfiles;
    }
    
    const filtered = processProfiles.filter(profile => {
      const compatiblePrinters = processProfileCompatibility.get(profile.path);
      
      if (!compatiblePrinters || compatiblePrinters.length === 0) {
        // If no compatibility info, include it (backward compatibility)
        return true;
      }
      
      // Check if selected printer is in the compatible list
      return compatiblePrinters.includes(selectedPrinterProfile.name);
    });
    
    return filtered;
  }, [processProfiles, selectedPrinterProfile, processProfileCompatibility]);

  // Handle process profile selection
  const handleProcessChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const profilePath = e.target.value;
    if (!profilePath) return;

    const profile = processProfiles.find((p) => p.path === profilePath);
    if (profile) {
      selectProcessProfile(profile);
    }
  };

  // Handle GlobalObjectsToggle change
  const handleGlobalObjectsToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    setGlobalObjectsEnabled(e.target.checked);
    // TODO: This setting will be passed to the CLI as a parameter override
    // when the job submission is implemented
  };

  return (
    <div className="space-y-3">
      {/* Process Profile Dropdown */}
      <div>
        <label htmlFor="process-profile" className="block text-xs font-medium text-gray-400 mb-1">
          Process Profile
          {selectedPrinterProfile && compatibleProcessProfiles.length < processProfiles.length && (
            <span className="ml-2 text-xs text-gray-500">
              (Compatible: {compatibleProcessProfiles.length}/{processProfiles.length})
            </span>
          )}
        </label>
        <select
          id="process-profile"
          value={selectedProcessProfile?.path || ''}
          onChange={handleProcessChange}
          onFocus={handleDropdownFocus}
          onClick={handleDropdownFocus}
          disabled={!selectedManufacturer || compatibleProcessProfiles.length === 0 || isLoadingCompatibility}
          className="w-full px-2 py-1.5 text-sm bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="">
            {isLoadingCompatibility
              ? 'Loading compatibility...'
              : compatibleProcessProfiles.length === 0
              ? selectedPrinterProfile
                ? 'No compatible process profiles'
                : 'No process profiles available'
              : 'Select process profile'}
          </option>
          {compatibleProcessProfiles.map((profile) => (
            <option key={profile.path} value={profile.path}>
              {profile.name}
            </option>
          ))}
        </select>
        {!selectedPrinterProfile && processProfiles.length > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            Select a printer model to filter compatible profiles
          </p>
        )}
      </div>

      {/* GlobalObjectsToggle Checkbox */}
      <div>
        <label className="flex items-center space-x-2 cursor-pointer group">
          <input
            type="checkbox"
            id="global-objects-toggle"
            checked={globalObjectsEnabled}
            onChange={handleGlobalObjectsToggle}
            className="w-4 h-4 bg-gray-700 border border-gray-600 rounded focus:ring-2 focus:ring-purple-500 text-purple-600 cursor-pointer"
          />
          <span className="text-xs text-gray-300 group-hover:text-white transition-colors">
            Enable Global Objects
          </span>
        </label>
      </div>
    </div>
  );
};
