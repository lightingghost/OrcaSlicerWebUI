import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TransformPanel } from './TransformPanel';
import { useStore } from '../../store';

describe('TransformPanel', () => {
  beforeEach(() => {
    // Reset store before each test
    useStore.getState().resetTransforms();
  });

  it('renders all transform controls', () => {
    render(<TransformPanel />);

    // Check for main heading
    expect(screen.getByText('Transform Options')).toBeInTheDocument();

    // Check for rotation controls
    expect(screen.getByText('Rotation (degrees)')).toBeInTheDocument();
    expect(screen.getByText('Z-axis')).toBeInTheDocument();
    expect(screen.getByText('X-axis')).toBeInTheDocument();
    expect(screen.getByText('Y-axis')).toBeInTheDocument();

    // Check for scale control
    expect(screen.getByText('Scale Factor')).toBeInTheDocument();

    // Check for arrange control
    expect(screen.getByText('Arrange Mode')).toBeInTheDocument();

    // Check for orient control
    expect(screen.getByText('Orient Mode')).toBeInTheDocument();

    // Check for repetitions control
    expect(screen.getByText('Repetitions')).toBeInTheDocument();

    // Check for boolean flags
    expect(screen.getByText('Ensure On Bed')).toBeInTheDocument();
    expect(screen.getByText('Assemble')).toBeInTheDocument();
    expect(screen.getByText('Convert Unit')).toBeInTheDocument();
  });

  it('displays default values', () => {
    render(<TransformPanel />);

    const rotateInput = screen.getByLabelText('Z-axis') as HTMLInputElement;
    const scaleInput = screen.getByLabelText('Scale Factor') as HTMLInputElement;
    const arrangeSelect = screen.getByLabelText('Arrange Mode') as HTMLSelectElement;

    expect(rotateInput.value).toBe('0');
    expect(scaleInput.value).toBe('1');
    expect(arrangeSelect.value).toBe('0');
  });

  it('updates store when numeric inputs change', async () => {
    render(<TransformPanel />);

    const rotateInput = screen.getByLabelText('Z-axis') as HTMLInputElement;

    // Change the value
    fireEvent.change(rotateInput, { target: { value: '45' } });

    // Wait for debounce (50ms + buffer)
    await waitFor(
      () => {
        expect(useStore.getState().transforms.rotate).toBe(45);
      },
      { timeout: 150 }
    );
  });

  it('updates store when boolean inputs change', () => {
    render(<TransformPanel />);

    const ensureOnBedCheckbox = screen.getByLabelText('Ensure On Bed') as HTMLInputElement;

    expect(ensureOnBedCheckbox.checked).toBe(false);

    // Toggle checkbox
    fireEvent.click(ensureOnBedCheckbox);

    // Boolean changes are not debounced, should update immediately
    expect(useStore.getState().transforms.ensure_on_bed).toBe(true);
  });

  it('updates store when select inputs change', () => {
    render(<TransformPanel />);

    const arrangeSelect = screen.getByLabelText('Arrange Mode') as HTMLSelectElement;

    // Change to Mode 1
    fireEvent.change(arrangeSelect, { target: { value: '1' } });

    expect(useStore.getState().transforms.arrange).toBe(1);
  });

  it('shows arrange sub-options when arrange is 1', () => {
    render(<TransformPanel />);

    const arrangeSelect = screen.getByLabelText('Arrange Mode') as HTMLSelectElement;

    // Initially, arrange sub-options should not be visible
    expect(screen.queryByText('Arrange Options')).not.toBeInTheDocument();

    // Change to Mode 1
    fireEvent.change(arrangeSelect, { target: { value: '1' } });

    // Arrange sub-options should now be visible
    expect(screen.getByText('Arrange Options')).toBeInTheDocument();
    expect(screen.getByText('Allow Rotations')).toBeInTheDocument();
    expect(screen.getByText('Allow Multicolor One Plate')).toBeInTheDocument();
    expect(screen.getByText('Avoid Extrusion Calibration Region')).toBeInTheDocument();
  });

  it('shows arrange sub-options when arrange is 2', () => {
    render(<TransformPanel />);

    const arrangeSelect = screen.getByLabelText('Arrange Mode') as HTMLSelectElement;

    // Change to Mode 2
    fireEvent.change(arrangeSelect, { target: { value: '2' } });

    // Arrange sub-options should be visible
    expect(screen.getByText('Arrange Options')).toBeInTheDocument();
  });

  it('hides arrange sub-options when arrange is 0', () => {
    render(<TransformPanel />);

    const arrangeSelect = screen.getByLabelText('Arrange Mode') as HTMLSelectElement;

    // Set to Mode 1 first
    fireEvent.change(arrangeSelect, { target: { value: '1' } });
    expect(screen.getByText('Arrange Options')).toBeInTheDocument();

    // Change back to 0
    fireEvent.change(arrangeSelect, { target: { value: '0' } });

    // Arrange sub-options should be hidden
    expect(screen.queryByText('Arrange Options')).not.toBeInTheDocument();
  });

  it('handles all rotation axes independently', async () => {
    render(<TransformPanel />);

    const rotateZInput = screen.getByLabelText('Z-axis') as HTMLInputElement;
    const rotateXInput = screen.getByLabelText('X-axis') as HTMLInputElement;
    const rotateYInput = screen.getByLabelText('Y-axis') as HTMLInputElement;

    fireEvent.change(rotateZInput, { target: { value: '90' } });
    fireEvent.change(rotateXInput, { target: { value: '45' } });
    fireEvent.change(rotateYInput, { target: { value: '30' } });

    // Wait for debounce
    await waitFor(
      () => {
        const transforms = useStore.getState().transforms;
        expect(transforms.rotate).toBe(90);
        expect(transforms.rotate_x).toBe(45);
        expect(transforms.rotate_y).toBe(30);
      },
      { timeout: 150 }
    );
  });

  it('handles scale input correctly', async () => {
    render(<TransformPanel />);

    const scaleInput = screen.getByLabelText('Scale Factor') as HTMLInputElement;

    fireEvent.change(scaleInput, { target: { value: '2.5' } });

    // Wait for debounce
    await waitFor(
      () => {
        expect(useStore.getState().transforms.scale).toBe(2.5);
      },
      { timeout: 150 }
    );
  });

  it('handles repetitions input correctly', async () => {
    render(<TransformPanel />);

    const repetitionsInput = screen.getByLabelText('Repetitions') as HTMLInputElement;

    fireEvent.change(repetitionsInput, { target: { value: '5' } });

    // Wait for debounce
    await waitFor(
      () => {
        expect(useStore.getState().transforms.repetitions).toBe(5);
      },
      { timeout: 150 }
    );
  });

  it('handles orient mode changes', () => {
    render(<TransformPanel />);

    const orientSelect = screen.getByLabelText('Orient Mode') as HTMLSelectElement;

    fireEvent.change(orientSelect, { target: { value: '2' } });

    expect(useStore.getState().transforms.orient).toBe(2);
  });

  it('handles arrange sub-option checkboxes', () => {
    render(<TransformPanel />);

    const arrangeSelect = screen.getByLabelText('Arrange Mode') as HTMLSelectElement;

    // Enable arrange to show sub-options
    fireEvent.change(arrangeSelect, { target: { value: '1' } });

    const allowRotationsCheckbox = screen.getByLabelText('Allow Rotations') as HTMLInputElement;
    const allowMulticolorCheckbox = screen.getByLabelText(
      'Allow Multicolor One Plate'
    ) as HTMLInputElement;
    const avoidCalibrationCheckbox = screen.getByLabelText(
      'Avoid Extrusion Calibration Region'
    ) as HTMLInputElement;

    // Toggle checkboxes
    fireEvent.click(allowRotationsCheckbox);
    fireEvent.click(allowMulticolorCheckbox);
    fireEvent.click(avoidCalibrationCheckbox);

    const transforms = useStore.getState().transforms;
    expect(transforms.allow_rotations).toBe(true);
    expect(transforms.allow_multicolor_oneplate).toBe(true);
    expect(transforms.avoid_extrusion_cali_region).toBe(true);
  });

  it('debounces numeric inputs with 50ms delay', async () => {
    const setTransformSpy = vi.spyOn(useStore.getState(), 'setTransform');

    render(<TransformPanel />);

    const rotateInput = screen.getByLabelText('Z-axis') as HTMLInputElement;

    // Change value rapidly
    fireEvent.change(rotateInput, { target: { value: '10' } });
    fireEvent.change(rotateInput, { target: { value: '20' } });
    fireEvent.change(rotateInput, { target: { value: '30' } });

    // Should not call setTransform immediately
    expect(setTransformSpy).not.toHaveBeenCalled();

    // Wait for debounce to complete
    await waitFor(
      () => {
        expect(useStore.getState().transforms.rotate).toBe(30);
      },
      { timeout: 150 }
    );

    setTransformSpy.mockRestore();
  });

  it('handles all boolean flags', () => {
    render(<TransformPanel />);

    const ensureOnBedCheckbox = screen.getByLabelText('Ensure On Bed') as HTMLInputElement;
    const assembleCheckbox = screen.getByLabelText('Assemble') as HTMLInputElement;
    const convertUnitCheckbox = screen.getByLabelText('Convert Unit') as HTMLInputElement;

    // Toggle all checkboxes
    fireEvent.click(ensureOnBedCheckbox);
    fireEvent.click(assembleCheckbox);
    fireEvent.click(convertUnitCheckbox);

    const transforms = useStore.getState().transforms;
    expect(transforms.ensure_on_bed).toBe(true);
    expect(transforms.assemble).toBe(true);
    expect(transforms.convert_unit).toBe(true);
  });
});
