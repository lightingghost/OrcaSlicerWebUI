import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import JobHistory from './JobHistory';
import { apiClient } from '../api/client';

// Mock the API client
vi.mock('../api/client', () => ({
  apiClient: {
    getJobs: vi.fn(),
    getJob: vi.fn(),
  },
}));

// Mock OutputFileList component
vi.mock('../components/Progress/OutputFileList', () => ({
  OutputFileList: ({ jobId }: { jobId: string }) => (
    <div data-testid="output-file-list">OutputFileList for {jobId}</div>
  ),
}));

describe('JobHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', () => {
    vi.mocked(apiClient.getJobs).mockImplementation(
      () => new Promise(() => {}) // Never resolves to keep loading state
    );

    render(<JobHistory />);
    
    expect(screen.getByText('Job History')).toBeInTheDocument();
    expect(screen.getByText('Loading job history...')).toBeInTheDocument();
  });

  it('renders empty state when no jobs exist', async () => {
    vi.mocked(apiClient.getJobs).mockResolvedValue([]);

    render(<JobHistory />);

    await waitFor(() => {
      expect(screen.getByText('No jobs yet')).toBeInTheDocument();
      expect(screen.getByText('Submit a slicing job to see it here')).toBeInTheDocument();
    });
  });

  it('renders job list ordered newest first', async () => {
    // Create jobs with specific timestamps - newest to oldest
    const now = Date.now();
    const mockJobs = [
      {
        job_id: 'job-newest',
        status: 'completed' as const,
        submitted_at: new Date(now).toISOString(), // Most recent
        action_type: 'slice',
      },
      {
        job_id: 'job-middle',
        status: 'running' as const,
        submitted_at: new Date(now - 3600000).toISOString(), // 1 hour ago
        action_type: 'export_3mf',
      },
      {
        job_id: 'job-oldest',
        status: 'failed' as const,
        submitted_at: new Date(now - 7200000).toISOString(), // 2 hours ago
        action_type: 'export_stl',
      },
    ];

    vi.mocked(apiClient.getJobs).mockResolvedValue(mockJobs);

    render(<JobHistory />);

    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument();
      expect(screen.getByText('Running')).toBeInTheDocument();
      expect(screen.getByText('Failed')).toBeInTheDocument();
    });

    // Assert ordering: get all job rows by using the title attributes which contain full job IDs
    const jobIdElements = screen.getAllByTitle(/^job-/);
    
    // Extract job IDs from title attributes
    const renderedJobIds = jobIdElements.map(el => el.getAttribute('title'));
    
    // Verify the jobs are rendered in newest-first order
    expect(renderedJobIds).toEqual(['job-newest', 'job-middle', 'job-oldest']);

    // Check status badges are present
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();

    // Check action types
    expect(screen.getByText('slice', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('export 3mf', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('export stl', { exact: false })).toBeInTheDocument();
  });

  it('displays status badges correctly for different statuses', async () => {
    const mockJobs = [
      {
        job_id: 'job-completed',
        status: 'completed' as const,
        submitted_at: new Date().toISOString(),
        action_type: 'slice',
      },
      {
        job_id: 'job-failed',
        status: 'failed' as const,
        submitted_at: new Date().toISOString(),
        action_type: 'slice',
      },
      {
        job_id: 'job-queued',
        status: 'queued' as const,
        submitted_at: new Date().toISOString(),
        action_type: 'slice',
      },
      {
        job_id: 'job-timedout',
        status: 'timed_out' as const,
        submitted_at: new Date().toISOString(),
        action_type: 'slice',
      },
    ];

    vi.mocked(apiClient.getJobs).mockResolvedValue(mockJobs);

    render(<JobHistory />);

    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument();
      expect(screen.getByText('Failed')).toBeInTheDocument();
      expect(screen.getByText('Queued')).toBeInTheDocument();
      expect(screen.getByText('Timed Out')).toBeInTheDocument();
    });
  });

  it('expands job details when clicking a completed job', async () => {
    const mockJobs = [
      {
        job_id: 'job-completed',
        status: 'completed' as const,
        submitted_at: new Date().toISOString(),
        action_type: 'slice',
      },
    ];

    const mockJobDetail = {
      job_id: 'job-completed',
      session_id: 'session-1',
      submitted_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: 'completed' as const,
      action_type: 'slice',
      cli_args: '--slice 0',
      exit_code: 0,
      error_message: null,
      output_dir: '/workspace/jobs/job-completed/output',
    };

    vi.mocked(apiClient.getJobs).mockResolvedValue(mockJobs);
    vi.mocked(apiClient.getJob).mockResolvedValue(mockJobDetail);

    render(<JobHistory />);

    // Wait for job list to load
    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument();
    });

    // Click on the job row to expand
    const jobButtons = screen.getAllByRole('button');
    fireEvent.click(jobButtons[0]);

    // Wait for details to load and OutputFileList to appear
    await waitFor(() => {
      expect(screen.getByTestId('output-file-list')).toBeInTheDocument();
      expect(screen.getByText(/OutputFileList for job-completed/)).toBeInTheDocument();
    });
  });

  it('completed job row displays download UI (OutputFileList)', async () => {
    const mockJobs = [
      {
        job_id: 'completed-job-123',
        status: 'completed' as const,
        submitted_at: new Date().toISOString(),
        action_type: 'slice',
      },
    ];

    const mockJobDetail = {
      job_id: 'completed-job-123',
      session_id: 'session-1',
      submitted_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: 'completed' as const,
      action_type: 'slice',
      cli_args: '--slice 0',
      exit_code: 0,
      error_message: null,
      output_dir: '/workspace/jobs/completed-job-123/output',
    };

    vi.mocked(apiClient.getJobs).mockResolvedValue(mockJobs);
    vi.mocked(apiClient.getJob).mockResolvedValue(mockJobDetail);

    render(<JobHistory />);

    // Wait for the completed job to appear
    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument();
    });

    // Expand the completed job
    const jobRow = screen.getByRole('button');
    fireEvent.click(jobRow);

    // Assert that OutputFileList component is rendered (download UI)
    await waitFor(() => {
      const outputFileList = screen.getByTestId('output-file-list');
      expect(outputFileList).toBeInTheDocument();
      // Verify it's for the correct job
      expect(screen.getByText(/OutputFileList for completed-job-123/)).toBeInTheDocument();
    });
  });

  it('expands job details and shows error for failed job', async () => {
    const mockJobs = [
      {
        job_id: 'job-failed',
        status: 'failed' as const,
        submitted_at: new Date().toISOString(),
        action_type: 'slice',
      },
    ];

    const mockJobDetail = {
      job_id: 'job-failed',
      session_id: 'session-1',
      submitted_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: 'failed' as const,
      action_type: 'slice',
      cli_args: '--slice 0',
      exit_code: 1,
      error_message: 'File not found',
      output_dir: '/workspace/jobs/job-failed/output',
    };

    vi.mocked(apiClient.getJobs).mockResolvedValue(mockJobs);
    vi.mocked(apiClient.getJob).mockResolvedValue(mockJobDetail);

    render(<JobHistory />);

    // Wait for job list to load
    await waitFor(() => {
      expect(screen.getByText('Failed')).toBeInTheDocument();
    });

    // Click on the job row to expand
    const jobButtons = screen.getAllByRole('button');
    fireEvent.click(jobButtons[0]);

    // Wait for details to load and error message to appear
    await waitFor(() => {
      expect(screen.getByText(/CLI Error \(Exit Code: 1\)/)).toBeInTheDocument();
      expect(screen.getByText('File not found')).toBeInTheDocument();
    });
  });

  it('failed job row shows CLI error code and message', async () => {
    const mockJobs = [
      {
        job_id: 'failed-job-456',
        status: 'failed' as const,
        submitted_at: new Date().toISOString(),
        action_type: 'export_3mf',
      },
    ];

    const mockJobDetail = {
      job_id: 'failed-job-456',
      session_id: 'session-2',
      submitted_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: 'failed' as const,
      action_type: 'export_3mf',
      cli_args: '--export_3mf output.3mf',
      exit_code: 127,
      error_message: 'Command not found: invalid argument --bad-flag',
      output_dir: '/workspace/jobs/failed-job-456/output',
    };

    vi.mocked(apiClient.getJobs).mockResolvedValue(mockJobs);
    vi.mocked(apiClient.getJob).mockResolvedValue(mockJobDetail);

    render(<JobHistory />);

    // Wait for the failed job to appear in the list
    await waitFor(() => {
      expect(screen.getByText('Failed')).toBeInTheDocument();
    });

    // Expand the failed job row
    const jobRow = screen.getByRole('button');
    fireEvent.click(jobRow);

    // Assert that CLI error code is displayed
    await waitFor(() => {
      expect(screen.getByText(/CLI Error \(Exit Code: 127\)/)).toBeInTheDocument();
    });

    // Assert that error message is displayed
    expect(screen.getByText(/Command not found: invalid argument --bad-flag/)).toBeInTheDocument();
  });

  it('collapses expanded job when clicked again', async () => {
    const mockJobs = [
      {
        job_id: 'job-1',
        status: 'completed' as const,
        submitted_at: new Date().toISOString(),
        action_type: 'slice',
      },
    ];

    const mockJobDetail = {
      job_id: 'job-1',
      session_id: 'session-1',
      submitted_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: 'completed' as const,
      action_type: 'slice',
      cli_args: '--slice 0',
      exit_code: 0,
      error_message: null,
      output_dir: '/workspace/jobs/job-1/output',
    };

    vi.mocked(apiClient.getJobs).mockResolvedValue(mockJobs);
    vi.mocked(apiClient.getJob).mockResolvedValue(mockJobDetail);

    render(<JobHistory />);

    // Wait for job list to load
    await waitFor(() => {
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    const jobButton = screen.getByRole('button');

    // Expand
    fireEvent.click(jobButton);
    await waitFor(() => {
      expect(screen.getByTestId('output-file-list')).toBeInTheDocument();
    });

    // Collapse
    fireEvent.click(jobButton);
    await waitFor(() => {
      expect(screen.queryByTestId('output-file-list')).not.toBeInTheDocument();
    });
  });

  it('renders error state when API call fails', async () => {
    vi.mocked(apiClient.getJobs).mockRejectedValue(new Error('Network error'));

    render(<JobHistory />);

    await waitFor(() => {
      expect(screen.getByText('Error loading job history')).toBeInTheDocument();
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('formats timestamps correctly', async () => {
    const now = new Date();
    const mockJobs = [
      {
        job_id: 'job-recent',
        status: 'completed' as const,
        submitted_at: new Date(now.getTime() - 30000).toISOString(), // 30 seconds ago
        action_type: 'slice',
      },
    ];

    vi.mocked(apiClient.getJobs).mockResolvedValue(mockJobs);

    render(<JobHistory />);

    await waitFor(() => {
      // Should show "Just now" or "1m ago" depending on timing
      expect(screen.getByText(/ago|now/i)).toBeInTheDocument();
    });
  });
});
