/**
 * ConfigAutoSave Component
 *
 * Saves three kinds of state automatically:
 * 1. Selection state (which printer/filament/process is chosen) → user_config.yaml
 * 2. Global process parameter overrides (edits made in the parameter panel
 *    while the Process section is toggled to "Global") →
 *    USER_WORKSPACE/autosave/process_config.json
 * 3. Per-object process parameter overrides (edits made while toggled to
 *    "Objects", for one specific plate object) →
 *    USER_WORKSPACE/autosave/process_config_object_{file_id}.json, one
 *    file per object that has any overrides of its own.
 *
 * The process autosaves are intentionally separate from the selection save
 * so that parameter edits survive page refresh independently of profile
 * switching. Per-object overrides are further restored lazily (once per
 * file_id, the first time it's seen — see effect 4 below) rather than
 * eagerly from user_config.yaml's object_config_autosaves pointer, since
 * the plate's actual file_ids are only known once ProjectAutoSave finishes
 * restoring the plate, which happens independently and asynchronously.
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
    objectOverrides,
    uploadedFiles,
    setObjectOverride,
    loadUserConfig,
    saveUserConfig,
  } = useStore();

  // Track if initial load has completed
  const hasLoadedRef = useRef(false);
  const isLoadingRef = useRef(false);
  // Separate timers for selection save and process-override save
  const selectionTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const objectTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  // file_ids whose autosave we've already attempted to restore, so a
  // later re-render (e.g. after toggling to Objects) doesn't re-fetch or
  // re-apply the same autosave repeatedly.
  const restoredObjectIdsRef = useRef<Set<string>>(new Set());

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

  // ── 4. Auto-save per-object process parameter overrides (debounced 800 ms) ──
  // One autosave file per object that has any overrides, named
  // process_config_object_{file_id} (mirrors process_config above, just
  // keyed per object instead of global). Objects with no overrides of
  // their own are simply never written (and any stale autosave for them
  // is removed by fileSlice.ts's removeFile when the object leaves the
  // plate).
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    const fileIds = Object.keys(objectOverrides);
    if (fileIds.length === 0) return;

    if (objectTimerRef.current) clearTimeout(objectTimerRef.current);
    objectTimerRef.current = setTimeout(() => {
      for (const fileId of fileIds) {
        const overridesForObject = objectOverrides[fileId];
        if (!overridesForObject || Object.keys(overridesForObject).length === 0) continue;
        apiClient
          .saveAutosave(`process_config_object_${fileId}`, { ...overridesForObject })
          .catch(err => console.error(`Object ${fileId} config autosave failed:`, err));
      }
    }, 800);

    return () => {
      if (objectTimerRef.current) clearTimeout(objectTimerRef.current);
    };
  }, [objectOverrides]);

  // ── 5. Restore per-object overrides as objects appear on the plate ──────
  // Each plate object's own autosave is fetched (once) the first time its
  // file_id is seen, rather than all at once on mount, so this correctly
  // covers objects that appear later (e.g. after ProjectAutoSave finishes
  // restoring the plate asynchronously, or a fresh upload that happens to
  // reuse a previously-overridden file_id).
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    const newFileIds = uploadedFiles
      .map(f => f.file_id)
      .filter(id => !restoredObjectIdsRef.current.has(id));
    if (newFileIds.length === 0) return;

    newFileIds.forEach(fileId => {
      restoredObjectIdsRef.current.add(fileId);
      apiClient
        .getAutosave(`process_config_object_${fileId}`)
        .then(autosaved => {
          for (const [key, value] of Object.entries(autosaved)) {
            if (key.startsWith('_')) continue; // skip internal markers
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
              setObjectOverride(fileId, key, value);
            }
          }
        })
        .catch(() => {
          // No autosave for this object yet — that's fine, it fully
          // inherits from Global until the user overrides something.
        });
    });
  }, [uploadedFiles, setObjectOverride]);

  return null;
};
