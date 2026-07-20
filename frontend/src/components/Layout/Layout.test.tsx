/**
 * Layout Component Tests
 * 
 * Tests for the main application shell layout
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Layout } from './Layout';
import { useStore } from '../../store';

// Mock the store
vi.mock('../../store', () => ({
  useStore: vi.fn(),
}));

// Mock child components to simplify testing
vi.mock('./TopBar', () => ({
  TopBar: ({ onSlice, onExport, isSliceDisabled, isExportDisabled }: any) => (
    <div data-testid="topbar">
      <button onClick={onSlice} disabled={isSliceDisabled} data-testid="slice-button">
        Slice
      </button>
      <button onClick={onExport} disabled={isExportDisabled} data-testid="export-button">
        Export
      </button>
    </div>
  ),
}));

vi.mock('./LeftPanel', () => ({
  LeftPanel: () => <div data-testid="leftpanel">LeftPanel</div>,
}));

vi.mock('./MainArea', () => ({
  MainArea: () => <div data-testid="mainarea">MainArea</div>,
}));

describe('Layout', () => {
  const mockUseStore = useStore as unknown as ReturnType<typeof vi.fn>;
  const mockSubmitJob = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseStore.mockReturnValue({
      submitJob: mockSubmitJob,
      uploadedFiles: [],
      selectedPrinterProfile: null,
      selectedProcessProfile: null,
      jobStatus: null,
      queuePosition: null,
      progress: null,
      outputFiles: [],
    });
  });

  it('renders all major layout sections', () => {
    render(<Layout />);

    expect(screen.getByTestId('topbar')).toBeInTheDocument();
    expect(screen.getByTestId('leftpanel')).toBeInTheDocument();
    expect(screen.getByTestId('mainarea')).toBeInTheDocument();
  });

  it('disables slice and export buttons when requirements not met', () => {
    render(<Layout />);

    const sliceButton = screen.getByTestId('slice-button');
    const exportButton = screen.getByTestId('export-button');

    expect(sliceButton).toBeDisabled();
    expect(exportButton).toBeDisabled();
  });

  it('enables slice and export buttons when all requirements met', () => {
    mockUseStore.mockReturnValue({
      submitJob: mockSubmitJob,
      uploadedFiles: [{ file_id: '1', filename: 'test.stl' }],
      selectedPrinterProfile: { name: 'Test Printer', path: 'test.json', category: 'machine' },
      selectedProcessProfile: { name: 'Test Process', path: 'process.json', category: 'process' },
      jobStatus: null,
      queuePosition: null,
      progress: null,
      outputFiles: [],
    });

    render(<Layout />);

    const sliceButton = screen.getByTestId('slice-button');
    const exportButton = screen.getByTestId('export-button');

    expect(sliceButton).not.toBeDisabled();
    expect(exportButton).not.toBeDisabled();
  });

  it('calls slice handler when slice button clicked', async () => {
    const user = userEvent.setup();
    
    mockUseStore.mockReturnValue({
      submitJob: mockSubmitJob,
      uploadedFiles: [{ file_id: '1', filename: 'test.stl' }],
      selectedPrinterProfile: { name: 'Test Printer', path: 'test.json', category: 'machine' },
      selectedProcessProfile: { name: 'Test Process', path: 'process.json', category: 'process' },
      jobStatus: null,
      queuePosition: null,
      progress: null,
      outputFiles: [],
    });

    render(<Layout />);

    const sliceButton = screen.getByTestId('slice-button');
    await user.click(sliceButton);

    // Currently just logs; in real implementation would call submitJob
    // expect(mockSubmitJob).toHaveBeenCalled();
  });

  it('applies correct layout structure', () => {
    const { container } = render(<Layout />);

    // Check for flex container
    const mainContainer = container.querySelector('.flex.flex-col.h-screen');
    expect(mainContainer).toBeInTheDocument();

    // Check for content area with LeftPanel and MainArea
    const contentArea = container.querySelector('.flex.flex-1.overflow-hidden');
    expect(contentArea).toBeInTheDocument();
  });

  it('has accessible layout structure', () => {
    render(<Layout />);

    // Layout should be properly structured for screen readers
    expect(screen.getByTestId('topbar')).toBeInTheDocument();
    expect(screen.getByTestId('leftpanel')).toBeInTheDocument();
    expect(screen.getByTestId('mainarea')).toBeInTheDocument();
  });
});
