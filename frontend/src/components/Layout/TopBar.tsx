/**
 * TopBar Component
 * 
 * The main application header containing:
 * - TabNav: Main navigation tabs (Prepare | Preview | Device | Project | Calibration)
 * - Job Options button: opens the CLI-specific options modal
 * - SliceButton: Primary action button (triggers job submission with action='slice')
 * - ExportButton: Secondary action button
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
  Download,
  ChevronDown,
  Settings2,
} from 'lucide-react';
import { useStore } from '../../store';
import type { Action, MainTab } from '../../store';
import { JobOptionsModal } from '../JobPanel';
import { OutputFilesDropdown } from './OutputFilesDropdown';

interface TopBarProps {
  activeTab?: MainTab;
  onTabChange?: (tab: MainTab) => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab = 'prepare',
  onTabChange,
}) => {
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showJobOptions, setShowJobOptions] = useState(false);

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
  const setAction = useStore((state) => state.setAction);
  const plateNumber = useStore((state) => state.plateNumber);
  const outputFilename = useStore((state) => state.outputFilename);

  const tabs: { id: MainTab; label: string }[] = [
    { id: 'prepare', label: 'Prepare' },
    { id: 'preview', label: 'Preview' },
    { id: 'device', label: 'Device' },
    { id: 'project', label: 'Project' },
    { id: 'calibration', label: 'Calibration' },
  ];

  const exportActions: { id: Action; label: string }[] = [
    { id: 'export_3mf', label: 'Export 3MF' },
    { id: 'export_stl', label: 'Export STL' },
    { id: 'export_stls', label: 'Export STLs' },
    { id: 'export_settings', label: 'Export Settings' },
  ];

  // Check if prerequisites are met for job submission
  const isSubmitDisabled =
    uploadedFiles.length === 0 ||
    !selectedPrinterProfile ||
    !selectedProcessProfile ||
    selectedFilamentProfiles.length === 0;

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

  const handleExport = async (exportAction: Action) => {
    if (isSubmitDisabled) return;

    try {
      // Set the action in store first
      setAction(exportAction);

      await submitJob({
        file_ids: uploadedFiles.map((f) => f.source_file_id),
        printer_profile_path: selectedPrinterProfile!.path,
        process_profile_path: selectedProcessProfile!.path,
        filament_profile_paths: selectedFilamentProfiles.map((f) => f.path),
        action: exportAction,
        output_filename: outputFilename || undefined,
        transforms: transforms as Record<string, unknown>,
        parameter_overrides: parameterOverrides,
        misc: misc as Record<string, unknown>,
        action_flags: actionFlags as Record<string, boolean>,
      });

      setShowExportMenu(false);
    } catch (error) {
      console.error('Failed to submit export job:', error);
      // Error handling could be improved with toast notifications
    }
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

        {/* Export Button (Secondary) with Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowExportMenu(!showExportMenu)}
            disabled={isSubmitDisabled}
            className="
              flex items-center gap-2 px-4 py-2 text-sm font-medium
              bg-gray-700 text-white rounded
              hover:bg-gray-600
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors
            "
            title={
              isSubmitDisabled
                ? 'Upload files and select profiles to enable'
                : 'Export options'
            }
          >
            <Download className="w-4 h-4" />
            Export
            <ChevronDown className="w-3 h-3" />
          </button>

          {/* Export Dropdown Menu */}
          {showExportMenu && !isSubmitDisabled && (
            <div className="absolute right-0 mt-2 w-48 bg-gray-700 rounded-md shadow-lg z-50 border border-gray-600">
              <div className="py-1">
                {exportActions.map((action) => (
                  <button
                    key={action.id}
                    onClick={() => handleExport(action.id)}
                    className="
                      block w-full text-left px-4 py-2 text-sm text-gray-200
                      hover:bg-gray-600 transition-colors
                    "
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

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
    </header>
  );
};
