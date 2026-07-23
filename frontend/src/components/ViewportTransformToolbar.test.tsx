import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ViewportTransformToolbar } from './ViewportTransformToolbar';
import { useStore } from '../store';

vi.mock('../store', () => ({
  useStore: vi.fn(),
}));

describe('ViewportTransformToolbar', () => {
  const mockSetActiveTransformTool = vi.fn();
  const mockSetTransform = vi.fn();
  const mockSetManipulationPanelOpen = vi.fn();
  const mockSetLayOnFacePickModeActive = vi.fn();
  const mockDispatchTransformCommand = vi.fn();
  const mockSetArrangeSettingsOpen = vi.fn();
  const mockUploadFile = vi.fn().mockResolvedValue(undefined);

  const baseState = {
    selectedObjectId: null as string | null,
    activeTransformTool: 'move' as const,
    isManipulationPanelOpen: false,
    isLayOnFacePickModeActive: false,
    isArrangeSettingsOpen: false,
    objectTransformSnapshot: null,
    coordinateMode: 'world' as const,
    uniformScale: true,
    arrangeSettings: {
      spacing: 0,
      enableRotation: false,
      allowMultiMaterialsOnSamePlate: true,
      alignToYAxis: false,
    },
    setActiveTransformTool: mockSetActiveTransformTool,
    setManipulationPanelOpen: mockSetManipulationPanelOpen,
    setLayOnFacePickModeActive: mockSetLayOnFacePickModeActive,
    setTransform: mockSetTransform,
    setCoordinateMode: vi.fn(),
    setUniformScale: vi.fn(),
    dispatchTransformCommand: mockDispatchTransformCommand,
    setSelectedObjectId: vi.fn(),
    setArrangeSettingsOpen: mockSetArrangeSettingsOpen,
    setArrangeSetting: vi.fn(),
    resetArrangeSettings: vi.fn(),
    triggerArrange: vi.fn(),
    uploadFile: mockUploadFile,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) => selector(baseState)
    );
  });

  it('renders Add, Move, Rotate, Scale, and Arrange buttons', () => {
    render(<ViewportTransformToolbar />);

    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rotate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scale' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Arrange' })).toBeInTheDocument();
  });

  it('Add is the first button in the toolbar', () => {
    render(<ViewportTransformToolbar />);
    const toolbar = screen.getByRole('toolbar', { name: 'Transform tools' });
    const buttons = within(toolbar).getAllByRole('button');
    expect(buttons[0]).toHaveAttribute('aria-label', 'Add');
  });

  it('Add is enabled even with no object selected', () => {
    render(<ViewportTransformToolbar />);
    expect(screen.getByRole('button', { name: 'Add' })).not.toBeDisabled();
  });

  it('clicking Add opens the native file picker (hidden file input)', () => {
    render(<ViewportTransformToolbar />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click');

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('the hidden file input accepts multiple STL/3MF/OBJ/AMF files', () => {
    render(<ViewportTransformToolbar />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toHaveAttribute('multiple');
    expect(fileInput.accept).toContain('.stl');
    expect(fileInput.accept).toContain('.3mf');
    expect(fileInput.accept).toContain('.obj');
    expect(fileInput.accept).toContain('.amf');
  });

  it('calls uploadFile for each file selected via the Add file input (supports multiple models)', () => {
    render(<ViewportTransformToolbar />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    const fileA = new File(['a'], 'a.stl', { type: 'model/stl' });
    const fileB = new File(['b'], 'b.3mf', { type: 'model/3mf' });
    Object.defineProperty(fileInput, 'files', { value: [fileA, fileB], writable: false });

    fireEvent.change(fileInput);

    expect(mockUploadFile).toHaveBeenCalledTimes(2);
    expect(mockUploadFile).toHaveBeenCalledWith(fileA);
    expect(mockUploadFile).toHaveBeenCalledWith(fileB);
  });

  it('exposes a toolbar role with an accessible label', () => {
    render(<ViewportTransformToolbar />);
    expect(screen.getByRole('toolbar', { name: 'Transform tools' })).toBeInTheDocument();
  });

  it('disables Move/Rotate/Scale when no object is selected, but not Arrange', () => {
    render(<ViewportTransformToolbar />);

    expect(screen.getByRole('button', { name: 'Move' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rotate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Scale' })).toBeDisabled();
    // Arrange always arranges every object on the plate, matching native's
    // toolbar Arrange button — it doesn't require a selection.
    expect(screen.getByRole('button', { name: 'Arrange' })).not.toBeDisabled();
  });

  it('enables Move/Rotate/Scale when an object is selected', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({ ...baseState, selectedObjectId: 'file-1' })
    );

    render(<ViewportTransformToolbar />);

    expect(screen.getByRole('button', { name: 'Move' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rotate' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Scale' })).not.toBeDisabled();
  });

  it('calls setActiveTransformTool and opens the panel when Rotate is clicked with a selection', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({ ...baseState, selectedObjectId: 'file-1' })
    );

    render(<ViewportTransformToolbar />);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));

    expect(mockSetActiveTransformTool).toHaveBeenCalledWith('rotate');
    expect(mockSetManipulationPanelOpen).toHaveBeenCalledWith(true);
  });

  it('does NOT show the manipulation panel just because an object is selected', () => {
    // Selecting an object sets selectedObjectId but isManipulationPanelOpen
    // stays false until the user explicitly clicks a tool button — the
    // panel must never auto-open using whatever tool was last active.
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({ ...baseState, selectedObjectId: 'file-1', isManipulationPanelOpen: false })
    );

    render(<ViewportTransformToolbar />);
    expect(screen.queryByLabelText('Coordinate system used for transform actions')).toBeNull();
  });

  it('shows the manipulation panel once isManipulationPanelOpen is true and an object is selected', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({
          ...baseState,
          selectedObjectId: 'file-1',
          isManipulationPanelOpen: true,
          objectTransformSnapshot: {
            position: [0, 0, 0],
            rotationRelative: [0, 0, 0],
            rotationAbsolute: [0, 0, 0],
            scale: [100, 100, 100],
            size: [10, 10, 10],
          },
        })
    );

    render(<ViewportTransformToolbar />);
    expect(screen.getByLabelText('Coordinate system used for transform actions')).toBeInTheDocument();
  });

  it('closes the panel when clicking the already-active tool again', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({
          ...baseState,
          selectedObjectId: 'file-1',
          isManipulationPanelOpen: true,
          activeTransformTool: 'move',
        })
    );

    render(<ViewportTransformToolbar />);
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    expect(mockSetManipulationPanelOpen).toHaveBeenCalledWith(false);
  });

  it('opens the Arrange settings popup when Arrange is clicked (does not act immediately)', () => {
    render(<ViewportTransformToolbar />);
    fireEvent.click(screen.getByRole('button', { name: 'Arrange' }));

    expect(mockSetArrangeSettingsOpen).toHaveBeenCalledWith(true);
    expect(mockSetTransform).not.toHaveBeenCalled();
    expect(mockSetActiveTransformTool).not.toHaveBeenCalled();
  });

  it('closes the Arrange settings popup when the toolbar Arrange button is clicked again while open', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({ ...baseState, isArrangeSettingsOpen: true })
    );

    render(<ViewportTransformToolbar />);
    // With the popup open, both the toolbar icon button AND the popup's
    // own "Arrange" action button share the name "Arrange" — target the
    // toolbar's icon button specifically via its toolbar role ancestor.
    const toolbar = screen.getByRole('toolbar', { name: 'Transform tools' });
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Arrange' }));

    expect(mockSetArrangeSettingsOpen).toHaveBeenCalledWith(false);
  });

  it('renders the ArrangeSettingsPanel when isArrangeSettingsOpen is true', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({ ...baseState, isArrangeSettingsOpen: true })
    );

    render(<ViewportTransformToolbar />);
    expect(screen.getByLabelText('Spacing')).toBeInTheDocument();
  });

  it('renders a single Lay on Face button and a single Auto Orient button', () => {
    render(<ViewportTransformToolbar />);
    expect(screen.getByRole('button', { name: 'Lay on Face' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Auto Orient' })).toHaveLength(1);
  });

  it('Auto Orient is enabled even with no selection (falls back to orient all)', () => {
    render(<ViewportTransformToolbar />);
    expect(screen.getByRole('button', { name: 'Auto Orient' })).not.toBeDisabled();
  });

  it('Lay on Face is disabled without a selection', () => {
    render(<ViewportTransformToolbar />);
    expect(screen.getByRole('button', { name: 'Lay on Face' })).toBeDisabled();
  });

  it('toggles Lay on Face pick mode on click, without opening the manipulation panel', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({ ...baseState, selectedObjectId: 'file-1' })
    );

    render(<ViewportTransformToolbar />);
    fireEvent.click(screen.getByRole('button', { name: 'Lay on Face' }));

    expect(mockSetLayOnFacePickModeActive).toHaveBeenCalledWith(true);
    expect(mockSetManipulationPanelOpen).not.toHaveBeenCalledWith(true);
  });

  it('shows a hint banner while Lay on Face pick mode is active', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({ ...baseState, selectedObjectId: 'file-1', isLayOnFacePickModeActive: true })
    );

    render(<ViewportTransformToolbar />);
    expect(screen.getByText(/Click a highlighted face/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lay on Face' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('dispatches an autoOrient("selected") command when Auto Orient is clicked WITH a selection', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({ ...baseState, selectedObjectId: 'file-1' })
    );

    render(<ViewportTransformToolbar />);
    fireEvent.click(screen.getByRole('button', { name: 'Auto Orient' }));

    expect(mockDispatchTransformCommand).toHaveBeenCalledWith({ type: 'autoOrient', scope: 'selected' });
  });

  it('dispatches an autoOrient("all") command when Auto Orient is clicked WITHOUT a selection', () => {
    render(<ViewportTransformToolbar />);
    fireEvent.click(screen.getByRole('button', { name: 'Auto Orient' }));

    expect(mockDispatchTransformCommand).toHaveBeenCalledWith({ type: 'autoOrient', scope: 'all' });
  });

  it('marks the active tool as pressed when the panel is open', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({
          ...baseState,
          selectedObjectId: 'file-1',
          activeTransformTool: 'scale',
          isManipulationPanelOpen: true,
        })
    );

    render(<ViewportTransformToolbar />);

    expect(screen.getByRole('button', { name: 'Scale' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Move' })).toHaveAttribute('aria-pressed', 'false');
  });
});
