/**
 * WebSocket client for job progress monitoring
 * 
 * Connects to /ws/jobs/{job_id}?token=<api_secret> and dispatches incoming
 * events to jobSlice. Implements auto-reconnect with exponential backoff
 * (max 5 attempts, then falls back to REST polling for job status).
 * 
 * Requirements: 7.1, 7.3
 */

// ============================================================================
// Types
// ============================================================================

export type ProgressEventType =
  | 'queued'
  | 'started'
  | 'progress'
  | 'warning'
  | 'completed'
  | 'failed'
  | 'timed_out';

export interface BaseProgressEvent {
  type: ProgressEventType;
  job_id: string;
  timestamp: string;
}

export interface QueuedEvent extends BaseProgressEvent {
  type: 'queued';
  queue_position: number;
}

export interface StartedEvent extends BaseProgressEvent {
  type: 'started';
}

export interface ProgressUpdateEvent extends BaseProgressEvent {
  type: 'progress';
  plate_index: number;
  plate_count: number;
  plate_percent: number;
  total_percent: number;
  message: string;
}

export interface WarningEvent extends BaseProgressEvent {
  type: 'warning';
  warning: string;
}

export interface OutputFileSummary {
  filename: string;
  size_bytes: number;
  download_url: string;
}

export interface CompletedEvent extends BaseProgressEvent {
  type: 'completed';
  output_files: OutputFileSummary[];
}

export interface FailedEvent extends BaseProgressEvent {
  type: 'failed';
  exit_code: number;
  error_message: string;
}

export interface TimedOutEvent extends BaseProgressEvent {
  type: 'timed_out';
  timeout_seconds: number;
}

export type ProgressEvent =
  | QueuedEvent
  | StartedEvent
  | ProgressUpdateEvent
  | WarningEvent
  | CompletedEvent
  | FailedEvent
  | TimedOutEvent;

export interface ProgressSocketCallbacks {
  onQueued?: (event: QueuedEvent) => void;
  onStarted?: (event: StartedEvent) => void;
  onProgress?: (event: ProgressUpdateEvent) => void;
  onWarning?: (event: WarningEvent) => void;
  onCompleted?: (event: CompletedEvent) => void;
  onFailed?: (event: FailedEvent) => void;
  onTimedOut?: (event: TimedOutEvent) => void;
  onReconnecting?: (attempt: number, maxAttempts: number, delay: number) => void;
  onMaxReconnectAttemptsReached?: (jobId: string) => void;
  onError?: (error: Event) => void;
}

// ============================================================================
// ProgressSocket Class
// ============================================================================

export class ProgressSocket {
  private socket: WebSocket | null = null;
  private jobId: string;
  private token: string;
  private callbacks: ProgressSocketCallbacks;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private reconnectTimeoutId: number | null = null;
  private isManuallyDisconnected = false;

  constructor(jobId: string, token: string, callbacks: ProgressSocketCallbacks) {
    this.jobId = jobId;
    this.token = token;
    this.callbacks = callbacks;
  }

  /**
   * Connect to the WebSocket endpoint
   */
  connect(): void {
    // Clear any pending reconnection
    this.clearReconnectTimeout();
    this.isManuallyDisconnected = false;

    // Build WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/jobs/${this.jobId}?token=${encodeURIComponent(this.token)}`;

    console.log(`[ProgressSocket] Connecting to job ${this.jobId}...`);

    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      console.log(`[ProgressSocket] Connected to job ${this.jobId}`);
      this.reconnectAttempts = 0;
    };

    this.socket.onmessage = (event) => {
      this.handleMessage(event);
    };

    this.socket.onerror = (error) => {
      console.error(`[ProgressSocket] WebSocket error:`, error);
      if (this.callbacks.onError) {
        this.callbacks.onError(error);
      }
    };

    this.socket.onclose = () => {
      console.log(`[ProgressSocket] WebSocket closed for job ${this.jobId}`);
      this.socket = null;

      // Only attempt reconnection if not manually disconnected
      if (!this.isManuallyDisconnected) {
        this.attemptReconnect();
      }
    };
  }

  /**
   * Disconnect from the WebSocket
   */
  disconnect(): void {
    console.log(`[ProgressSocket] Manually disconnecting from job ${this.jobId}`);
    this.isManuallyDisconnected = true;
    this.clearReconnectTimeout();

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    this.reconnectAttempts = 0;
  }

  /**
   * Check if the socket is currently connected
   */
  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  /**
   * Get the current job ID
   */
  getJobId(): string {
    return this.jobId;
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data) as ProgressEvent;

      console.log(`[ProgressSocket] Received ${message.type} event for job ${message.job_id}`);

      switch (message.type) {
        case 'queued':
          if (this.callbacks.onQueued) {
            this.callbacks.onQueued(message as QueuedEvent);
          }
          break;

        case 'started':
          if (this.callbacks.onStarted) {
            this.callbacks.onStarted(message as StartedEvent);
          }
          break;

        case 'progress':
          if (this.callbacks.onProgress) {
            this.callbacks.onProgress(message as ProgressUpdateEvent);
          }
          break;

        case 'warning':
          if (this.callbacks.onWarning) {
            this.callbacks.onWarning(message as WarningEvent);
          }
          break;

        case 'completed':
          if (this.callbacks.onCompleted) {
            this.callbacks.onCompleted(message as CompletedEvent);
          }
          // Auto-disconnect on completion
          this.disconnect();
          break;

        case 'failed':
          if (this.callbacks.onFailed) {
            this.callbacks.onFailed(message as FailedEvent);
          }
          // Auto-disconnect on failure
          this.disconnect();
          break;

        case 'timed_out':
          if (this.callbacks.onTimedOut) {
            this.callbacks.onTimedOut(message as TimedOutEvent);
          }
          // Auto-disconnect on timeout
          this.disconnect();
          break;

        default:
          console.warn(`[ProgressSocket] Unknown message type:`, message);
      }
    } catch (error) {
      console.error(`[ProgressSocket] Failed to parse WebSocket message:`, error);
    }
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn(
        `[ProgressSocket] Max reconnection attempts (${this.maxReconnectAttempts}) reached for job ${this.jobId}`
      );

      if (this.callbacks.onMaxReconnectAttemptsReached) {
        this.callbacks.onMaxReconnectAttemptsReached(this.jobId);
      }

      return;
    }

    // Calculate exponential backoff delay: 1s, 2s, 4s, 8s, 16s
    const delay = Math.pow(2, this.reconnectAttempts) * 1000;
    this.reconnectAttempts++;

    console.log(
      `[ProgressSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    if (this.callbacks.onReconnecting) {
      this.callbacks.onReconnecting(this.reconnectAttempts, this.maxReconnectAttempts, delay);
    }

    this.reconnectTimeoutId = window.setTimeout(() => {
      this.reconnectTimeoutId = null;
      this.connect();
    }, delay);
  }

  /**
   * Clear any pending reconnection timeout
   */
  private clearReconnectTimeout(): void {
    if (this.reconnectTimeoutId !== null) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create and connect a ProgressSocket instance
 */
export function createProgressSocket(
  jobId: string,
  token: string,
  callbacks: ProgressSocketCallbacks
): ProgressSocket {
  const socket = new ProgressSocket(jobId, token, callbacks);
  socket.connect();
  return socket;
}
