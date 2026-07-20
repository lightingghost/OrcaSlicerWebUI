/**
 * ConfigAutoSave Component
 *
 * Saves two kinds of state automatically:
 * 1. Selection state (which printer/filament/process is chosen) → user_config.yaml
 * 2. Process parameter overrides (edits made in the parameter panel) →
 *    USER_WORKSPACE/autosave/process_config.json
 *
 * The process autosave is intentionally separate from the selection save so
 * that parameter edits survive page refresh independently of profile switching.
 */

import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { apiClient } from '../api/client';

export const ConfigAutoSave: React.FC = () => {
  const {
    selectedManufacturer,
    selectedPrinterProfile,
    selectedBedType,
    selectedProcessProfile,
    selectedFilamentProfiles,
    overrides,
    loadUserConfig,
    saveUserConfig,
  } = useStore();

  // Track if initial load has completed
  const hasLoadedRef = useRef(false);
  const isLoadingRef = useRef(false);
  // Separate timers for selection save and process-override save
  const selectionTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 1. Load user config on mount ────────────────────────────────────────
  useEffect(() => {
    if (!hasLoadedRef.current && !isLoadingRef.current) {
      isLoadingRef.current = true;
      loadUserConfig().finally(() => {
        hasLoadedRef.current = true;
        isLoadingRef.current = false;
      });
    }
  }, [loadUserConfig]);

  // ── 2. Auto-save selection state (debounced 500 ms) ─────────────────────
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    if (!selectedManufacturer && !selectedPrinterProfile && !selectedBedType &&
        !selectedProcessProfile && selectedFilamentProfiles.length === 0) return;

    if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current);
    selectionTimerRef.current = setTimeout(() => {
      saveUserConfig();
    }, 500);

    return () => {
      if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current);
    };
  }, [
    selectedManufacturer,
    selectedPrinterProfile,
    selectedBedType,
    selectedProcessProfile,
    selectedFilamentProfiles,
    saveUserConfig,
  ]);

  // ── 3. Auto-save process parameter overrides (debounced 800 ms) ─────────
  // Saves the full overrides dict to USER_WORKSPACE/autosave/process_config.json
  // so parameter edits in the panel survive page refresh.
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    // Only save if there are actual overrides to persist
    if (Object.keys(overrides).length === 0) return;

    if (processTimerRef.current) clearTimeout(processTimerRef.current);
    processTimerRef.current = setTimeout(() => {
      const payload: Record<string, unknown> = { ...overrides };
      // Embed the inherits reference so we know which profile these overrides
      // belong to and can detect stale autosaves if the profile changes.
      if (selectedProcessProfile) {
        payload['_inherits'] = selectedProcessProfile.path;
      }
      apiClient.saveAutosave('process_config', payload)
        .catch(err => console.error('Process config autosave failed:', err));
    }, 800);

    return () => {
      if (processTimerRef.current) clearTimeout(processTimerRef.current);
    };
  }, [overrides, selectedProcessProfile]);

  return null;
};
