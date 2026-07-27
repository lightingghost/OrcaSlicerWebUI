import { StateCreator } from 'zustand';
import { FileSlice, UploadedFile } from './fileSlice';
import { ViewportSlice } from './viewportSlice';

/**
 * projectSlice
 *
 * "Project" actions for the top bar: New / Import / Download, backed by
 * a single .3mf file (see backend/app/routers/projects.py) — matching
 * native OrcaSlicer's File > New Project / Import Project / Export Project
 * as .3mf, minus profile/settings embedding (this app's printer/process/
 * filament SELECTION is already a separate concept, persisted via
 * user_config.yaml — see ConfigAutoSave.tsx — not part of the .3mf
 * project file itself).
 *
 * A "project" here means: every object currently on the Prepare-tab
 * plate (fileSlice's `uploadedFiles`) plus each object's live position/
 * orientation in the Three.js scene. Positions/orientations live ONLY in
 * the scene's own mesh transforms (see MainArea.tsx's doc comment), not
 * in Zustand, so Download Project reads them via `getPlateSnapshot`
 * (registered by ThreeViewport, mirroring the existing
 * `captureViewportThumbnail` registration pattern in viewportSlice.ts)
 * rather than from any store field.
 */

export interface PlateObjectPlacement {
  x: number;
  y: number;
  z: number;
  /** THREE.js quaternion order. */
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  /** Per-axis scale (THREE.js Object3D.scale convention). */
  sx: number;
  sy: number;
  sz: number;
}

export interface ImportedProjectObject extends PlateObjectPlacement {
  file_id: string;
  filename: string;
}

export interface ProjectExportObject extends PlateObjectPlacement {
  file_id: string;
}

export interface ProjectSlice {
  /**
   * Placement to apply the FIRST time ThreeViewport loads a given
   * file_id, instead of the default "stack new imports in a grid"
   * placement — populated by importProject with each object's original
   * position/orientation from the imported .3mf, consumed-and-removed by
   * ThreeViewport's uploadedFiles-loading effect once applied.
   */
  pendingInitialTransforms: Map<string, PlateObjectPlacement>;
  clearPendingInitialTransform: (fileId: string) => void;

  /** True while an import/export/new-project request is in flight, so
   * TopBar can disable the relevant button and avoid double-submission. */
  isProjectActionInProgress: boolean;
  projectActionError: string | null;

  /** Clears every object off the plate (matches native's File > New
   * Project) — the actual Three.js scene cleanup follows automatically
   * from uploadedFiles going empty, see ThreeViewport's cleanup effect. */
  newProject: () => void;

  /** Imports a .3mf: splits it server-side into individual STL files
   * (see routers/projects.py) and REPLACES the current plate with them
   * (matching native OrcaSlicer's File > Import Project, which opens a
   * fresh project rather than merging into the current one) — the old
   * plate's objects are discarded first, then each imported object is
   * added with its original position/orientation queued in
   * pendingInitialTransforms for ThreeViewport to apply once loaded. */
  importProject: (file: File) => Promise<void>;

  /** Captures the live plate (positions/orientations) via
   * getPlateSnapshot and downloads the resulting project.3mf. */
  downloadProject: () => Promise<void>;
}

type ProjectSliceDeps = FileSlice & ViewportSlice & ProjectSlice;

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${localStorage.getItem('api_token') || ''}` };
}

/**
 * Writes the CURRENT plate to USER_WORKSPACE/autosave/project.3mf on the
 * backend (see routers/projects.py's autosave_project) — the actual
 * on-disk .3mf autosave, distinct from ProjectAutoSave.tsx's own
 * periodic JSON-blob autosave (file_ids + placements) that's what
 * actually restores the plate on reload. Called from ProjectAutoSave's
 * save interval so there's always a real, inspectable .3mf reflecting
 * the live plate, not just the restore-oriented JSON blob.
 */
export async function autosaveProjectAs3mf(
  snapshot: Array<{
    file_id: string;
    x: number; y: number; z: number;
    qx: number; qy: number; qz: number; qw: number;
    sx: number; sy: number; sz: number;
  }>
): Promise<void> {
  await fetch('/api/projects/autosave', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ objects: snapshot }),
  });
}

export const createProjectSlice: StateCreator<
  ProjectSliceDeps,
  [],
  [],
  ProjectSlice
> = (set, get) => ({
  pendingInitialTransforms: new Map(),
  isProjectActionInProgress: false,
  projectActionError: null,

  clearPendingInitialTransform: (fileId: string) => {
    set((state) => {
      if (!state.pendingInitialTransforms.has(fileId)) return {};
      const next = new Map(state.pendingInitialTransforms);
      next.delete(fileId);
      return { pendingInitialTransforms: next };
    });
  },

  newProject: () => {
    // Clearing uploadedFiles is sufficient — ThreeViewport's own cleanup
    // effect (which reacts to entries disappearing from uploadedFiles)
    // removes every corresponding mesh from the scene automatically, so
    // there's no separate "clear the viewport" step needed here.
    set({ uploadedFiles: [], pendingInitialTransforms: new Map(), projectActionError: null });
  },

  importProject: async (file: File) => {
    set({ isProjectActionInProgress: true, projectActionError: null });
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/projects/import', {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Import failed' }));
        throw new Error(errorData.detail || `Import failed with status ${response.status}`);
      }

      const body: { objects: ImportedProjectObject[] } = await response.json();

      // Import REPLACES the plate rather than merging into it — start
      // from a fresh pendingInitialTransforms map (not the previous
      // project's leftovers) alongside the fresh uploadedFiles list
      // below, mirroring newProject()'s own reset.
      const newFiles: UploadedFile[] = body.objects.map((obj) => ({
        file_id: obj.file_id,
        filename: obj.filename,
        size_bytes: 0,
        extension: 'stl',
        uploaded_at: new Date().toISOString(),
        source_file_id: obj.file_id,
        is_clone: false,
      }));
      const nextTransforms = new Map<string, PlateObjectPlacement>();
      for (const obj of body.objects) {
        nextTransforms.set(obj.file_id, {
          x: obj.x,
          y: obj.y,
          z: obj.z,
          qx: obj.qx,
          qy: obj.qy,
          qz: obj.qz,
          qw: obj.qw,
          sx: obj.sx,
          sy: obj.sy,
          sz: obj.sz,
        });
      }
      set({
        uploadedFiles: newFiles,
        pendingInitialTransforms: nextTransforms,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error occurred';
      set({ projectActionError: message });
      throw error;
    } finally {
      set({ isProjectActionInProgress: false });
    }
  },

  downloadProject: async () => {
    const getPlateSnapshot = get().getPlateSnapshot;
    if (!getPlateSnapshot) {
      set({ projectActionError: 'Viewport is not ready yet' });
      return;
    }

    set({ isProjectActionInProgress: true, projectActionError: null });
    try {
      const snapshot = getPlateSnapshot();
      if (snapshot.length === 0) {
        set({ projectActionError: 'Nothing on the plate to export' });
        return;
      }

      const response = await fetch('/api/projects/export', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ objects: snapshot }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Export failed' }));
        throw new Error(errorData.detail || `Export failed with status ${response.status}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'project.3mf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error occurred';
      set({ projectActionError: message });
      throw error;
    } finally {
      set({ isProjectActionInProgress: false });
    }
  },
});
