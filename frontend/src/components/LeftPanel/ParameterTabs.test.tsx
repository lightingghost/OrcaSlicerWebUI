/**
 * ParameterTabs Component Tests
 * 
 * Tests tab navigation, descriptor loading, and integration with ParameterPanel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ParameterTabs } from './ParameterTabs';
import { useStore } from '../../store';

// Mock the store
vi.mock('../../store', () => ({
  useStore: vi.fn(),
}));

// Mock ParameterPanel component
vi.mock('./ParameterPanel', () => ({
  ParameterPanel: ({ section }: { section: string }) => (
    <div data-testid={`panel-${section}`}>Panel for {section}</div>
  ),
}));

describe('ParameterTabs', () => {
  const mockFetchDescriptors = vi.fn();

  const defaultStoreState = {
    fetchDescriptors: mockFetchDescriptors,
    parameterDescriptors: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(defaultStoreState);
  });

  it('calls fetchDescriptors on mount when descriptors are empty', async () => {
    mockFetchDescriptors.mockResolvedValue(undefined);

    render(<ParameterTabs />);

    await waitFor(() => {
      expect(mockFetchDescriptors).toHaveBeenCalledTimes(1);
    });
  });

  it('does not call fetchDescriptors if descriptors are already loaded', async () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      parameterDescriptors: [
        {
          key: 'test_param',
          label: 'Test',
          tooltip: 'Test param',
          type: 'float',
          default_value: 0,
          section: 'quality',
        },
      ],
    });

    render(<ParameterTabs />);

    // Wait a bit to ensure it doesn't call
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockFetchDescriptors).not.toHaveBeenCalled();
  });

  it('displays loading state while fetching descriptors', async () => {
    // Create a promise that never resolves to simulate loading
    mockFetchDescriptors.mockReturnValue(new Promise(() => {}));

    render(<ParameterTabs />);

    await waitFor(() => {
      expect(screen.getByText('Loading parameters...')).toBeInTheDocument();
    });
  });

  it('displays error message when fetch fails', async () => {
    mockFetchDescriptors.mockRejectedValue(new Error('Network error'));

    render(<ParameterTabs />);

    await waitFor(() => {
      expect(screen.getByText(/Network error/)).toBeInTheDocument();
    });
  });

  it('renders all tab buttons', async () => {
    mockFetchDescriptors.mockResolvedValue(undefined);
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      parameterDescriptors: [{ key: 'test', label: 'Test', tooltip: '', type: 'float', default_value: 0, section: 'quality' }],
    });

    render(<ParameterTabs />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Quality' })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Strength' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Support' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Multimaterial' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Others' })).toBeInTheDocument();
  });

  it('displays Quality tab as active by default', async () => {
    mockFetchDescriptors.mockResolvedValue(undefined);
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      parameterDescriptors: [{ key: 'test', label: 'Test', tooltip: '', type: 'float', default_value: 0, section: 'quality' }],
    });

    render(<ParameterTabs />);

    await waitFor(() => {
      const qualityTab = screen.getByRole('button', { name: 'Quality' });
      expect(qualityTab).toHaveClass('text-purple-400');
      expect(qualityTab).toHaveClass('border-purple-400');
    });
  });

  it('switches active tab when tab button is clicked', async () => {
    const user = userEvent.setup();
    mockFetchDescriptors.mockResolvedValue(undefined);
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      parameterDescriptors: [{ key: 'test', label: 'Test', tooltip: '', type: 'float', default_value: 0, section: 'quality' }],
    });

    render(<ParameterTabs />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Strength' })).toBeInTheDocument();
    });

    const strengthTab = screen.getByRole('button', { name: 'Strength' });
    await user.click(strengthTab);

    expect(strengthTab).toHaveClass('text-purple-400');
    expect(strengthTab).toHaveClass('border-purple-400');
  });

  it('renders ParameterPanel with correct section', async () => {
    mockFetchDescriptors.mockResolvedValue(undefined);
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      parameterDescriptors: [{ key: 'test', label: 'Test', tooltip: '', type: 'float', default_value: 0, section: 'quality' }],
    });

    render(<ParameterTabs />);

    await waitFor(() => {
      expect(screen.getByTestId('panel-quality')).toBeInTheDocument();
    });
  });

  it('updates ParameterPanel section when tab changes', async () => {
    const user = userEvent.setup();
    mockFetchDescriptors.mockResolvedValue(undefined);
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      parameterDescriptors: [{ key: 'test', label: 'Test', tooltip: '', type: 'float', default_value: 0, section: 'quality' }],
    });

    render(<ParameterTabs />);

    await waitFor(() => {
      expect(screen.getByTestId('panel-quality')).toBeInTheDocument();
    });

    const supportTab = screen.getByRole('button', { name: 'Support' });
    await user.click(supportTab);

    expect(screen.getByTestId('panel-support')).toBeInTheDocument();
    expect(screen.queryByTestId('panel-quality')).not.toBeInTheDocument();
  });

  it('maintains inactive styling for non-selected tabs', async () => {
    const user = userEvent.setup();
    mockFetchDescriptors.mockResolvedValue(undefined);
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      parameterDescriptors: [{ key: 'test', label: 'Test', tooltip: '', type: 'float', default_value: 0, section: 'quality' }],
    });

    render(<ParameterTabs />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Quality' })).toBeInTheDocument();
    });

    const strengthTab = screen.getByRole('button', { name: 'Strength' });
    
    // Should have inactive styling
    expect(strengthTab).toHaveClass('text-gray-400');
    expect(strengthTab).not.toHaveClass('border-purple-400');

    // Click to activate
    await user.click(strengthTab);

    // Now Quality should be inactive
    const qualityTab = screen.getByRole('button', { name: 'Quality' });
    expect(qualityTab).toHaveClass('text-gray-400');
    expect(qualityTab).not.toHaveClass('border-purple-400');
  });

  it('allows switching between all tabs', async () => {
    const user = userEvent.setup();
    mockFetchDescriptors.mockResolvedValue(undefined);
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      parameterDescriptors: [{ key: 'test', label: 'Test', tooltip: '', type: 'float', default_value: 0, section: 'quality' }],
    });

    render(<ParameterTabs />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Quality' })).toBeInTheDocument();
    });

    const tabs = ['Speed', 'Support', 'Multimaterial', 'Others'];

    for (const tabName of tabs) {
      const tab = screen.getByRole('button', { name: tabName });
      await user.click(tab);

      expect(tab).toHaveClass('text-purple-400');
      expect(tab).toHaveClass('border-purple-400');
    }
  });

  it('does not render tabs and panel during loading', () => {
    mockFetchDescriptors.mockReturnValue(new Promise(() => {}));

    render(<ParameterTabs />);

    expect(screen.queryByRole('button', { name: 'Quality' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('panel-quality')).not.toBeInTheDocument();
  });

  it('does not render tabs and panel when error occurs', async () => {
    mockFetchDescriptors.mockRejectedValue(new Error('Failed to load'));

    render(<ParameterTabs />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load/)).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'Quality' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('panel-quality')).not.toBeInTheDocument();
  });
});
