/**
 * Unit tests for ProgressSocket
 * 
 * Tests WebSocket connection, message handling, reconnection logic,
 * and fallback behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ProgressSocket,
  createProgressSocket,
  QueuedEvent,
  StartedEvent,
  ProgressUpdateEvent,
  WarningEvent,
  CompletedEvent,
  FailedEvent,
  TimedOutEvent,
} from './progressSocket';

// Mock WebSocket
class MockWebSocket {
  url: string;
  readyState: number = WebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url: string) {
    this.url = url;
    // Simulate async connection
    setTimeout(() => {
      this.readyState = WebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 0);
  }

  send(data: string): void {
    // Mock send
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close'));
    }
  }

  // Helper method to simulate receiving a message
  simulateMessage(data: unknown): void {
    if (this.onmessage) {
      const event = new MessageEvent('message', {
        data: JSON.stringify(data),
      });
      this.onmessage(event);
    }
  }

  // Helper method to simulate error
  simulateError(): void {
    if (this.onerror) {
      this.onerror(new Event('error'));
    }
  }
}

describe('ProgressSocket', () => {
  let originalWebSocket: typeof WebSocket;
  let mockWebSocketInstance: MockWebSocket | null = null;

  beforeEach(() => {
    // Save original WebSocket
    originalWebSocket = global.WebSocket;

    // Mock WebSocket constructor
    global.WebSocket = vi.fn((url: string) => {
      mockWebSocketInstance = new MockWebSocket(url);
      return mockWebSocketInstance as unknown as WebSocket;
    }) as unknown as typeof WebSocket;

    // Add static constants
    (global.WebSocket as any).CONNECTING = 0;
    (global.WebSocket as any).OPEN = 1;
    (global.WebSocket as any).CLOSING = 2;
    (global.WebSocket as any).CLOSED = 3;

    vi.useFakeTimers();
  });

  afterEach(() => {
    // Restore original WebSocket
    global.WebSocket = originalWebSocket;
    mockWebSocketInstance = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('Constructor and Connection', () => {
    it('should construct WebSocket URL correctly with ws protocol', () => {
      const jobId = 'test-job-123';
      const token = 'test-token';

      // Mock location
      Object.defineProperty(window, 'location', {
        value: {
          protocol: 'http:',
          host: 'localhost:3000',
        },
        writable: true,
      });

      const socket = new ProgressSocket(jobId, token, {});
      socket.connect();

      expect(global.WebSocket).toHaveBeenCalledWith(
        `ws://localhost:3000/ws/jobs/test-job-123?token=test-token`
      );
    });

    it('should construct WebSocket URL correctly with wss protocol', () => {
      const jobId = 'test-job-456';
      const token = 'secure-token';

      // Mock location
      Object.defineProperty(window, 'location', {
        value: {
          protocol: 'https:',
          host: 'example.com',
        },
        writable: true,
      });

      const socket = new ProgressSocket(jobId, token, {});
      socket.connect();

      expect(global.WebSocket).toHaveBeenCalledWith(
        `wss://example.com/ws/jobs/test-job-456?token=secure-token`
      );
    });

    it('should properly encode token in URL', () => {
      const jobId = 'test-job';
      const token = 'token with spaces & special=chars';

      Object.defineProperty(window, 'location', {
        value: {
          protocol: 'http:',
          host: 'localhost',
        },
        writable: true,
      });

      const socket = new ProgressSocket(jobId, token, {});
      socket.connect();

      expect(global.WebSocket).toHaveBeenCalledWith(
        `ws://localhost/ws/jobs/test-job?token=${encodeURIComponent(token)}`
      );
    });

    it('should call onopen callback when connected', async () => {
      const onOpen = vi.fn();
      const socket = new ProgressSocket('job-1', 'token', {});
      
      // Manually set up onopen handler to test
      socket.connect();
      
      await vi.runAllTimersAsync();
      
      expect(mockWebSocketInstance?.readyState).toBe(WebSocket.OPEN);
    });
  });

  describe('Message Handling', () => {
    it('should handle queued event', async () => {
      const onQueued = vi.fn();
      const socket = new ProgressSocket('job-1', 'token', { onQueued });
      socket.connect();

      await vi.runAllTimersAsync();

      const queuedEvent: QueuedEvent = {
        type: 'queued',
        job_id: 'job-1',
        queue_position: 3,
        timestamp: '2024-01-01T00:00:00Z',
      };

      mockWebSocketInstance?.simulateMessage(queuedEvent);

      expect(onQueued).toHaveBeenCalledWith(queuedEvent);
    });

    it('should handle started event', async () => {
      const onStarted = vi.fn();
      const socket = new ProgressSocket('job-1', 'token', { onStarted });
      socket.connect();

      await vi.runAllTimersAsync();

      const startedEvent: StartedEvent = {
        type: 'started',
        job_id: 'job-1',
        timestamp: '2024-01-01T00:00:00Z',
      };

      mockWebSocketInstance?.simulateMessage(startedEvent);

      expect(onStarted).toHaveBeenCalledWith(startedEvent);
    });

    it('should handle progress event', async () => {
      const onProgress = vi.fn();
      const socket = new ProgressSocket('job-1', 'token', { onProgress });
      socket.connect();

      await vi.runAllTimersAsync();

      const progressEvent: ProgressUpdateEvent = {
        type: 'progress',
        job_id: 'job-1',
        plate_index: 0,
        plate_count: 1,
        plate_percent: 50,
        total_percent: 50,
        message: 'Slicing plate 1...',
        timestamp: '2024-01-01T00:00:00Z',
      };

      mockWebSocketInstance?.simulateMessage(progressEvent);

      expect(onProgress).toHaveBeenCalledWith(progressEvent);
    });

    it('should handle warning event', async () => {
      const onWarning = vi.fn();
      const socket = new ProgressSocket('job-1', 'token', { onWarning });
      socket.connect();

      await vi.runAllTimersAsync();

      const warningEvent: WarningEvent = {
        type: 'warning',
        job_id: 'job-1',
        warning: 'Layer time is very short',
        timestamp: '2024-01-01T00:00:00Z',
      };

      mockWebSocketInstance?.simulateMessage(warningEvent);

      expect(onWarning).toHaveBeenCalledWith(warningEvent);
    });

    it('should handle completed event and auto-disconnect', async () => {
      const onCompleted = vi.fn();
      const socket = new ProgressSocket('job-1', 'token', { onCompleted });
      socket.connect();

      await vi.runAllTimersAsync();

      const completedEvent: CompletedEvent = {
        type: 'completed',
        job_id: 'job-1',
        output_files: [
          {
            filename: 'output.gcode',
            size_bytes: 1024,
            download_url: '/api/jobs/job-1/outputs/output.gcode',
          },
        ],
        timestamp: '2024-01-01T00:00:00Z',
      };

      mockWebSocketInstance?.simulateMessage(completedEvent);

      expect(onCompleted).toHaveBeenCalledWith(completedEvent);
      expect(mockWebSocketInstance?.readyState).toBe(WebSocket.CLOSED);
    });

    it('should handle failed event and auto-disconnect', async () => {
      const onFailed = vi.fn();
      const socket = new ProgressSocket('job-1', 'token', { onFailed });
      socket.connect();

      await vi.runAllTimersAsync();

      const failedEvent: FailedEvent = {
        type: 'failed',
        job_id: 'job-1',
        exit_code: 1,
        error_message: 'CLI error',
        timestamp: '2024-01-01T00:00:00Z',
      };

      mockWebSocketInstance?.simulateMessage(failedEvent);

      expect(onFailed).toHaveBeenCalledWith(failedEvent);
      expect(mockWebSocketInstance?.readyState).toBe(WebSocket.CLOSED);
    });

    it('should handle timed_out event and auto-disconnect', async () => {
      const onTimedOut = vi.fn();
      const socket = new ProgressSocket('job-1', 'token', { onTimedOut });
      socket.connect();

      await vi.runAllTimersAsync();

      const timedOutEvent: TimedOutEvent = {
        type: 'timed_out',
        job_id: 'job-1',
        timeout_seconds: 3600,
        timestamp: '2024-01-01T00:00:00Z',
      };

      mockWebSocketInstance?.simulateMessage(timedOutEvent);

      expect(onTimedOut).toHaveBeenCalledWith(timedOutEvent);
      expect(mockWebSocketInstance?.readyState).toBe(WebSocket.CLOSED);
    });

    it('should handle malformed JSON gracefully', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const socket = new ProgressSocket('job-1', 'token', {});
      socket.connect();

      await vi.runAllTimersAsync();

      // Simulate invalid JSON
      if (mockWebSocketInstance?.onmessage) {
        mockWebSocketInstance.onmessage(
          new MessageEvent('message', { data: 'invalid json' })
        );
      }

      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe('Reconnection Logic', () => {
    it('should attempt reconnection with exponential backoff', async () => {
      const onReconnecting = vi.fn();
      const socket = new ProgressSocket('job-1', 'token', { onReconnecting });
      socket.connect();

      await vi.runAllTimersAsync();

      // Simulate connection close
      mockWebSocketInstance?.close();

      // First reconnection attempt: 1 second (2^0 * 1000)
      await vi.advanceTimersByTimeAsync(1000);
      expect(onReconnecting).toHaveBeenCalledWith(1, 5, 1000);

      // Close again
      mockWebSocketInstance?.close();

      // Second reconnection attempt: 2 seconds (2^1 * 1000)
      await vi.advanceTimersByTimeAsync(2000);
      expect(onReconnecting).toHaveBeenCalledWith(2, 5, 2000);
    });

    it('should stop reconnecting after max attempts', async () => {
      const onMaxReconnectAttemptsReached = vi.fn();
      const onReconnecting = vi.fn();
      
      const socket = new ProgressSocket('job-1', 'token', {
        onMaxReconnectAttemptsReached,
        onReconnecting,
      });
      socket.connect();

      await vi.runAllTimersAsync();

      // Simulate 5 consecutive connection failures
      // We need to prevent the socket from successfully opening on reconnect
      // by closing it immediately each time before onopen fires
      
      for (let attempt = 0; attempt < 5; attempt++) {
        // Close the current socket
        if (mockWebSocketInstance) {
          // Prevent onopen from firing
          mockWebSocketInstance.onopen = null;
          mockWebSocketInstance.close();
        }
        
        // Wait for the reconnection delay
        const delay = Math.pow(2, attempt) * 1000;
        await vi.advanceTimersByTimeAsync(delay);
        
        // A new WebSocket should have been created
        // Verify reconnecting callback was called
        if (attempt < 4) {
          expect(onReconnecting).toHaveBeenCalledWith(attempt + 1, 5, delay);
        }
      }

      // After 5 attempts, the next close should trigger max attempts callback
      if (mockWebSocketInstance) {
        mockWebSocketInstance.onopen = null;
        mockWebSocketInstance.close();
      }

      expect(onMaxReconnectAttemptsReached).toHaveBeenCalledWith('job-1');
    });

    it('should not reconnect if manually disconnected', async () => {
      const socket = new ProgressSocket('job-1', 'token', {});
      socket.connect();

      await vi.runAllTimersAsync();

      // Manually disconnect
      socket.disconnect();

      // Advance time - should not attempt reconnection
      await vi.advanceTimersByTimeAsync(10000);

      // WebSocket constructor should only be called once (initial connection)
      expect(global.WebSocket).toHaveBeenCalledTimes(1);
    });

    it('should reset reconnect attempts on successful connection', async () => {
      const onReconnecting = vi.fn();
      const socket = new ProgressSocket('job-1', 'token', { onReconnecting });
      socket.connect();

      await vi.runAllTimersAsync();

      // Simulate close and reconnect
      mockWebSocketInstance?.close();
      await vi.advanceTimersByTimeAsync(1000);

      // Should be attempt 1
      expect(onReconnecting).toHaveBeenCalledWith(1, 5, 1000);

      // Simulate successful connection (onopen is called in constructor)
      await vi.runAllTimersAsync();

      // Close again - should start from attempt 1 again
      mockWebSocketInstance?.close();
      await vi.advanceTimersByTimeAsync(1000);

      expect(onReconnecting).toHaveBeenCalledWith(1, 5, 1000);
    });
  });

  // ============================================================================
  // Task 18.4: WebSocket Reconnect Logic Tests
  // Validates: Requirements 7.1
  // ============================================================================
  describe('Task 18.4: WebSocket Reconnect Logic', () => {
    describe('Disconnect Scenarios', () => {
      it('should handle unexpected network disconnection', async () => {
        const onReconnecting = vi.fn();
        const socket = new ProgressSocket('job-disconnect-test', 'token', { onReconnecting });
        socket.connect();
        
        await vi.runAllTimersAsync();
        expect(socket.isConnected()).toBe(true);

        // Simulate unexpected disconnect (e.g., network failure)
        mockWebSocketInstance?.close();
        
        // Should trigger reconnection
        await vi.advanceTimersByTimeAsync(1000);
        expect(onReconnecting).toHaveBeenCalledWith(1, 5, 1000);
      });

      it('should handle server-initiated disconnection', async () => {
        const onReconnecting = vi.fn();
        const socket = new ProgressSocket('job-server-disconnect', 'token', { onReconnecting });
        socket.connect();
        
        await vi.runAllTimersAsync();

        // Simulate server closing the connection
        mockWebSocketInstance?.close();
        
        // Should attempt reconnection
        expect(socket.isConnected()).toBe(false);
        await vi.advanceTimersByTimeAsync(1000);
        expect(onReconnecting).toHaveBeenCalled();
      });

      it('should not trigger reconnection after terminal events (completed)', async () => {
        const onCompleted = vi.fn();
        const onReconnecting = vi.fn();
        const socket = new ProgressSocket('job-completed', 'token', { 
          onCompleted, 
          onReconnecting 
        });
        socket.connect();
        
        await vi.runAllTimersAsync();

        // Simulate completed event (which auto-disconnects)
        const completedEvent: CompletedEvent = {
          type: 'completed',
          job_id: 'job-completed',
          output_files: [],
          timestamp: '2024-01-01T00:00:00Z',
        };
        mockWebSocketInstance?.simulateMessage(completedEvent);

        // Advance time - should not attempt reconnection
        await vi.advanceTimersByTimeAsync(10000);
        expect(onReconnecting).not.toHaveBeenCalled();
      });

      it('should not trigger reconnection after terminal events (failed)', async () => {
        const onFailed = vi.fn();
        const onReconnecting = vi.fn();
        const socket = new ProgressSocket('job-failed', 'token', { 
          onFailed, 
          onReconnecting 
        });
        socket.connect();
        
        await vi.runAllTimersAsync();

        // Simulate failed event (which auto-disconnects)
        const failedEvent: FailedEvent = {
          type: 'failed',
          job_id: 'job-failed',
          exit_code: 1,
          error_message: 'Test error',
          timestamp: '2024-01-01T00:00:00Z',
        };
        mockWebSocketInstance?.simulateMessage(failedEvent);

        // Advance time - should not attempt reconnection
        await vi.advanceTimersByTimeAsync(10000);
        expect(onReconnecting).not.toHaveBeenCalled();
      });
    });

    describe('Exponential Backoff Delays', () => {
      it('should apply exponential backoff: 1s, 2s, 4s, 8s, 16s', async () => {
        const onReconnecting = vi.fn();
        const socket = new ProgressSocket('job-backoff', 'token', { onReconnecting });
        socket.connect();
        
        await vi.runAllTimersAsync();

        const expectedDelays = [1000, 2000, 4000, 8000, 16000];
        
        for (let i = 0; i < expectedDelays.length; i++) {
          // Simulate disconnect
          if (mockWebSocketInstance) {
            mockWebSocketInstance.onopen = null;
            mockWebSocketInstance.close();
          }
          
          // Advance to the expected delay
          await vi.advanceTimersByTimeAsync(expectedDelays[i]);
          
          // Verify the callback was called with correct parameters
          expect(onReconnecting).toHaveBeenCalledWith(i + 1, 5, expectedDelays[i]);
        }
      });

      it('should calculate delay as 2^attempt * 1000ms', async () => {
        const onReconnecting = vi.fn();
        const socket = new ProgressSocket('job-delay-calc', 'token', { onReconnecting });
        socket.connect();
        
        await vi.runAllTimersAsync();

        // Test each attempt's delay calculation
        for (let attempt = 0; attempt < 5; attempt++) {
          const expectedDelay = Math.pow(2, attempt) * 1000;
          
          // Simulate disconnect
          if (mockWebSocketInstance) {
            mockWebSocketInstance.onopen = null;
            mockWebSocketInstance.close();
          }
          
          await vi.advanceTimersByTimeAsync(expectedDelay);
          
          // Verify the delay matches the formula
          expect(onReconnecting).toHaveBeenCalledWith(
            attempt + 1, 
            5, 
            expectedDelay
          );
        }
      });

      it('should not reconnect before the backoff delay expires', async () => {
        const onReconnecting = vi.fn();
        const socket = new ProgressSocket('job-no-early-reconnect', 'token', { onReconnecting });
        socket.connect();
        
        await vi.runAllTimersAsync();
        const initialCallCount = (global.WebSocket as any).mock.calls.length;

        // Simulate disconnect
        mockWebSocketInstance?.close();

        // Advance time by less than the first backoff delay (1000ms)
        await vi.advanceTimersByTimeAsync(500);
        
        // Should not have attempted reconnection yet
        expect((global.WebSocket as any).mock.calls.length).toBe(initialCallCount);
        
        // Advance to complete the delay
        await vi.advanceTimersByTimeAsync(500);
        
        // Now reconnection should have been attempted
        expect((global.WebSocket as any).mock.calls.length).toBe(initialCallCount + 1);
      });

      it('should maintain separate backoff state for different attempts', async () => {
        const onReconnecting = vi.fn();
        const socket = new ProgressSocket('job-backoff-state', 'token', { onReconnecting });
        socket.connect();
        
        await vi.runAllTimersAsync();

        // First disconnect and reconnect
        mockWebSocketInstance?.close();
        await vi.advanceTimersByTimeAsync(1000);
        expect(onReconnecting).toHaveBeenCalledWith(1, 5, 1000);

        // Second disconnect should use 2s delay
        if (mockWebSocketInstance) {
          mockWebSocketInstance.onopen = null;
          mockWebSocketInstance.close();
        }
        await vi.advanceTimersByTimeAsync(2000);
        expect(onReconnecting).toHaveBeenCalledWith(2, 5, 2000);

        // Third disconnect should use 4s delay
        if (mockWebSocketInstance) {
          mockWebSocketInstance.onopen = null;
          mockWebSocketInstance.close();
        }
        await vi.advanceTimersByTimeAsync(4000);
        expect(onReconnecting).toHaveBeenCalledWith(3, 5, 4000);
      });
    });

    describe('Fallback to REST Polling After 5 Failed Attempts', () => {
      it('should trigger fallback callback after exactly 5 failed reconnection attempts', async () => {
        const onMaxReconnectAttemptsReached = vi.fn();
        const onReconnecting = vi.fn();
        
        const socket = new ProgressSocket('job-fallback', 'token', {
          onMaxReconnectAttemptsReached,
          onReconnecting,
        });
        socket.connect();
        
        await vi.runAllTimersAsync();

        // Simulate 5 consecutive failed reconnection attempts
        const delays = [1000, 2000, 4000, 8000, 16000];
        
        for (let i = 0; i < 5; i++) {
          // Prevent successful connection
          if (mockWebSocketInstance) {
            mockWebSocketInstance.onopen = null;
            mockWebSocketInstance.close();
          }
          
          await vi.advanceTimersByTimeAsync(delays[i]);
        }

        // After the 5th attempt fails, one more close should trigger the fallback
        if (mockWebSocketInstance) {
          mockWebSocketInstance.onopen = null;
          mockWebSocketInstance.close();
        }

        // Verify fallback callback was called with job ID
        expect(onMaxReconnectAttemptsReached).toHaveBeenCalledWith('job-fallback');
        expect(onMaxReconnectAttemptsReached).toHaveBeenCalledTimes(1);
      });

      it('should not attempt further reconnections after reaching max attempts', async () => {
        const onMaxReconnectAttemptsReached = vi.fn();
        const socket = new ProgressSocket('job-no-more-reconnect', 'token', {
          onMaxReconnectAttemptsReached,
        });
        socket.connect();
        
        await vi.runAllTimersAsync();
        const initialCallCount = (global.WebSocket as any).mock.calls.length;

        // Exhaust all 5 reconnection attempts
        const delays = [1000, 2000, 4000, 8000, 16000];
        for (let i = 0; i < 5; i++) {
          if (mockWebSocketInstance) {
            mockWebSocketInstance.onopen = null;
            mockWebSocketInstance.close();
          }
          await vi.advanceTimersByTimeAsync(delays[i]);
        }

        // Final close to trigger max attempts
        if (mockWebSocketInstance) {
          mockWebSocketInstance.onopen = null;
          mockWebSocketInstance.close();
        }

        const callCountAfterMaxAttempts = (global.WebSocket as any).mock.calls.length;

        // Advance time significantly - should not create new WebSocket instances
        await vi.advanceTimersByTimeAsync(100000);
        
        expect((global.WebSocket as any).mock.calls.length).toBe(callCountAfterMaxAttempts);
      });

      it('should provide job ID to fallback handler for REST polling initiation', async () => {
        const onMaxReconnectAttemptsReached = vi.fn();
        const jobId = 'job-rest-fallback-test';
        
        const socket = new ProgressSocket(jobId, 'token', {
          onMaxReconnectAttemptsReached,
        });
        socket.connect();
        
        await vi.runAllTimersAsync();

        // Fail all 5 attempts
        const delays = [1000, 2000, 4000, 8000, 16000];
        for (const delay of delays) {
          if (mockWebSocketInstance) {
            mockWebSocketInstance.onopen = null;
            mockWebSocketInstance.close();
          }
          await vi.advanceTimersByTimeAsync(delay);
        }

        // Trigger final close
        if (mockWebSocketInstance) {
          mockWebSocketInstance.onopen = null;
          mockWebSocketInstance.close();
        }

        // Verify the callback receives the correct job ID for REST polling
        expect(onMaxReconnectAttemptsReached).toHaveBeenCalledWith(jobId);
      });

      it('should count only automatic reconnection attempts, not initial connection', async () => {
        const onReconnecting = vi.fn();
        const onMaxReconnectAttemptsReached = vi.fn();
        
        const socket = new ProgressSocket('job-count-attempts', 'token', {
          onReconnecting,
          onMaxReconnectAttemptsReached,
        });
        
        // Initial connection
        socket.connect();
        await vi.runAllTimersAsync();
        
        // Should not count initial connection as a reconnection attempt
        expect(onReconnecting).not.toHaveBeenCalled();

        // Now simulate 5 disconnects and reconnects
        const delays = [1000, 2000, 4000, 8000, 16000];
        for (let i = 0; i < 5; i++) {
          if (mockWebSocketInstance) {
            mockWebSocketInstance.onopen = null;
            mockWebSocketInstance.close();
          }
          await vi.advanceTimersByTimeAsync(delays[i]);
          
          // Verify we're on attempt i+1
          expect(onReconnecting).toHaveBeenCalledWith(i + 1, 5, delays[i]);
        }

        // Final close should trigger max attempts
        if (mockWebSocketInstance) {
          mockWebSocketInstance.onopen = null;
          mockWebSocketInstance.close();
        }
        
        expect(onMaxReconnectAttemptsReached).toHaveBeenCalled();
      });

      it('should reset attempt counter after successful reconnection', async () => {
        const onReconnecting = vi.fn();
        const onMaxReconnectAttemptsReached = vi.fn();
        
        const socket = new ProgressSocket('job-reset-counter', 'token', {
          onReconnecting,
          onMaxReconnectAttemptsReached,
        });
        socket.connect();
        await vi.runAllTimersAsync();

        // Fail 3 attempts
        for (let i = 0; i < 3; i++) {
          mockWebSocketInstance?.close();
          await vi.advanceTimersByTimeAsync(Math.pow(2, i) * 1000);
        }

        // Successfully reconnect (onopen fires automatically in mock)
        await vi.runAllTimersAsync();

        // Now disconnect again - should start from attempt 1, not 4
        mockWebSocketInstance?.close();
        await vi.advanceTimersByTimeAsync(1000);
        
        // Should see attempt 1 again, not attempt 4
        const lastCall = onReconnecting.mock.calls[onReconnecting.mock.calls.length - 1];
        expect(lastCall[0]).toBe(1); // attempt number
        expect(lastCall[2]).toBe(1000); // delay should be 1s, not 8s
      });
    });
  });

  describe('Connection Management', () => {
    it('should report connected status correctly', async () => {
      const socket = new ProgressSocket('job-1', 'token', {});
      
      expect(socket.isConnected()).toBe(false);

      socket.connect();
      await vi.runAllTimersAsync();

      expect(socket.isConnected()).toBe(true);

      socket.disconnect();

      expect(socket.isConnected()).toBe(false);
    });

    it('should return correct job ID', () => {
      const jobId = 'test-job-123';
      const socket = new ProgressSocket(jobId, 'token', {});

      expect(socket.getJobId()).toBe(jobId);
    });

    it('should clear reconnection timeout on disconnect', async () => {
      const socket = new ProgressSocket('job-1', 'token', {});
      socket.connect();

      await vi.runAllTimersAsync();

      // Simulate close to trigger reconnection
      mockWebSocketInstance?.close();

      // Disconnect before reconnection happens
      socket.disconnect();

      // Advance time - reconnection should not happen
      await vi.advanceTimersByTimeAsync(10000);

      // Should only have initial connection
      expect(global.WebSocket).toHaveBeenCalledTimes(1);
    });
  });

  describe('Factory Function', () => {
    it('should create and connect socket', async () => {
      const onProgress = vi.fn();
      const socket = createProgressSocket('job-1', 'token', { onProgress });

      expect(socket).toBeInstanceOf(ProgressSocket);
      expect(global.WebSocket).toHaveBeenCalled();

      await vi.runAllTimersAsync();

      expect(socket.isConnected()).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should call onError callback on WebSocket error', async () => {
      const onError = vi.fn();
      const socket = new ProgressSocket('job-1', 'token', { onError });
      socket.connect();

      await vi.runAllTimersAsync();

      mockWebSocketInstance?.simulateError();

      expect(onError).toHaveBeenCalled();
    });
  });
});
