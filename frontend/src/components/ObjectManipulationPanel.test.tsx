import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ObjectManipulationPanel } from './ObjectManipulationPanel';
import { useStore } from '../store';
import type { ObjectTransformSnapshot } from '../lib/objectTransform';

vi.mock('../store', () => ({
  useStore: vi.fn(),
}));

const baseSnapshot: ObjectTransformSnapshot = {
  position: [1, 2, 3],
  rotationRelative: [0, 0, 0],
  rotationAbsolute: [10, 20, 30],
  scale: [100, 100, 100],
  size: [50, 60, 70],
};

describe('ObjectManipulationPanel', () => {
  const dispatchTransformCommand = vi.fn();
  const setCoordinateMode = vi.fn();
  const setUniformScale = vi.fn();
  const setSelectedObjectId = vi.fn();

  const baseState = {
    selectedObjectId: 'file-1',
    activeTransformTool: 'move' as const,
    coordinateMode: 'world' as const,
    uniformScale: true,
    objectTransformSnapshot: baseSnapshot,
    setCoordinateMode,
    setUniformScale,
    dispatchTransformCommand,
    setSelectedObjectId,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) => selector(baseState)
    );
  });

  it('renders nothing when no object is selected', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({ ...baseState, selectedObjectId: null })
    );
    const { container } = render(<ObjectManipulationPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the coordinate mode dropdown with World/Object options', () => {
    render(<ObjectManipulationPanel />);
    const select = screen.getByLabelText('Coordinate system used for transform actions');
    expect(select).toBeInTheDocument();
    expect(screen.getByText('World coordinates')).toBeInTheDocument();
    expect(screen.getByText('Object coordinates')).toBeInTheDocument();
  });

  it('shows Position fields for the Move tool', () => {
    render(<ObjectManipulationPanel />);
    expect(screen.getByText('Position')).toBeInTheDocument();
    expect(screen.getByLabelText('Position X')).toHaveValue(1);
    expect(screen.getByLabelText('Position Y')).toHaveValue(2);
    expect(screen.getByLabelText('Position Z')).toHaveValue(3);
  });

  it('dispatches a position command when a Position field changes', () => {
    render(<ObjectManipulationPanel />);
    fireEvent.change(screen.getByLabelText('Position X'), { target: { value: '42' } });
    expect(dispatchTransformCommand).toHaveBeenCalledWith({ type: 'position', axis: 0, value: 42 });
  });

  it('shows Rotate (relative) and Rotate (absolute) fields for the Rotate tool', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({ ...baseState, activeTransformTool: 'rotate' })
    );
    render(<ObjectManipulationPanel />);
    expect(screen.getByText('Rotate (relative)')).toBeInTheDocument();
    expect(screen.getByText('Rotate (absolute)')).toBeInTheDocument();
    expect(screen.getByLabelText('Rotate absolute Z')).toHaveValue(30);
  });

  it('dispatches a rotateAbsolute command when an absolute rotate field changes', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({ ...baseState, activeTransformTool: 'rotate' })
    );
    render(<ObjectManipulationPanel />);
    fireEvent.change(screen.getByLabelText('Rotate absolute Z'), { target: { value: '90' } });
    expect(dispatchTransformCommand).toHaveBeenCalledWith({
      type: 'rotateAbsolute',
      axis: 2,
      degrees: 90,
    });
  });

  it('shows Scale and Size fields plus Uniform scale checkbox for the Scale tool', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({ ...baseState, activeTransformTool: 'scale' })
    );
    render(<ObjectManipulationPanel />);
    expect(screen.getByText('Scale')).toBeInTheDocument();
    expect(screen.getByText('Size')).toBeInTheDocument();
    expect(screen.getByText('Uniform scale')).toBeInTheDocument();
    expect(screen.getByLabelText('Size X')).toHaveValue(50);
  });

  it('dispatches a scaleRatio command computed from the displayed percentage', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({ ...baseState, activeTransformTool: 'scale' })
    );
    render(<ObjectManipulationPanel />);
    // current scale[0] = 100%, so entering 200 should produce ratio = 2
    fireEvent.change(screen.getByLabelText('Scale X'), { target: { value: '200' } });
    expect(dispatchTransformCommand).toHaveBeenCalledWith({ type: 'scaleRatio', axis: 0, ratio: 2 });
  });

  it('calls setUniformScale when the checkbox is toggled', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({ ...baseState, activeTransformTool: 'scale' })
    );
    render(<ObjectManipulationPanel />);
    fireEvent.click(screen.getByLabelText('Uniform scale'));
    expect(setUniformScale).toHaveBeenCalledWith(false);
  });

  it('calls setCoordinateMode when the dropdown changes', () => {
    render(<ObjectManipulationPanel />);
    fireEvent.change(screen.getByLabelText('Coordinate system used for transform actions'), {
      target: { value: 'object' },
    });
    expect(setCoordinateMode).toHaveBeenCalledWith('object');
  });

  it('deselects the object when Done is clicked', () => {
    render(<ObjectManipulationPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(setSelectedObjectId).toHaveBeenCalledWith(null);
  });
});
