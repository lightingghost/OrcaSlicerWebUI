import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useStore } from '../../store';
import {
  formatShortTime,
  formatDuration,
  formatFilamentMeters,
  formatWeightGrams,
} from '../../lib/gcodeParser';

function rgbCss([r, g, b]: [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * LineTypeStatsPanel
 *
 * Replicates the native OrcaSlicer Preview tab's line-type stats table and
 * "Total estimation" summary (see reference screenshot: a "Line Type" /
 * "Time" / "Usage" table with a color swatch + visibility toggle per row,
 * a Travel row, followed by Total Filament / Model Filament / Cost /
 * Prepare time / Model printing time / Total time).
 *
 * Column layout and figures are ported directly from
 * `GCodeViewer::render_legend`'s `EViewType::FeatureType` branch (Line
 * Type, Time, %, Usage, Display columns) — see gcodeParser.ts's module
 * doc comment for exactly which figures are native's own computed values
 * (Total estimation) vs this app's own approximation (per-line-type Time,
 * since that requires native's full kinematic planner to compute exactly).
 */
export const LineTypeStatsPanel: React.FC = () => {
  const parsedGcode = useStore((state) => state.parsedGcode);
  const isLoadingGcode = useStore((state) => state.isLoadingGcode);
  const gcodeLoadError = useStore((state) => state.gcodeLoadError);
  const hiddenRoles = useStore((state) => state.hiddenRoles);
  const toggleRoleVisibility = useStore((state) => state.toggleRoleVisibility);

  if (isLoadingGcode) {
    return (
      <div className="p-4 text-sm text-gray-400">Loading gcode preview…</div>
    );
  }

  if (gcodeLoadError) {
    return (
      <div className="p-4 text-sm text-red-400">
        Failed to load preview: {gcodeLoadError}
      </div>
    );
  }

  if (!parsedGcode) {
    return (
      <div className="p-4 text-sm text-gray-400">
        Slice the plate to see line-type statistics.
      </div>
    );
  }

  const { lineTypeStats, travelStat, totalEstimation } = parsedGcode;

  return (
    <div className="flex flex-col text-sm text-gray-200 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
      {parsedGcode.previewSegmentStride > 1 && (
        <div className="border-b border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          Large preview simplified: rendering one out of every {parsedGcode.previewSegmentStride} moves
          ({parsedGcode.segments.length.toLocaleString()} of {parsedGcode.sourceSegmentCount.toLocaleString()}).
          Statistics use the complete G-code.
        </div>
      )}
      {/* Line Type / Time / Length / Weight table. table-fixed + explicit
          column widths (rather than letting the browser size columns from
          content) so the rightmost visibility-toggle column can never get
          pushed past the panel's right edge, whatever the Length/Weight
          text lengths turn out to be. */}
      <table className="w-full table-fixed text-xs">
        <colgroup>
          <col className="w-[28%]" />
          <col className="w-[15%]" />
          <col className="w-[11%]" />
          <col className="w-[17%]" />
          <col className="w-[17%]" />
          <col className="w-[12%]" />
        </colgroup>
        <thead>
          <tr className="text-xs text-gray-400 border-b border-gray-700">
            <th className="text-left font-medium px-1.5 py-2">Line Type</th>
            <th className="text-right font-medium px-1.5 py-2">Time</th>
            <th className="text-right font-medium px-1.5 py-2">%</th>
            <th className="text-right font-medium px-1.5 py-2">Length</th>
            <th className="text-right font-medium px-1.5 py-2">Weight</th>
            <th className="text-center font-medium px-1.5 py-2">
              <Eye className="w-3.5 h-3.5 inline" />
            </th>
          </tr>
        </thead>
        <tbody>
          {lineTypeStats.map((stat) => (
            <LineTypeRow
              key={stat.role}
              role={stat.role}
              color={stat.color}
              timeLabel={formatShortTime(stat.timeSeconds)}
              percentLabel={
                stat.usageFraction > 0.001
                  ? `${(stat.usageFraction * 100).toFixed(1)}`
                  : stat.usageFraction > 0
                  ? '<0.1'
                  : '0'
              }
              lengthLabel={formatFilamentMeters(stat.filamentMm / 1000)}
              weightLabel={formatWeightGrams(stat.filamentGrams)}
              visible={!hiddenRoles.has(stat.role)}
              onToggle={() => toggleRoleVisibility(stat.role)}
            />
          ))}
          <LineTypeRow
            role="Travel"
            color={[56, 72, 155]}
            timeLabel={formatShortTime(travelStat.timeSeconds)}
            percentLabel={
              travelStat.usageFraction > 0.001
                ? `${(travelStat.usageFraction * 100).toFixed(1)}`
                : travelStat.usageFraction > 0
                ? '<0.1'
                : '0'
            }
            lengthLabel={`${(travelStat.distanceMm / 1000).toFixed(2)} m`}
            weightLabel={`${travelStat.moveCount}x`}
            visible={!hiddenRoles.has('Travel')}
            onToggle={() => toggleRoleVisibility('Travel')}
          />
        </tbody>
      </table>

      {/* Total estimation summary */}
      <div className="border-t border-gray-700 px-3 py-3 space-y-1">
        <div className="text-xs font-semibold text-gray-300 mb-1">Total estimation</div>
        <EstimationRow label="Total Filament" value={formatFilamentMeters(totalEstimation.totalFilamentM)} />
        <EstimationRow label="Model Filament" value={formatFilamentMeters(totalEstimation.modelFilamentM)} />
        <EstimationRow
          label="Cost"
          value={totalEstimation.cost !== null ? totalEstimation.cost.toFixed(2) : '-'}
        />
        <EstimationRow label="Prepare time" value={formatDuration(totalEstimation.prepareTimeSeconds)} />
        <EstimationRow
          label="Model printing time"
          value={formatDuration(totalEstimation.modelPrintingTimeSeconds)}
        />
        <EstimationRow label="Total time" value={formatDuration(totalEstimation.totalTimeSeconds)} />
      </div>
    </div>
  );
};

const LineTypeRow: React.FC<{
  role: string;
  color: [number, number, number];
  timeLabel: string;
  percentLabel: string;
  lengthLabel: string;
  weightLabel: string;
  visible: boolean;
  onToggle: () => void;
}> = ({ role, color, timeLabel, percentLabel, lengthLabel, weightLabel, visible, onToggle }) => {
  return (
    <tr className="border-b border-gray-700/50 hover:bg-gray-700/30">
      <td className="px-1.5 py-1.5 truncate">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
            style={{ backgroundColor: rgbCss(color) }}
          />
          <span className={`truncate ${visible ? '' : 'text-gray-500'}`}>{role}</span>
        </div>
      </td>
      <td className="px-1.5 py-1.5 text-right tabular-nums truncate">{timeLabel}</td>
      <td className="px-1.5 py-1.5 text-right tabular-nums truncate">{percentLabel}</td>
      <td className="px-1.5 py-1.5 text-right tabular-nums truncate">{lengthLabel}</td>
      <td className="px-1.5 py-1.5 text-right tabular-nums truncate">{weightLabel}</td>
      <td className="px-1.5 py-1.5 text-center">
        <button
          onClick={onToggle}
          className="text-gray-400 hover:text-white transition-colors"
          aria-label={`Toggle ${role} visibility`}
        >
          {visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        </button>
      </td>
    </tr>
  );
};

const EstimationRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between text-xs">
    <span className="text-gray-400">{label}:</span>
    <span className="text-gray-200 tabular-nums">{value}</span>
  </div>
);
