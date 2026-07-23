import React, { useCallback, useMemo } from 'react';
import { useStore } from '../store';
import type { CoordinateMode } from '../lib/objectTransform';

/**
 * ObjectManipulationPanel Component
 *
 * The Move / Rotate / Scale field panel that appears in the 3D viewport
 * when a transform tool is active, matching OrcaSlicer's native
 * GizmoObjectManipulation ImGui panel (see reference screenshots):
 *  - A "World coordinates" / "Object coordinates" dropdown at the top.
 *  - X (red) / Y (green) / Z (blue) column headers.
 *  - Move: a single "Position" row (mm).
 *  - Rotate: "Rotate (relative)" and "Rotate (absolute)" rows (degrees).
 *  - Scale: "Scale" (%) and "Size" (mm) rows, plus a "Uniform scale" toggle.
 *  - A "Done" button that deselects/closes the panel.
 *
 * This component only reads the live snapshot from the store
 * (`objectTransformSnapshot`, computed by ThreeViewport from the actual
 * mesh) and dispatches edit commands back via `dispatchTransformCommand` —
 * it never touches Three.js directly, keeping all WebGL state inside
 * ThreeViewport.
 */

const AXIS_LABELS: Array<{ label: string; colorClass: string }> = [
  { label: 'X', colorClass: 'text-red-400' },
  { label: 'Y', colorClass: 'text-green-400' },
  { label: 'Z', colorClass: 'text-blue-400' },
];

function parseNumberInput(raw: string): number | null {
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

export const ObjectManipulationPanel: React.FC = () => {
  const selectedObjectId = useStore((state) => state.selectedObjectId);
  const activeTool = useStore((state) => state.activeTransformTool);
  const coordinateMode = useStore((state) => state.coordinateMode);
  const uniformScale = useStore((state) => state.uniformScale);
  const snapshot = useStore((state) => state.objectTransformSnapshot);
  const setCoordinateMode = useStore((state) => state.setCoordinateMode);
  const setUniformScale = useStore((state) => state.setUniformScale);
  const dispatchTransformCommand = useStore((state) => state.dispatchTransformCommand);
  const setSelectedObjectId = useStore((state) => state.setSelectedObjectId);

  const handleCoordinateModeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setCoordinateMode(e.target.value as CoordinateMode);
    },
    [setCoordinateMode]
  );

  const handlePositionChange = useCallback(
    (axis: 0 | 1 | 2) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseNumberInput(e.target.value);
      if (value === null) return;
      dispatchTransformCommand({ type: 'position', axis, value });
    },
    [dispatchTransformCommand]
  );

  const handleRotateRelativeChange = useCallback(
    (axis: 0 | 1 | 2) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseNumberInput(e.target.value);
      if (value === null) return;
      dispatchTransformCommand({ type: 'rotateRelative', axis, deltaDegrees: value });
    },
    [dispatchTransformCommand]
  );

  const handleRotateAbsoluteChange = useCallback(
    (axis: 0 | 1 | 2) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseNumberInput(e.target.value);
      if (value === null) return;
      dispatchTransformCommand({ type: 'rotateAbsolute', axis, degrees: value });
    },
    [dispatchTransformCommand]
  );

  const handleScaleChange = useCallback(
    (axis: 0 | 1 | 2) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseNumberInput(e.target.value);
      if (value === null || value <= 0 || !snapshot) return;
      const currentPercent = snapshot.scale[axis];
      const ratio = currentPercent > 1e-9 ? value / currentPercent : 1;
      dispatchTransformCommand({ type: 'scaleRatio', axis, ratio });
    },
    [dispatchTransformCommand, snapshot]
  );

  const handleSizeChange = useCallback(
    (axis: 0 | 1 | 2) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseNumberInput(e.target.value);
      if (value === null || value <= 0 || !snapshot) return;
      const currentSize = snapshot.size[axis];
      const ratio = currentSize > 1e-9 ? value / currentSize : 1;
      dispatchTransformCommand({ type: 'sizeRatio', axis, ratio });
    },
    [dispatchTransformCommand, snapshot]
  );

  const handleDone = useCallback(() => {
    setSelectedObjectId(null);
  }, [setSelectedObjectId]);

  const availableModes = useMemo<Array<{ value: CoordinateMode; label: string }>>(
    () => [
      { value: 'world', label: 'World coordinates' },
      { value: 'object', label: 'Object coordinates' },
    ],
    []
  );

  if (!selectedObjectId || !snapshot) return null;

  return (
    <div className="w-[340px] bg-gray-100 text-gray-800 rounded-md shadow-xl border border-gray-300 overflow-hidden">
      <div className="p-3 space-y-2">
        {/* Coordinate mode selector */}
        <select
          value={coordinateMode}
          onChange={handleCoordinateModeChange}
          aria-label="Coordinate system used for transform actions"
          title="Coordinate system used for transform actions."
          className="w-full text-sm bg-white border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple-400"
        >
          {availableModes.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>

        {/* Axis header row */}
        <div className="grid grid-cols-[70px_1fr_1fr_1fr] gap-2 items-center px-0.5">
          <div />
          {AXIS_LABELS.map(({ label, colorClass }) => (
            <div key={label} className={`text-center font-semibold ${colorClass}`}>
              {label}
            </div>
          ))}
        </div>

        {/* Move tool: Position row */}
        {activeTool === 'move' && (
          <div className="grid grid-cols-[70px_1fr_1fr_1fr_28px] gap-2 items-center">
            <label className="text-sm text-gray-700">Position</label>
            {[0, 1, 2].map((axis) => (
              <input
                key={axis}
                type="number"
                step="0.01"
                aria-label={`Position ${AXIS_LABELS[axis].label}`}
                value={snapshot.position[axis].toFixed(2)}
                onChange={handlePositionChange(axis as 0 | 1 | 2)}
                className="w-full text-sm text-center bg-white border border-gray-300 rounded px-1 py-1"
              />
            ))}
            <span className="text-xs text-gray-500">mm</span>
          </div>
        )}

        {/* Rotate tool: Rotate (relative) + Rotate (absolute) rows */}
        {activeTool === 'rotate' && (
          <>
            <div className="grid grid-cols-[70px_1fr_1fr_1fr_28px] gap-2 items-center">
              <label className="text-sm text-gray-700">Rotate (relative)</label>
              {[0, 1, 2].map((axis) => (
                <input
                  key={axis}
                  type="number"
                  step="1"
                  aria-label={`Rotate relative ${AXIS_LABELS[axis].label}`}
                  value={snapshot.rotationRelative[axis].toFixed(2)}
                  onChange={handleRotateRelativeChange(axis as 0 | 1 | 2)}
                  className="w-full text-sm text-center bg-white border border-gray-300 rounded px-1 py-1"
                />
              ))}
              <span className="text-xs text-gray-500">&deg;</span>
            </div>
            <div className="grid grid-cols-[70px_1fr_1fr_1fr_28px] gap-2 items-center">
              <label className="text-sm text-gray-700">Rotate (absolute)</label>
              {[0, 1, 2].map((axis) => (
                <input
                  key={axis}
                  type="number"
                  step="1"
                  aria-label={`Rotate absolute ${AXIS_LABELS[axis].label}`}
                  value={snapshot.rotationAbsolute[axis].toFixed(2)}
                  onChange={handleRotateAbsoluteChange(axis as 0 | 1 | 2)}
                  className="w-full text-sm text-center bg-white border border-gray-300 rounded px-1 py-1"
                />
              ))}
              <span className="text-xs text-gray-500">&deg;</span>
            </div>
          </>
        )}

        {/* Scale tool: Scale (%) + Size (mm) rows + Uniform scale toggle */}
        {activeTool === 'scale' && (
          <>
            <div className="grid grid-cols-[70px_1fr_1fr_1fr_28px] gap-2 items-center">
              <label className="text-sm text-gray-700">Scale</label>
              {[0, 1, 2].map((axis) => (
                <input
                  key={axis}
                  type="number"
                  step="1"
                  min="0.01"
                  aria-label={`Scale ${AXIS_LABELS[axis].label}`}
                  value={snapshot.scale[axis].toFixed(2)}
                  onChange={handleScaleChange(axis as 0 | 1 | 2)}
                  className="w-full text-sm text-center bg-white border border-gray-300 rounded px-1 py-1"
                />
              ))}
              <span className="text-xs text-gray-500">%</span>
            </div>
            <div className="grid grid-cols-[70px_1fr_1fr_1fr_28px] gap-2 items-center">
              <label className="text-sm text-gray-700">Size</label>
              {[0, 1, 2].map((axis) => (
                <input
                  key={axis}
                  type="number"
                  step="0.01"
                  min="0.01"
                  aria-label={`Size ${AXIS_LABELS[axis].label}`}
                  value={snapshot.size[axis].toFixed(2)}
                  onChange={handleSizeChange(axis as 0 | 1 | 2)}
                  className="w-full text-sm text-center bg-white border border-gray-300 rounded px-1 py-1"
                />
              ))}
              <span className="text-xs text-gray-500">mm</span>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 pt-1">
              <input
                type="checkbox"
                checked={uniformScale}
                onChange={(e) => setUniformScale(e.target.checked)}
                className="w-4 h-4 accent-teal-600"
              />
              Uniform scale
            </label>
          </>
        )}
      </div>

      <div className="flex items-center justify-between px-3 py-2 border-t border-gray-300 bg-gray-50">
        <button
          type="button"
          title="Help"
          aria-label="Help"
          className="w-6 h-6 rounded-full bg-teal-600 text-white text-xs flex items-center justify-center"
        >
          ?
        </button>
        <button
          type="button"
          onClick={handleDone}
          className="text-sm px-3 py-1 border border-gray-400 rounded hover:bg-gray-200 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
};
