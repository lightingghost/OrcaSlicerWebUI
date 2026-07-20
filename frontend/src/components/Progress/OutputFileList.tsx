import React, { useEffect, useState } from 'react';
import { apiClient, OutputFileSummary } from '../../api/client';

/**
 * OutputFileList Component
 * 
 * Displayed when job reaches completed status.
 * Fetches /api/jobs/{job_id}/outputs and renders filename and size for each output file
 * with a download button that triggers a browser download.
 * Displays "File expired" message if API returns 404.
 * 
 * Validates: Requirements 8.1, 8.2, 8.3, 8.5
 */

interface OutputFileListProps {
  jobId: string;
}

export const OutputFileList: React.FC<OutputFileListProps> = ({ jobId }) => {
  const [outputFiles, setOutputFiles] = useState<OutputFileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [downloadingFiles, setDownloadingFiles] = useState<Set<string>>(new Set());

  // Fetch output files when component mounts or jobId changes
  useEffect(() => {
    const fetchOutputFiles = async () => {
      try {
        setLoading(true);
        setError(null);
        setExpired(false);

        const files = await apiClient.getJobOutputs(jobId);
        setOutputFiles(files);
      } catch (err: unknown) {
        // Check if it's a 404 error (file expired)
        if (err && typeof err === 'object' && 'statusCode' in err) {
          const apiError = err as { statusCode: number; message?: string };
          if (apiError.statusCode === 404) {
            setExpired(true);
          } else {
            setError(apiError.message || 'Failed to fetch output files');
          }
        } else {
          setError('Failed to fetch output files');
        }
        console.error('Failed to fetch output files:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchOutputFiles();
  }, [jobId]);

  /**
   * Format file size in human-readable format
   */
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  /**
   * Handle download button click
   * Triggers browser download of the output file
   */
  const handleDownload = async (filename: string) => {
    try {
      // Mark this file as downloading
      setDownloadingFiles(prev => new Set(prev).add(filename));

      // Fetch the file blob
      const blob = await apiClient.downloadOutput(jobId, filename);

      // Create a temporary download link and trigger it
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();

      // Cleanup
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      // Check if it's a 404 error (file expired during download)
      if (err && typeof err === 'object' && 'statusCode' in err) {
        const apiError = err as { statusCode: number };
        if (apiError.statusCode === 404) {
          setExpired(true);
        }
      }
      console.error('Failed to download file:', err);
    } finally {
      // Remove downloading state
      setDownloadingFiles(prev => {
        const next = new Set(prev);
        next.delete(filename);
        return next;
      });
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="rounded-lg bg-gray-800 border border-gray-700 px-4 py-6">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400"></div>
          <span className="ml-3 text-sm text-gray-400">Loading output files...</span>
        </div>
      </div>
    );
  }

  // Expired state (404 response)
  if (expired) {
    return (
      <div className="rounded-lg bg-red-900 bg-opacity-20 border border-red-500 px-4 py-4">
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
            <p className="text-sm font-medium text-red-300">File expired</p>
            <p className="mt-1 text-sm text-red-200">
              The output files for this job are no longer available.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="rounded-lg bg-red-900 bg-opacity-20 border border-red-500 px-4 py-4">
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
            <p className="text-sm font-medium text-red-300">Error</p>
            <p className="mt-1 text-sm text-red-200">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (outputFiles.length === 0) {
    return (
      <div className="rounded-lg bg-gray-800 border border-gray-700 px-4 py-6">
        <div className="flex items-center justify-center text-gray-400">
          <svg
            className="h-12 w-12 text-gray-600 mb-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="text-sm">No output files available</p>
        </div>
      </div>
    );
  }

  // Output files list
  return (
    <div className="rounded-lg bg-gray-800 border border-gray-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700 bg-gray-750">
        <h3 className="text-sm font-semibold text-white">Output Files</h3>
        <p className="text-xs text-gray-400 mt-1">
          {outputFiles.length} {outputFiles.length === 1 ? 'file' : 'files'} ready for download
        </p>
      </div>

      <div className="divide-y divide-gray-700">
        {outputFiles.map((file) => {
          const isDownloading = downloadingFiles.has(file.filename);

          return (
            <div
              key={file.filename}
              className="px-4 py-3 flex items-center justify-between hover:bg-gray-750 transition-colors"
            >
              {/* File info */}
              <div className="flex items-center flex-1 min-w-0 mr-4">
                <svg
                  className="h-8 w-8 text-blue-400 mr-3 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate" title={file.filename}>
                    {file.filename}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {formatFileSize(file.size_bytes)}
                  </p>
                </div>
              </div>

              {/* Download button */}
              <button
                onClick={() => handleDownload(file.filename)}
                disabled={isDownloading}
                className="flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
                aria-label={`Download ${file.filename}`}
              >
                {isDownloading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Downloading
                  </>
                ) : (
                  <>
                    <svg
                      className="h-4 w-4 mr-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                      />
                    </svg>
                    Download
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
