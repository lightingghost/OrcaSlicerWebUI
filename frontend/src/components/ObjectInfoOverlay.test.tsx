import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ObjectInfoOverlay } from './ObjectInfoOverlay';
import { useStore } from '../store';

describe('ObjectInfoOverlay', () => {
  beforeEach(() => {
    // Reset store state before each test
    const state = useStore.getState();
    state.setModelBounds(null as any);
    state.setModelMetadata(null as any);
    state.setInfoOverlayOpen(true);
  });

  it('should not render when no model is loaded', () => {
    const { container } = render(<ObjectInfoOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('should not render when only bounds are set without metadata', () => {
    const state = useStore.getState();
    state.setModelBounds({
      min: { x: -10, y: -10, z: 0 },
      max: { x: 10, y: 10, z: 20 },
    });

    const { container } = render(<ObjectInfoOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('should not render when only metadata is set without bounds', () => {
    const state = useStore.getState();
    state.setModelMetadata({
      filename: 'test.stl',
      triangleCount: 1000,
    });

    const { container } = render(<ObjectInfoOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('should render all required fields when model is loaded', () => {
    const state = useStore.getState();
    
    // Set bounds: 20mm × 30mm × 40mm
    state.setModelBounds({
      min: { x: -10, y: -15, z: 0 },
      max: { x: 10, y: 15, z: 40 },
    });

    state.setModelMetadata({
      filename: 'test_model.stl',
      triangleCount: 5000,
    });

    render(<ObjectInfoOverlay />);

    // Check filename
    expect(screen.getByText('test_model.stl')).toBeTruthy();

    // Check dimensions (W × D × H)
    expect(screen.getByText(/20\.00 × 30\.00 × 40\.00 mm/)).toBeTruthy();

    // Check volume (20 * 30 * 40 = 24000 mm³)
    expect(screen.getByText(/24000\.00 mm³/)).toBeTruthy();

    // Check triangle count (formatted with thousands separator)
    expect(screen.getByText('5,000')).toBeTruthy();
  });

  it('should format dimensions with 2 decimal places', () => {
    const state = useStore.getState();
    
    // Set bounds with non-round numbers
    state.setModelBounds({
      min: { x: -5.555, y: -7.777, z: 0 },
      max: { x: 5.555, y: 7.777, z: 10.123 },
    });

    state.setModelMetadata({
      filename: 'precise.stl',
      triangleCount: 100,
    });

    render(<ObjectInfoOverlay />);

    // Width: 11.11, Depth: 15.554, Height: 10.123
    expect(screen.getByText(/11\.11 × 15\.55 × 10\.12 mm/)).toBeTruthy();
  });

  it('should format volume with 2 decimal places', () => {
    const state = useStore.getState();
    
    state.setModelBounds({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 3.333, y: 4.444, z: 5.555 },
    });

    state.setModelMetadata({
      filename: 'volume_test.stl',
      triangleCount: 200,
    });

    const { container } = render(<ObjectInfoOverlay />);

    // Volume: 3.333 * 4.444 * 5.555 ≈ 82.28 mm³ (rendered as 82.28)
    const volumeText = container.textContent;
    expect(volumeText).toContain('82.28');
    expect(volumeText).toContain('mm³');
  });

  it('should format triangle count with thousands separators', () => {
    const state = useStore.getState();
    
    state.setModelBounds({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 10, y: 10, z: 10 },
    });

    state.setModelMetadata({
      filename: 'high_poly.stl',
      triangleCount: 1234567,
    });

    render(<ObjectInfoOverlay />);

    // Should format as 1,234,567
    expect(screen.getByText('1,234,567')).toBeTruthy();
  });

  it('should truncate long filenames with ellipsis', () => {
    const state = useStore.getState();
    
    state.setModelBounds({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 10, y: 10, z: 10 },
    });

    const longFilename = 'this_is_a_very_long_filename_that_should_be_truncated_with_ellipsis.stl';
    state.setModelMetadata({
      filename: longFilename,
      triangleCount: 500,
    });

    render(<ObjectInfoOverlay />);

    // Should have truncate class
    const filenameElement = screen.getByText(longFilename);
    expect(filenameElement.className).toContain('truncate');
    
    // Should have title attribute for tooltip
    expect(filenameElement.getAttribute('title')).toBe(longFilename);
  });

  it('should display all metric labels', () => {
    const state = useStore.getState();
    
    state.setModelBounds({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 10, y: 10, z: 10 },
    });

    state.setModelMetadata({
      filename: 'test.stl',
      triangleCount: 100,
    });

    render(<ObjectInfoOverlay />);

    // Check all metric labels are present (each shares a row with its value)
    expect(screen.getByText('Dimensions')).toBeTruthy();
    expect(screen.getByText('Volume')).toBeTruthy();
    expect(screen.getByText('Triangles')).toBeTruthy();
  });

  it('should render a close button that hides the overlay when clicked', () => {
    const state = useStore.getState();

    state.setModelBounds({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 10, y: 10, z: 10 },
    });
    state.setModelMetadata({
      filename: 'test.stl',
      triangleCount: 100,
    });
    state.setInfoOverlayOpen(true);

    render(<ObjectInfoOverlay />);
    expect(screen.getByText('test.stl')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Close object parameters'));
    expect(useStore.getState().isInfoOverlayOpen).toBe(false);
  });

  it('should not render when isInfoOverlayOpen is false, even with a loaded model', () => {
    const state = useStore.getState();

    state.setModelBounds({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 10, y: 10, z: 10 },
    });
    state.setModelMetadata({
      filename: 'test.stl',
      triangleCount: 100,
    });
    state.setInfoOverlayOpen(false);

    const { container } = render(<ObjectInfoOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('should be positioned in top-right corner', () => {
    const state = useStore.getState();
    
    state.setModelBounds({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 10, y: 10, z: 10 },
    });

    state.setModelMetadata({
      filename: 'test.stl',
      triangleCount: 100,
    });

    const { container } = render(<ObjectInfoOverlay />);
    
    const overlay = container.firstChild as HTMLElement;
    expect(overlay.className).toContain('absolute');
    expect(overlay.className).toContain('top-4');
    expect(overlay.className).toContain('right-4');
  });

  it('should have proper styling and layout', () => {
    const state = useStore.getState();
    
    state.setModelBounds({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 10, y: 10, z: 10 },
    });

    state.setModelMetadata({
      filename: 'test.stl',
      triangleCount: 100,
    });

    const { container } = render(<ObjectInfoOverlay />);
    
    const overlay = container.firstChild as HTMLElement;
    
    // Check styling classes
    expect(overlay.className).toContain('bg-gray-800');
    expect(overlay.className).toContain('bg-opacity-90');
    expect(overlay.className).toContain('text-white');
    expect(overlay.className).toContain('rounded-lg');
    expect(overlay.className).toContain('shadow-lg');
    
    // Check z-index for proper layering
    expect(overlay.className).toContain('z-10');
  });
});
