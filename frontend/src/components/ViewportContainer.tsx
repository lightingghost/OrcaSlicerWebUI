import { ThreeViewport } from './ThreeViewport';
import { ObjectInfoOverlay } from './ObjectInfoOverlay';
import { ObjectContextMenu } from './ObjectContextMenu';

/**
 * ViewportContainer Component
 * 
 * Container for the 3D viewport and its overlays.
 * Includes:
 * - ThreeViewport: The main Three.js scene
 * - ObjectInfoOverlay: Model information display
 * - ObjectContextMenu: Right-click menu (Remove / Clone / Set number of
 *   instances) opened by right-clicking a plate object
 * 
 * Adding models to the plate is done via the "Add" button in
 * ViewportTransformToolbar (first item, to the left of Move) rather than a
 * drag-and-drop zone — matching the native OrcaSlicer desktop UI, which has
 * no drag-and-drop import affordance either.
 * 
 * Additional overlays will be added here (ViewPresetToolbar, AxisGizmo, etc.)
 */
export const ViewportContainer: React.FC = () => {
  return (
    <div className="relative w-full h-full">
      {/* Main Three.js viewport */}
      <ThreeViewport />
      
      {/* Object info overlay (top-right) */}
      <ObjectInfoOverlay />

      {/* Right-click object context menu */}
      <ObjectContextMenu />
    </div>
  );
};
