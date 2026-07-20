import React, { useState, useCallback, useRef, DragEvent } from 'react';
import { useStore } from '../store';

/**
 * UploadDropzone Component
 * 
 * Provides a drag-and-drop file upload interface that:
 * - Accepts .stl, .3mf, .obj, .amf files
 * - Shows inline errors for unsupported extensions or files > 500 MB
 * - Calls fileSlice.uploadFile on drop
 * - Disappears after the first file is loaded and model shows in viewport
 * 
 * Validates: Requirements 1.1, 1.3, 1.5, 1.6
 */

const ACCEPTED_EXTENSIONS = ['.stl', '.3mf', '.obj', '.amf'];
const MAX_FILE_SIZE_MB = 500;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export const UploadDropzone: React.FC = () => {
  const [isDragging, setIsDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Get state from store
  const uploadedFiles = useStore((state) => state.uploadedFiles);
  const uploadFile = useStore((state) => state.uploadFile);
  const uploadError = useStore((state) => state.uploadError);

  /**
   * Validates a file against accepted extensions and size limits
   */
  const validateFile = (file: File): string | null => {
    // Check extension
    const fileName = file.name.toLowerCase();
    const hasValidExtension = ACCEPTED_EXTENSIONS.some((ext) =>
      fileName.endsWith(ext)
    );

    if (!hasValidExtension) {
      return `Unsupported file type. Please upload one of: ${ACCEPTED_EXTENSIONS.join(', ')}`;
    }

    // Check size
    if (file.size > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
      return `File too large (${sizeMB} MB). Maximum size is ${MAX_FILE_SIZE_MB} MB.`;
    }

    return null;
  };

  /**
   * Handles file upload with validation
   */
  const handleFileUpload = useCallback(
    async (file: File) => {
      setLocalError(null);

      // Validate file
      const validationError = validateFile(file);
      if (validationError) {
        setLocalError(validationError);
        return;
      }

      // Upload file
      setIsUploading(true);
      try {
        await uploadFile(file);
        // Success - dropzone will disappear due to uploadedFiles.length > 0
      } catch (error) {
        // Error is already set in the store by uploadFile
        console.error('Upload failed:', error);
      } finally {
        setIsUploading(false);
      }
    },
    [uploadFile]
  );

  /**
   * Drag event handlers
   */
  const handleDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Only set dragging to false if we're leaving the dropzone entirely
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    
    if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      
      if (files.length === 0) {
        return;
      }

      // Take the first file
      const file = files[0];
      handleFileUpload(file);
    },
    [handleFileUpload]
  );

  /**
   * Click to upload handler
   */
  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFileUpload(files[0]);
      }
      // Reset input value so the same file can be selected again
      e.target.value = '';
    },
    [handleFileUpload]
  );

  // Hide the dropzone if any file has been uploaded
  // This check is AFTER all hooks have been called
  if (uploadedFiles.length > 0) {
    return null;
  }

  // Combine local and store errors
  const displayError = localError || uploadError;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-95">
      <div className="w-full max-w-2xl px-6">
        {/* Dropzone */}
        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={handleClick}
          className={`
            relative cursor-pointer rounded-lg border-2 border-dashed p-12 text-center
            transition-all duration-200 ease-in-out
            ${
              isDragging
                ? 'border-blue-500 bg-blue-500 bg-opacity-10'
                : 'border-gray-600 bg-gray-800 hover:border-gray-500 hover:bg-gray-750'
            }
            ${isUploading ? 'pointer-events-none opacity-50' : ''}
          `}
        >
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS.join(',')}
            onChange={handleFileInputChange}
            className="hidden"
            disabled={isUploading}
          />

          {/* Upload icon */}
          <div className="mb-4 flex justify-center">
            <svg
              className="h-16 w-16 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </div>

          {/* Text content */}
          {isUploading ? (
            <div>
              <p className="text-lg font-medium text-white">Uploading...</p>
              <p className="mt-2 text-sm text-gray-400">Please wait</p>
            </div>
          ) : (
            <div>
              <p className="text-lg font-medium text-white">
                {isDragging ? 'Drop your file here' : 'Drag & drop your 3D model'}
              </p>
              <p className="mt-2 text-sm text-gray-400">or click to browse</p>
              <p className="mt-4 text-xs text-gray-500">
                Supported formats: {ACCEPTED_EXTENSIONS.join(', ').toUpperCase()}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Maximum file size: {MAX_FILE_SIZE_MB} MB
              </p>
            </div>
          )}
        </div>

        {/* Error message */}
        {displayError && (
          <div className="mt-4 rounded-lg bg-red-900 bg-opacity-30 border border-red-500 px-4 py-3">
            <div className="flex items-start">
              <svg
                className="h-5 w-5 text-red-500 mr-3 mt-0.5 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-medium text-red-300">Upload Error</p>
                <p className="mt-1 text-sm text-red-200">{displayError}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
