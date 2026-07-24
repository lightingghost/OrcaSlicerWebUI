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
import { PreviewSlice } from './previewSlice';
import { ViewportSlice } from './viewportSlice';

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
  /** Populated when jobStatus becomes 'failed' or 'timed_out', so the UI
   * can actually show the user WHY the job failed instead of the
   * progress modal just silently disappearing (which looks identical to
   * "clicking Slice did nothing"). Cleared on the next submitJob call. */
  jobError: string | null;
  submitJob: (request: JobRequest) => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;
  fetchJobHistory: () => Promise<void>;
  connectProgressSocket: (jobId: string) => void;
  disconnectProgressSocket: () => void;
  /** Dismiss a failed/timed-out job's progress modal entirely (clears
   * activeJobId/jobStatus/jobError so the modal's render guard hides it).
   * Distinct from disconnectProgressSocket, which only tears down the
   * socket/polling but leaves jobStatus as 'failed' — this is what
   * JobProgressModal's close button calls once a job has failed, so the
   * user can dismiss the error and try again. */
  dismissJob: () => void;
}

/** Picks the sliced gcode file out of a completed job's output files (a
 * slice job's outputs are `plate_N.gcode` plus a `result.json` — see
 * job_manager.py's `_register_output_files`, which just lists every file
 * OrcaSlicer's CLI wrote to the job's output directory). Returns null for
 * export jobs (3mf/stl/settings), which have no meaningful gcode preview. */
export function findGcodeOutput(outputFiles: OutputFileSummary[]): OutputFileSummary | null {
  return outputFiles.find((f) => f.filename.toLowerCase().endsWith('.gcode')) ?? null;
}

/**
 * Captures the current Prepare-tab 3D viewport as a PNG (via
 * viewportSlice's captureViewportThumbnail, registered by ThreeViewport)
 * and uploads it as the completed job's thumbnail output. Native
 * OrcaSlicer's CLI can never generate a gcode thumbnail itself (see the
 * doc comment on POST /api/jobs/{id}/thumbnail in routers/jobs.py for
 * why — its thumbnail generator callback only exists in the desktop
 * GUI's OpenGL pipeline), so this is the substitute: a snapshot of the
 * exact plate/model the job just sliced, taken from the browser's own
 * already-rendered view.
 *
 * Best-effort and silent on failure — a missing thumbnail should never
 * surface as a job failure or block any of the other completion side
 * effects (tab switch, gcode preview load), since the job itself
 * genuinely succeeded regardless of whether this cosmetic extra works.
 */
async function captureAndUploadThumbnail(
  jobId: string,
  captureViewportThumbnail: (() => Promise<Blob | null>) | null,
  onUploaded: (thumbnail: OutputFileSummary) => void
): Promise<void> {
  if (!captureViewportThumbnail) return;
  try {
    const blob = await captureViewportThumbnail();
    if (!blob) return;
    const response = await fetch(`/api/jobs/${jobId}/thumbnail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
      },
      body: blob,
    });
    if (!response.ok) return;
    const thumbnail: OutputFileSummary = await response.json();
    // Uploading is async and finishes after the completion handler that
    // triggered it has already returned (and already set() the job's
    // outputFiles from the gcode/result.json list alone) — without this,
    // the thumbnail would exist on the backend but never appear in
    // outputFiles until the next unrelated state update, if ever.
    onUploaded(thumbnail);
  } catch (error) {
    console.error('[JobSlice] Failed to capture/upload thumbnail:', error);
  }
}

export const createJobSlice: StateCreator<
  JobSlice & PreviewSlice & ViewportSlice,
  [],
  [],
  JobSlice
> = (set, get) => {
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

        // If job is in terminal state, stop polling and refresh history
        // IMMEDIATELY — this must never be skipped, or the interval fires
        // forever (re-hitting /api/jobs/{id} and /outputs every 2s with no
        // way to stop, since every subsequent tick re-enters this same
        // branch). Any further side effects (fetching outputs, switching
        // to the Preview tab, loading the gcode preview) are best-effort
        // and handled separately below, wrapped in their own try/catch so
        // a failure there can never block this cleanup again.
        if (['completed', 'failed', 'timed_out'].includes(jobDetail.status)) {
          stopPolling();

          if (jobDetail.status === 'failed' || jobDetail.status === 'timed_out') {
            set({
              jobError:
                jobDetail.error_message ||
                `Job ${jobDetail.status === 'timed_out' ? 'timed out' : 'failed'}`,
            });
          }

          if (jobDetail.status === 'completed') {
            try {
              // Fetch output files
              const outputsResponse = await fetch(`/api/jobs/${jobId}/outputs`, {
                headers: {
                  Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
                },
              });

              if (outputsResponse.ok) {
                // GET /api/jobs/{id}/outputs responds with
                // { job_id, status, output_files: [...] }, not a bare
                // array (see backend/app/routers/jobs.py) — outputFiles
                // state and findGcodeOutput both expect the array itself.
                const outputsBody = await outputsResponse.json();
                const outputs: OutputFileSummary[] = outputsBody.output_files ?? [];
                set({ outputFiles: outputs });

                // Matches native OrcaSlicer jumping to its Preview tab the
                // moment slicing finishes: switch tabs and load the sliced
                // gcode's stats/toolpath. No-op (findGcodeOutput returns
                // null) for export jobs, which have no gcode to preview.
                const gcodeOutput = findGcodeOutput(outputs);
                if (gcodeOutput) {
                  get().setActiveTab('preview');
                  get().loadGcodePreview(gcodeOutput.download_url);
                  captureAndUploadThumbnail(jobId, get().captureViewportThumbnail, (thumbnail) => {
                    set((state) => ({ outputFiles: [...state.outputFiles, thumbnail] }));
                  });
                }
              }
            } catch (outputsError) {
              console.error('[JobSlice] Failed to fetch outputs / load preview:', outputsError);
            }
          }

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
    jobError: null,

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
          jobError: null,
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

      // Always start the REST-polling safety net alongside the WebSocket,
      // not only after 5 failed reconnect attempts. The WebSocket can go
      // silently dead without ever firing a close/error event (e.g. a
      // backgrounded tab, a proxy that drops the connection without a
      // clean close frame, or the backend restarting mid-session) — in
      // that case reconnectAttempts never increments and
      // onMaxReconnectAttemptsReached never fires, so the UI would be
      // stuck showing "Slicing in Progress" forever even though the job
      // finished on the backend. Polling every 2s is cheap (a single
      // small JSON GET) and guarantees the UI converges to the backend's
      // real status within a few seconds no matter what the socket does.
      // onCompleted/onFailed/onTimedOut below call stopPolling(), so this
      // is a no-op once a terminal event arrives via the socket first.
      startPolling(jobId);

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
          const outputFiles = event.output_files.map((file: SocketOutputFileSummary) => ({
            filename: file.filename,
            size_bytes: file.size_bytes,
            download_url: file.download_url,
          }));
          set({
            jobStatus: 'completed',
            outputFiles,
          });
          stopPolling();
          fetchJobHistory();

          // Matches native OrcaSlicer jumping to its Preview tab the
          // moment slicing finishes (see the REST-polling fallback path
          // above for the fuller explanation). No-op for export jobs.
          const gcodeOutput = findGcodeOutput(outputFiles);
          if (gcodeOutput) {
            get().setActiveTab('preview');
            get().loadGcodePreview(gcodeOutput.download_url);
            captureAndUploadThumbnail(event.job_id, get().captureViewportThumbnail, (thumbnail) => {
              set((state) => ({ outputFiles: [...state.outputFiles, thumbnail] }));
            });
          }
        },

        onFailed: (event: FailedEvent) => {
          set({
            jobStatus: 'failed',
            jobError: event.error_message || `Job failed (exit code ${event.exit_code})`,
          });
          stopPolling();
          fetchJobHistory();
        },

        onTimedOut: (event: TimedOutEvent) => {
          set({
            jobStatus: 'timed_out',
            jobError: `Job timed out after ${event.timeout_seconds}s`,
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

    dismissJob: () => {
      if (progressSocket) {
        progressSocket.disconnect();
        progressSocket = null;
      }
      stopPolling();
      set({ activeJobId: null, jobStatus: null, jobError: null });
    },
  };
};
