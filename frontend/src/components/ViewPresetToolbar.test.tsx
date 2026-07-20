import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ViewPresetToolbar } from './ViewPresetToolbar';
import { useStore } from '../store';

// Mock the store
vi.mock('../store', () => ({
  useStore: vi.fn(),
}));

describe('ViewPresetToolbar', () => {
  beforeEach(() => {
    // Setup the mock to return cameraPreset: 'home'
    vi.mocked(useStore).mockReturnValue('home' as any);
  });

  it('renders all four preset buttons', () => {
    const mockOnPresetSelect = vi.fn();
    render(<ViewPresetToolbar onPresetSelect={mockOnPresetSelect} />);

    expect(screen.getByText('Home')).toBeDefined();
    expect(screen.getByText('Top')).toBeDefined();
    expect(screen.getByText('Front')).toBeDefined();
    expect(screen.getByText('Side')).toBeDefined();
  });

  it('calls onPresetSelect with correct preset when button is clicked', () => {
    const mockOnPresetSelect = vi.fn();
    render(<ViewPresetToolbar onPresetSelect={mockOnPresetSelect} />);

    // Click Top button
    fireEvent.click(screen.getByText('Top'));
    expect(mockOnPresetSelect).toHaveBeenCalledWith('top');

    // Click Front button
    fireEvent.click(screen.getByText('Front'));
    expect(mockOnPresetSelect).toHaveBeenCalledWith('front');

    // Click Side button
    fireEvent.click(screen.getByText('Side'));
    expect(mockOnPresetSelect).toHaveBeenCalledWith('side');

    // Click Home button
    fireEvent.click(screen.getByText('Home'));
    expect(mockOnPresetSelect).toHaveBeenCalledWith('home');
  });

  it('applies active styling to the home button by default', () => {
    vi.mocked(useStore).mockReturnValue('home' as any);
    const mockOnPresetSelect = vi.fn();
    render(<ViewPresetToolbar onPresetSelect={mockOnPresetSelect} />);

    const homeButton = screen.getByText('Home');
    expect(homeButton.className).toContain('bg-purple-600');
    expect(homeButton.className).toContain('text-white');
  });

  it('applies inactive styling to non-active buttons', () => {
    vi.mocked(useStore).mockReturnValue('home' as any);
    const mockOnPresetSelect = vi.fn();
    render(<ViewPresetToolbar onPresetSelect={mockOnPresetSelect} />);

    const topButton = screen.getByText('Top');
    expect(topButton.className).toContain('bg-gray-700');
    expect(topButton.className).toContain('text-gray-300');
  });
});
