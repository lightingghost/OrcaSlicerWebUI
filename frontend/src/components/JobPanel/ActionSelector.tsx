import React, { useCallback } from 'react';
import { useStore } from '../../store';
import type { Action, ActionFlags } from '../../store';

/**
 * ActionSelector Component
 * 
 * Radio group for selecting the CLI action:
 * - Slice (with plate selector)
 * - Export 3MF (with output filename)
 * - Export STL
 * - Export STLs
 * - Export Settings (with output filename)
 * 
 * Also exposes boolean action flags as checkboxes:
 * - min_save
 * - no_check
 * - normative_check
 * - uptodate
 * - load_defaultfila
 * - enable_timelapse
 * 
 * Reads/writes the shared `actionSlice` in the Zustand store so the
 * selection here is what SubmitButton (and TopBar's Slice/Export buttons)
 * actually submit — previously this used disconnected local state.
 * 
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.6
 */
export const ActionSelector: React.FC = () => {
  const action = useStore((state) => state.action);
  const plateNumber = useStore((state) => state.plateNumber);
  const outputFilename = useStore((state) => state.outputFilename);
  const actionFlags = useStore((state) => state.actionFlags);
  const setAction = useStore((state) => state.setAction);
  const setPlateNumber = useStore((state) => state.setPlateNumber);
  const setOutputFilename = useStore((state) => state.setOutputFilename);
  const setActionFlag = useStore((state) => state.setActionFlag);

  // Handler for action radio button change
  const handleActionChange = useCallback(
    (newAction: Action) => {
      setAction(newAction);
    },
    [setAction]
  );

  // Handler for plate number change
  const handlePlateNumberChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setPlateNumber(parseInt(e.target.value, 10));
    },
    [setPlateNumber]
  );

  // Handler for output filename change
  const handleOutputFilenameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setOutputFilename(e.target.value);
    },
    [setOutputFilename]
  );

  // Handler for action flag checkbox change
  const handleActionFlagChange = useCallback(
    (flagName: keyof ActionFlags) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setActionFlag(flagName, e.target.checked);
    },
    [setActionFlag]
  );

  return (
    <div className="bg-gray-800 p-4 rounded-lg space-y-4">
      <h3 className="text-lg font-semibold text-white mb-3">Action</h3>

      {/* Action Radio Group */}
      <div className="space-y-2">
        {/* Slice */}
        <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="radio"
            name="action"
            value="slice"
            checked={action === 'slice'}
            onChange={() => handleActionChange('slice')}
            className="form-radio bg-gray-700 border-gray-600 text-blue-500"
          />
          <span>Slice</span>
        </label>

        {/* Plate selector - shown only when Slice is selected */}
        {action === 'slice' && (
          <div className="pl-6 mt-2">
            <label className="block text-xs text-gray-400 mb-1">Plate Selection</label>
            <select
              value={plateNumber}
              onChange={handlePlateNumberChange}
              className="w-full px-2 py-1 bg-gray-700 text-white rounded text-sm"
            >
              <option value={0}>All Plates</option>
              <option value={1}>Plate 1</option>
              <option value={2}>Plate 2</option>
              <option value={3}>Plate 3</option>
              <option value={4}>Plate 4</option>
              <option value={5}>Plate 5</option>
              <option value={6}>Plate 6</option>
              <option value={7}>Plate 7</option>
              <option value={8}>Plate 8</option>
            </select>
          </div>
        )}

        {/* Export 3MF */}
        <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="radio"
            name="action"
            value="export_3mf"
            checked={action === 'export_3mf'}
            onChange={() => handleActionChange('export_3mf')}
            className="form-radio bg-gray-700 border-gray-600 text-blue-500"
          />
          <span>Export 3MF</span>
        </label>

        {/* Output filename for Export 3MF */}
        {action === 'export_3mf' && (
          <div className="pl-6 mt-2">
            <label className="block text-xs text-gray-400 mb-1">Output Filename</label>
            <input
              type="text"
              value={outputFilename}
              onChange={handleOutputFilenameChange}
              placeholder="output.3mf"
              className="w-full px-2 py-1 bg-gray-700 text-white rounded text-sm"
            />
          </div>
        )}

        {/* Export STL */}
        <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="radio"
            name="action"
            value="export_stl"
            checked={action === 'export_stl'}
            onChange={() => handleActionChange('export_stl')}
            className="form-radio bg-gray-700 border-gray-600 text-blue-500"
          />
          <span>Export STL</span>
        </label>

        {/* Export STLs */}
        <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="radio"
            name="action"
            value="export_stls"
            checked={action === 'export_stls'}
            onChange={() => handleActionChange('export_stls')}
            className="form-radio bg-gray-700 border-gray-600 text-blue-500"
          />
          <span>Export STLs</span>
        </label>

        {/* Export Settings */}
        <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="radio"
            name="action"
            value="export_settings"
            checked={action === 'export_settings'}
            onChange={() => handleActionChange('export_settings')}
            className="form-radio bg-gray-700 border-gray-600 text-blue-500"
          />
          <span>Export Settings</span>
        </label>

        {/* Output filename for Export Settings */}
        {action === 'export_settings' && (
          <div className="pl-6 mt-2">
            <label className="block text-xs text-gray-400 mb-1">Output Filename</label>
            <input
              type="text"
              value={outputFilename}
              onChange={handleOutputFilenameChange}
              placeholder="output.json"
              className="w-full px-2 py-1 bg-gray-700 text-white rounded text-sm"
            />
          </div>
        )}
      </div>

      {/* Action Flags Section */}
      <div className="border-t border-gray-700 pt-4 space-y-2">
        <h4 className="text-sm font-medium text-gray-300 mb-2">Action Flags</h4>

        <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={actionFlags.min_save ?? false}
            onChange={handleActionFlagChange('min_save')}
            className="form-checkbox bg-gray-700 border-gray-600"
          />
          <span>Minimal Save</span>
        </label>

        <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={actionFlags.no_check ?? false}
            onChange={handleActionFlagChange('no_check')}
            className="form-checkbox bg-gray-700 border-gray-600"
          />
          <span>No Check</span>
        </label>

        <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={actionFlags.normative_check ?? false}
            onChange={handleActionFlagChange('normative_check')}
            className="form-checkbox bg-gray-700 border-gray-600"
          />
          <span>Normative Check</span>
        </label>

        <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={actionFlags.uptodate ?? false}
            onChange={handleActionFlagChange('uptodate')}
            className="form-checkbox bg-gray-700 border-gray-600"
          />
          <span>Up-to-date Check</span>
        </label>

        <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={actionFlags.load_defaultfila ?? false}
            onChange={handleActionFlagChange('load_defaultfila')}
            className="form-checkbox bg-gray-700 border-gray-600"
          />
          <span>Load Default Filament</span>
        </label>

        <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={actionFlags.enable_timelapse ?? false}
            onChange={handleActionFlagChange('enable_timelapse')}
            className="form-checkbox bg-gray-700 border-gray-600"
          />
          <span>Enable Timelapse</span>
        </label>
      </div>
    </div>
  );
};
