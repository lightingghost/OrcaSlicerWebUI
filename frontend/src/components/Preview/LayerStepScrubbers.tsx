import React from 'react';
import { useStore } from '../../store';

/**
 * LayerStepScrubbers
 *
 * Two scrubbers matching native OrcaSlicer's Preview tab:
 *  - A vertical layer slider (right edge of the 3D view) that selects
 *    which layer is the "current" one being built up.
 *  - A horizontal step/move slider (bottom edge) that reveals the current
 *    layer's toolpath moves incrementally, from 0 up to that layer's full
 *    segment count.
 *
 * Both write directly to the store (`setCurrentLayerIndex` /
 * `setCurrentStepIndex` in previewSlice.ts), which PreviewViewport reads
 * to decide how many segments to draw.
 */
export const LayerStepScrubbers: React.FC = () => {
  const parsedGcode = useStore((state) => state.parsedGcode);
  const currentLayerIndex = useStore((state) => state.currentLayerIndex);
  const currentStepIndex = useStore((state) => state.currentStepIndex);
  const setCurrentLayerIndex = useStore((state) => state.setCurrentLayerIndex);
  const setCurrentStepIndex = useStore((state) => state.setCurrentStepIndex);

  if (!parsedGcode || parsedGcode.layers.length === 0) return null;

  const layers = parsedGcode.layers;
  const maxLayerIndex = layers.length - 1;
  const currentLayer = layers[currentLayerIndex];
  const maxStepIndex = currentLayer
    ? currentLayer.endSegmentIndex - currentLayer.startSegmentIndex
    : 0;

  return (
    <>
      {/* Vertical layer slider — right edge of the viewport */}
      <div className="absolute top-6 right-4 bottom-16 flex flex-col items-center z-10">
        <div className="text-xs text-gray-300 bg-gray-800/80 rounded px-1.5 py-0.5 mb-1 tabular-nums">
          {currentLayerIndex + 1}
        </div>
        <input
          type="range"
          aria-label="Layer"
          min={0}
          max={maxLayerIndex}
          // Native's layer slider has layer 1 at the top and the highest
          // layer at the bottom. A vertical <input type="range"> with
          // writing-mode: vertical-lr naturally puts min at the bottom and
          // max at the top (like a thermometer), so invert the value here
          // (max - value) to get top-to-bottom = first-to-last layer while
          // still reporting the real layer index to the store.
          value={maxLayerIndex - currentLayerIndex}
          onChange={(e) => setCurrentLayerIndex(maxLayerIndex - Number(e.target.value))}
          className="flex-1 accent-teal-400"
          style={{
            writingMode: 'vertical-lr' as React.CSSProperties['writingMode'],
            WebkitAppearance: 'slider-vertical',
            width: '20px',
          }}
        />
        <div className="text-xs text-gray-400 mt-1 tabular-nums">{layers.length}</div>
      </div>

      {/* Horizontal step/move slider — bottom edge of the viewport */}
      <div className="absolute bottom-4 left-4 right-16 flex items-center gap-2 z-10">
        <input
          type="range"
          aria-label="Step"
          min={0}
          max={maxStepIndex}
          value={currentStepIndex}
          onChange={(e) => setCurrentStepIndex(Number(e.target.value))}
          className="flex-1 accent-teal-400"
        />
        <div className="text-xs text-gray-300 bg-gray-800/80 rounded px-1.5 py-0.5 tabular-nums whitespace-nowrap">
          {currentStepIndex}/{maxStepIndex}
        </div>
      </div>
    </>
  );
};
