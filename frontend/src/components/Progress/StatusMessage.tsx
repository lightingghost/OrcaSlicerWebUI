import React from 'react';

/**
 * StatusMessage Component
 * 
 * Displays the current status message from the CLI progress stream.
 * Shows a text description of what the slicer is currently doing.
 * 
 * @param message - Status text from ProgressUpdateEvent.message field
 */

interface StatusMessageProps {
  message: string;
}

export const StatusMessage: React.FC<StatusMessageProps> = ({ message }) => {
  return (
    <div className="rounded-lg bg-gray-800 px-4 py-3">
      <div className="flex items-start">
        {/* Status icon */}
        <svg
          className="h-5 w-5 text-blue-400 mr-3 mt-0.5 flex-shrink-0 animate-pulse"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        
        {/* Message text */}
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-300">
            {message || 'Processing...'}
          </p>
        </div>
      </div>
    </div>
  );
};
