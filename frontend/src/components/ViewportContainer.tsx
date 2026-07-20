import { ThreeViewport } from './ThreeViewport';
import { ObjectInfoOverlay } from './ObjectInfoOverlay';
import { UploadDropzone } from './UploadDropzone';

/**
 * ViewportContainer Component
 * 
 * Container for the 3D viewport and its overlays.
 * Includes:
 * - ThreeViewport: The main Three.js scene
 * - ObjectInfoOverlay: Model information display
 * - UploadDropzone: File upload interface (shows before first file is loaded)
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
      
      {/* Upload dropzone (full-screen overlay, shows before first file upload) */}
      <UploadDropzone />
    </div>
  );
};
