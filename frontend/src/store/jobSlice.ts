import { StateCreator } from 'zustand';
import {
  ProgressSocket,
  createProgressSocket,
  ProgressUpdateEvent as SocketProgressUpdateEvent,
  OutputFileSummary as SocketOutputFileSummary,
  QueuedEvent,
  StartedEvent,
  CompletedEvent,
  FailedEvent,
  TimedOutEvent,
  WarningEvent,
} from '../lib/progressSocket';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'timed_out';

export interface OutputFileSummary {
  filename: string;
  size_bytes: number;
  download_url: string;
}

export interface JobRecord {
  job_id: string;
  status: JobStatus;
  action_type: string;
  submitted_at: string;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
}

export interface ProgressUpdateEvent {
  type: 'progress';
  job_id: string;
  plate_index: number;
  plate_count: number;
  plate_percent: number;
  total_percent: number;
  message: string;
  timestamp: string;
}

export interface JobRequest {
  file_ids: string[];
  printer_profile_path: string;
  process_profile_path: string;
  filament_profile_paths: string[];
  action: 'slice' | 'export_3mf' | 'export_stl' | 'export_stls' | 'export_settings';
  plate_number?: number;
  output_filename?: string;
  transforms?: Record<string, unknown>;
  parameter_overrides?: Record<string, string | number | boolean>;
  misc?: Record<string, unknown>;
  action_flags?: Record<string, boolean>;
}

export interface JobSlice {
  activeJobId: string | null;
  jobStatus: JobStatus | null;
  queuePosition: number | null;
  progress: ProgressUpdateEvent | null;
  outputFiles: OutputFileSummary[];
  jobs: JobRecord[];
  submitJob: (request: JobRequest) => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;
  fetchJobHistory: () => Promise<void>;
  connectProgressSocket: (jobId: string) => void;
  disconnectProgressSocket: () => void;
}

export const createJobSlice: StateCreator<JobSlice> = (set, get) => {
  let progressSocket: ProgressSocket | null = null;
  let pollingIntervalId: number | null = null;

  /**
   * Start polling job status as fallback when WebSocket fails
   */
  const startPolling = (jobId: string) => {
    console.log('[JobSlice] Starting REST polling fallback for job', jobId);
    
    // Clear any existing polling
    stopPolling();

    // Poll every 2 seconds
    pollingIntervalId = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/jobs/${jobId}`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
          },
        });

        if (!response.ok) {
          console.error('[JobSlice] Polling failed:', response.status);
          return;
        }

        const jobDetail = await response.json();
        
        // Update state based on job detail
        set({
          jobStatus: jobDetail.status,
        });

        // If job is in terminal state, fetch outputs and stop polling
        if (['completed', 'failed', 'timed_out'].includes(jobDetail.status)) {
          if (jobDetail.status === 'completed') {
            // Fetch output files
            const outputsResponse = await fetch(`/api/jobs/${jobId}/outputs`, {
              headers: {
                Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
              },
            });

            if (outputsResponse.ok) {
              const outputs = await outputsResponse.json();
              set({ outputFiles: outputs });
            }
          }

          stopPolling();
          get().fetchJobHistory();
        }
      } catch (error) {
        console.error('[JobSlice] Polling error:', error);
      }
    }, 2000);
  };

  /**
   * Stop polling job status
   */
  const stopPolling = () => {
    if (pollingIntervalId !== null) {
      clearInterval(pollingIntervalId);
      pollingIntervalId = null;
      console.log('[JobSlice] Stopped REST polling');
    }
  };

  return {
    activeJobId: null,
    jobStatus: null,
    queuePosition: null,
    progress: null,
    outputFiles: [],
    jobs: [],

    submitJob: async (request: JobRequest) => {
      try {
        const response = await fetch('/api/jobs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
          },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Job submission failed' }));
          throw new Error(errorData.error || `Job submission failed with status ${response.status}`);
        }

        const jobData = await response.json();

        set({
          activeJobId: jobData.job_id,
          jobStatus: jobData.status || 'queued',
          queuePosition: null,
          progress: null,
          outputFiles: [],
        });

        // Auto-connect to progress socket
        get().connectProgressSocket(jobData.job_id);
      } catch (error) {
        console.error('Failed to submit job:', error);
        throw error;
      }
    },

    cancelJob: async (jobId: string) => {
      try {
        const response = await fetch(`/api/jobs/${jobId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to cancel job: ${response.status}`);
        }

        // Disconnect socket if this was the active job
        if (get().activeJobId === jobId) {
          get().disconnectProgressSocket();
        }

        // Refresh job history
        await get().fetchJobHistory();
      } catch (error) {
        console.error('Failed to cancel job:', error);
        throw error;
      }
    },

    fetchJobHistory: async () => {
      try {
        const response = await fetch('/api/jobs', {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch job history: ${response.status}`);
        }

        const jobs: JobRecord[] = await response.json();
        set({ jobs });
      } catch (error) {
        console.error('Failed to fetch job history:', error);
        throw error;
      }
    },

    connectProgressSocket: (jobId: string) => {
      const { disconnectProgressSocket, fetchJobHistory } = get();

      // Close existing socket if any
      disconnectProgressSocket();

      const token = localStorage.getItem('api_token') || '';

      // Create progress socket with callbacks
      progressSocket = createProgressSocket(jobId, token, {
        onQueued: (event: QueuedEvent) => {
          set({
            jobStatus: 'queued',
            queuePosition: event.queue_position,
          });
        },

        onStarted: (_event: StartedEvent) => {
          set({
            jobStatus: 'running',
            queuePosition: null,
          });
        },

        onProgress: (event: SocketProgressUpdateEvent) => {
          set({
            jobStatus: 'running',
            progress: {
              type: 'progress',
              job_id: event.job_id,
              plate_index: event.plate_index,
              plate_count: event.plate_count,
              plate_percent: event.plate_percent,
              total_percent: event.total_percent,
              message: event.message,
              timestamp: event.timestamp,
            } as ProgressUpdateEvent,
          });
        },

        onWarning: (event: WarningEvent) => {
          console.warn('[JobSlice] Job warning:', event.warning);
          // Could dispatch to a separate warnings array in state if needed
        },

        onCompleted: (event: CompletedEvent) => {
          set({
            jobStatus: 'completed',
            outputFiles: event.output_files.map((file: SocketOutputFileSummary) => ({
              filename: file.filename,
              size_bytes: file.size_bytes,
              download_url: file.download_url,
            })),
          });
          stopPolling();
          fetchJobHistory();
        },

        onFailed: (_event: FailedEvent) => {
          set({
            jobStatus: 'failed',
          });
          stopPolling();
          fetchJobHistory();
        },

        onTimedOut: (_event: TimedOutEvent) => {
          set({
            jobStatus: 'timed_out',
          });
          stopPolling();
          fetchJobHistory();
        },

        onReconnecting: (attempt: number, maxAttempts: number, delay: number) => {
          console.log(
            `[JobSlice] Reconnecting to progress socket (${attempt}/${maxAttempts}) in ${delay}ms`
          );
        },

        onMaxReconnectAttemptsReached: (jobId: string) => {
          console.warn('[JobSlice] Max WebSocket reconnection attempts reached, falling back to REST polling');
          startPolling(jobId);
        },

        onError: (error: Event) => {
          console.error('[JobSlice] WebSocket error:', error);
        },
      });
    },

    disconnectProgressSocket: () => {
      if (progressSocket) {
        progressSocket.disconnect();
        progressSocket = null;
      }
      stopPolling();
    },
  };
};
