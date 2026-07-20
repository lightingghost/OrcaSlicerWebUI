import React from 'react';
import { useStore } from '../../store';
import { ProgressBar } from './ProgressBar';
import { StatusMessage } from './StatusMessage';
import { WarningBanner } from './WarningBanner';
import { QueuePositionIndicator } from './QueuePositionIndicator';

/**
 * JobProgressModal Component
 * 
 * Modal that appears when a job is queued or running.
 * Contains:
 * - ProgressBar (reflects total_percent)
 * - StatusMessage (reflects message field)
 * - WarningBanner (displays warning text when present)
 * - QueuePositionIndicator (shown when status = queued)
 * 
 * Validates: Requirements 7.3, 7.4, 7.7
 */

export const JobProgressModal: React.FC = () => {
  // Get job state from store
  const activeJobId = useStore((state) => state.activeJobId);
  const jobStatus = useStore((state) => state.jobStatus);
  const queuePosition = useStore((state) => state.queuePosition);
  const progress = useStore((state) => state.progress);
  const disconnectProgressSocket = useStore((state) => state.disconnectProgressSocket);
  const cancelJob = useStore((state) => state.cancelJob);

  // Listen for warning events via WebSocket
  // Note: Warning handling is done in jobSlice, but we can track warnings locally
  React.useEffect(() => {
    // If the progress updates, check for warnings
    // In a real implementation, warnings would come through WebSocket as separate events
    // For now, we'll leave this as a placeholder for future warning handling
  }, [progress]);

  // Don't render the modal if there's no active job or job is not queued/running
  if (!activeJobId || !jobStatus || !['queued', 'running'].includes(jobStatus)) {
    return null;
  }

  /**
   * Handle cancel button click
   */
  const handleCancel = async () => {
    if (!activeJobId) return;

    try {
      await cancelJob(activeJobId);
      disconnectProgressSocket();
    } catch (error) {
      console.error('Failed to cancel job:', error);
    }
  };

  /**
   * Handle close button (only enabled for certain states)
   */
  const handleClose = () => {
    disconnectProgressSocket();
  };

  // Determine if we can show a close button (only after job completes/fails)
  const canClose = !['queued', 'running'].includes(jobStatus);

  return (
    <>
      {/* Modal backdrop */}
      <div className="fixed inset-0 z-50 bg-black bg-opacity-60 flex items-center justify-center">
        {/* Modal content */}
        <div className="relative w-full max-w-2xl mx-6 bg-gray-900 rounded-xl shadow-2xl border border-gray-700">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
            <div className="flex items-center">
              <div className="h-8 w-8 rounded-full bg-blue-500 bg-opacity-20 flex items-center justify-center mr-3">
                <svg
                  className="h-5 w-5 text-blue-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-white">
                {jobStatus === 'queued' ? 'Job Queued' : 'Slicing in Progress'}
              </h2>
            </div>

            {/* Close button (only show if job is not active) */}
            {canClose && (
              <button
                onClick={handleClose}
                className="text-gray-400 hover:text-white transition-colors"
                aria-label="Close modal"
              >
                <svg
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>

          {/* Body */}
          <div className="px-6 py-6 space-y-4">
            {/* Job ID */}
            <div className="text-xs text-gray-500 font-mono">
              Job ID: {activeJobId}
            </div>

            {/* Queue position indicator (only shown when queued) */}
            {jobStatus === 'queued' && <QueuePositionIndicator queuePosition={queuePosition} />}

            {/* Progress bar (only shown when running) */}
            {jobStatus === 'running' && progress && (
              <>
                <ProgressBar percent={progress.total_percent} />

                {/* Plate information */}
                {progress.plate_count > 0 && (
                  <div className="flex justify-between text-sm text-gray-400">
                    <span>
                      Plate {progress.plate_index + 1} of {progress.plate_count}
                    </span>
                    <span>{progress.plate_percent.toFixed(1)}% (current plate)</span>
                  </div>
                )}
              </>
            )}

            {/* Status message (shown when running) */}
            {jobStatus === 'running' && progress && <StatusMessage message={progress.message} />}

            {/* Warning banner (shown when warning is present) */}
            {/* TODO: Warning state needs to be added to store for full implementation */}
            <WarningBanner warning={null} />

            {/* Queued message (when no progress yet) */}
            {jobStatus === 'queued' && (
              <div className="text-center py-8 text-gray-400">
                <p className="text-sm">Waiting for available slot...</p>
                <p className="text-xs mt-2">
                  Your job will start automatically when resources are available
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-700 flex justify-end">
            {/* Cancel button (only shown when queued or running) */}
            {['queued', 'running'].includes(jobStatus) && (
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                Cancel Job
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
