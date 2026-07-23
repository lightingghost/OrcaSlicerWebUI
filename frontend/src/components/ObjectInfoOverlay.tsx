import { X } from 'lucide-react';
import { useStore } from '../store';

/**
 * ObjectInfoOverlay Component
 * 
 * Compact model information overlay showing:
 * - Filename
 * - Bounding box dimensions (W × D × H) in millimeters
 * - Estimated volume in mm³
 * - Triangle count
 * 
 * Each metric is a single row of "Label    Value" (name and value share
 * one line) rather than a label row followed by a separate value row, so
 * the whole panel takes up noticeably less vertical space.
 * 
 * Closable via the X button in the header; reopened by double-clicking
 * the object in the viewport (see ThreeViewport's dblclick handler), which
 * sets `isInfoOverlayOpen` back to true.
 * 
 * Updates automatically when a new model is loaded.
 * Positioned at top-right corner of the viewport.
 */
export const ObjectInfoOverlay: React.FC = () => {
  const modelBounds = useStore((state) => state.modelBounds);
  const modelMetadata = useStore((state) => state.modelMetadata);
  const isOpen = useStore((state) => state.isInfoOverlayOpen);
  const setInfoOverlayOpen = useStore((state) => state.setInfoOverlayOpen);

  // Don't render if no model is loaded, or the user closed the panel
  if (!modelBounds || !modelMetadata || !isOpen) {
    return null;
  }

  // Calculate dimensions in millimeters
  const width = modelBounds.max.x - modelBounds.min.x;
  const depth = modelBounds.max.y - modelBounds.min.y;
  const height = modelBounds.max.z - modelBounds.min.z;

  // Calculate volume in mm³
  const volume = width * depth * height;

  const formatDimension = (value: number): string => value.toFixed(2);
  const formatVolume = (value: number): string => value.toFixed(2);
  const formatTriangleCount = (count: number): string => count.toLocaleString();

  const rows: Array<{ label: string; value: string }> = [
    {
      label: 'Dimensions',
      value: `${formatDimension(width)} × ${formatDimension(depth)} × ${formatDimension(height)} mm`,
    },
    { label: 'Volume', value: `${formatVolume(volume)} mm³` },
    { label: 'Triangles', value: formatTriangleCount(modelMetadata.triangleCount) },
  ];

  return (
    <div className="absolute top-4 right-4 bg-gray-800 bg-opacity-90 text-white rounded-lg shadow-lg min-w-[220px] font-mono text-xs z-10">
      {/* Header: filename + close button, sharing one row */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-600">
        <span className="truncate text-white" title={modelMetadata.filename}>
          {modelMetadata.filename}
        </span>
        <button
          type="button"
          onClick={() => setInfoOverlayOpen(false)}
          aria-label="Close object parameters"
          title="Close"
          className="text-gray-400 hover:text-white flex-shrink-0 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Metrics: label and value on the same row */}
      <div className="px-3 py-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 py-0.5">
            <span className="text-gray-400 whitespace-nowrap">{row.label}</span>
            <span className="text-white text-right">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
