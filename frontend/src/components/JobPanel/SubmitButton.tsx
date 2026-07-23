import React, { useMemo, useState } from 'react';
import { useStore } from '../../store';
import type { JobRequest } from '../../store';

/**
 * SubmitButton Component
 * 
 * Primary CTA button that submits a slicing job.
 * 
 * Disabled Conditions (Requirement 2.3, 6.1):
 * - No files uploaded
 * - No printer profile selected
 * - No process profile selected
 * - No filament profiles selected
 * - Any validation error exists (parameter overrides or misc options)
 * 
 * On Click (Requirement 6.1):
 * - Assembles JobRequest from all relevant store slices
 * - Calls jobSlice.submitJob with the assembled request
 * - Displays loading spinner during submission
 * 
 * Validates: Requirements 2.3, 6.1
 */
export const SubmitButton: React.FC = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // File slice
  const uploadedFiles = useStore((state) => state.uploadedFiles);

  // Profile slice
  const selectedPrinterProfile = useStore((state) => state.selectedPrinterProfile);
  const selectedProcessProfile = useStore((state) => state.selectedProcessProfile);
  const selectedFilamentProfiles = useStore((state) => state.selectedFilamentProfiles);

  // Parameter slice
  const parameterOverrides = useStore((state) => state.overrides);
  const validationErrors = useStore((state) => state.validationErrors);

  // Misc slice
  const misc = useStore((state) => state.misc);
  const miscValidationErrors = useStore((state) => state.miscValidationErrors);

  // Transform slice
  const transforms = useStore((state) => state.transforms);

  // Action slice
  const action = useStore((state) => state.action);
  const plateNumber = useStore((state) => state.plateNumber);
  const outputFilename = useStore((state) => state.outputFilename);
  const actionFlags = useStore((state) => state.actionFlags);

  // Job slice
  const submitJob = useStore((state) => state.submitJob);

  // Compute disabled state
  const isDisabled = useMemo(() => {
    // No files uploaded
    if (uploadedFiles.length === 0) {
      return true;
    }

    // No printer profile selected
    if (!selectedPrinterProfile) {
      return true;
    }

    // No process profile selected
    if (!selectedProcessProfile) {
      return true;
    }

    // No filament profiles selected
    if (selectedFilamentProfiles.length === 0) {
      return true;
    }

    // Any parameter validation errors
    if (Object.keys(validationErrors).length > 0) {
      return true;
    }

    // Any misc validation errors
    if (Object.keys(miscValidationErrors).length > 0) {
      return true;
    }

    return false;
  }, [
    uploadedFiles,
    selectedPrinterProfile,
    selectedProcessProfile,
    selectedFilamentProfiles,
    validationErrors,
    miscValidationErrors,
  ]);

  // Assemble JobRequest
  const assembleJobRequest = (): JobRequest => {
    // Use source_file_id (the real backend file) for every plate object,
    // including clones — a clone's synthetic file_id was never uploaded,
    // but repeating its source file's id here still submits one CLI
    // argument per instance on the plate, matching native's "N instances"
    // semantics.
    const file_ids = uploadedFiles.map((file) => file.source_file_id);

    const printer_profile_path = selectedPrinterProfile!.path;
    const process_profile_path = selectedProcessProfile!.path;
    const filament_profile_paths = selectedFilamentProfiles.map((profile) => profile.path);

    const request: JobRequest = {
      file_ids,
      printer_profile_path,
      process_profile_path,
      filament_profile_paths,
      action,
      parameter_overrides: parameterOverrides,
    };

    // Add plate_number for slice action
    if (action === 'slice') {
      request.plate_number = plateNumber;
    }

    // Add output_filename for export_3mf and export_settings
    if (action === 'export_3mf' || action === 'export_settings') {
      request.output_filename = outputFilename;
    }

    // Add transforms if any are set (exclude defaults)
    const transformEntries = Object.entries(transforms).filter(([key, value]) => {
      // Only include non-default values
      if (value === undefined || value === null) return false;
      if (key === 'rotate' && value === 0) return false;
      if (key === 'rotate_x' && value === 0) return false;
      if (key === 'rotate_y' && value === 0) return false;
      if (key === 'scale' && value === 1) return false;
      if (key === 'arrange' && value === 0) return false;
      if (key === 'orient' && value === 0) return false;
      if (key === 'repetitions' && value === 1) return false;
      if (typeof value === 'boolean' && !value) return false;
      return true;
    });

    if (transformEntries.length > 0) {
      request.transforms = Object.fromEntries(transformEntries);
    }

    // Add misc options if any are set
    const miscEntries = Object.entries(misc).filter(([_, value]) => {
      if (value === undefined || value === null) return false;
      if (typeof value === 'boolean' && !value) return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    });

    if (miscEntries.length > 0) {
      request.misc = Object.fromEntries(miscEntries);
    }

    // Add action flags if any are set
    const actionFlagEntries = Object.entries(actionFlags).filter(([_, value]) => value === true);

    if (actionFlagEntries.length > 0) {
      request.action_flags = Object.fromEntries(actionFlagEntries);
    }

    return request;
  };

  // Handle submit
  const handleSubmit = async () => {
    if (isDisabled || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const jobRequest = assembleJobRequest();
      await submitJob(jobRequest);
      // Success - the job is now submitted and progress tracking is auto-connected
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to submit job';
      setError(errorMessage);
      console.error('Job submission error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        onClick={handleSubmit}
        disabled={isDisabled || isSubmitting}
        className={`
          w-full py-3 px-4 rounded-lg font-semibold text-white
          transition-all duration-200
          flex items-center justify-center space-x-2
          ${
            isDisabled || isSubmitting
              ? 'bg-gray-600 cursor-not-allowed opacity-50'
              : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
          }
        `}
      >
        {isSubmitting ? (
          <>
            <svg
              className="animate-spin h-5 w-5 text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span>Submitting...</span>
          </>
        ) : (
          <span>Submit Job</span>
        )}
      </button>

      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-200 px-3 py-2 rounded text-sm">
          {error}
        </div>
      )}

      {isDisabled && !isSubmitting && (
        <div className="text-xs text-gray-400 space-y-1">
          <p className="font-semibold">Job submission disabled:</p>
          <ul className="list-disc list-inside space-y-0.5 pl-2">
            {uploadedFiles.length === 0 && <li>No files uploaded</li>}
            {!selectedPrinterProfile && <li>No printer profile selected</li>}
            {!selectedProcessProfile && <li>No process profile selected</li>}
            {selectedFilamentProfiles.length === 0 && <li>No filament profiles selected</li>}
            {Object.keys(validationErrors).length > 0 && (
              <li>Parameter validation errors: {Object.keys(validationErrors).join(', ')}</li>
            )}
            {Object.keys(miscValidationErrors).length > 0 && (
              <li>Misc option validation errors: {Object.keys(miscValidationErrors).join(', ')}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
