import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { JobProgressModal } from './JobProgressModal';
import { useStore } from '../../store';

// Mock the store
vi.mock('../../store', () => ({
  useStore: vi.fn(),
}));

describe('JobProgressModal', () => {
  const mockDisconnectProgressSocket = vi.fn();
  const mockCancelJob = vi.fn();
  const mockUseStore = useStore as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when there is no active job', () => {
    mockUseStore.mockImplementation((selector) =>
      selector({
        activeJobId: null,
        jobStatus: null,
        queuePosition: null,
        progress: null,
        disconnectProgressSocket: mockDisconnectProgressSocket,
        cancelJob: mockCancelJob,
      })
    );

    const { container } = render(<JobProgressModal />);
    expect(container.firstChild).toBeNull();
  });

  it('does not render when job status is completed', () => {
    mockUseStore.mockImplementation((selector) =>
      selector({
        activeJobId: 'job-123',
        jobStatus: 'completed',
        queuePosition: null,
        progress: null,
        disconnectProgressSocket: mockDisconnectProgressSocket,
        cancelJob: mockCancelJob,
      })
    );

    const { container } = render(<JobProgressModal />);
    expect(container.firstChild).toBeNull();
  });

  it('renders modal when job is queued', () => {
    mockUseStore.mockImplementation((selector) =>
      selector({
        activeJobId: 'job-123',
        jobStatus: 'queued',
        queuePosition: 2,
        progress: null,
        disconnectProgressSocket: mockDisconnectProgressSocket,
        cancelJob: mockCancelJob,
      })
    );

    render(<JobProgressModal />);

    expect(screen.getAllByText('Job Queued')[0]).toBeInTheDocument(); // Header
    expect(screen.getByText('Job ID: job-123')).toBeInTheDocument();
    expect(screen.getByText('Position 2 in queue')).toBeInTheDocument();
  });

  it('renders modal when job is running', () => {
    mockUseStore.mockImplementation((selector) =>
      selector({
        activeJobId: 'job-456',
        jobStatus: 'running',
        queuePosition: null,
        progress: {
          type: 'progress',
          job_id: 'job-456',
          plate_index: 0,
          plate_count: 2,
          plate_percent: 45.5,
          total_percent: 23.2,
          message: 'Slicing plate 1...',
          timestamp: new Date().toISOString(),
        },
        disconnectProgressSocket: mockDisconnectProgressSocket,
        cancelJob: mockCancelJob,
      })
    );

    render(<JobProgressModal />);

    expect(screen.getByText('Slicing in Progress')).toBeInTheDocument();
    expect(screen.getByText('23.2%')).toBeInTheDocument();
    expect(screen.getByText('Slicing plate 1...')).toBeInTheDocument();
    expect(screen.getByText('Plate 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('45.5% (current plate)')).toBeInTheDocument();
  });

  it('shows queue position indicator when status is queued', () => {
    mockUseStore.mockImplementation((selector) =>
      selector({
        activeJobId: 'job-789',
        jobStatus: 'queued',
        queuePosition: 1,
        progress: null,
        disconnectProgressSocket: mockDisconnectProgressSocket,
        cancelJob: mockCancelJob,
      })
    );

    render(<JobProgressModal />);

    expect(screen.getByText('Your job is next in line')).toBeInTheDocument();
  });

  it('shows waiting message when job is queued', () => {
    mockUseStore.mockImplementation((selector) =>
      selector({
        activeJobId: 'job-waiting',
        jobStatus: 'queued',
        queuePosition: 3,
        progress: null,
        disconnectProgressSocket: mockDisconnectProgressSocket,
        cancelJob: mockCancelJob,
      })
    );

    render(<JobProgressModal />);

    expect(screen.getByText('Waiting for available slot...')).toBeInTheDocument();
    expect(
      screen.getByText('Your job will start automatically when resources are available')
    ).toBeInTheDocument();
  });

  it('calls cancelJob when cancel button is clicked', async () => {
    mockCancelJob.mockResolvedValue(undefined);

    mockUseStore.mockImplementation((selector) =>
      selector({
        activeJobId: 'job-cancel',
        jobStatus: 'running',
        queuePosition: null,
        progress: {
          type: 'progress',
          job_id: 'job-cancel',
          plate_index: 0,
          plate_count: 1,
          plate_percent: 30.0,
          total_percent: 30.0,
          message: 'Processing...',
          timestamp: new Date().toISOString(),
        },
        disconnectProgressSocket: mockDisconnectProgressSocket,
        cancelJob: mockCancelJob,
      })
    );

    render(<JobProgressModal />);

    const cancelButton = screen.getByRole('button', { name: /cancel job/i });
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(mockCancelJob).toHaveBeenCalledWith('job-cancel');
      expect(mockDisconnectProgressSocket).toHaveBeenCalled();
    });
  });

  it('shows cancel button when job is queued', () => {
    mockUseStore.mockImplementation((selector) =>
      selector({
        activeJobId: 'job-123',
        jobStatus: 'queued',
        queuePosition: 2,
        progress: null,
        disconnectProgressSocket: mockDisconnectProgressSocket,
        cancelJob: mockCancelJob,
      })
    );

    render(<JobProgressModal />);

    expect(screen.getByRole('button', { name: /cancel job/i })).toBeInTheDocument();
  });

  it('shows cancel button when job is running', () => {
    mockUseStore.mockImplementation((selector) =>
      selector({
        activeJobId: 'job-123',
        jobStatus: 'running',
        queuePosition: null,
        progress: {
          type: 'progress',
          job_id: 'job-123',
          plate_index: 0,
          plate_count: 1,
          plate_percent: 50.0,
          total_percent: 50.0,
          message: 'Running...',
          timestamp: new Date().toISOString(),
        },
        disconnectProgressSocket: mockDisconnectProgressSocket,
        cancelJob: mockCancelJob,
      })
    );

    render(<JobProgressModal />);

    expect(screen.getByRole('button', { name: /cancel job/i })).toBeInTheDocument();
  });

  it('displays progress bar with correct percentage', () => {
    mockUseStore.mockImplementation((selector) =>
      selector({
        activeJobId: 'job-progress',
        jobStatus: 'running',
        queuePosition: null,
        progress: {
          type: 'progress',
          job_id: 'job-progress',
          plate_index: 1,
          plate_count: 3,
          plate_percent: 75.3,
          total_percent: 58.8,
          message: 'Generating G-code...',
          timestamp: new Date().toISOString(),
        },
        disconnectProgressSocket: mockDisconnectProgressSocket,
        cancelJob: mockCancelJob,
      })
    );

    render(<JobProgressModal />);

    expect(screen.getByText('58.8%')).toBeInTheDocument();
    expect(screen.getByText('Plate 2 of 3')).toBeInTheDocument();
    expect(screen.getByText('75.3% (current plate)')).toBeInTheDocument();
  });

  it('has modal backdrop with correct styling', () => {
    mockUseStore.mockImplementation((selector) =>
      selector({
        activeJobId: 'job-123',
        jobStatus: 'queued',
        queuePosition: 1,
        progress: null,
        disconnectProgressSocket: mockDisconnectProgressSocket,
        cancelJob: mockCancelJob,
      })
    );

    const { container } = render(<JobProgressModal />);

    const backdrop = container.querySelector('.fixed.inset-0.z-50.bg-black.bg-opacity-60');
    expect(backdrop).toBeInTheDocument();
  });

  it('displays job ID in monospace font', () => {
    mockUseStore.mockImplementation((selector) =>
      selector({
        activeJobId: 'test-job-id-12345',
        jobStatus: 'running',
        queuePosition: null,
        progress: {
          type: 'progress',
          job_id: 'test-job-id-12345',
          plate_index: 0,
          plate_count: 1,
          plate_percent: 10.0,
          total_percent: 10.0,
          message: 'Starting...',
          timestamp: new Date().toISOString(),
        },
        disconnectProgressSocket: mockDisconnectProgressSocket,
        cancelJob: mockCancelJob,
      })
    );

    render(<JobProgressModal />);

    const jobIdElement = screen.getByText('Job ID: test-job-id-12345');
    expect(jobIdElement).toHaveClass('font-mono');
  });

  it('handles cancel job error gracefully', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCancelJob.mockRejectedValue(new Error('Cancel failed'));

    mockUseStore.mockImplementation((selector) =>
      selector({
        activeJobId: 'job-error',
        jobStatus: 'running',
        queuePosition: null,
        progress: {
          type: 'progress',
          job_id: 'job-error',
          plate_index: 0,
          plate_count: 1,
          plate_percent: 20.0,
          total_percent: 20.0,
          message: 'Working...',
          timestamp: new Date().toISOString(),
        },
        disconnectProgressSocket: mockDisconnectProgressSocket,
        cancelJob: mockCancelJob,
      })
    );

    render(<JobProgressModal />);

    const cancelButton = screen.getByRole('button', { name: /cancel job/i });
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    consoleErrorSpy.mockRestore();
  });

  it('shows header icon for job', () => {
    mockUseStore.mockImplementation((selector) =>
      selector({
        activeJobId: 'job-123',
        jobStatus: 'running',
        queuePosition: null,
        progress: {
          type: 'progress',
          job_id: 'job-123',
          plate_index: 0,
          plate_count: 1,
          plate_percent: 40.0,
          total_percent: 40.0,
          message: 'Processing...',
          timestamp: new Date().toISOString(),
        },
        disconnectProgressSocket: mockDisconnectProgressSocket,
        cancelJob: mockCancelJob,
      })
    );

    const { container } = render(<JobProgressModal />);

    const headerIcon = container.querySelector('.bg-blue-500.bg-opacity-20');
    expect(headerIcon).toBeInTheDocument();
  });
});
