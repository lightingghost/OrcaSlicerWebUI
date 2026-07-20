import React, { useState, useCallback } from 'react';
import { useStore } from '../../store';
import { MiscOptions } from '../../store/miscSlice';

/**
 * AdvancedPanel Component
 * 
 * Collapsible drawer containing controls for all MiscOptions:
 * - datadir: text input
 * - debug: dropdown (0-5)
 * - load_custom_gcodes: file upload
 * - load_filament_ids: comma-separated integer input
 * - skip_objects: comma-separated integer input (validate each is positive integer)
 * - clone_objects: comma-separated integer input (validate each is positive integer)
 * - Boolean checkboxes for:
 *   - allow_newer_file
 *   - allow_mix_temp
 *   - skip_modified_gcodes
 *   - downward_check
 *   - enable_timelapse
 * 
 * Validates: Requirements 10.1, 10.4
 */
export const AdvancedPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  
  const misc = useStore((state) => state.misc);
  const setMiscOption = useStore((state) => state.setMiscOption);
  const miscValidationErrors = useStore((state) => state.miscValidationErrors);
  const setMiscValidationError = useStore((state) => state.setMiscValidationError);

  // Local input values for comma-separated lists (displayed as strings)
  const [filamentIdsInput, setFilamentIdsInput] = useState(
    misc.load_filament_ids?.join(', ') || ''
  );
  const [skipObjectsInput, setSkipObjectsInput] = useState(
    misc.skip_objects?.join(', ') || ''
  );
  const [cloneObjectsInput, setCloneObjectsInput] = useState(
    misc.clone_objects?.join(', ') || ''
  );

  // Toggle drawer open/closed
  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  // Handler for text input changes
  const handleTextChange = useCallback(
    (key: keyof MiscOptions) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setMiscOption(key, e.target.value || undefined);
    },
    [setMiscOption]
  );

  // Handler for debug level dropdown
  const handleDebugChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      setMiscOption('debug', value === '' ? undefined : (parseInt(value, 10) as 0 | 1 | 2 | 3 | 4 | 5));
    },
    [setMiscOption]
  );

  // Handler for boolean checkbox changes
  const handleBooleanChange = useCallback(
    (key: keyof MiscOptions) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setMiscOption(key, e.target.checked);
    },
    [setMiscOption]
  );

  // Handler for file upload (custom gcodes)
  const handleCustomGcodesUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // In a real implementation, this would upload the file to the backend
      // and get back a file_id. For now, we'll use a placeholder.
      try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/files/upload', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
          },
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`Upload failed: ${response.status}`);
        }

        const data = await response.json();
        setMiscOption('load_custom_gcodes_file_id', data.file_id);
      } catch (error) {
        console.error('Failed to upload custom gcodes file:', error);
        // Could show error to user here
      }
    },
    [setMiscOption]
  );

  // Validate and parse comma-separated positive integers
  const validatePositiveIntegers = (input: string): { valid: boolean; values?: number[]; error?: string } => {
    if (!input.trim()) {
      return { valid: true, values: undefined };
    }

    const parts = input.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    const values: number[] = [];

    for (const part of parts) {
      const num = parseInt(part, 10);
      if (isNaN(num) || num <= 0 || !Number.isInteger(parseFloat(part))) {
        return { valid: false, error: `"${part}" is not a positive integer` };
      }
      values.push(num);
    }

    return { valid: true, values: values.length > 0 ? values : undefined };
  };

  // Handler for load_filament_ids input
  const handleFilamentIdsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target.value;
      setFilamentIdsInput(input);

      const result = validatePositiveIntegers(input);
      if (result.valid) {
        setMiscOption('load_filament_ids', result.values);
        setMiscValidationError('load_filament_ids', undefined);
      } else {
        setMiscValidationError('load_filament_ids', result.error);
      }
    },
    [setMiscOption, setMiscValidationError]
  );

  // Handler for skip_objects input
  const handleSkipObjectsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target.value;
      setSkipObjectsInput(input);

      const result = validatePositiveIntegers(input);
      if (result.valid) {
        setMiscOption('skip_objects', result.values);
        setMiscValidationError('skip_objects', undefined);
      } else {
        setMiscValidationError('skip_objects', result.error);
      }
    },
    [setMiscOption, setMiscValidationError]
  );

  // Handler for clone_objects input
  const handleCloneObjectsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target.value;
      setCloneObjectsInput(input);

      const result = validatePositiveIntegers(input);
      if (result.valid) {
        setMiscOption('clone_objects', result.values);
        setMiscValidationError('clone_objects', undefined);
      } else {
        setMiscValidationError('clone_objects', result.error);
      }
    },
    [setMiscOption, setMiscValidationError]
  );

  return (
    <div className="bg-gray-800 rounded-lg">
      {/* Collapsible Header */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between p-4 text-white hover:bg-gray-750 transition-colors rounded-lg"
        aria-expanded={isOpen}
      >
        <h3 className="text-lg font-semibold">Advanced Options</h3>
        <svg
          className={`w-5 h-5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Collapsible Content */}
      {isOpen && (
        <div className="p-4 pt-0 space-y-4">
          {/* Data Directory */}
          <div>
            <label htmlFor="misc-datadir" className="block text-sm font-medium text-gray-300 mb-1">
              Data Directory
            </label>
            <input
              id="misc-datadir"
              type="text"
              value={misc.datadir || ''}
              onChange={handleTextChange('datadir')}
              placeholder="/path/to/data"
              className="w-full px-3 py-2 bg-gray-700 text-white rounded text-sm border border-gray-600 focus:border-blue-500 focus:outline-none"
            />
            <p className="text-xs text-gray-400 mt-1">
              Custom data directory for OrcaSlicer resources
            </p>
          </div>

          {/* Debug Level */}
          <div>
            <label htmlFor="misc-debug" className="block text-sm font-medium text-gray-300 mb-1">
              Debug Level
            </label>
            <select
              id="misc-debug"
              value={misc.debug ?? ''}
              onChange={handleDebugChange}
              className="w-full px-3 py-2 bg-gray-700 text-white rounded text-sm border border-gray-600 focus:border-blue-500 focus:outline-none"
            >
              <option value="">None</option>
              <option value="0">0 - Minimal</option>
              <option value="1">1 - Low</option>
              <option value="2">2 - Medium</option>
              <option value="3">3 - High</option>
              <option value="4">4 - Very High</option>
              <option value="5">5 - Maximum</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Set CLI debug verbosity level (0-5)
            </p>
          </div>

          {/* Load Custom G-codes */}
          <div>
            <label htmlFor="misc-custom-gcodes" className="block text-sm font-medium text-gray-300 mb-1">
              Load Custom G-codes
            </label>
            <input
              id="misc-custom-gcodes"
              type="file"
              accept=".json"
              onChange={handleCustomGcodesUpload}
              className="w-full px-3 py-2 bg-gray-700 text-white rounded text-sm border border-gray-600 focus:border-blue-500 focus:outline-none file:mr-4 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:bg-blue-600 file:text-white hover:file:bg-blue-700"
            />
            <p className="text-xs text-gray-400 mt-1">
              Upload custom G-code JSON file
            </p>
            {misc.load_custom_gcodes_file_id && (
              <p className="text-xs text-green-400 mt-1">
                File uploaded: {misc.load_custom_gcodes_file_id}
              </p>
            )}
          </div>

          {/* Load Filament IDs */}
          <div>
            <label htmlFor="misc-filament-ids" className="block text-sm font-medium text-gray-300 mb-1">
              Load Filament IDs
            </label>
            <input
              id="misc-filament-ids"
              type="text"
              value={filamentIdsInput}
              onChange={handleFilamentIdsChange}
              placeholder="1, 2, 3"
              className={`w-full px-3 py-2 bg-gray-700 text-white rounded text-sm border ${
                miscValidationErrors.load_filament_ids
                  ? 'border-red-500 focus:border-red-500'
                  : 'border-gray-600 focus:border-blue-500'
              } focus:outline-none`}
            />
            {miscValidationErrors.load_filament_ids && (
              <p className="text-xs text-red-400 mt-1">
                {miscValidationErrors.load_filament_ids}
              </p>
            )}
            <p className="text-xs text-gray-400 mt-1">
              Comma-separated list of positive integers
            </p>
          </div>

          {/* Skip Objects */}
          <div>
            <label htmlFor="misc-skip-objects" className="block text-sm font-medium text-gray-300 mb-1">
              Skip Objects
            </label>
            <input
              id="misc-skip-objects"
              type="text"
              value={skipObjectsInput}
              onChange={handleSkipObjectsChange}
              placeholder="1, 2, 3"
              className={`w-full px-3 py-2 bg-gray-700 text-white rounded text-sm border ${
                miscValidationErrors.skip_objects
                  ? 'border-red-500 focus:border-red-500'
                  : 'border-gray-600 focus:border-blue-500'
              } focus:outline-none`}
            />
            {miscValidationErrors.skip_objects && (
              <p className="text-xs text-red-400 mt-1">
                {miscValidationErrors.skip_objects}
              </p>
            )}
            <p className="text-xs text-gray-400 mt-1">
              Comma-separated list of positive integers
            </p>
          </div>

          {/* Clone Objects */}
          <div>
            <label htmlFor="misc-clone-objects" className="block text-sm font-medium text-gray-300 mb-1">
              Clone Objects
            </label>
            <input
              id="misc-clone-objects"
              type="text"
              value={cloneObjectsInput}
              onChange={handleCloneObjectsChange}
              placeholder="1, 2, 3"
              className={`w-full px-3 py-2 bg-gray-700 text-white rounded text-sm border ${
                miscValidationErrors.clone_objects
                  ? 'border-red-500 focus:border-red-500'
                  : 'border-gray-600 focus:border-blue-500'
              } focus:outline-none`}
            />
            {miscValidationErrors.clone_objects && (
              <p className="text-xs text-red-400 mt-1">
                {miscValidationErrors.clone_objects}
              </p>
            )}
            <p className="text-xs text-gray-400 mt-1">
              Comma-separated list of positive integers
            </p>
          </div>

          {/* Boolean Options */}
          <div className="space-y-2 border-t border-gray-700 pt-4">
            <h4 className="text-sm font-medium text-gray-300 mb-2">Flags</h4>

            <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={misc.allow_newer_file ?? false}
                onChange={handleBooleanChange('allow_newer_file')}
                className="form-checkbox bg-gray-700 border-gray-600 text-blue-500"
              />
              <span>Allow Newer File</span>
            </label>

            <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={misc.allow_mix_temp ?? false}
                onChange={handleBooleanChange('allow_mix_temp')}
                className="form-checkbox bg-gray-700 border-gray-600 text-blue-500"
              />
              <span>Allow Mixed Temperature</span>
            </label>

            <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={misc.skip_modified_gcodes ?? false}
                onChange={handleBooleanChange('skip_modified_gcodes')}
                className="form-checkbox bg-gray-700 border-gray-600 text-blue-500"
              />
              <span>Skip Modified G-codes</span>
            </label>

            <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={misc.downward_check ?? false}
                onChange={handleBooleanChange('downward_check')}
                className="form-checkbox bg-gray-700 border-gray-600 text-blue-500"
              />
              <span>Downward Check</span>
            </label>

            <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={misc.enable_timelapse ?? false}
                onChange={handleBooleanChange('enable_timelapse')}
                className="form-checkbox bg-gray-700 border-gray-600 text-blue-500"
              />
              <span>Enable Timelapse</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
};
