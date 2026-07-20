import React from 'react';

/**
 * QueuePositionIndicator Component
 * 
 * Displays the job's position in the queue when status is 'queued'.
 * Only visible when queuePosition is provided.
 * 
 * @param queuePosition - 1-based position in the queue (null/undefined if not queued)
 */

interface QueuePositionIndicatorProps {
  queuePosition?: number | null;
}

export const QueuePositionIndicator: React.FC<QueuePositionIndicatorProps> = ({ queuePosition }) => {
  // Don't render anything if there's no queue position or if position is 0 or negative
  if (queuePosition === null || queuePosition === undefined || queuePosition <= 0) {
    return null;
  }

  return (
    <div className="rounded-lg bg-purple-900 bg-opacity-30 border border-purple-500 px-4 py-3">
      <div className="flex items-center justify-between">
        {/* Queue icon and text */}
        <div className="flex items-center">
          <svg
            className="h-5 w-5 text-purple-400 mr-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <p className="text-sm font-medium text-purple-300">Job Queued</p>
            <p className="mt-1 text-xs text-purple-200">
              {queuePosition === 1
                ? 'Your job is next in line'
                : `Position ${queuePosition} in queue`}
            </p>
          </div>
        </div>

        {/* Position badge */}
        <div className="flex items-center justify-center h-10 w-10 rounded-full bg-purple-500 bg-opacity-20">
          <span className="text-lg font-bold text-purple-300">{queuePosition}</span>
        </div>
      </div>
    </div>
  );
};
