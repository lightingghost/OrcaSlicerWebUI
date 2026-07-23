import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SubmitButton } from './SubmitButton';
import { useStore } from '../../store';

/**
 * Unit tests for SubmitButton component
 * 
 * Task: 16.4 Create SubmitButton component
 * Requirements: 2.3, 6.1
 * 
 * Tests verify:
 * - Button is disabled when validation conditions are not met
 * - Button is enabled when all conditions are satisfied
 * - JobRequest is assembled correctly from store slices
 * - Loading spinner is displayed during submission
 * - Error messages are displayed on failure
 */

// Mock the store
vi.mock('../../store', () => ({
  useStore: vi.fn(),
}));

describe('SubmitButton', () => {
  const mockSubmitJob = vi.fn();
  
  const createMockStore = (overrides = {}) => ({
    uploadedFiles: [],
    selectedPrinterProfile: null,
    selectedProcessProfile: null,
    selectedFilamentProfiles: [],
    overrides: {},
    validationErrors: {},
    misc: {},
    miscValidationErrors: {},
    transforms: {},
    action: 'slice',
    plateNumber: 0,
    outputFilename: '',
    actionFlags: {},
    submitJob: mockSubmitJob,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Disabled State (Requirements 2.3, 6.1)', () => {
    it('is disabled when no files are uploaded', () => {
      const mockStore = createMockStore({
        uploadedFiles: [],
        selectedPrinterProfile: { name: 'Printer', path: 'path', category: 'machine' },
        selectedProcessProfile: { name: 'Process', path: 'path', category: 'process' },
        selectedFilamentProfiles: [{ name: 'Filament', path: 'path', category: 'filament' }],
      });
      
      vi.mocked(useStore).mockImplementation((selector: any) => selector(mockStore));
      
      render(<SubmitButton />);
      
      const button = screen.getByRole('button', { name: /submit job/i });
      expect(button).toBeDisabled();
      expect(screen.getByText('No files uploaded')).toBeInTheDocument();
    });

    it('is disabled when no printer profile is selected', () => {
      const mockStore = createMockStore({
        uploadedFiles: [{ file_id: '1', filename: 'test.stl', size_bytes: 100, extension: 'stl', uploaded_at: '2024-01-01', source_file_id: '1', is_clone: false }],
        selectedPrinterProfile: null,
        selectedProcessProfile: { name: 'Process', path: 'path', category: 'process' },
        selectedFilamentProfiles: [{ name: 'Filament', path: 'path', category: 'filament' }],
      });
      
      vi.mocked(useStore).mockImplementation((selector: any) => selector(mockStore));
      
      render(<SubmitButton />);
      
      const button = screen.getByRole('button', { name: /submit job/i });
      expect(button).toBeDisabled();
      expect(screen.getByText('No printer profile selected')).toBeInTheDocument();
    });

    it('is disabled when no process profile is selected', () => {
      const mockStore = createMockStore({
        uploadedFiles: [{ file_id: '1', filename: 'test.stl', size_bytes: 100, extension: 'stl', uploaded_at: '2024-01-01', source_file_id: '1', is_clone: false }],
        selectedPrinterProfile: { name: 'Printer', path: 'path', category: 'machine' },
        selectedProcessProfile: null,
        selectedFilamentProfiles: [{ name: 'Filament', path: 'path', category: 'filament' }],
      });
      
      vi.mocked(useStore).mockImplementation((selector: any) => selector(mockStore));
      
      render(<SubmitButton />);
      
      const button = screen.getByRole('button', { name: /submit job/i });
      expect(button).toBeDisabled();
      expect(screen.getByText('No process profile selected')).toBeInTheDocument();
    });

    it('is disabled when no filament profiles are selected', () => {
      const mockStore = createMockStore({
        uploadedFiles: [{ file_id: '1', filename: 'test.stl', size_bytes: 100, extension: 'stl', uploaded_at: '2024-01-01', source_file_id: '1', is_clone: false }],
        selectedPrinterProfile: { name: 'Printer', path: 'path', category: 'machine' },
        selectedProcessProfile: { name: 'Process', path: 'path', category: 'process' },
        selectedFilamentProfiles: [],
      });
      
      vi.mocked(useStore).mockImplementation((selector: any) => selector(mockStore));
      
      render(<SubmitButton />);
      
      const button = screen.getByRole('button', { name: /submit job/i });
      expect(button).toBeDisabled();
      expect(screen.getByText('No filament profiles selected')).toBeInTheDocument();
    });

    it('is disabled when parameter validation errors exist', () => {
      const mockStore = createMockStore({
        uploadedFiles: [{ file_id: '1', filename: 'test.stl', size_bytes: 100, extension: 'stl', uploaded_at: '2024-01-01', source_file_id: '1', is_clone: false }],
        selectedPrinterProfile: { name: 'Printer', path: 'path', category: 'machine' },
        selectedProcessProfile: { name: 'Process', path: 'path', category: 'process' },
        selectedFilamentProfiles: [{ name: 'Filament', path: 'path', category: 'filament' }],
        validationErrors: { layer_height: 'Value out of range' },
      });
      
      vi.mocked(useStore).mockImplementation((selector: any) => selector(mockStore));
      
      render(<SubmitButton />);
      
      const button = screen.getByRole('button', { name: /submit job/i });
      expect(button).toBeDisabled();
      expect(screen.getByText(/Parameter validation errors: layer_height/i)).toBeInTheDocument();
    });

    it('is disabled when misc validation errors exist', () => {
      const mockStore = createMockStore({
        uploadedFiles: [{ file_id: '1', filename: 'test.stl', size_bytes: 100, extension: 'stl', uploaded_at: '2024-01-01', source_file_id: '1', is_clone: false }],
        selectedPrinterProfile: { name: 'Printer', path: 'path', category: 'machine' },
        selectedProcessProfile: { name: 'Process', path: 'path', category: 'process' },
        selectedFilamentProfiles: [{ name: 'Filament', path: 'path', category: 'filament' }],
        miscValidationErrors: { skip_objects: 'Invalid format' },
      });
      
      vi.mocked(useStore).mockImplementation((selector: any) => selector(mockStore));
      
      render(<SubmitButton />);
      
      const button = screen.getByRole('button', { name: /submit job/i });
      expect(button).toBeDisabled();
      expect(screen.getByText(/Misc option validation errors: skip_objects/i)).toBeInTheDocument();
    });
  });

  describe('Enabled State (Requirements 2.3, 6.1)', () => {
    it('is enabled when all required conditions are met', () => {
      const mockStore = createMockStore({
        uploadedFiles: [{ file_id: '1', filename: 'test.stl', size_bytes: 100, extension: 'stl', uploaded_at: '2024-01-01', source_file_id: '1', is_clone: false }],
        selectedPrinterProfile: { name: 'Printer', path: 'printer/path', category: 'machine' },
        selectedProcessProfile: { name: 'Process', path: 'process/path', category: 'process' },
        selectedFilamentProfiles: [{ name: 'Filament', path: 'filament/path', category: 'filament' }],
        validationErrors: {},
        miscValidationErrors: {},
      });
      
      vi.mocked(useStore).mockImplementation((selector: any) => selector(mockStore));
      
      render(<SubmitButton />);
      
      const button = screen.getByRole('button', { name: /submit job/i });
      expect(button).not.toBeDisabled();
    });
  });

  describe('Job Submission (Requirement 6.1)', () => {
    it('calls submitJob with correctly assembled JobRequest', async () => {
      const mockStore = createMockStore({
        uploadedFiles: [
          { file_id: 'file1', filename: 'test1.stl', size_bytes: 100, extension: 'stl', uploaded_at: '2024-01-01', source_file_id: 'file1', is_clone: false },
          { file_id: 'file2', filename: 'test2.stl', size_bytes: 200, extension: 'stl', uploaded_at: '2024-01-01', source_file_id: 'file2', is_clone: false },
        ],
        selectedPrinterProfile: { name: 'Printer', path: 'printer/path', category: 'machine' },
        selectedProcessProfile: { name: 'Process', path: 'process/path', category: 'process' },
        selectedFilamentProfiles: [
          { name: 'Filament1', path: 'filament/path1', category: 'filament' },
          { name: 'Filament2', path: 'filament/path2', category: 'filament' },
        ],
        overrides: { layer_height: 0.2 },
        action: 'slice',
        plateNumber: 1,
      });
      
      mockSubmitJob.mockResolvedValue(undefined);
      vi.mocked(useStore).mockImplementation((selector: any) => selector(mockStore));
      
      render(<SubmitButton />);
      
      const button = screen.getByRole('button', { name: /submit job/i });
      fireEvent.click(button);
      
      await waitFor(() => {
        expect(mockSubmitJob).toHaveBeenCalledTimes(1);
      });

      const calledWith = mockSubmitJob.mock.calls[0][0];
      expect(calledWith.file_ids).toEqual(['file1', 'file2']);
      expect(calledWith.printer_profile_path).toBe('printer/path');
      expect(calledWith.process_profile_path).toBe('process/path');
      expect(calledWith.filament_profile_paths).toEqual(['filament/path1', 'filament/path2']);
      expect(calledWith.action).toBe('slice');
      expect(calledWith.plate_number).toBe(1);
      expect(calledWith.parameter_overrides).toEqual({ layer_height: 0.2 });
    });

    it('includes output_filename for export_3mf action', async () => {
      const mockStore = createMockStore({
        uploadedFiles: [{ file_id: 'file1', filename: 'test.stl', size_bytes: 100, extension: 'stl', uploaded_at: '2024-01-01', source_file_id: 'file1', is_clone: false }],
        selectedPrinterProfile: { name: 'Printer', path: 'printer/path', category: 'machine' },
        selectedProcessProfile: { name: 'Process', path: 'process/path', category: 'process' },
        selectedFilamentProfiles: [{ name: 'Filament', path: 'filament/path', category: 'filament' }],
        action: 'export_3mf',
        outputFilename: 'custom.3mf',
      });
      
      mockSubmitJob.mockResolvedValue(undefined);
      vi.mocked(useStore).mockImplementation((selector: any) => selector(mockStore));
      
      render(<SubmitButton />);
      
      const button = screen.getByRole('button', { name: /submit job/i });
      fireEvent.click(button);
      
      await waitFor(() => {
        expect(mockSubmitJob).toHaveBeenCalledTimes(1);
      });

      const calledWith = mockSubmitJob.mock.calls[0][0];
      expect(calledWith.action).toBe('export_3mf');
      expect(calledWith.output_filename).toBe('custom.3mf');
    });

    it('includes transforms when set', async () => {
      const mockStore = createMockStore({
        uploadedFiles: [{ file_id: 'file1', filename: 'test.stl', size_bytes: 100, extension: 'stl', uploaded_at: '2024-01-01', source_file_id: 'file1', is_clone: false }],
        selectedPrinterProfile: { name: 'Printer', path: 'printer/path', category: 'machine' },
        selectedProcessProfile: { name: 'Process', path: 'process/path', category: 'process' },
        selectedFilamentProfiles: [{ name: 'Filament', path: 'filament/path', category: 'filament' }],
        transforms: { rotate: 45, scale: 2, ensure_on_bed: true },
        action: 'slice',
      });
      
      mockSubmitJob.mockResolvedValue(undefined);
      vi.mocked(useStore).mockImplementation((selector: any) => selector(mockStore));
      
      render(<SubmitButton />);
      
      const button = screen.getByRole('button', { name: /submit job/i });
      fireEvent.click(button);
      
      await waitFor(() => {
        expect(mockSubmitJob).toHaveBeenCalledTimes(1);
      });

      const calledWith = mockSubmitJob.mock.calls[0][0];
      expect(calledWith.transforms).toEqual({ rotate: 45, scale: 2, ensure_on_bed: true });
    });

    it('includes misc options when set', async () => {
      const mockStore = createMockStore({
        uploadedFiles: [{ file_id: 'file1', filename: 'test.stl', size_bytes: 100, extension: 'stl', uploaded_at: '2024-01-01', source_file_id: 'file1', is_clone: false }],
        selectedPrinterProfile: { name: 'Printer', path: 'printer/path', category: 'machine' },
        selectedProcessProfile: { name: 'Process', path: 'process/path', category: 'process' },
        selectedFilamentProfiles: [{ name: 'Filament', path: 'filament/path', category: 'filament' }],
        misc: { debug: 3, enable_timelapse: true },
        action: 'slice',
      });
      
      mockSubmitJob.mockResolvedValue(undefined);
      vi.mocked(useStore).mockImplementation((selector: any) => selector(mockStore));
      
      render(<SubmitButton />);
      
      const button = screen.getByRole('button', { name: /submit job/i });
      fireEvent.click(button);
      
      await waitFor(() => {
        expect(mockSubmitJob).toHaveBeenCalledTimes(1);
      });

      const calledWith = mockSubmitJob.mock.calls[0][0];
      expect(calledWith.misc).toEqual({ debug: 3, enable_timelapse: true });
    });

    it('includes action flags when set', async () => {
      const mockStore = createMockStore({
        uploadedFiles: [{ file_id: 'file1', filename: 'test.stl', size_bytes: 100, extension: 'stl', uploaded_at: '2024-01-01', source_file_id: 'file1', is_clone: false }],
        selectedPrinterProfile: { name: 'Printer', path: 'printer/path', category: 'machine' },
        selectedProcessProfile: { name: 'Process', path: 'process/path', category: 'process' },
        selectedFilamentProfiles: [{ name: 'Filament', path: 'filament/path', category: 'filament' }],
        actionFlags: { min_save: true, enable_timelapse: true },
        action: 'slice',
      });
      
      mockSubmitJob.mockResolvedValue(undefined);
      vi.mocked(useStore).mockImplementation((selector: any) => selector(mockStore));
      
      render(<SubmitButton />);
      
      const button = screen.getByRole('button', { name: /submit job/i });
      fireEvent.click(button);
      
      await waitFor(() => {
        expect(mockSubmitJob).toHaveBeenCalledTimes(1);
      });

      const calledWith = mockSubmitJob.mock.calls[0][0];
      expect(calledWith.action_flags).toEqual({ min_save: true, enable_timelapse: true });
    });
  });

  describe('Loading State (Requirement 6.1)', () => {
    it('displays loading spinner during submission', async () => {
      const mockStore = createMockStore({
        uploadedFiles: [{ file_id: 'file1', filename: 'test.stl', size_bytes: 100, extension: 'stl', uploaded_at: '2024-01-01', source_file_id: 'file1', is_clone: false }],
        selectedPrinterProfile: { name: 'Printer', path: 'printer/path', category: 'machine' },
        selectedProcessProfile: { name: 'Process', path: 'process/path', category: 'process' },
        selectedFilamentProfiles: [{ name: 'Filament', path: 'filament/path', category: 'filament' }],
      });
      
      let resolveSubmit: (value?: unknown) => void;
      mockSubmitJob.mockReturnValue(new Promise((resolve) => { resolveSubmit = resolve; }));
      vi.mocked(useStore).mockImplementation((selector: any) => selector(mockStore));
      
      render(<SubmitButton />);
      
      const button = screen.getByRole('button', { name: /submit job/i });
      fireEvent.click(button);
      
      // Check loading state
      expect(screen.getByText('Submitting...')).toBeInTheDocument();
      expect(button).toBeDisabled();
      
      // Resolve the promise
      resolveSubmit!();
      
      await waitFor(() => {
        expect(screen.queryByText('Submitting...')).not.toBeInTheDocument();
      });
    });

    it('is disabled during submission', async () => {
      const mockStore = createMockStore({
        uploadedFiles: [{ file_id: 'file1', filename: 'test.stl', size_bytes: 100, extension: 'stl', uploaded_at: '2024-01-01', source_file_id: 'file1', is_clone: false }],
        selectedPrinterProfile: { name: 'Printer', path: 'printer/path', category: 'machine' },
        selectedProcessProfile: { name: 'Process', path: 'process/path', category: 'process' },
        selectedFilamentProfiles: [{ name: 'Filament', path: 'filament/path', category: 'filament' }],
      });
      
      let resolveSubmit: (value?: unknown) => void;
      mockSubmitJob.mockReturnValue(new Promise((resolve) => { resolveSubmit = resolve; }));
      vi.mocked(useStore).mockImplementation((selector: any) => selector(mockStore));
      
      render(<SubmitButton />);
      
      const button = screen.getByRole('button', { name: /submit job/i });
      fireEvent.click(button);
      
      // Button should be disabled during submission
      expect(button).toBeDisabled();
      
      // Resolve the promise
      resolveSubmit!();
      
      await waitFor(() => {
        expect(button).not.toBeDisabled();
      });
    });
  });

  describe('Error Handling', () => {
    it('displays error message when submission fails', async () => {
      const mockStore = createMockStore({
        uploadedFiles: [{ file_id: 'file1', filename: 'test.stl', size_bytes: 100, extension: 'stl', uploaded_at: '2024-01-01', source_file_id: 'file1', is_clone: false }],
        selectedPrinterProfile: { name: 'Printer', path: 'printer/path', category: 'machine' },
        selectedProcessProfile: { name: 'Process', path: 'process/path', category: 'process' },
        selectedFilamentProfiles: [{ name: 'Filament', path: 'filament/path', category: 'filament' }],
      });
      
      mockSubmitJob.mockRejectedValue(new Error('Network error'));
      vi.mocked(useStore).mockImplementation((selector: any) => selector(mockStore));
      
      render(<SubmitButton />);
      
      const button = screen.getByRole('button', { name: /submit job/i });
      fireEvent.click(button);
      
      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('button is enabled again after error', async () => {
      const mockStore = createMockStore({
        uploadedFiles: [{ file_id: 'file1', filename: 'test.stl', size_bytes: 100, extension: 'stl', uploaded_at: '2024-01-01', source_file_id: 'file1', is_clone: false }],
        selectedPrinterProfile: { name: 'Printer', path: 'printer/path', category: 'machine' },
        selectedProcessProfile: { name: 'Process', path: 'process/path', category: 'process' },
        selectedFilamentProfiles: [{ name: 'Filament', path: 'filament/path', category: 'filament' }],
      });
      
      mockSubmitJob.mockRejectedValue(new Error('Network error'));
      vi.mocked(useStore).mockImplementation((selector: any) => selector(mockStore));
      
      render(<SubmitButton />);
      
      const button = screen.getByRole('button', { name: /submit job/i });
      fireEvent.click(button);
      
      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
      
      // Button should be enabled again after error
      expect(button).not.toBeDisabled();
    });
  });
});
