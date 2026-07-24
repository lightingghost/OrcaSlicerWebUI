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
import { DevicePage } from '../Device/DevicePage';
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
      {/* ViewportContainer (Prepare tab) is kept permanently mounted and
          toggled via CSS (display: none) rather than conditionally
          rendered — object positions (including manual drag placement)
          live only in the Three.js scene's own mesh transforms, not the
          Zustand store, so unmounting ThreeViewport on every tab switch
          would tear down that scene and force a re-fetch/reload of every
          model from scratch on returning to Prepare.

          PreviewContainer does NOT need this treatment: its toolpath is
          rebuilt purely from store state (parsedGcode/currentLayerIndex/
          currentStepIndex/hiddenRoles/bedSize/bedCenter — see
          PreviewViewport.tsx), so it's conditionally mounted/unmounted
          instead. This also keeps the page's total simultaneous WebGL
          context count at 2 (ThreeViewport's main + gizmo-cube contexts)
          rather than 3 — each extra always-on context is one more that
          can tip a long dev session (repeated Vite HMR teardown/rebuild
          of these components) over the browser's hard per-page WebGL
          context limit, which previously surfaced as an uncaught
          "Error creating WebGL context" crashing the whole app (no
          errorElement is configured on the router, so any thrown render
          error takes down the entire UI) — see also
          ThreeViewport/PreviewViewport's own try/catch around renderer
          creation, added as a second, independent line of defense. */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {/* ViewportContainer's ViewportTransformToolbar overlay is
            absolutely positioned within ThreeViewport, not scoped to
            this wrapper div — it was previously only hidden while on the
            Preview tab, so switching to the Device tab left it visibly
            overlapping DevicePage underneath (confirmed via a real
            browser screenshot: the Add/Move/Rotate/etc toolbar icons and
            a translucent "Connected to..." bar bled through on top of
            the device UI iframe). Must hide ViewportContainer for every
            non-"prepare" tab, not just "preview". */}
        <div className={activeTab === 'prepare' ? 'w-full h-full' : 'hidden'}>
          <ViewportContainer />
        </div>
        {activeTab === 'preview' && (
          <div className="w-full h-full">
            <PreviewContainer />
          </div>
        )}
        {activeTab === 'device' && (
          <div className="absolute inset-0">
            <DevicePage />
          </div>
        )}
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
