/**
 * TopBar Component Tests
 * 
 * Tests for the TopBar component including:
 * - Tab navigation rendering and interaction
 * - Slice and Export button state management
 * - Store integration for job submission
 * 
 * Move/Rotate/Scale/Arrange toolbar tests now live in
 * ViewportTransformToolbar.test.tsx (that toolbar moved into the 3D
 * viewport to match the native OrcaSlicer UI).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TopBar } from './TopBar';
import { useStore } from '../../store';

// Mock the store
vi.mock('../../store', () => ({
  useStore: vi.fn(),
}));

describe('TopBar', () => {
  const mockSubmitJob = vi.fn();
  const mockSetAction = vi.fn();

  const defaultStoreState = {
    uploadedFiles: [{ file_id: 'file1', filename: 'test.stl', size_bytes: 1000, extension: 'stl' as const, uploaded_at: '2024-01-01', source_file_id: 'file1', is_clone: false }],
    selectedPrinterProfile: { name: 'Printer 1', path: 'printer/1.json', category: 'machine' as const },
    selectedProcessProfile: { name: 'Process 1', path: 'process/1.json', category: 'process' as const },
    selectedFilamentProfiles: [{ name: 'Filament 1', path: 'filament/1.json', category: 'filament' as const }],
    overrides: {},
    transforms: { rotate: 0, scale: 1 },
    misc: {},
    actionFlags: {},
    submitJob: mockSubmitJob,
    setAction: mockSetAction,
    action: 'slice' as const,
    plateNumber: 0,
    outputFilename: '',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSubmitJob.mockResolvedValue(undefined);
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (state: typeof defaultStoreState) => unknown) => 
      selector(defaultStoreState)
    );
  });

  it('renders all navigation tabs', () => {
    render(<TopBar />);

    expect(screen.getByRole('tab', { name: 'Prepare' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Preview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Device' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Project' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Calibration' })).toBeInTheDocument();
  });

  it('highlights active tab', () => {
    render(<TopBar activeTab="preview" />);

    const previewTab = screen.getByRole('tab', { name: 'Preview' });
    expect(previewTab).toHaveAttribute('aria-selected', 'true');
    expect(previewTab).toHaveClass('bg-purple-600');
  });

  it('calls onTabChange when tab clicked', async () => {
    const user = userEvent.setup();
    const handleTabChange = vi.fn();

    render(<TopBar onTabChange={handleTabChange} />);

    await user.click(screen.getByRole('tab', { name: 'Device' }));

    expect(handleTabChange).toHaveBeenCalledWith('device');
  });

  it('updates active tab state for each tab', async () => {
    const user = userEvent.setup();
    const handleTabChange = vi.fn();

    render(<TopBar activeTab="prepare" onTabChange={handleTabChange} />);

    // Test clicking each tab
    const tabs = ['Prepare', 'Preview', 'Device', 'Project', 'Calibration'] as const;
    const tabIds = ['prepare', 'preview', 'device', 'project', 'calibration'] as const;

    for (let i = 0; i < tabs.length; i++) {
      handleTabChange.mockClear();
      await user.click(screen.getByRole('tab', { name: tabs[i] }));
      expect(handleTabChange).toHaveBeenCalledWith(tabIds[i]);
    }
  });

  it('each tab shows proper aria-selected attribute when active', () => {
    const tabs = [
      { label: 'Prepare', id: 'prepare' },
      { label: 'Preview', id: 'preview' },
      { label: 'Device', id: 'device' },
      { label: 'Project', id: 'project' },
      { label: 'Calibration', id: 'calibration' },
    ] as const;

    tabs.forEach(({ label, id }) => {
      const { unmount } = render(<TopBar activeTab={id} />);

      const tab = screen.getByRole('tab', { name: label });
      expect(tab).toHaveAttribute('aria-selected', 'true');
      expect(tab).toHaveClass('bg-purple-600');

      // Verify other tabs are not selected
      tabs.forEach(({ label: otherLabel, id: otherId }) => {
        if (otherId !== id) {
          const otherTab = screen.getByRole('tab', { name: otherLabel });
          expect(otherTab).toHaveAttribute('aria-selected', 'false');
          expect(otherTab).not.toHaveClass('bg-purple-600');
        }
      });

      // Clean up before next iteration
      unmount();
    });
  });

  it('renders slice and export buttons', () => {
    render(<TopBar />);

    expect(screen.getByRole('button', { name: 'Slice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('disables slice button when no files uploaded', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (state: typeof defaultStoreState) => unknown) => 
      selector({ ...defaultStoreState, uploadedFiles: [] })
    );

    render(<TopBar />);

    const sliceButton = screen.getByRole('button', { name: 'Slice' });
    expect(sliceButton).toBeDisabled();
  });

  it('disables slice button when no printer profile selected', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (state: typeof defaultStoreState) => unknown) => 
      selector({ ...defaultStoreState, selectedPrinterProfile: null as never })
    );

    render(<TopBar />);

    const sliceButton = screen.getByRole('button', { name: 'Slice' });
    expect(sliceButton).toBeDisabled();
  });

  it('disables slice button when no process profile selected', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (state: typeof defaultStoreState) => unknown) => 
      selector({ ...defaultStoreState, selectedProcessProfile: null as never })
    );

    render(<TopBar />);

    const sliceButton = screen.getByRole('button', { name: 'Slice' });
    expect(sliceButton).toBeDisabled();
  });

  it('disables slice button when no filament profiles selected', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (state: typeof defaultStoreState) => unknown) => 
      selector({ ...defaultStoreState, selectedFilamentProfiles: [] })
    );

    render(<TopBar />);

    const sliceButton = screen.getByRole('button', { name: 'Slice' });
    expect(sliceButton).toBeDisabled();
  });

  it('enables slice button when all prerequisites are met', () => {
    render(<TopBar />);

    const sliceButton = screen.getByRole('button', { name: 'Slice' });
    expect(sliceButton).not.toBeDisabled();
  });

  it('disables export button when no files uploaded', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (state: typeof defaultStoreState) => unknown) => 
      selector({ ...defaultStoreState, uploadedFiles: [] })
    );

    render(<TopBar />);

    const exportButton = screen.getByRole('button', { name: 'Export' });
    expect(exportButton).toBeDisabled();
  });

  it('disables export button when profiles not selected', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (state: typeof defaultStoreState) => unknown) => 
      selector({ ...defaultStoreState, selectedPrinterProfile: null as never })
    );

    render(<TopBar />);

    const exportButton = screen.getByRole('button', { name: 'Export' });
    expect(exportButton).toBeDisabled();
  });

  it('calls submitJob when slice button clicked', async () => {
    const user = userEvent.setup();

    render(<TopBar />);

    await user.click(screen.getByRole('button', { name: 'Slice' }));

    await waitFor(() => {
      expect(mockSubmitJob).toHaveBeenCalledWith({
        file_ids: ['file1'],
        printer_profile_path: 'printer/1.json',
        process_profile_path: 'process/1.json',
        filament_profile_paths: ['filament/1.json'],
        action: 'slice',
        plate_number: 0,
        transforms: { rotate: 0, scale: 1 },
        parameter_overrides: {},
        misc: {},
        action_flags: {},
      });
    });
  });

  it('shows export dropdown when export button clicked', async () => {
    const user = userEvent.setup();

    render(<TopBar />);

    await user.click(screen.getByRole('button', { name: 'Export' }));

    expect(screen.getByText('Export 3MF')).toBeInTheDocument();
    expect(screen.getByText('Export STL')).toBeInTheDocument();
    expect(screen.getByText('Export STLs')).toBeInTheDocument();
    expect(screen.getByText('Export Settings')).toBeInTheDocument();
  });

  it('calls submitJob with correct export action', async () => {
    const user = userEvent.setup();

    render(<TopBar />);

    // Open export menu
    await user.click(screen.getByRole('button', { name: 'Export' }));

    // Click Export 3MF
    await user.click(screen.getByText('Export 3MF'));

    await waitFor(() => {
      expect(mockSetAction).toHaveBeenCalledWith('export_3mf');
      expect(mockSubmitJob).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'export_3mf',
        })
      );
    });
  });

  it('has proper ARIA attributes for accessibility', () => {
    render(<TopBar />);

    const tablist = screen.getByRole('tablist', { name: 'Main navigation' });
    expect(tablist).toBeInTheDocument();
    // Move/Rotate/Scale/Arrange toolbar now lives inside the 3D viewport
    // (ViewportTransformToolbar), not in TopBar — see that component's
    // own tests for its ARIA/toolbar assertions.
  });

  it('applies correct visual hierarchy to buttons', () => {
    render(<TopBar />);

    // Slice button should have primary styling (purple background)
    const sliceButton = screen.getByRole('button', { name: 'Slice' });
    expect(sliceButton).toHaveClass('bg-purple-600');

    // Export button should have secondary styling (gray background)
    const exportButton = screen.getByRole('button', { name: 'Export' });
    expect(exportButton).toHaveClass('bg-gray-700');
  });
});
