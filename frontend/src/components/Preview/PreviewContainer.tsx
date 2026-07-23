import { PreviewViewport } from './PreviewViewport';
import { LayerStepScrubbers } from './LayerStepScrubbers';
import { LineTypeStatsPanel } from './LineTypeStatsPanel';

/**
 * PreviewContainer
 *
 * The Preview tab's main content: the 3D toolpath viewport (with the
 * layer/step scrubbers overlaid on it) plus the line-type stats + total
 * estimation panel docked to the right — matching native OrcaSlicer's
 * Preview tab layout (see reference screenshot).
 */
export const PreviewContainer: React.FC = () => {
  return (
    <div className="relative w-full h-full flex">
      <div className="flex-1 relative min-w-0">
        <PreviewViewport />
        <LayerStepScrubbers />
      </div>
      <div className="w-[26rem] flex-shrink-0 border-l border-gray-700 bg-gray-900 overflow-y-auto p-3">
        <LineTypeStatsPanel />
      </div>
    </div>
  );
};

export { PreviewViewport, LayerStepScrubbers, LineTypeStatsPanel };
