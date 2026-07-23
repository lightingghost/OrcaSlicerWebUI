import { StateCreator } from 'zustand';

export interface UploadedFile {
  file_id: string;
  filename: string;
  size_bytes: number;
  extension: 'stl' | '3mf' | 'obj' | 'amf';
  uploaded_at: string;
  /**
   * The backend file this plate object's geometry actually comes from.
   * For a genuine upload this equals its own `file_id`. For a clone
   * (created via duplicateObject/setInstanceCount — see the viewport's
   * right-click context menu: Remove/Clone/Set number of instances,
   * matching native OrcaSlicer's object list menu), this points back at
   * the original upload's file_id, since a clone reuses the same source
   * geometry on the backend rather than being re-uploaded. Job submission
   * uses `source_file_id` (not the synthetic clone id) so the backend
   * receives a real, valid file reference for every instance.
   */
  source_file_id: string;
  /** True for entries created by duplicateObject/setInstanceCount, i.e. not a genuine upload. */
  is_clone: boolean;
}

export interface FileSlice {
  uploadedFiles: UploadedFile[];
  uploadFile: (file: File) => Promise<void>;
  removeFile: (fileId: string) => void;
  /** Adds exactly one clone of the given object (matches native's "Clone" object-list action). */
  duplicateObject: (fileId: string) => string;
  /**
   * Ensures the total number of instances descending from the same source
   * file as `fileId` equals `count` (matches native's "Set number of
   * instances" object-list action, which sets an absolute count rather
   * than adding N more). Adds or removes clones as needed; never removes
   * the original. Returns the file_ids of any newly-created clones.
   */
  setInstanceCount: (fileId: string, count: number) => string[];
  uploadError: string | null;
}

let cloneIdCounter = 0;

function generateCloneId(sourceFileId: string): string {
  cloneIdCounter += 1;
  return `${sourceFileId}__clone-${cloneIdCounter}-${Date.now()}`;
}

export const createFileSlice: StateCreator<FileSlice> = (set, get) => ({
  uploadedFiles: [],
  uploadError: null,

  uploadFile: async (file: File) => {
    try {
      set({ uploadError: null });

      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(errorData.error || `Upload failed with status ${response.status}`);
      }

      const rawFile = await response.json();
      const uploadedFile: UploadedFile = {
        ...rawFile,
        source_file_id: rawFile.file_id,
        is_clone: false,
      };

      set((state) => ({
        uploadedFiles: [...state.uploadedFiles, uploadedFile],
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      set({ uploadError: errorMessage });
      throw error;
    }
  },

  removeFile: (fileId: string) => {
    const state = get();
    const target = state.uploadedFiles.find((file) => file.file_id === fileId);
    const remaining = state.uploadedFiles.filter((file) => file.file_id !== fileId);

    set({ uploadedFiles: remaining });

    if (!target) return;

    // Only ask the backend to delete the underlying file once NO instance
    // (original or clone) referencing that source file remains — deleting
    // it while a sibling clone still needs the same geometry would break
    // that clone. Clones never trigger a backend delete on their own,
    // since the synthetic clone id was never uploaded as its own file.
    const anySiblingRemains = remaining.some((file) => file.source_file_id === target.source_file_id);
    if (anySiblingRemains) return;

    // Async delete request (fire and forget)
    fetch(`/api/files/${target.source_file_id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
      },
    }).catch((error) => {
      console.error('Failed to delete file:', error);
    });
  },

  duplicateObject: (fileId: string) => {
    const state = get();
    const source = state.uploadedFiles.find((file) => file.file_id === fileId);
    if (!source) return '';

    const cloneId = generateCloneId(source.source_file_id);
    const clone: UploadedFile = {
      ...source,
      file_id: cloneId,
      source_file_id: source.source_file_id,
      is_clone: true,
      uploaded_at: new Date().toISOString(),
    };

    set((s) => ({ uploadedFiles: [...s.uploadedFiles, clone] }));
    return cloneId;
  },

  setInstanceCount: (fileId: string, count: number) => {
    const targetCount = Math.max(1, Math.floor(count));
    const state = get();
    const target = state.uploadedFiles.find((file) => file.file_id === fileId);
    if (!target) return [];

    // "Instances" of this object = every entry (original + clones) sharing
    // the same source_file_id. Native semantics: setting the count is
    // absolute, and the original is never removed — only clones are
    // added/removed to reach the target total.
    const family = state.uploadedFiles.filter((file) => file.source_file_id === target.source_file_id);
    const currentCount = family.length;

    if (targetCount === currentCount) return [];

    if (targetCount > currentCount) {
      const toAdd = targetCount - currentCount;
      const newClones: UploadedFile[] = Array.from({ length: toAdd }, () => ({
        ...target,
        file_id: generateCloneId(target.source_file_id),
        source_file_id: target.source_file_id,
        is_clone: true,
        uploaded_at: new Date().toISOString(),
      }));
      set((s) => ({ uploadedFiles: [...s.uploadedFiles, ...newClones] }));
      return newClones.map((c) => c.file_id);
    }

    // Removing instances: prefer removing clones over the original, and
    // never remove below 1 (targetCount is already clamped to >= 1).
    const toRemove = currentCount - targetCount;
    const removableClones = family.filter((f) => f.is_clone);
    const idsToRemove = new Set(removableClones.slice(0, toRemove).map((f) => f.file_id));

    set((s) => ({
      uploadedFiles: s.uploadedFiles.filter((file) => !idsToRemove.has(file.file_id)),
    }));
    return [];
  },
});
