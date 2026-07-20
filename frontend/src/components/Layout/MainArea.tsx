/**
 * MainArea Component
 * 
 * The main content area containing:
 * - ViewportContainer: The 3D viewport with model, build plate, and overlays
 * - JobPanel: Action selection, transform controls, and submit button
 * - JobStatusPanel: Progress monitoring and output file download
 * 
 * Validates: Requirements 13.1, 13.4
 */

import React from 'react';
import { ViewportContainer } from '../ViewportContainer';
import {
  ActionSelector,
  TransformPanel,
  AdvancedPanel,
  SubmitButton,
} from '../JobPanel';
import {
  JobProgressModal,
  ProgressBar,
  StatusMessage,
  WarningBanner,
  QueuePositionIndicator,
  OutputFileList,
} from '../Progress';
import { useStore } from '../../store';

export const MainArea: React.FC = () => {
  const { jobStatus, queuePosition, progress, outputFiles, activeJobId } = useStore();

  // Determine if job status panel should be visible
  const showJobStatus = jobStatus && jobStatus !== 'completed';
  const showOutputFiles = jobStatus === 'completed' && outputFiles.length > 0;

  return (
    <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* ViewportContainer - Takes remaining vertical space */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        <ViewportContainer />
      </div>

      {/* JobPanel - Fixed height section at bottom */}
      <div className="flex-shrink-0 bg-gray-800 border-t border-gray-700">
        <div className="flex flex-col lg:flex-row gap-4 p-4">
          {/* Left column: Action + Transform */}
          <div className="flex-1 space-y-4">
            <ActionSelector />
            <TransformPanel />
          </div>

          {/* Right column: Advanced options */}
          <div className="flex-1">
            <AdvancedPanel />
          </div>
        </div>

        {/* Submit Button Row */}
        <div className="px-4 pb-4">
          <SubmitButton />
        </div>
      </div>

      {/* JobStatusPanel - Conditional rendering based on job state */}
      {(showJobStatus || showOutputFiles) && (
        <div className="flex-shrink-0 bg-gray-900 border-t-2 border-purple-600 p-4 space-y-3 max-h-64 overflow-y-auto">
          {/* Queue Position Indicator */}
          {jobStatus === 'queued' && queuePosition !== null && queuePosition !== undefined && (
            <QueuePositionIndicator queuePosition={queuePosition} />
          )}

          {/* Progress Bar */}
          {jobStatus === 'running' && progress && 'total_percent' in progress && (
            <ProgressBar percent={progress.total_percent} />
          )}

          {/* Status Message */}
          {progress && 'message' in progress && progress.message && (
            <StatusMessage message={progress.message} />
          )}

          {/* Warning Banner */}
          {progress && 'warning' in progress && typeof progress.warning === 'string' && (
            <WarningBanner warning={progress.warning} />
          )}

          {/* Output Files List */}
          {showOutputFiles && activeJobId && <OutputFileList jobId={activeJobId} />}
        </div>
      )}

      {/* Job Progress Modal - Shows for active jobs */}
      <JobProgressModal />
    </main>
  );
};
