import React from 'react';

/**
 * ProgressBar Component
 * 
 * Displays a horizontal progress bar with percentage text.
 * Used within JobProgressModal to show slicing progress.
 * 
 * @param percent - Progress value from 0 to 100
 */

interface ProgressBarProps {
  percent: number;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ percent }) => {
  // Clamp percentage between 0 and 100
  const clampedPercent = Math.max(0, Math.min(100, percent));

  return (
    <div className="w-full">
      {/* Progress bar container */}
      <div className="relative h-8 w-full overflow-hidden rounded-lg bg-gray-700">
        {/* Progress fill */}
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300 ease-out"
          style={{ width: `${clampedPercent}%` }}
        />
        
        {/* Percentage text overlay */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-semibold text-white drop-shadow-md">
            {clampedPercent.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
};
