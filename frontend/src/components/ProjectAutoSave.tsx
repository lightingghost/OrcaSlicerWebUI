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
 * (by file_id) to uploadedFiles, queuing each one's saved placement in
 * pendingInitialTransforms for ThreeViewport to apply once loaded —
 * exactly the same mechanism importProject uses (see projectSlice.ts),
 * just fed from a stored autosave instead of a freshly-imported .3mf.
 *
 * Uploaded files live under TMP_ROOT (ephemeral — see backend
 * config.py's tmp_root docstring), which is wiped on server restart,
 * while this autosave itself lives under the persistent USER_WORKSPACE.
 * So a restored file_id is NOT guaranteed to still exist server-side —
 * each one is verified with a HEAD-like GET /api/files/{id} before being
 * re-added; ones that 404 are dropped (and, if any were dropped, the
 * autosave is immediately rewritten without them so the 3s save loop
 * doesn't keep resubmitting dead file_ids to /api/projects/autosave and
 * looping on 422s).
 *
 * Saving is change-driven, not time-driven: a cheap in-memory poll (every
 * POLL_INTERVAL_MS, no network) compares the live plate's signature
 * (uploadedFiles + each object's live position/rotation/scale) against
 * the last-checked one. A poll — rather than a debounced effect keyed on
 * some piece of store state — is necessary because object position/
 * rotation/scale edits (drag, the Move/Rotate/Scale tool, Arrange, Lay on
 * Face, Auto Orient) mutate the Three.js scene's mesh transforms
 * DIRECTLY and are never mirrored into Zustand (see MainArea.tsx's doc
 * comment on why) — there is no store field whose change a normal
 * useEffect dependency array could react to.
 *
 * Only once the signature has been unchanged for DEBOUNCE_MS does an
 * actual save request fire (mirroring ConfigAutoSave.tsx's own
 * debounced-save pattern), and the save-succeeded signature is then
 * remembered so an unchanged plate produces zero network requests on
 * every subsequent poll tick — this is also what stops a save that the
 * backend rejects (e.g. a stale file_id — see projects.py's
 * autosave_project) from being retried forever: it's attempted exactly
 * once per distinct plate state, not resubmitted every tick until the
 * plate actually changes again.
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

// How often to poll the (unmirrored, see this file's doc comment) live
// scene state for changes. Pure in-memory comparison, no network — cheap
// enough to run this frequently without concern.
const POLL_INTERVAL_MS = 1000;
// Once a change is detected, wait this long without a FURTHER change
// before actually saving — mirrors ConfigAutoSave.tsx's debounce pattern,
// so a drag-in-progress or a burst of edits collapses into one save
// instead of one per poll tick.
const DEBOUNCE_MS = 2000;

/** Cheap string fingerprint of "what's on the plate and where", used to
 * detect whether anything actually changed since the last poll tick —
 * order-sensitive is fine since uploadedFiles order only changes when
 * files are added/removed/reordered, which IS a real change worth saving. */
function computePlateSignature(
  files: UploadedFile[],
  placements: Record<string, PlateObjectPlacement>
): string {
  return files
    .map((f) => {
      const p = placements[f.file_id];
      return p
        ? `${f.file_id}:${p.x},${p.y},${p.z},${p.qx},${p.qy},${p.qz},${p.qw},${p.sx},${p.sy},${p.sz}`
        : `${f.file_id}:none`;
    })
    .join('|');
}

export const ProjectAutoSave: React.FC = () => {
  const hasLoadedRef = useRef(false);
  const isLoadingRef = useRef(false);
  // Signature of the plate state as of the last poll tick — used to
  // detect "did anything change since we last looked". Starts as a
  // sentinel that can never equal a real signature (including the empty
  // one, `''`) so the very first poll tick always runs its comparison
  // logic rather than assuming "unchanged".
  const lastSeenSignatureRef = useRef<string | null>(null);
  // Signature of the plate state as of the last successful (or
  // last-attempted — see debounced save effect) save. Comparing against
  // THIS, not lastSeenSignatureRef, is what stops a save the backend
  // rejects (e.g. a stale file_id — see projects.py's autosave_project)
  // from being retried every poll tick forever: it's attempted once per
  // distinct signature, not once per tick.
  const lastSavedSignatureRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 1. Restore the saved project on mount ───────────────────────────────
  useEffect(() => {
    if (hasLoadedRef.current || isLoadingRef.current) return;
    isLoadingRef.current = true;

    apiClient
      .getAutosave('project')
      .then(async (raw) => {
        const payload = raw as unknown as ProjectAutosavePayload;
        if (!payload || !Array.isArray(payload.files) || payload.files.length === 0) {
          // Nothing to restore — seed both signatures as "empty" so
          // effect 2's poll doesn't immediately fire a pointless
          // deleteAutosave for a plate that was already empty (there's
          // nothing on disk to clear in the first place).
          lastSeenSignatureRef.current = '';
          lastSavedSignatureRef.current = '';
          return;
        }

        // Verify each restored file still exists server-side (uploads
        // live under ephemeral TMP_ROOT and don't survive a restart —
        // see this component's doc comment). Clones (is_clone) share
        // their source file's geometry rather than being their own
        // upload, so check source_file_id, not file_id, for them.
        const checkedIds = new Map<string, boolean>();
        const checkExists = async (id: string): Promise<boolean> => {
          if (checkedIds.has(id)) return checkedIds.get(id)!;
          const exists = await apiClient
            .getFile(id)
            .then(() => true)
            .catch(() => false);
          checkedIds.set(id, exists);
          return exists;
        };

        const survivingFiles: UploadedFile[] = [];
        for (const file of payload.files) {
          if (await checkExists(file.source_file_id)) {
            survivingFiles.push(file);
          }
        }

        const droppedAny = survivingFiles.length !== payload.files.length;

        useStore.setState((state) => {
          const nextTransforms = new Map(state.pendingInitialTransforms);
          for (const file of survivingFiles) {
            const placement = payload.placements?.[file.file_id];
            if (placement) {
              nextTransforms.set(file.file_id, placement);
            }
          }
          return {
            uploadedFiles: survivingFiles,
            pendingInitialTransforms: nextTransforms,
          };
        });

        const survivingPlacements: Record<string, PlateObjectPlacement> = {};
        for (const file of survivingFiles) {
          const placement = payload.placements?.[file.file_id];
          if (placement) survivingPlacements[file.file_id] = placement;
        }
        const survivingSignature = computePlateSignature(survivingFiles, survivingPlacements);

        if (droppedAny) {
          // Rewrite (or clear) the autosave immediately so effect 2's
          // poll doesn't keep resubmitting now-dead file_ids to
          // /api/projects/autosave and looping on 422s.
          if (survivingFiles.length === 0) {
            await apiClient.deleteAutosave('project').catch(() => {});
          } else {
            const prunedPayload: ProjectAutosavePayload = {
              files: survivingFiles,
              placements: survivingPlacements,
            };
            await apiClient
              .saveAutosave('project', prunedPayload as unknown as Record<string, unknown>)
              .catch(() => {});
          }
        }

        // Seed both signatures with what's now actually on disk, so
        // effect 2's poll treats the just-restored plate as "already
        // saved" and doesn't immediately re-save it (or the pruned
        // version of it) again on its very first tick.
        lastSeenSignatureRef.current = survivingSignature;
        lastSavedSignatureRef.current = survivingSignature;
      })
      .catch(() => {
        // No autosave yet (404) or it failed to load — start with an
        // empty plate rather than blocking app startup.
        lastSeenSignatureRef.current = '';
        lastSavedSignatureRef.current = '';
      })
      .finally(() => {
        hasLoadedRef.current = true;
        isLoadingRef.current = false;
      });
  }, []);

  // ── 2. Save whenever the plate actually changes (debounced) ─────────────
  // Polls the live scene every POLL_INTERVAL_MS (cheap, in-memory, no
  // network — see this file's doc comment for why a poll is necessary at
  // all) purely to compute computePlateSignature and compare it against
  // lastSeenSignatureRef. Only a CHANGE restarts the debounce timer; an
  // unchanged plate does nothing on a given tick, and a plate that's
  // already been saved (lastSavedSignatureRef) never re-fires the network
  // request even if the debounce timer were somehow retriggered — this
  // is what eliminates the constant "200 / 422 every 3s" log spam for an
  // idle plate.
  useEffect(() => {
    const clearDebounce = () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };

    const performSave = (signature: string) => {
      if (signature === lastSavedSignatureRef.current) return;
      lastSavedSignatureRef.current = signature;

      const { uploadedFiles: currentFiles, getPlateSnapshot: currentGetSnapshot } = useStore.getState();

      if (currentFiles.length === 0) {
        apiClient.deleteAutosave('project').catch(() => {});
        return;
      }
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
    };

    const intervalId = setInterval(() => {
      if (!hasLoadedRef.current) return;
      const { uploadedFiles: currentFiles, getPlateSnapshot: currentGetSnapshot } = useStore.getState();

      const placements: Record<string, PlateObjectPlacement> = {};
      if (currentFiles.length > 0 && currentGetSnapshot) {
        const snapshot = currentGetSnapshot();
        for (const entry of snapshot) {
          placements[entry.file_id] = {
            x: entry.x, y: entry.y, z: entry.z,
            qx: entry.qx, qy: entry.qy, qz: entry.qz, qw: entry.qw,
            sx: entry.sx, sy: entry.sy, sz: entry.sz,
          };
        }
      }

      const currentSignature = computePlateSignature(currentFiles, placements);
      if (currentSignature === lastSeenSignatureRef.current) return;

      // Something changed since the last tick — (re)start the debounce
      // timer rather than saving immediately, so a drag-in-progress or a
      // burst of edits collapses into a single save DEBOUNCE_MS after
      // the LAST change, not one save per tick while changes keep coming.
      lastSeenSignatureRef.current = currentSignature;
      clearDebounce();
      debounceTimerRef.current = setTimeout(() => {
        performSave(currentSignature);
      }, DEBOUNCE_MS);
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
      clearDebounce();
    };
  }, []);

  return null;
};
