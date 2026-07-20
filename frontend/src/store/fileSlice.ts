import { StateCreator } from 'zustand';

export interface UploadedFile {
  file_id: string;
  filename: string;
  size_bytes: number;
  extension: 'stl' | '3mf' | 'obj' | 'amf';
  uploaded_at: string;
}

export interface FileSlice {
  uploadedFiles: UploadedFile[];
  uploadFile: (file: File) => Promise<void>;
  removeFile: (fileId: string) => void;
  uploadError: string | null;
}

export const createFileSlice: StateCreator<FileSlice> = (set) => ({
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

      const uploadedFile: UploadedFile = await response.json();

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
    set((state) => ({
      uploadedFiles: state.uploadedFiles.filter((file) => file.file_id !== fileId),
    }));

    // Async delete request (fire and forget)
    fetch(`/api/files/${fileId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
      },
    }).catch((error) => {
      console.error('Failed to delete file:', error);
    });
  },
});
