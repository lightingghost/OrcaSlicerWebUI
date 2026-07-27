/**
 * TopBar Component
 * 
 * The main application header containing:
 * - TabNav: Main navigation tabs (Prepare | Preview | Device)
 * - Project buttons: New / Import / Download (.3mf) — see ProjectSlice
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

import React, { useRef, useState } from 'react';
import {
  Play,
  Printer,
  Settings2,
  FilePlus2,
  FolderOpen,
  Download,
} from 'lucide-react';
import { useStore, findGcodeOutput } from '../../store';
import type { MainTab } from '../../store';
import { JobOptionsModal } from '../JobPanel';
import { OutputFilesDropdown } from './OutputFilesDropdown';
import { PrintDialog } from '../Device/PrintDialog';
import { serializeParameterValueForCli } from '../../lib/validation';

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
  const importProjectInputRef = useRef<HTMLInputElement>(null);

  // Store selectors
  const uploadedFiles = useStore((state) => state.uploadedFiles);
  const newProject = useStore((state) => state.newProject);
  const importProject = useStore((state) => state.importProject);
  const downloadProject = useStore((state) => state.downloadProject);
  const isProjectActionInProgress = useStore((state) => state.isProjectActionInProgress);
  const selectedPrinterProfile = useStore((state) => state.selectedPrinterProfile);
  const selectedProcessProfile = useStore((state) => state.selectedProcessProfile);
  const selectedFilamentProfiles = useStore((state) => state.selectedFilamentProfiles);
  const parameterOverrides = useStore((state) => state.overrides);
  // Per-object process overrides (Global/Objects toggle) — see
  // SubmitButton.tsx's identical selector / JobInstancePlacement.config_overrides's
  // doc comment for why each object's own delta (not merged with
  // Global) is what gets embedded per-instance below.
  const objectOverrides = useStore((state) => state.objectOverrides);
  const transforms = useStore((state) => state.transforms);
  const misc = useStore((state) => state.misc);
  const actionFlags = useStore((state) => state.actionFlags);
  const submitJob = useStore((state) => state.submitJob);
  const plateNumber = useStore((state) => state.plateNumber);
  const activeJobId = useStore((state) => state.activeJobId);
  const jobStatus = useStore((state) => state.jobStatus);
  const outputFiles = useStore((state) => state.outputFiles);

  // See SubmitButton.tsx's identical selector for why this is needed:
  // without it, the CLI never learns each object's live position and
  // slices raw, unpositioned files instead, which reliably fails with
  // CLI_OBJECTS_PARTLY_INSIDE for 2+ objects (arrange is disabled by
  // default at slice time — see transformSlice.ts).
  const getPlateSnapshot = useStore((state) => state.getPlateSnapshot);

  const tabs: { id: MainTab; label: string }[] = [
    { id: 'prepare', label: 'Prepare' },
    { id: 'preview', label: 'Preview' },
    { id: 'device', label: 'Device' },
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

    // Capture each plate object's LIVE position/rotation/scale from the
    // Three.js scene — see JobRequest.instances's doc comment
    // (jobSlice.ts) and getPlateSnapshot above for the full rationale.
    let instances: NonNullable<Parameters<typeof submitJob>[0]['instances']> | undefined;
    if (getPlateSnapshot) {
      const snapshot = getPlateSnapshot();
      const snapshotByFileId = new Map(snapshot.map((s) => [s.file_id, s]));
      instances = uploadedFiles
        .map((file) => {
          const placement = snapshotByFileId.get(file.file_id);
          if (!placement) return null;
          // This object's own override DELTA (not merged with Global —
          // see JobInstancePlacement.config_overrides's doc comment).
          const ownOverrides = objectOverrides[file.file_id];
          const config_overrides =
            ownOverrides && Object.keys(ownOverrides).length > 0
              ? Object.fromEntries(
                  Object.entries(ownOverrides).map(([key, value]) => [
                    key,
                    serializeParameterValueForCli(value),
                  ])
                )
              : undefined;
          return {
            ...placement,
            instance_id: file.file_id,
            file_id: file.source_file_id,
            ...(config_overrides ? { config_overrides } : {}),
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);
    }

    try {
      await submitJob({
        // source_file_id (not the synthetic clone file_id) so every
        // instance on the plate — including clones — submits a valid
        // backend file reference.
        file_ids: uploadedFiles.map((f) => f.source_file_id),
        instances,
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

  const handleNewProject = () => {
    if (uploadedFiles.length === 0) {
      newProject();
      return;
    }
    // No existing modal-confirm component fits this one-off case — a
    // native browser confirm is a reasonable, low-effort guard against
    // accidentally discarding the current plate (matches native
    // OrcaSlicer, which also prompts before starting a new project over
    // unsaved changes).
    if (window.confirm('Start a new project? This will remove every object currently on the plate.')) {
      newProject();
    }
  };

  const handleImportProjectFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    // Import REPLACES the current plate (matches native OrcaSlicer's
    // File > Import Project opening a fresh project) — guard with the
    // same confirm pattern New Project uses, so switching projects
    // doesn't silently discard unsaved objects.
    if (
      uploadedFiles.length > 0 &&
      !window.confirm('Import this project? This will replace every object currently on the plate.')
    ) {
      return;
    }

    importProject(file).catch((error) => {
      console.error('Failed to import project:', error);
    });
  };

  const handleDownloadProject = () => {
    if (uploadedFiles.length === 0) return;
    downloadProject().catch((error) => {
      console.error('Failed to download project:', error);
    });
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

      {/* Project Buttons — New / Import / Download, backed by a single
          .3mf file (see projectSlice.ts / backend/app/routers/projects.py).
          Grouped separately from the Slice/Print action buttons since
          these operate on the whole plate's file set, not a job. */}
      <div className="flex gap-2 border-l border-gray-700 pl-4">
        <input
          ref={importProjectInputRef}
          type="file"
          accept=".3mf"
          onChange={handleImportProjectFileChange}
          className="hidden"
        />
        <button
          onClick={handleNewProject}
          disabled={isProjectActionInProgress}
          className="
            flex items-center gap-2 px-3 py-2 text-sm font-medium
            text-gray-300 hover:bg-gray-700 hover:text-white rounded
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors
          "
          title="New project (clears the plate)"
          aria-label="New project"
        >
          <FilePlus2 className="w-4 h-4" />
          New
        </button>
        <button
          onClick={() => importProjectInputRef.current?.click()}
          disabled={isProjectActionInProgress}
          className="
            flex items-center gap-2 px-3 py-2 text-sm font-medium
            text-gray-300 hover:bg-gray-700 hover:text-white rounded
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors
          "
          title="Import project (.3mf)"
          aria-label="Import project"
        >
          <FolderOpen className="w-4 h-4" />
          Import
        </button>
        <button
          onClick={handleDownloadProject}
          disabled={isProjectActionInProgress || uploadedFiles.length === 0}
          className="
            flex items-center gap-2 px-3 py-2 text-sm font-medium
            text-gray-300 hover:bg-gray-700 hover:text-white rounded
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors
          "
          title={uploadedFiles.length === 0 ? 'Add objects to the plate first' : 'Download project (.3mf)'}
          aria-label="Download project"
        >
          <Download className="w-4 h-4" />
          Download
        </button>
      </div>

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
