import { useStore } from '../store';

/**
 * ViewPresetToolbar Component
 * 
 * Provides four preset camera view buttons:
 * - Home: Default isometric view
 * - Top: Top-down view
 * - Front: Front view
 * - Side: Side view
 * 
 * Clicking a button animates the camera to the preset position
 * using smooth interpolation and updates the viewport store.
 */

interface ViewPresetToolbarProps {
  onPresetSelect: (preset: 'home' | 'top' | 'front' | 'side') => void;
}

export const ViewPresetToolbar: React.FC<ViewPresetToolbarProps> = ({ onPresetSelect }) => {
  const cameraPreset = useStore((state) => state.cameraPreset);

  const handlePresetClick = (preset: 'home' | 'top' | 'front' | 'side') => {
    onPresetSelect(preset);
  };

  const buttonBaseClass = 'px-4 py-2 rounded text-sm font-medium transition-colors';
  const activeClass = 'bg-purple-600 text-white';
  const inactiveClass = 'bg-gray-700 text-gray-300 hover:bg-gray-600';

  return (
    <div className="flex gap-2 bg-gray-800 p-2 rounded-lg">
      <button
        onClick={() => handlePresetClick('home')}
        className={`${buttonBaseClass} ${cameraPreset === 'home' ? activeClass : inactiveClass}`}
        title="Home view - Isometric perspective"
      >
        Home
      </button>
      <button
        onClick={() => handlePresetClick('top')}
        className={`${buttonBaseClass} ${cameraPreset === 'top' ? activeClass : inactiveClass}`}
        title="Top view - Looking down at the build plate"
      >
        Top
      </button>
      <button
        onClick={() => handlePresetClick('front')}
        className={`${buttonBaseClass} ${cameraPreset === 'front' ? activeClass : inactiveClass}`}
        title="Front view - Looking from the front"
      >
        Front
      </button>
      <button
        onClick={() => handlePresetClick('side')}
        className={`${buttonBaseClass} ${cameraPreset === 'side' ? activeClass : inactiveClass}`}
        title="Side view - Looking from the right side"
      >
        Side
      </button>
    </div>
  );
};
