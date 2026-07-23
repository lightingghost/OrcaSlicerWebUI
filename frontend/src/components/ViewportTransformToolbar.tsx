import React, { useRef } from 'react';
import { Plus, Move, RotateCw, Maximize2, Grid3x3, ArrowDownToLine, Wand2 } from 'lucide-react';
import { useStore } from '../store';
import type { TransformTool } from '../store/objectManipulationSlice';
import { ObjectManipulationPanel } from './ObjectManipulationPanel';
import { ArrangeSettingsPanel } from './ArrangeSettingsPanel';

const ACCEPTED_EXTENSIONS = ['.stl', '.3mf', '.obj', '.amf'];

/**
 * ViewportTransformToolbar Component
 *
 * Add / Move / Rotate / Scale / Arrange / Lay on Face / Auto Orient tool
 * buttons, positioned inside the 3D viewport (top-left, under the tab
 * bar) rather than in the app's top navigation bar — matching the native
 * OrcaSlicer desktop UI, where these tools live as an overlay on the 3D
 * view itself.
 *
 * - Add: the FIRST button (to the left of Move), opens a native file
 *   picker to import one or more 3D models (STL/3MF/OBJ/AMF) onto the
 *   plate. This replaces the old full-viewport drag-and-drop zone —
 *   native OrcaSlicer has no drag-and-drop import affordance either, only
 *   File > Import / a toolbar action. Supports adding multiple models to
 *   the same project: each import adds a new object alongside any already
 *   on the plate (see ThreeViewport's uploadedFiles effect), it doesn't
 *   replace them.
 * - Move / Rotate / Scale: open the ObjectManipulationPanel (World/Object
 *   coordinates + Position/Rotation/Scale/Size fields) directly below the
 *   toolbar, mirroring OrcaSlicer's GizmoObjectManipulation ImGui window.
 * - Lay on Face: matches GLGizmoFlatten ("Lay on Face", Ctrl+F in native
 *   OrcaSlicer). Clicking arms a picking mode that highlights every
 *   clickable flat face of the selected object's convex hull (see
 *   ThreeViewport's overlay rendering + lib/orientation.ts); clicking a
 *   highlighted face rotates it flat against the bed.
 * - Auto Orient: a SINGLE button matching OrcaSlicer's Orient toolbar
 *   action (libslic3r/Orient.cpp's AutoOrienter). If an object is
 *   selected, orients just that object; if nothing is selected, orients
 *   every loaded object ("orient all", matching native's per-plate orient
 *   toolbar icon which orients everything on the plate when nothing is
 *   individually selected).
 * - Arrange: matches native's Arrange toolbar icon, which opens a small
 *   settings popup (Spacing / Auto rotate for arrangement / Allow
 *   multiple materials on same plate / Align to Y axis / Arrange / Reset
 *   — see the reference screenshot and ArrangeSettingsPanel.tsx) rather
 *   than acting immediately. Arranging always applies to every object on
 *   the plate, matching native (there is no "arrange selected only" mode
 *   in the native toolbar's Arrange button), so it's enabled regardless
 *   of selection.
 *
 * Only Move / Rotate / Scale / Lay on Face are disabled when no object is
 * selected — Add, Auto Orient, and Arrange are always enabled (Add has no
 * selection dependency; Auto Orient falls back to "orient all"; Arrange
 * always arranges everything).
 */
type ToolbarButtonId = TransformTool | 'arrange' | 'layOnFace' | 'autoOrient' | 'add';

export const ViewportTransformToolbar: React.FC = () => {
  const selectedObjectId = useStore((state) => state.selectedObjectId);
  const activeTool = useStore((state) => state.activeTransformTool);
  const isPanelOpen = useStore((state) => state.isManipulationPanelOpen);
  const isLayOnFacePickModeActive = useStore((state) => state.isLayOnFacePickModeActive);
  const setActiveTransformTool = useStore((state) => state.setActiveTransformTool);
  const setManipulationPanelOpen = useStore((state) => state.setManipulationPanelOpen);
  const setLayOnFacePickModeActive = useStore((state) => state.setLayOnFacePickModeActive);
  const dispatchTransformCommand = useStore((state) => state.dispatchTransformCommand);
  const isArrangeSettingsOpen = useStore((state) => state.isArrangeSettingsOpen);
  const setArrangeSettingsOpen = useStore((state) => state.setArrangeSettingsOpen);
  const uploadFile = useStore((state) => state.uploadFile);
  const addFileInputRef = useRef<HTMLInputElement>(null);

  const hasSelection = !!selectedObjectId;

  const tools: { id: ToolbarButtonId; icon: React.ComponentType<{ className?: string }>; label: string; requiresSelection: boolean }[] = [
    { id: 'add', icon: Plus, label: 'Add', requiresSelection: false },
    { id: 'move', icon: Move, label: 'Move', requiresSelection: true },
    { id: 'rotate', icon: RotateCw, label: 'Rotate', requiresSelection: true },
    { id: 'scale', icon: Maximize2, label: 'Scale', requiresSelection: true },
    { id: 'layOnFace', icon: ArrowDownToLine, label: 'Lay on Face', requiresSelection: true },
    { id: 'autoOrient', icon: Wand2, label: 'Auto Orient', requiresSelection: false },
    { id: 'arrange', icon: Grid3x3, label: 'Arrange', requiresSelection: false },
  ];

  const handleAddFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      Array.from(files).forEach((file) => {
        uploadFile(file).catch((error) => {
          console.error('Failed to import file:', error);
        });
      });
    }
    // Reset so the same file(s) can be re-selected later
    e.target.value = '';
  };

  const handleClick = (tool: ToolbarButtonId) => {
    if (tool === 'add') {
      addFileInputRef.current?.click();
      return;
    }
    if (tool === 'arrange') {
      // Opens the settings popup (matching native); the popup's own
      // "Arrange" button actually triggers the pass (see
      // ArrangeSettingsPanel.tsx). Clicking the toolbar button again
      // toggles the popup closed.
      setArrangeSettingsOpen(!isArrangeSettingsOpen);
      setManipulationPanelOpen(false);
      setLayOnFacePickModeActive(false);
      return;
    }
    if (tool === 'autoOrient') {
      // One button: orient the selection if there is one, otherwise
      // orient everything on the plate.
      dispatchTransformCommand({ type: 'autoOrient', scope: hasSelection ? 'selected' : 'all' });
      return;
    }
    if (tool === 'layOnFace') {
      // Toggle the picking mode. While active, ThreeViewport renders
      // clickable highlighted overlays on every flat face of the selected
      // object's convex hull; clicking one lays it flat. Clicking this
      // button again cancels picking.
      setLayOnFacePickModeActive(!isLayOnFacePickModeActive);
      return;
    }
    // Clicking the already-active tool toggles the panel closed again;
    // clicking a different tool (or the same tool while closed) opens it
    // with that tool selected. The panel never opens on its own just
    // because a new object was selected — only an explicit click here
    // (see objectManipulationSlice.ts for why isManipulationPanelOpen is
    // tracked separately from activeTransformTool).
    if (isPanelOpen && activeTool === tool) {
      setManipulationPanelOpen(false);
      return;
    }
    setActiveTransformTool(tool as TransformTool);
    setManipulationPanelOpen(true);
    setLayOnFacePickModeActive(false);
    setArrangeSettingsOpen(false);
  };

  const showPanel = hasSelection && isPanelOpen;

  return (
    <div className="flex flex-col gap-2 items-start">
      <input
        ref={addFileInputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(',')}
        multiple
        onChange={handleAddFileChange}
        className="hidden"
      />
      <div
        className="flex gap-1 bg-gray-800 bg-opacity-90 p-1.5 rounded-lg shadow-lg"
        role="toolbar"
        aria-label="Transform tools"
      >
        {tools.map((tool, index) => {
          const Icon = tool.icon;
          const isModeTool = tool.id === 'move' || tool.id === 'rotate' || tool.id === 'scale';
          const isActive =
            (isModeTool && showPanel && activeTool === tool.id) ||
            (tool.id === 'layOnFace' && isLayOnFacePickModeActive) ||
            (tool.id === 'arrange' && isArrangeSettingsOpen);
          const disabled = tool.requiresSelection && !hasSelection;
          return (
            <React.Fragment key={tool.id}>
              {/* Divider after "Add" to visually separate it from the
                  selection-dependent transform tools, matching the
                  reference screenshots' toolbar grouping. */}
              {index === 1 && <div className="w-px bg-gray-600 mx-0.5" />}
              <button
                onClick={() => handleClick(tool.id)}
                disabled={disabled}
                aria-label={tool.label}
                aria-pressed={isActive}
                title={
                  disabled
                    ? `${tool.label} (select an object first)`
                    : tool.id === 'add'
                      ? 'Add model (STL, 3MF, OBJ, AMF)'
                      : tool.id === 'autoOrient'
                        ? hasSelection
                          ? 'Auto Orient (selected object)'
                          : 'Auto Orient (all objects)'
                        : tool.label
                }
                className={`
                  p-2 rounded transition-colors
                  ${isActive ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}
                  disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent
                `}
              >
                <Icon className="w-4 h-4" />
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {isLayOnFacePickModeActive && (
        <div className="bg-gray-800 bg-opacity-90 text-gray-200 text-xs px-3 py-1.5 rounded-lg shadow-lg">
          Click a highlighted face to lay it flat
        </div>
      )}

      {showPanel && <ObjectManipulationPanel />}
      {isArrangeSettingsOpen && <ArrangeSettingsPanel />}
    </div>
  );
};
