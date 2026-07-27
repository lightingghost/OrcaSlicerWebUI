/**
 * ProjectAutoSave Component
 *
 * Persists the CURRENT plate (which files are loaded + each object's live
 * position/orientation/scale) across page reloads, using the same
 * generic `/api/autosave/{name}` mechanism ConfigAutoSave.tsx already
 * uses for profile-selection/parameter-override autosaving (see that
 * component's doc comment) — this is a separate concern (actual 3D scene
 * contents, not printer/process/filament selection), stored under its
 * own autosave name ("project") so the two never collide or overwrite
 * each other.
 *
 * On mount: loads any saved project autosave and re-adds every file
 * (by file_id — files are never deleted by backend retention cleanup,
 * see cleanup.py, so a saved file_id remains valid indefinitely) to
 * uploadedFiles, queuing each one's saved placement in
 * pendingInitialTransforms for ThreeViewport to apply once loaded —
 * exactly the same mechanism importProject uses (see projectSlice.ts),
 * just fed from a stored autosave instead of a freshly-imported .3mf.
 *
 * On an interval (every 3s) while there's anything on the plate: captures
 * the live snapshot via getPlateSnapshot and saves it alongside the
 * current uploadedFiles list. A periodic poll — rather than a debounced
 * effect keyed on some piece of store state — is necessary because
 * object position/rotation/scale edits (drag, the Move/Rotate/Scale
 * tool, Arrange, Lay on Face, Auto Orient) mutate the Three.js scene's
 * mesh transforms DIRECTLY and are never mirrored into Zustand (see
 * MainArea.tsx's doc comment on why) — there is no store field whose
 * change could debounce off of for "the plate moved". Uploading/removing
 * files (which DOES go through the store, via uploadedFiles) is also
 * covered by this same interval rather than a separate more-responsive
 * path, since losing at most ~3s of edits on an unexpected tab close is
 * an acceptable tradeoff for not having to instrument every transform
 * call site in ThreeViewport with an explicit "plate changed" signal.
 */

import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { apiClient } from '../api/client';
import type { UploadedFile } from '../store/fileSlice';
import { autosaveProjectAs3mf, type PlateObjectPlacement } from '../store/projectSlice';

interface ProjectAutosavePayload {
  files: UploadedFile[];
  placements: Record<string, PlateObjectPlacement>;
}

export const ProjectAutoSave: React.FC = () => {
  const hasLoadedRef = useRef(false);
  const isLoadingRef = useRef(false);
  // Tracks whether the LAST tick already had an empty plate, so the
  // empty-plate branch below only calls deleteAutosave once per
  // transition to empty, instead of firing a DELETE request every 3s
  // forever while the plate stays empty (observed: dozens of repeated
  // "DELETE /api/autosave/project → 200" log lines with nothing on the
  // plate — harmless to correctness but a pointless steady drip of
  // requests every 3 seconds for as long as the tab stays open empty).
  const wasEmptyRef = useRef(false);

  // ── 1. Restore the saved project on mount ───────────────────────────────
  useEffect(() => {
    if (hasLoadedRef.current || isLoadingRef.current) return;
    isLoadingRef.current = true;

    apiClient
      .getAutosave('project')
      .then((raw) => {
        const payload = raw as unknown as ProjectAutosavePayload;
        if (!payload || !Array.isArray(payload.files) || payload.files.length === 0) return;

        useStore.setState((state) => {
          const nextTransforms = new Map(state.pendingInitialTransforms);
          for (const file of payload.files) {
            const placement = payload.placements?.[file.file_id];
            if (placement) {
              nextTransforms.set(file.file_id, placement);
            }
          }
          return {
            uploadedFiles: payload.files,
            pendingInitialTransforms: nextTransforms,
          };
        });
      })
      .catch(() => {
        // No autosave yet (404) or it failed to load — start with an
        // empty plate rather than blocking app startup.
      })
      .finally(() => {
        hasLoadedRef.current = true;
        isLoadingRef.current = false;
      });
  }, []);

  // ── 2. Auto-save the plate every 3s ─────────────────────────────────────
  // Reads uploadedFiles/getPlateSnapshot fresh from the store on each tick
  // (via useStore.getState(), not the reactive selectors above) so the
  // interval itself never needs to be torn down and recreated just
  // because uploadedFiles changed — it only needs to be set up once.
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (!hasLoadedRef.current) return;
      const { uploadedFiles: currentFiles, getPlateSnapshot: currentGetSnapshot } = useStore.getState();

      if (currentFiles.length === 0) {
        // Nothing to save — clear any stale autosave from a previous
        // session instead of leaving a payload that would resurrect
        // objects the user deliberately removed (e.g. via New Project).
        // Only fire this once per empty-plate transition (see
        // wasEmptyRef's doc comment) rather than every tick forever.
        if (!wasEmptyRef.current) {
          wasEmptyRef.current = true;
          apiClient.deleteAutosave('project').catch(() => {});
        }
        return;
      }
      wasEmptyRef.current = false;
      if (!currentGetSnapshot) return;

      const snapshot = currentGetSnapshot();
      const placements: Record<string, PlateObjectPlacement> = {};
      for (const entry of snapshot) {
        placements[entry.file_id] = {
          x: entry.x,
          y: entry.y,
          z: entry.z,
          qx: entry.qx,
          qy: entry.qy,
          qz: entry.qz,
          qw: entry.qw,
          sx: entry.sx,
          sy: entry.sy,
          sz: entry.sz,
        };
      }

      const payload: ProjectAutosavePayload = { files: currentFiles, placements };
      apiClient
        .saveAutosave('project', payload as unknown as Record<string, unknown>)
        .catch((err) => console.error('Project autosave failed:', err));

      // Also write the real, inspectable .3mf (USER_WORKSPACE/autosave/
      // project.3mf) — see projectSlice.ts's autosaveProjectAs3mf doc
      // comment for why this is separate from the JSON blob above.
      autosaveProjectAs3mf(snapshot).catch((err) =>
        console.error('Project .3mf autosave failed:', err)
      );
    }, 3000);

    return () => clearInterval(intervalId);
  }, []);

  return null;
};
