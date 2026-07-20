import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OutputFileList } from './OutputFileList';
import { apiClient } from '../../api/client';

// Mock the API client
vi.mock('../../api/client', () => ({
  apiClient: {
    getJobOutputs: vi.fn(),
    downloadOutput: vi.fn(),
  },
}));

describe('OutputFileList', () => {
  const mockJobId = 'test-job-123';

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset URL.createObjectURL and URL.revokeObjectURL mocks
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('renders loading state initially', () => {
    vi.mocked(apiClient.getJobOutputs).mockImplementation(() => new Promise(() => {}));
    
    render(<OutputFileList jobId={mockJobId} />);
    
    expect(screen.getByText('Loading output files...')).toBeInTheDocument();
  });

  it('fetches and displays output files', async () => {
    const mockFiles = [
      {
        filename: 'plate_1.gcode',
        size_bytes: 1024000,
        download_url: '/api/jobs/test-job-123/outputs/plate_1.gcode',
      },
      {
        filename: 'plate_2.gcode',
        size_bytes: 2048000,
        download_url: '/api/jobs/test-job-123/outputs/plate_2.gcode',
      },
    ];

    vi.mocked(apiClient.getJobOutputs).mockResolvedValue(mockFiles);

    render(<OutputFileList jobId={mockJobId} />);

    // Wait for files to load
    await waitFor(() => {
      expect(screen.getByText('Output Files')).toBeInTheDocument();
    });

    // Check that both files are displayed
    expect(screen.getByText('plate_1.gcode')).toBeInTheDocument();
    expect(screen.getByText('plate_2.gcode')).toBeInTheDocument();

    // Check file sizes are formatted correctly
    expect(screen.getByText('1000.00 KB')).toBeInTheDocument();
    expect(screen.getByText('1.95 MB')).toBeInTheDocument(); // 2048000 bytes = 1.953125 MB

    // Check file count
    expect(screen.getByText('2 files ready for download')).toBeInTheDocument();
  });

  it('displays "File expired" message on 404 error', async () => {
    const error = {
      statusCode: 404,
      message: 'Not found',
    };

    vi.mocked(apiClient.getJobOutputs).mockRejectedValue(error);

    render(<OutputFileList jobId={mockJobId} />);

    await waitFor(() => {
      expect(screen.getByText('File expired')).toBeInTheDocument();
    });

    expect(
      screen.getByText('The output files for this job are no longer available.')
    ).toBeInTheDocument();
  });

  it('displays generic error message on non-404 errors', async () => {
    const error = {
      statusCode: 500,
      message: 'Internal server error',
    };

    vi.mocked(apiClient.getJobOutputs).mockRejectedValue(error);

    render(<OutputFileList jobId={mockJobId} />);

    await waitFor(() => {
      expect(screen.getByText('Error')).toBeInTheDocument();
    });

    expect(screen.getByText('Internal server error')).toBeInTheDocument();
  });

  it('displays empty state when no files are returned', async () => {
    vi.mocked(apiClient.getJobOutputs).mockResolvedValue([]);

    render(<OutputFileList jobId={mockJobId} />);

    await waitFor(() => {
      expect(screen.getByText('No output files available')).toBeInTheDocument();
    });
  });

  it('triggers download when download button is clicked', async () => {
    const user = userEvent.setup();
    const mockFiles = [
      {
        filename: 'output.gcode',
        size_bytes: 1024,
        download_url: '/api/jobs/test-job-123/outputs/output.gcode',
      },
    ];

    const mockBlob = new Blob(['file content'], { type: 'text/plain' });
    vi.mocked(apiClient.getJobOutputs).mockResolvedValue(mockFiles);
    vi.mocked(apiClient.downloadOutput).mockResolvedValue(mockBlob);

    // Mock document.body.appendChild and removeChild
    const appendChildSpy = vi.spyOn(document.body, 'appendChild');
    const removeChildSpy = vi.spyOn(document.body, 'removeChild');

    render(<OutputFileList jobId={mockJobId} />);

    // Wait for files to load
    await waitFor(() => {
      expect(screen.getByText('output.gcode')).toBeInTheDocument();
    });

    // Click download button
    const downloadButton = screen.getByRole('button', { name: /Download output.gcode/i });
    await user.click(downloadButton);

    // Check that download was triggered
    await waitFor(() => {
      expect(apiClient.downloadOutput).toHaveBeenCalledWith(mockJobId, 'output.gcode');
    });

    // Verify URL manipulation
    expect(global.URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    // Verify link was added and removed
    expect(appendChildSpy).toHaveBeenCalled();
    expect(removeChildSpy).toHaveBeenCalled();

    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
  });

  it('shows downloading state during download', async () => {
    const user = userEvent.setup();
    const mockFiles = [
      {
        filename: 'output.gcode',
        size_bytes: 1024,
        download_url: '/api/jobs/test-job-123/outputs/output.gcode',
      },
    ];

    vi.mocked(apiClient.getJobOutputs).mockResolvedValue(mockFiles);
    
    // Make download slow to capture intermediate state
    vi.mocked(apiClient.downloadOutput).mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(new Blob(['content'])), 100)
        )
    );

    render(<OutputFileList jobId={mockJobId} />);

    await waitFor(() => {
      expect(screen.getByText('output.gcode')).toBeInTheDocument();
    });

    const downloadButton = screen.getByRole('button', { name: /Download output.gcode/i });
    await user.click(downloadButton);

    // Check downloading state appears
    expect(screen.getByText('Downloading')).toBeInTheDocument();

    // Wait for download to complete
    await waitFor(() => {
      expect(screen.getByText('Download')).toBeInTheDocument();
    }, { timeout: 200 });
  });

  it('shows expired message if download returns 404', async () => {
    const user = userEvent.setup();
    const mockFiles = [
      {
        filename: 'output.gcode',
        size_bytes: 1024,
        download_url: '/api/jobs/test-job-123/outputs/output.gcode',
      },
    ];

    vi.mocked(apiClient.getJobOutputs).mockResolvedValue(mockFiles);
    vi.mocked(apiClient.downloadOutput).mockRejectedValue({
      statusCode: 404,
      message: 'Not found',
    });

    render(<OutputFileList jobId={mockJobId} />);

    await waitFor(() => {
      expect(screen.getByText('output.gcode')).toBeInTheDocument();
    });

    const downloadButton = screen.getByRole('button', { name: /Download output.gcode/i });
    await user.click(downloadButton);

    // Check that expired message appears
    await waitFor(() => {
      expect(screen.getByText('File expired')).toBeInTheDocument();
    });
  });

  it('formats file sizes correctly', async () => {
    const mockFiles = [
      { filename: 'file1.gcode', size_bytes: 0, download_url: '/download/file1' },
      { filename: 'file2.gcode', size_bytes: 500, download_url: '/download/file2' },
      { filename: 'file3.gcode', size_bytes: 1024, download_url: '/download/file3' },
      { filename: 'file4.gcode', size_bytes: 1024 * 1024, download_url: '/download/file4' },
      {
        filename: 'file5.gcode',
        size_bytes: 1024 * 1024 * 1024,
        download_url: '/download/file5',
      },
    ];

    vi.mocked(apiClient.getJobOutputs).mockResolvedValue(mockFiles);

    render(<OutputFileList jobId={mockJobId} />);

    await waitFor(() => {
      expect(screen.getByText('0 B')).toBeInTheDocument();
      expect(screen.getByText('500.00 B')).toBeInTheDocument();
      expect(screen.getByText('1.00 KB')).toBeInTheDocument();
      expect(screen.getByText('1.00 MB')).toBeInTheDocument();
      expect(screen.getByText('1.00 GB')).toBeInTheDocument();
    });
  });

  it('refetches output files when jobId changes', async () => {
    const mockFiles1 = [
      {
        filename: 'job1_output.gcode',
        size_bytes: 1024,
        download_url: '/api/jobs/job-1/outputs/job1_output.gcode',
      },
    ];

    const mockFiles2 = [
      {
        filename: 'job2_output.gcode',
        size_bytes: 2048,
        download_url: '/api/jobs/job-2/outputs/job2_output.gcode',
      },
    ];

    vi.mocked(apiClient.getJobOutputs).mockResolvedValueOnce(mockFiles1);

    const { rerender } = render(<OutputFileList jobId="job-1" />);

    await waitFor(() => {
      expect(screen.getByText('job1_output.gcode')).toBeInTheDocument();
    });

    // Change jobId
    vi.mocked(apiClient.getJobOutputs).mockResolvedValueOnce(mockFiles2);
    rerender(<OutputFileList jobId="job-2" />);

    await waitFor(() => {
      expect(screen.getByText('job2_output.gcode')).toBeInTheDocument();
    });

    expect(apiClient.getJobOutputs).toHaveBeenCalledTimes(2);
    expect(apiClient.getJobOutputs).toHaveBeenCalledWith('job-1');
    expect(apiClient.getJobOutputs).toHaveBeenCalledWith('job-2');
  });
});
