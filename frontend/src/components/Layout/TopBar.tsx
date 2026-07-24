/**
 * TopBar Component
 * 
 * The main application header containing:
 * - TabNav: Main navigation tabs (Prepare | Preview | Device | Project | Calibration)
 * - Job Options button: opens the CLI-specific options modal
 * - SliceButton: Primary action button (triggers job submission with action='slice')
 * - PrintButton: Secondary action button, disabled until the plate has
 *   been sliced; opens the "Send G-code to printer host" dialog
 *   (see PrintDialog.tsx), matching native OrcaSlicer's Send-to-print
 *   flow instead of a plain file-export dropdown.
 * 
 * Move/Rotate/Scale/Arrange tools AND the "Add model" import button live
 * inside the 3D viewport itself (see ViewportTransformToolbar), not here —
 * matching the native OrcaSlicer desktop UI's layout.
 * 
 * Validates: Requirements 13.1, 13.4, 5.1
 */

import React, { useState } from 'react';
import {
  Play,
  Printer,
  Settings2,
} from 'lucide-react';
import { useStore, findGcodeOutput } from '../../store';
import type { MainTab } from '../../store';
import { JobOptionsModal } from '../JobPanel';
import { OutputFilesDropdown } from './OutputFilesDropdown';
import { PrintDialog } from '../Device/PrintDialog';

interface TopBarProps {
  activeTab?: MainTab;
  onTabChange?: (tab: MainTab) => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab = 'prepare',
  onTabChange,
}) => {
  const [showJobOptions, setShowJobOptions] = useState(false);
  const [showPrintDialog, setShowPrintDialog] = useState(false);

  // Store selectors
  const uploadedFiles = useStore((state) => state.uploadedFiles);
  const selectedPrinterProfile = useStore((state) => state.selectedPrinterProfile);
  const selectedProcessProfile = useStore((state) => state.selectedProcessProfile);
  const selectedFilamentProfiles = useStore((state) => state.selectedFilamentProfiles);
  const parameterOverrides = useStore((state) => state.overrides);
  const transforms = useStore((state) => state.transforms);
  const misc = useStore((state) => state.misc);
  const actionFlags = useStore((state) => state.actionFlags);
  const submitJob = useStore((state) => state.submitJob);
  const plateNumber = useStore((state) => state.plateNumber);
  const activeJobId = useStore((state) => state.activeJobId);
  const jobStatus = useStore((state) => state.jobStatus);
  const outputFiles = useStore((state) => state.outputFiles);

  const tabs: { id: MainTab; label: string }[] = [
    { id: 'prepare', label: 'Prepare' },
    { id: 'preview', label: 'Preview' },
    { id: 'device', label: 'Device' },
    { id: 'project', label: 'Project' },
    { id: 'calibration', label: 'Calibration' },
  ];

  // Check if prerequisites are met for job submission
  const isSubmitDisabled =
    uploadedFiles.length === 0 ||
    !selectedPrinterProfile ||
    !selectedProcessProfile ||
    selectedFilamentProfiles.length === 0;

  // Print is only enabled once the CURRENT job has actually finished
  // slicing and produced a gcode — jobStatus/outputFiles are cleared the
  // moment a new job is submitted (see jobSlice's submitJob), so this
  // naturally re-disables the button the instant the user re-slices,
  // rather than staying enabled from a stale previous slice.
  const slicedGcode = jobStatus === 'completed' ? findGcodeOutput(outputFiles) : null;
  const isPrintDisabled = !activeJobId || !slicedGcode;

  const handleSlice = async () => {
    if (isSubmitDisabled) return;

    try {
      await submitJob({
        // source_file_id (not the synthetic clone file_id) so every
        // instance on the plate — including clones — submits a valid
        // backend file reference.
        file_ids: uploadedFiles.map((f) => f.source_file_id),
        printer_profile_path: selectedPrinterProfile!.path,
        process_profile_path: selectedProcessProfile!.path,
        filament_profile_paths: selectedFilamentProfiles.map((f) => f.path),
        action: 'slice',
        plate_number: plateNumber,
        transforms: transforms as Record<string, unknown>,
        parameter_overrides: parameterOverrides,
        misc: misc as Record<string, unknown>,
        action_flags: actionFlags as Record<string, boolean>,
      });
    } catch (error) {
      console.error('Failed to submit slice job:', error);
      // Error handling could be improved with toast notifications
    }
  };

  const handlePrintClick = () => {
    if (isPrintDisabled) return;
    setShowPrintDialog(true);
  };

  return (
    <header className="bg-gray-800 border-b border-gray-700 h-16 flex items-center px-4 gap-6">
      {/* TabNav - Left Section */}
      <nav className="flex gap-1" role="tablist" aria-label="Main navigation">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`${tab.id}-panel`}
            onClick={() => onTabChange?.(tab.id)}
            className={`
              px-4 py-2 text-sm font-medium rounded transition-colors
              ${
                activeTab === tab.id
                  ? 'bg-purple-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              }
            `}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Note: Move/Rotate/Scale/Arrange tools now live inside the 3D
          viewport itself (see ViewportTransformToolbar), matching the
          native OrcaSlicer desktop UI where these are viewport overlays,
          not top-bar buttons. */}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Action Buttons - Right Section */}
      <div className="flex gap-3">
        {/* Job Options Button - opens the CLI-specific options modal
            (Action/Plate/Transform/Advanced). These options have no native
            OrcaSlicer desktop equivalent, so they live in an on-demand
            dialog instead of a panel docked under the viewport. */}
        <button
          onClick={() => setShowJobOptions(true)}
          className="
            flex items-center gap-2 px-3 py-2 text-sm font-medium
            text-gray-300 hover:bg-gray-700 hover:text-white rounded
            transition-colors
          "
          title="Job options (action, transform, advanced)"
          aria-label="Open job options"
        >
          <Settings2 className="w-4 h-4" />
          Job Options
        </button>

        {/* Output Files - only rendered once a job has completed */}
        <OutputFilesDropdown />

        {/* Print Button (Secondary) — replaces the old Export button.
            Disabled until the current job has actually finished slicing
            and produced a gcode (re-disables itself the moment a new
            slice is submitted, since submitJob clears outputFiles). */}
        <button
          onClick={handlePrintClick}
          disabled={isPrintDisabled}
          className="
            flex items-center gap-2 px-4 py-2 text-sm font-medium
            bg-gray-700 text-white rounded
            hover:bg-gray-600
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors
          "
          title={isPrintDisabled ? 'Slice the plate first to enable printing' : 'Send to printer'}
        >
          <Printer className="w-4 h-4" />
          Print
        </button>

        {/* Slice Button (Primary) */}
        <button
          onClick={handleSlice}
          disabled={isSubmitDisabled}
          className="
            flex items-center gap-2 px-6 py-2 text-sm font-semibold
            bg-purple-600 text-white rounded
            hover:bg-purple-500
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors
            shadow-lg shadow-purple-500/30
          "
          title={
            isSubmitDisabled
              ? 'Upload files and select profiles to enable'
              : 'Start slicing'
          }
        >
          <Play className="w-4 h-4" />
          Slice
        </button>
      </div>

      {/* Job Options Modal */}
      <JobOptionsModal isOpen={showJobOptions} onClose={() => setShowJobOptions(false)} />

      {/* Send G-code to printer host dialog (matches native's
          PrintHostSendDialog — see reference screenshot) */}
      <PrintDialog
        isOpen={showPrintDialog}
        onClose={() => setShowPrintDialog(false)}
        jobId={activeJobId}
        defaultFilename={slicedGcode?.filename ?? ''}
      />
    </header>
  );
};
