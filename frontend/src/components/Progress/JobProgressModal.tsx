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
  const jobError = useStore((state) => state.jobError);
  const disconnectProgressSocket = useStore((state) => state.disconnectProgressSocket);
  const dismissJob = useStore((state) => state.dismissJob);
  const cancelJob = useStore((state) => state.cancelJob);

  // Listen for warning events via WebSocket
  // Note: Warning handling is done in jobSlice, but we can track warnings locally
  React.useEffect(() => {
    // If the progress updates, check for warnings
    // In a real implementation, warnings would come through WebSocket as separate events
    // For now, we'll leave this as a placeholder for future warning handling
  }, [progress]);

  // Show the modal while a job is queued/running, AND keep it visible
  // (in a "failed" state) once it fails/times out, so the user sees WHY
  // it failed instead of the modal just vanishing — which previously
  // looked identical to "clicking Slice did nothing" for any real
  // slicing error (bad profile combo, incompatible gcode settings, etc).
  const relevantStatuses = ['queued', 'running', 'failed', 'timed_out'];
  if (!activeJobId || !jobStatus || !relevantStatuses.includes(jobStatus)) {
    return null;
  }

  const isTerminalFailure = jobStatus === 'failed' || jobStatus === 'timed_out';

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

  /** Dismiss the failure state entirely (not just disconnect the socket —
   * jobStatus itself must be cleared too, otherwise this modal's guard
   * clause above would keep it visible forever). */
  const handleDismissFailure = () => {
    dismissJob();
  };

  return (
    <>
      {/* Modal backdrop */}
      <div className="fixed inset-0 z-50 bg-black bg-opacity-60 flex items-center justify-center">
        {/* Modal content */}
        <div className="relative w-full max-w-2xl mx-6 bg-gray-900 rounded-xl shadow-2xl border border-gray-700">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
            <div className="flex items-center">
              <div
                className={`h-8 w-8 rounded-full flex items-center justify-center mr-3 ${
                  isTerminalFailure ? 'bg-red-500 bg-opacity-20' : 'bg-blue-500 bg-opacity-20'
                }`}
              >
                {isTerminalFailure ? (
                  <svg
                    className="h-5 w-5 text-red-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                ) : (
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
                )}
              </div>
              <h2 className="text-lg font-semibold text-white">
                {jobStatus === 'queued'
                  ? 'Job Queued'
                  : jobStatus === 'failed'
                  ? 'Slicing Failed'
                  : jobStatus === 'timed_out'
                  ? 'Slicing Timed Out'
                  : 'Slicing in Progress'}
              </h2>
            </div>

            {/* Close button (only show if job is not active) */}
            {canClose && (
              <button
                onClick={isTerminalFailure ? handleDismissFailure : handleClose}
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

            {/* Failure reason — this is the fix for jobs that fail with a
                real CLI error (bad profile combo, invalid gcode settings,
                etc): previously the modal just disappeared with no
                indication of what happened, which looked identical to
                the Slice button doing nothing at all. */}
            {isTerminalFailure && (
              <div className="rounded-lg bg-red-900 bg-opacity-30 border border-red-700 p-4">
                <p className="text-sm text-red-300 font-medium mb-1">
                  {jobStatus === 'timed_out' ? 'The job timed out.' : 'The slicer reported an error:'}
                </p>
                <p className="text-sm text-red-200 whitespace-pre-wrap break-words font-mono">
                  {jobError || 'Unknown error'}
                </p>
              </div>
            )}

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
