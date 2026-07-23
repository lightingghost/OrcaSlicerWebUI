import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LayerStepScrubbers } from './LayerStepScrubbers';
import { useStore } from '../../store';

vi.mock('../../store', () => ({
  useStore: vi.fn(),
}));

describe('LayerStepScrubbers', () => {
  const mockUseStore = useStore as unknown as ReturnType<typeof vi.fn>;
  const mockSetCurrentLayerIndex = vi.fn();
  const mockSetCurrentStepIndex = vi.fn();

  const layers = [
    { startSegmentIndex: 0, endSegmentIndex: 10, z: 0.2, height: 0.2 },
    { startSegmentIndex: 10, endSegmentIndex: 25, z: 0.4, height: 0.2 },
    { startSegmentIndex: 25, endSegmentIndex: 40, z: 0.6, height: 0.2 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const withState = (state: Record<string, unknown>) => {
    mockUseStore.mockImplementation((selector: (s: typeof state) => unknown) => selector(state));
  };

  it('renders nothing when there is no parsed gcode', () => {
    withState({
      parsedGcode: null,
      currentLayerIndex: 0,
      currentStepIndex: 0,
      setCurrentLayerIndex: mockSetCurrentLayerIndex,
      setCurrentStepIndex: mockSetCurrentStepIndex,
    });
    const { container } = render(<LayerStepScrubbers />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the layer slider bounded to [0, layers.length - 1], inverted so the top of the slider is the first layer', () => {
    withState({
      parsedGcode: { layers },
      currentLayerIndex: 1,
      currentStepIndex: 5,
      setCurrentLayerIndex: mockSetCurrentLayerIndex,
      setCurrentStepIndex: mockSetCurrentStepIndex,
    });
    render(<LayerStepScrubbers />);

    const layerSlider = screen.getByLabelText('Layer') as HTMLInputElement;
    const maxLayerIndex = layers.length - 1; // 2
    expect(layerSlider.min).toBe('0');
    expect(layerSlider.max).toBe(String(maxLayerIndex));
    // Native's vertical layer slider has layer 1 at the top and the
    // highest layer at the bottom. The underlying vertical <input
    // type="range"> naturally puts its max value at the top, so the
    // displayed slider value is inverted (maxLayerIndex - currentLayerIndex)
    // relative to the store's real currentLayerIndex.
    expect(layerSlider.value).toBe(String(maxLayerIndex - 1));
  });

  it('renders the step slider bounded to the current layer size', () => {
    withState({
      parsedGcode: { layers },
      currentLayerIndex: 1,
      currentStepIndex: 5,
      setCurrentLayerIndex: mockSetCurrentLayerIndex,
      setCurrentStepIndex: mockSetCurrentStepIndex,
    });
    render(<LayerStepScrubbers />);

    const stepSlider = screen.getByLabelText('Step') as HTMLInputElement;
    // layer 1 spans segments [10, 25) -> 15 steps
    expect(stepSlider.max).toBe('15');
    expect(stepSlider.value).toBe('5');
  });

  it('calls setCurrentLayerIndex with the inverted slider value (top-of-slider = first layer)', () => {
    withState({
      parsedGcode: { layers },
      currentLayerIndex: 1,
      currentStepIndex: 0,
      setCurrentLayerIndex: mockSetCurrentLayerIndex,
      setCurrentStepIndex: mockSetCurrentStepIndex,
    });
    render(<LayerStepScrubbers />);

    // maxLayerIndex is 2 (3 layers); currentLayerIndex starts at 1, so the
    // rendered slider value starts at (2 - 1) = 1. Change it to raw input
    // value 2 (top of slider) -> real layer index (2 - 2) = 0.
    fireEvent.change(screen.getByLabelText('Layer'), { target: { value: '2' } });
    expect(mockSetCurrentLayerIndex).toHaveBeenCalledWith(0);

    // ...and raw input value 0 (bottom of slider) -> real layer index (2 - 0) = 2.
    fireEvent.change(screen.getByLabelText('Layer'), { target: { value: '0' } });
    expect(mockSetCurrentLayerIndex).toHaveBeenCalledWith(2);
  });

  it('calls setCurrentStepIndex when the step slider changes', () => {
    withState({
      parsedGcode: { layers },
      currentLayerIndex: 0,
      currentStepIndex: 0,
      setCurrentLayerIndex: mockSetCurrentLayerIndex,
      setCurrentStepIndex: mockSetCurrentStepIndex,
    });
    render(<LayerStepScrubbers />);

    fireEvent.change(screen.getByLabelText('Step'), { target: { value: '7' } });
    expect(mockSetCurrentStepIndex).toHaveBeenCalledWith(7);
  });

  it('displays the 1-indexed current layer number and total layer count', () => {
    withState({
      parsedGcode: { layers },
      currentLayerIndex: 1,
      currentStepIndex: 5,
      setCurrentLayerIndex: mockSetCurrentLayerIndex,
      setCurrentStepIndex: mockSetCurrentStepIndex,
    });
    render(<LayerStepScrubbers />);

    expect(screen.getByText('2')).toBeInTheDocument(); // currentLayerIndex + 1
    expect(screen.getByText('3')).toBeInTheDocument(); // layers.length
  });
});
