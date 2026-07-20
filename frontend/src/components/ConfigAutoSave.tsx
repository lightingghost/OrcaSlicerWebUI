/**
 * ConfigAutoSave Component
 * 
 * Automatically saves user configuration when selections change.
 * Also loads saved configuration on mount.
 * 
 * This component renders nothing - it only handles the save/load logic.
 */

import { useEffect, useRef } from 'react';
import { useStore } from '../store';

export const ConfigAutoSave: React.FC = () => {
  const {
    selectedManufacturer,
    selectedPrinterProfile,
    selectedBedType,
    selectedProcessProfile,
    selectedFilamentProfiles,
    loadUserConfig,
    saveUserConfig,
  } = useStore();

  // Track if initial load has completed
  const hasLoadedRef = useRef(false);
  const isLoadingRef = useRef(false);
  
  // Load user config on mount
  useEffect(() => {
    if (!hasLoadedRef.current && !isLoadingRef.current) {
      isLoadingRef.current = true;
      loadUserConfig().finally(() => {
        hasLoadedRef.current = true;
        isLoadingRef.current = false;
      });
    }
  }, [loadUserConfig]);

  // Auto-save whenever selections change (debounced to avoid excessive saves)
  useEffect(() => {
    // Don't save until initial load is complete
    if (!hasLoadedRef.current) {
      console.log('Skipping save - waiting for initial config load');
      return;
    }

    // Don't save if all values are null/empty (nothing selected)
    if (!selectedManufacturer && !selectedPrinterProfile && !selectedBedType && 
        !selectedProcessProfile && selectedFilamentProfiles.length === 0) {
      console.log('Skipping save - no selections made');
      return;
    }

    // Debounce the save to avoid saving on every keystroke/selection
    const timeoutId = setTimeout(() => {
      console.log('Auto-saving config...');
      saveUserConfig();
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [
    selectedManufacturer,
    selectedPrinterProfile,
    selectedBedType,
    selectedProcessProfile,
    selectedFilamentProfiles,
    saveUserConfig,
  ]);

  // This component renders nothing
  return null;
};
