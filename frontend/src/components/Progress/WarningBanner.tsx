import React from 'react';

/**
 * WarningBanner Component
 * 
 * Displays a warning message in amber/yellow styling.
 * Only visible when a warning is present in the progress stream.
 * 
 * @param warning - Warning text to display (null/undefined means no warning)
 */

interface WarningBannerProps {
  warning?: string | null;
}

export const WarningBanner: React.FC<WarningBannerProps> = ({ warning }) => {
  // Don't render anything if there's no warning
  if (!warning) {
    return null;
  }

  return (
    <div className="rounded-lg bg-amber-900 bg-opacity-30 border border-amber-500 px-4 py-3">
      <div className="flex items-start">
        {/* Warning icon */}
        <svg
          className="h-5 w-5 text-amber-500 mr-3 mt-0.5 flex-shrink-0"
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
        
        {/* Warning content */}
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-300">Warning</p>
          <p className="mt-1 text-sm text-amber-200">{warning}</p>
        </div>
      </div>
    </div>
  );
};
