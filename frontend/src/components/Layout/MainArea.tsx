/**
 * MainArea Component
 * 
 * The main content area containing:
 * - ViewportContainer: The 3D viewport with model, build plate, and overlays
 *   (this fills essentially the entire main area, matching the native
 *   OrcaSlicer desktop layout, which has no panel docked under the
 *   viewport — CLI-specific job options are opened on demand via
 *   JobOptionsModal instead, see TopBar)
 * - JobStatusPanel: Progress monitoring and output file download
 * 
 * Validates: Requirements 13.1, 13.4
 */

import React from 'react';
import { ViewportContainer } from '../ViewportContainer';
import { PreviewContainer } from '../Preview/PreviewContainer';
import {
  JobProgressModal,
  ProgressBar,
  StatusMessage,
  WarningBanner,
  QueuePositionIndicator,
} from '../Progress';
import { useStore } from '../../store';

export const MainArea: React.FC = () => {
  const { jobStatus, queuePosition, progress, activeTab } = useStore();

  // Determine if job status panel should be visible. Completed jobs'
  // output files are no longer shown here — see TopBar's
  // OutputFilesDropdown, docked under the Export button (matching native
  // OrcaSlicer, which surfaces exported/sliced file access near its
  // Export action rather than as a panel under the viewport).
  const showJobStatus = jobStatus && jobStatus !== 'completed';

  return (
    <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* ViewportContainer (Prepare tab) and PreviewContainer (Preview
          tab) are both kept mounted at all times and toggled via CSS
          (display: none), rather than conditionally rendered. Object
          positions (including manual drag placement) live only in the
          Three.js scene's own mesh transforms, not in the Zustand store —
          conditionally unmounting ThreeViewport on every tab switch would
          tear down that scene, so coming back to Prepare would re-fetch
          and reload each model from scratch, discarding wherever the user
          had actually placed it and resetting to the loader's default
          centered position. Keeping both mounted preserves viewport state
          exactly like native OrcaSlicer's Prepare/Preview tabs do. */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        <div className={activeTab === 'preview' ? 'hidden' : 'w-full h-full'}>
          <ViewportContainer />
        </div>
        <div className={activeTab === 'preview' ? 'w-full h-full' : 'hidden'}>
          <PreviewContainer />
        </div>
      </div>

      {/* JobStatusPanel - Conditional rendering based on job state */}
      {showJobStatus && (
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
        </div>
      )}

      {/* Job Progress Modal - Shows for active jobs */}
      <JobProgressModal />
    </main>
  );
};
