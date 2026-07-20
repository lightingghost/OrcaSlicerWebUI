import React, { useCallback } from 'react';

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
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.6
 */

type Action = 'slice' | 'export_3mf' | 'export_stl' | 'export_stls' | 'export_settings';

interface ActionState {
  action: Action;
  plateNumber: number;
  outputFilename: string;
  actionFlags: {
    min_save: boolean;
    no_check: boolean;
    normative_check: boolean;
    uptodate: boolean;
    load_defaultfila: boolean;
    enable_timelapse: boolean;
  };
}

export const ActionSelector: React.FC = () => {
  // For now, we'll use local state management
  // In a real implementation, this would be part of the Zustand store
  const [actionState, setActionState] = React.useState<ActionState>({
    action: 'slice',
    plateNumber: 0,
    outputFilename: '',
    actionFlags: {
      min_save: false,
      no_check: false,
      normative_check: false,
      uptodate: false,
      load_defaultfila: false,
      enable_timelapse: false,
    },
  });

  // Handler for action radio button change
  const handleActionChange = useCallback((newAction: Action) => {
    setActionState((prev) => ({
      ...prev,
      action: newAction,
      // Pre-fill default output filenames
      outputFilename:
        newAction === 'export_3mf'
          ? 'output.3mf'
          : newAction === 'export_settings'
          ? 'output.json'
          : prev.outputFilename,
    }));
  }, []);

  // Handler for plate number change
  const handlePlateNumberChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setActionState((prev) => ({
      ...prev,
      plateNumber: parseInt(e.target.value, 10),
    }));
  }, []);

  // Handler for output filename change
  const handleOutputFilenameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setActionState((prev) => ({
      ...prev,
      outputFilename: e.target.value,
    }));
  }, []);

  // Handler for action flag checkbox change
  const handleActionFlagChange = useCallback(
    (flagName: keyof ActionState['actionFlags']) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setActionState((prev) => ({
        ...prev,
        actionFlags: {
          ...prev.actionFlags,
          [flagName]: e.target.checked,
        },
      }));
    },
    []
  );

  const { action, plateNumber, outputFilename, actionFlags } = actionState;

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
            checked={actionFlags.min_save}
            onChange={handleActionFlagChange('min_save')}
            className="form-checkbox bg-gray-700 border-gray-600"
          />
          <span>Minimal Save</span>
        </label>

        <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={actionFlags.no_check}
            onChange={handleActionFlagChange('no_check')}
            className="form-checkbox bg-gray-700 border-gray-600"
          />
          <span>No Check</span>
        </label>

        <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={actionFlags.normative_check}
            onChange={handleActionFlagChange('normative_check')}
            className="form-checkbox bg-gray-700 border-gray-600"
          />
          <span>Normative Check</span>
        </label>

        <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={actionFlags.uptodate}
            onChange={handleActionFlagChange('uptodate')}
            className="form-checkbox bg-gray-700 border-gray-600"
          />
          <span>Up-to-date Check</span>
        </label>

        <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={actionFlags.load_defaultfila}
            onChange={handleActionFlagChange('load_defaultfila')}
            className="form-checkbox bg-gray-700 border-gray-600"
          />
          <span>Load Default Filament</span>
        </label>

        <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={actionFlags.enable_timelapse}
            onChange={handleActionFlagChange('enable_timelapse')}
            className="form-checkbox bg-gray-700 border-gray-600"
          />
          <span>Enable Timelapse</span>
        </label>
      </div>
    </div>
  );
};
