import { useStore } from '../store';

/**
 * ObjectInfoOverlay Component
 * 
 * Displays model information overlay showing:
 * - Filename
 * - Bounding box dimensions (W × D × H) in millimeters
 * - Estimated volume in mm³
 * - Triangle count
 * 
 * Updates automatically when a new model is loaded.
 * Positioned at top-right corner of the viewport.
 */
export const ObjectInfoOverlay: React.FC = () => {
  const modelBounds = useStore((state) => state.modelBounds);
  const modelMetadata = useStore((state) => state.modelMetadata);

  // Don't render if no model is loaded
  if (!modelBounds || !modelMetadata) {
    return null;
  }

  // Calculate dimensions in millimeters
  const width = modelBounds.max.x - modelBounds.min.x;
  const depth = modelBounds.max.y - modelBounds.min.y;
  const height = modelBounds.max.z - modelBounds.min.z;

  // Calculate volume in mm³
  const volume = width * depth * height;

  // Format numbers with appropriate precision
  const formatDimension = (value: number): string => {
    return value.toFixed(2);
  };

  const formatVolume = (value: number): string => {
    return value.toFixed(2);
  };

  const formatTriangleCount = (count: number): string => {
    return count.toLocaleString();
  };

  return (
    <div className="absolute top-4 right-4 bg-gray-800 bg-opacity-90 text-white rounded-lg p-4 shadow-lg min-w-[250px] font-mono text-sm z-10">
      <div className="space-y-2">
        {/* Filename */}
        <div className="border-b border-gray-600 pb-2">
          <div className="font-semibold text-gray-300 text-xs uppercase tracking-wide mb-1">
            Object
          </div>
          <div className="text-white truncate" title={modelMetadata.filename}>
            {modelMetadata.filename}
          </div>
        </div>

        {/* Dimensions */}
        <div>
          <div className="font-semibold text-gray-300 text-xs uppercase tracking-wide mb-1">
            Dimensions
          </div>
          <div className="text-white">
            {formatDimension(width)} × {formatDimension(depth)} × {formatDimension(height)} mm
          </div>
        </div>

        {/* Volume */}
        <div>
          <div className="font-semibold text-gray-300 text-xs uppercase tracking-wide mb-1">
            Volume
          </div>
          <div className="text-white">
            {formatVolume(volume)} mm³
          </div>
        </div>

        {/* Triangle Count */}
        <div>
          <div className="font-semibold text-gray-300 text-xs uppercase tracking-wide mb-1">
            Triangles
          </div>
          <div className="text-white">
            {formatTriangleCount(modelMetadata.triangleCount)}
          </div>
        </div>
      </div>
    </div>
  );
};
