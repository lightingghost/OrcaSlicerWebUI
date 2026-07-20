import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createJobSlice, JobSlice } from './jobSlice';
import { createProgressSocket } from '../lib/progressSocket';

// Mock the progressSocket module
vi.mock('../lib/progressSocket', () => ({
  createProgressSocket: vi.fn(),
}));

// Mock fetch globally
global.fetch = vi.fn();

describe('JobSlice WebSocket Wiring (Task 18.3)', () => {
  const mockProgressSocket = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn(() => true),
    getJobId: vi.fn(() => 'test-job-id'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (createProgressSocket as any).mockReturnValue(mockProgressSocket);
    localStorage.setItem('api_token', 'test-token');
  });

  it('should call connectProgressSocket after successful job submission', async () => {
    // Setup
    const mockJobResponse = {
      job_id: 'test-job-123',
      status: 'queued',
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockJobResponse,
    });

    // Create store slice
    const slice = createJobSlice(
      vi.fn() as any, // setState
      () => slice as JobSlice, // getState
      undefined as any // store
    );

    // Submit job
    await slice.submitJob({
      file_ids: ['file-1'],
      printer_profile_path: 'printer.json',
      process_profile_path: 'process.json',
      filament_profile_paths: ['filament.json'],
      action: 'slice',
    });

    // Verify connectProgressSocket was called (createProgressSocket should be called)
    expect(createProgressSocket).toHaveBeenCalledWith(
      'test-job-123',
      'test-token',
      expect.objectContaining({
        onQueued: expect.any(Function),
        onStarted: expect.any(Function),
        onProgress: expect.any(Function),
        onWarning: expect.any(Function),
        onCompleted: expect.any(Function),
        onFailed: expect.any(Function),
        onTimedOut: expect.any(Function),
        onReconnecting: expect.any(Function),
        onMaxReconnectAttemptsReached: expect.any(Function),
        onError: expect.any(Function),
      })
    );
  });

  it('should call disconnectProgressSocket when disconnect is invoked', () => {
    // Create store slice
    const slice = createJobSlice(
      vi.fn() as any,
      () => slice as JobSlice,
      undefined as any
    );

    // First connect
    slice.connectProgressSocket('test-job-456');
    expect(createProgressSocket).toHaveBeenCalledWith('test-job-456', 'test-token', expect.any(Object));

    // Then disconnect
    slice.disconnectProgressSocket();

    // Verify disconnect was called on the socket
    expect(mockProgressSocket.disconnect).toHaveBeenCalled();
  });

  it('should disconnect socket on job cancellation', async () => {
    // Setup
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
    });

    // Create store slice with active job
    let currentState: Partial<JobSlice> = {
      activeJobId: 'job-to-cancel',
    };

    const setState = vi.fn((updater: any) => {
      if (typeof updater === 'function') {
        currentState = { ...currentState, ...updater(currentState) };
      } else {
        currentState = { ...currentState, ...updater };
      }
    });

    const getState = vi.fn(() => ({
      ...currentState,
      cancelJob: slice.cancelJob,
      disconnectProgressSocket: slice.disconnectProgressSocket,
      fetchJobHistory: vi.fn(),
    })) as any;

    const slice = createJobSlice(setState, getState, undefined as any);

    // Connect first
    slice.connectProgressSocket('job-to-cancel');

    // Cancel job
    await slice.cancelJob('job-to-cancel');

    // Verify disconnectProgressSocket was called (disconnect should be called)
    expect(mockProgressSocket.disconnect).toHaveBeenCalled();
  });

  it('should handle completed event and disconnect socket', () => {
    let callbacks: any;

    (createProgressSocket as any).mockImplementation((_jobId: string, _token: string, cbs: any) => {
      callbacks = cbs;
      return mockProgressSocket;
    });

    // Create store slice
    const setState = vi.fn();
    const getState = vi.fn();
    
    const slice = createJobSlice(setState as any, getState as any, undefined as any);

    // Setup getState to return the slice methods
    getState.mockReturnValue({
      disconnectProgressSocket: slice.disconnectProgressSocket,
      fetchJobHistory: vi.fn(),
    });

    // Connect socket
    slice.connectProgressSocket('test-job-complete');

    // Simulate completed event (this should trigger disconnect)
    const completedEvent = {
      type: 'completed' as const,
      job_id: 'test-job-complete',
      timestamp: new Date().toISOString(),
      output_files: [
        {
          filename: 'output.gcode',
          size_bytes: 1024,
          download_url: '/api/jobs/test-job-complete/outputs/output.gcode',
        },
      ],
    };

    callbacks.onCompleted(completedEvent);

    // Verify state was updated with completed status and output files
    expect(setState).toHaveBeenCalledWith(
      expect.objectContaining({
        jobStatus: 'completed',
        outputFiles: expect.arrayContaining([
          expect.objectContaining({
            filename: 'output.gcode',
            size_bytes: 1024,
          }),
        ]),
      })
    );
  });

  it('should handle failed event and disconnect socket', () => {
    let callbacks: any;

    (createProgressSocket as any).mockImplementation((_jobId: string, _token: string, cbs: any) => {
      callbacks = cbs;
      return mockProgressSocket;
    });

    const setState = vi.fn();
    const getState = vi.fn();

    const slice = createJobSlice(setState as any, getState as any, undefined as any);

    // Setup getState to return the slice methods
    getState.mockReturnValue({
      disconnectProgressSocket: slice.disconnectProgressSocket,
      fetchJobHistory: vi.fn(),
    });

    // Connect socket
    slice.connectProgressSocket('test-job-fail');

    // Simulate failed event
    const failedEvent = {
      type: 'failed' as const,
      job_id: 'test-job-fail',
      timestamp: new Date().toISOString(),
      exit_code: 1,
      error_message: 'CLI error',
    };

    callbacks.onFailed(failedEvent);

    // Verify state was updated
    expect(setState).toHaveBeenCalledWith(
      expect.objectContaining({
        jobStatus: 'failed',
      })
    );
  });

  it('should handle timed_out event and disconnect socket', () => {
    let callbacks: any;

    (createProgressSocket as any).mockImplementation((_jobId: string, _token: string, cbs: any) => {
      callbacks = cbs;
      return mockProgressSocket;
    });

    const setState = vi.fn();
    const getState = vi.fn();

    const slice = createJobSlice(setState as any, getState as any, undefined as any);

    // Setup getState to return the slice methods
    getState.mockReturnValue({
      disconnectProgressSocket: slice.disconnectProgressSocket,
      fetchJobHistory: vi.fn(),
    });

    // Connect socket
    slice.connectProgressSocket('test-job-timeout');

    // Simulate timed_out event
    const timedOutEvent = {
      type: 'timed_out' as const,
      job_id: 'test-job-timeout',
      timestamp: new Date().toISOString(),
      timeout_seconds: 3600,
    };

    callbacks.onTimedOut(timedOutEvent);

    // Verify state was updated
    expect(setState).toHaveBeenCalledWith(
      expect.objectContaining({
        jobStatus: 'timed_out',
      })
    );
  });
});
