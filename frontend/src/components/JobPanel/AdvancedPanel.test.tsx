import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AdvancedPanel } from './AdvancedPanel';
import { useStore } from '../../store';

describe('AdvancedPanel', () => {
  beforeEach(() => {
    // Reset store state before each test
    useStore.getState().resetMisc?.();
  });

  it('always shows the advanced option fields, with no expand/collapse toggle', () => {
    render(<AdvancedPanel />);
    expect(screen.getByText('Advanced Options')).toBeInTheDocument();
    // No toggle button — the heading is now a plain heading, not a button.
    expect(screen.queryByRole('button', { name: /advanced options/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Data Directory')).toBeInTheDocument();
    expect(screen.getByLabelText('Debug Level')).toBeInTheDocument();
  });

  it('updates datadir in store when text input changes', async () => {
    render(<AdvancedPanel />);

    const input = screen.getByLabelText('Data Directory') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/custom/path' } });
    
    await waitFor(() => {
      expect(useStore.getState().misc.datadir).toBe('/custom/path');
    });
  });

  it('updates debug level in store when dropdown changes', async () => {
    render(<AdvancedPanel />);

    const select = screen.getByLabelText('Debug Level') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '3' } });
    
    await waitFor(() => {
      expect(useStore.getState().misc.debug).toBe(3);
    });
  });

  it('validates skip_objects input and shows error for invalid integers', async () => {
    render(<AdvancedPanel />);

    const input = screen.getByLabelText('Skip Objects') as HTMLInputElement;
    
    // Enter invalid value
    fireEvent.change(input, { target: { value: '1, abc, 3' } });
    
    await waitFor(() => {
      expect(screen.getByText(/"abc" is not a positive integer/i)).toBeInTheDocument();
    });
  });

  it('validates skip_objects input and accepts valid positive integers', async () => {
    render(<AdvancedPanel />);

    const input = screen.getByLabelText('Skip Objects') as HTMLInputElement;
    
    // Enter valid value
    fireEvent.change(input, { target: { value: '1, 2, 3' } });
    
    await waitFor(() => {
      expect(useStore.getState().misc.skip_objects).toEqual([1, 2, 3]);
      expect(useStore.getState().miscValidationErrors.skip_objects).toBeUndefined();
    });
  });

  it('rejects zero and negative integers in skip_objects', async () => {
    render(<AdvancedPanel />);

    const input = screen.getByLabelText('Skip Objects') as HTMLInputElement;
    
    // Enter zero
    fireEvent.change(input, { target: { value: '0, 1' } });
    
    await waitFor(() => {
      expect(screen.getByText(/"0" is not a positive integer/i)).toBeInTheDocument();
    });
    
    // Enter negative
    fireEvent.change(input, { target: { value: '-1, 2' } });
    
    await waitFor(() => {
      expect(screen.getByText(/"-1" is not a positive integer/i)).toBeInTheDocument();
    });
  });

  it('updates boolean flags in store when checkboxes change', async () => {
    render(<AdvancedPanel />);

    const checkbox = screen.getByLabelText('Allow Newer File') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    
    fireEvent.click(checkbox);
    
    await waitFor(() => {
      expect(useStore.getState().misc.allow_newer_file).toBe(true);
    });
  });

  it('renders all boolean flag checkboxes', () => {
    render(<AdvancedPanel />);

    expect(screen.getByLabelText('Allow Newer File')).toBeInTheDocument();
    expect(screen.getByLabelText('Allow Mixed Temperature')).toBeInTheDocument();
    expect(screen.getByLabelText('Skip Modified G-codes')).toBeInTheDocument();
    expect(screen.getByLabelText('Downward Check')).toBeInTheDocument();
    expect(screen.getByLabelText('Enable Timelapse')).toBeInTheDocument();
  });

  it('validates clone_objects input correctly', async () => {
    render(<AdvancedPanel />);

    const input = screen.getByLabelText('Clone Objects') as HTMLInputElement;
    
    // Valid input
    fireEvent.change(input, { target: { value: '5, 10, 15' } });
    
    await waitFor(() => {
      expect(useStore.getState().misc.clone_objects).toEqual([5, 10, 15]);
      expect(useStore.getState().miscValidationErrors.clone_objects).toBeUndefined();
    });
  });

  it('validates load_filament_ids input correctly', async () => {
    render(<AdvancedPanel />);

    const input = screen.getByLabelText('Load Filament IDs') as HTMLInputElement;
    
    // Valid input
    fireEvent.change(input, { target: { value: '100, 200, 300' } });
    
    await waitFor(() => {
      expect(useStore.getState().misc.load_filament_ids).toEqual([100, 200, 300]);
      expect(useStore.getState().miscValidationErrors.load_filament_ids).toBeUndefined();
    });
  });

  it('handles empty comma-separated inputs correctly', async () => {
    render(<AdvancedPanel />);

    const input = screen.getByLabelText('Skip Objects') as HTMLInputElement;
    
    // Empty input should clear the array
    fireEvent.change(input, { target: { value: '' } });
    
    await waitFor(() => {
      expect(useStore.getState().misc.skip_objects).toBeUndefined();
      expect(useStore.getState().miscValidationErrors.skip_objects).toBeUndefined();
    });
  });

  it('trims whitespace in comma-separated inputs', async () => {
    render(<AdvancedPanel />);

    const input = screen.getByLabelText('Skip Objects') as HTMLInputElement;
    
    // Input with extra whitespace
    fireEvent.change(input, { target: { value: '  1  ,  2  ,  3  ' } });
    
    await waitFor(() => {
      expect(useStore.getState().misc.skip_objects).toEqual([1, 2, 3]);
    });
  });
});
