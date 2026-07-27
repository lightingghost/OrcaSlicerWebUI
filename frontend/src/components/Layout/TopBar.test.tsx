/**
 * TopBar Component Tests
 * 
 * Tests for the TopBar component including:
 * - Tab navigation rendering and interaction
 * - Slice and Print button state management
 * - Store integration for job submission
 * 
 * Move/Rotate/Scale/Arrange toolbar tests now live in
 * ViewportTransformToolbar.test.tsx (that toolbar moved into the 3D
 * viewport to match the native OrcaSlicer UI).
 *
 * The Print button replaced the old Export button/dropdown (Requirements:
 * "Replace the export button with a print button" — disabled until the
 * plate has been sliced; clicking it opens PrintDialog, tested
 * separately in PrintDialog.test.tsx).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TopBar } from './TopBar';
import { useStore, findGcodeOutput } from '../../store';

// Mock the store
vi.mock('../../store', () => ({
  useStore: vi.fn(),
  findGcodeOutput: vi.fn(),
}));

// PrintDialog is exercised by its own test file — stub it here so
// TopBar's tests stay focused on the button's own enable/disable/click
// behavior rather than re-testing dialog internals.
vi.mock('../Device/PrintDialog', () => ({
  PrintDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="print-dialog">PrintDialog</div> : null,
}));

describe('TopBar', () => {
  const mockSubmitJob = vi.fn();
  const mockFindGcodeOutput = findGcodeOutput as unknown as ReturnType<typeof vi.fn>;

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
    plateNumber: 0,
    activeJobId: null as string | null,
    jobStatus: null as string | null,
    outputFiles: [] as { filename: string; size_bytes: number; download_url: string }[],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSubmitJob.mockResolvedValue(undefined);
    mockFindGcodeOutput.mockReturnValue(null);
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (state: typeof defaultStoreState) => unknown) => 
      selector(defaultStoreState)
    );
  });

  it('renders all navigation tabs', () => {
    render(<TopBar />);

    expect(screen.getByRole('tab', { name: 'Prepare' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Preview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Device' })).toBeInTheDocument();
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
    const tabs = ['Prepare', 'Preview', 'Device'] as const;
    const tabIds = ['prepare', 'preview', 'device'] as const;

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

  it('renders slice and print buttons', () => {
    render(<TopBar />);

    expect(screen.getByRole('button', { name: 'Slice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument();
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

  it('disables Print button when no job has ever been submitted (Requirement 1: not clickable when unsliced)', () => {
    render(<TopBar />);

    const printButton = screen.getByRole('button', { name: 'Print' });
    expect(printButton).toBeDisabled();
  });

  it('disables Print button while a job is queued/running, even with a previous activeJobId', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (state: typeof defaultStoreState) => unknown) => 
      selector({ ...defaultStoreState, activeJobId: 'job-1', jobStatus: 'running' })
    );

    render(<TopBar />);

    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled();
  });

  it('disables Print button when the completed job has no gcode output (e.g. an export job)', () => {
    mockFindGcodeOutput.mockReturnValue(null);
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (state: typeof defaultStoreState) => unknown) => 
      selector({
        ...defaultStoreState,
        activeJobId: 'job-1',
        jobStatus: 'completed',
        outputFiles: [{ filename: 'export.3mf', size_bytes: 100, download_url: '/x' }],
      })
    );

    render(<TopBar />);

    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled();
  });

  it('enables Print button once the current job has completed with a sliced gcode (Requirement 2)', () => {
    mockFindGcodeOutput.mockReturnValue({
      filename: 'plate_1.gcode',
      size_bytes: 1000,
      download_url: '/api/jobs/job-1/outputs/plate_1.gcode',
    });
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (state: typeof defaultStoreState) => unknown) => 
      selector({
        ...defaultStoreState,
        activeJobId: 'job-1',
        jobStatus: 'completed',
        outputFiles: [{ filename: 'plate_1.gcode', size_bytes: 1000, download_url: '/x' }],
      })
    );

    render(<TopBar />);

    expect(screen.getByRole('button', { name: 'Print' })).not.toBeDisabled();
  });

  it('opens the Send G-code dialog when Print is clicked while enabled (Requirement 2)', async () => {
    const user = userEvent.setup();
    mockFindGcodeOutput.mockReturnValue({
      filename: 'plate_1.gcode',
      size_bytes: 1000,
      download_url: '/x',
    });
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (state: typeof defaultStoreState) => unknown) => 
      selector({
        ...defaultStoreState,
        activeJobId: 'job-1',
        jobStatus: 'completed',
        outputFiles: [{ filename: 'plate_1.gcode', size_bytes: 1000, download_url: '/x' }],
      })
    );

    render(<TopBar />);

    expect(screen.queryByTestId('print-dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Print' }));
    expect(screen.getByTestId('print-dialog')).toBeInTheDocument();
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

    // Print button should have secondary styling (gray background)
    const printButton = screen.getByRole('button', { name: 'Print' });
    expect(printButton).toHaveClass('bg-gray-700');
  });
});
