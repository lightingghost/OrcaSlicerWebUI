import { useMemo, useCallback } from 'react';
import { useStore } from '../../store';
import { TransformOptions } from '../../store/transformSlice';

/**
 * TransformPanel Component
 * 
 * Controls for all transform options:
 * - rotate, rotate_x, rotate_y (degrees)
 * - scale (scale factor)
 * - arrange (0/1/2)
 * - orient (0/1/2)
 * - repetitions
 * - Boolean flags: ensure_on_bed, assemble, convert_unit
 * - Arrange sub-options (shown when arrange === 1 or 2):
 *   - allow_rotations
 *   - allow_multicolor_oneplate
 *   - avoid_extrusion_cali_region
 * 
 * All inputs are debounced with 50ms delay to ensure viewport updates
 * stay under the 100ms requirement (Property 19).
 */
export const TransformPanel: React.FC = () => {
  const transforms = useStore((state) => state.transforms);
  const setTransform = useStore((state) => state.setTransform);

  // Debounced setTransform with 50ms delay
  // We use a simple timeout-based debounce to keep dependencies minimal
  // Each key has its own debounce timer
  const debouncedSetTransform = useMemo(() => {
    const timeouts: Record<string, ReturnType<typeof setTimeout>> = {};

    return (key: keyof TransformOptions, value: unknown) => {
      if (timeouts[key]) {
        clearTimeout(timeouts[key]);
      }

      timeouts[key] = setTimeout(() => {
        setTransform(key, value);
        delete timeouts[key];
      }, 50); // 50ms debounce delay
    };
  }, [setTransform]);

  // Handler for numeric inputs
  const handleNumberChange = useCallback(
    (key: keyof TransformOptions) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseFloat(e.target.value);
      if (!isNaN(value)) {
        debouncedSetTransform(key, value);
      }
    },
    [debouncedSetTransform]
  );

  // Handler for boolean inputs
  const handleBooleanChange = useCallback(
    (key: keyof TransformOptions) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setTransform(key, e.target.checked);
    },
    [setTransform]
  );

  // Handler for select inputs (arrange, orient)
  const handleSelectChange = useCallback(
    (key: keyof TransformOptions) => (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = parseInt(e.target.value, 10);
      setTransform(key, value as 0 | 1 | 2);
    },
    [setTransform]
  );

  // Show arrange sub-options only when arrange is 1 or 2
  const showArrangeOptions = transforms.arrange === 1 || transforms.arrange === 2;

  return (
    <div className="bg-gray-800 p-4 rounded-lg space-y-4">
      <h3 className="text-lg font-semibold text-white mb-3">Transform Options</h3>

      {/* Rotation Controls */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-gray-300">Rotation (degrees)</h4>
        
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label htmlFor="rotate-z" className="block text-xs text-gray-400 mb-1">Z-axis</label>
            <input
              id="rotate-z"
              type="number"
              defaultValue={transforms.rotate ?? 0}
              onChange={handleNumberChange('rotate')}
              className="w-full px-2 py-1 bg-gray-700 text-white rounded text-sm"
              step="1"
            />
          </div>

          <div>
            <label htmlFor="rotate-x" className="block text-xs text-gray-400 mb-1">X-axis</label>
            <input
              id="rotate-x"
              type="number"
              defaultValue={transforms.rotate_x ?? 0}
              onChange={handleNumberChange('rotate_x')}
              className="w-full px-2 py-1 bg-gray-700 text-white rounded text-sm"
              step="1"
            />
          </div>

          <div>
            <label htmlFor="rotate-y" className="block text-xs text-gray-400 mb-1">Y-axis</label>
            <input
              id="rotate-y"
              type="number"
              defaultValue={transforms.rotate_y ?? 0}
              onChange={handleNumberChange('rotate_y')}
              className="w-full px-2 py-1 bg-gray-700 text-white rounded text-sm"
              step="1"
            />
          </div>
        </div>
      </div>

      {/* Scale Control */}
      <div>
        <label htmlFor="scale-factor" className="block text-sm font-medium text-gray-300 mb-1">
          Scale Factor
        </label>
        <input
          id="scale-factor"
          type="number"
          defaultValue={transforms.scale ?? 1}
          onChange={handleNumberChange('scale')}
          className="w-full px-2 py-1 bg-gray-700 text-white rounded text-sm"
          step="0.1"
          min="0.1"
        />
      </div>

      {/* Arrange Control */}
      <div>
        <label htmlFor="arrange-mode" className="block text-sm font-medium text-gray-300 mb-1">
          Arrange Mode
        </label>
        <select
          id="arrange-mode"
          value={transforms.arrange ?? 0}
          onChange={handleSelectChange('arrange')}
          className="w-full px-2 py-1 bg-gray-700 text-white rounded text-sm"
        >
          <option value={0}>Disabled (0)</option>
          <option value={1}>Mode 1</option>
          <option value={2}>Mode 2</option>
        </select>
      </div>

      {/* Arrange Sub-Options (conditional) */}
      {showArrangeOptions && (
        <div className="pl-4 border-l-2 border-gray-600 space-y-2">
          <h4 className="text-sm font-medium text-gray-300">Arrange Options</h4>
          
          <label className="flex items-center space-x-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={transforms.allow_rotations ?? false}
              onChange={handleBooleanChange('allow_rotations')}
              className="form-checkbox bg-gray-700 border-gray-600"
            />
            <span>Allow Rotations</span>
          </label>

          <label className="flex items-center space-x-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={transforms.allow_multicolor_oneplate ?? false}
              onChange={handleBooleanChange('allow_multicolor_oneplate')}
              className="form-checkbox bg-gray-700 border-gray-600"
            />
            <span>Allow Multicolor One Plate</span>
          </label>

          <label className="flex items-center space-x-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={transforms.avoid_extrusion_cali_region ?? false}
              onChange={handleBooleanChange('avoid_extrusion_cali_region')}
              className="form-checkbox bg-gray-700 border-gray-600"
            />
            <span>Avoid Extrusion Calibration Region</span>
          </label>
        </div>
      )}

      {/* Orient Control */}
      <div>
        <label htmlFor="orient-mode" className="block text-sm font-medium text-gray-300 mb-1">
          Orient Mode
        </label>
        <select
          id="orient-mode"
          value={transforms.orient ?? 0}
          onChange={handleSelectChange('orient')}
          className="w-full px-2 py-1 bg-gray-700 text-white rounded text-sm"
        >
          <option value={0}>Disabled (0)</option>
          <option value={1}>Mode 1</option>
          <option value={2}>Mode 2</option>
        </select>
      </div>

      {/* Repetitions Control */}
      <div>
        <label htmlFor="repetitions" className="block text-sm font-medium text-gray-300 mb-1">
          Repetitions
        </label>
        <input
          id="repetitions"
          type="number"
          defaultValue={transforms.repetitions ?? 1}
          onChange={handleNumberChange('repetitions')}
          className="w-full px-2 py-1 bg-gray-700 text-white rounded text-sm"
          step="1"
          min="1"
        />
      </div>

      {/* Boolean Flags */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-gray-300">Options</h4>

        <label className="flex items-center space-x-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={transforms.ensure_on_bed ?? false}
            onChange={handleBooleanChange('ensure_on_bed')}
            className="form-checkbox bg-gray-700 border-gray-600"
          />
          <span>Ensure On Bed</span>
        </label>

        <label className="flex items-center space-x-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={transforms.assemble ?? false}
            onChange={handleBooleanChange('assemble')}
            className="form-checkbox bg-gray-700 border-gray-600"
          />
          <span>Assemble</span>
        </label>

        <label className="flex items-center space-x-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={transforms.convert_unit ?? false}
            onChange={handleBooleanChange('convert_unit')}
            className="form-checkbox bg-gray-700 border-gray-600"
          />
          <span>Convert Unit</span>
        </label>
      </div>
    </div>
  );
};
