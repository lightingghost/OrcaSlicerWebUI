import React, { useCallback } from 'react';
import { useStore } from '../store';

/**
 * ArrangeSettingsPanel Component
 *
 * The Arrange settings popup, matching OrcaSlicer's native
 * `_render_arrange_menu` ImGui window (src/slic3r/GUI/GLCanvas3D.cpp) and
 * the reference screenshot:
 *   - "Spacing" slider + numeric input, with "0 means auto spacing."
 *   - "Auto rotate for arrangement" checkbox
 *   - "Allow multiple materials on same plate" checkbox
 *   - "Align to Y axis" checkbox (disabled whenever rotation is enabled,
 *     matching native's mutual-exclusivity behavior)
 *   - "Arrange" and "Reset" buttons
 *
 * Clicking "Arrange" triggers ThreeViewport's arrange pass (via
 * `triggerArrange`, a one-shot counter ThreeViewport watches) using the
 * current settings, then closes the popup — matching native, where
 * clicking Arrange in the popup calls `plater()->arrange()` immediately.
 * "Reset" restores all settings to native's defaults without arranging.
 */
export const ArrangeSettingsPanel: React.FC = () => {
  const settings = useStore((state) => state.arrangeSettings);
  const setArrangeSetting = useStore((state) => state.setArrangeSetting);
  const resetArrangeSettings = useStore((state) => state.resetArrangeSettings);
  const triggerArrange = useStore((state) => state.triggerArrange);
  const setArrangeSettingsOpen = useStore((state) => state.setArrangeSettingsOpen);

  const handleSpacingChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseFloat(e.target.value);
      if (Number.isFinite(value)) {
        setArrangeSetting('spacing', Math.max(0, value));
      }
    },
    [setArrangeSetting]
  );

  const handleArrangeClick = useCallback(() => {
    triggerArrange();
    setArrangeSettingsOpen(false);
  }, [triggerArrange, setArrangeSettingsOpen]);

  const handleResetClick = useCallback(() => {
    resetArrangeSettings();
  }, [resetArrangeSettings]);

  return (
    <div className="w-[320px] bg-white text-gray-800 rounded-md shadow-xl border border-gray-300 overflow-hidden">
      <div className="p-4 space-y-3">
        {/* Spacing row: slider + numeric input, matching the reference layout */}
        <div className="flex items-center gap-3">
          <label htmlFor="arrange-spacing" className="text-base text-gray-800 w-16 flex-shrink-0">
            Spacing
          </label>
          <input
            id="arrange-spacing-slider"
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={settings.spacing}
            onChange={handleSpacingChange}
            aria-label="Spacing slider"
            className="flex-1 accent-teal-600"
          />
          <input
            id="arrange-spacing"
            type="number"
            min={0}
            step={0.01}
            value={settings.spacing.toFixed(2)}
            onChange={handleSpacingChange}
            aria-label="Spacing"
            className="w-20 text-sm text-center bg-white border border-gray-300 rounded px-1 py-1"
          />
        </div>
        <p className="text-sm text-gray-500">0 means auto spacing.</p>

        <hr className="border-gray-200" />

        <label className="flex items-center gap-2 text-base text-gray-800 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.enableRotation}
            onChange={(e) => setArrangeSetting('enableRotation', e.target.checked)}
            className="w-4 h-4 accent-teal-600"
          />
          Auto rotate for arrangement
        </label>

        <label className="flex items-center gap-2 text-base text-gray-800 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.allowMultiMaterialsOnSamePlate}
            onChange={(e) => setArrangeSetting('allowMultiMaterialsOnSamePlate', e.target.checked)}
            className="w-4 h-4 accent-teal-600"
          />
          Allow multiple materials on same plate
        </label>

        <label
          className={`flex items-center gap-2 text-base cursor-pointer ${
            settings.enableRotation ? 'text-gray-400 cursor-not-allowed' : 'text-gray-800'
          }`}
        >
          <input
            type="checkbox"
            checked={settings.alignToYAxis}
            disabled={settings.enableRotation}
            onChange={(e) => setArrangeSetting('alignToYAxis', e.target.checked)}
            className="w-4 h-4 accent-teal-600 disabled:opacity-50"
          />
          Align to Y axis
        </label>
      </div>

      <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-200">
        <button
          type="button"
          onClick={handleArrangeClick}
          className="text-base px-4 py-1.5 border border-gray-400 rounded hover:bg-gray-100 transition-colors"
        >
          Arrange
        </button>
        <button
          type="button"
          onClick={handleResetClick}
          className="text-base px-4 py-1.5 border border-gray-400 rounded hover:bg-gray-100 transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
  );
};
