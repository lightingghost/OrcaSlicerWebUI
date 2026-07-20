/**
 * Unit tests for API Client
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ApiClient, ApiClientError } from "./client";

describe("ApiClient", () => {
  let client: ApiClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create a fresh instance
    client = new ApiClient();
    
    // Mock fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    
    // Clear localStorage
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication", () => {
    it("should inject Bearer token in Authorization header", async () => {
      const token = "test-token-123";
      client.setToken(token);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "healthy" }),
      });

      await client.getHealth();

      expect(fetchMock).toHaveBeenCalledWith(
        "/health",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${token}`,
          }),
        })
      );
    });

    it("should store token in localStorage", () => {
      const token = "test-token-456";
      client.setToken(token);

      expect(localStorage.getItem("api_token")).toBe(token);
      expect(client.getToken()).toBe(token);
    });

    it("should clear token from localStorage", () => {
      client.setToken("test-token");
      client.clearToken();

      expect(localStorage.getItem("api_token")).toBeNull();
      expect(client.getToken()).toBeNull();
    });
  });

  describe("Error Handling", () => {
    it("should throw ApiClientError on 401", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized", code: "AUTH_FAILED" }),
      });

      try {
        await client.getHealth();
        // Should not reach here
        expect.fail("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        expect((error as ApiClientError).statusCode).toBe(401);
        expect((error as ApiClientError).code).toBe("AUTH_FAILED");
      }
    });

    it("should throw ApiClientError on 422 with validation details", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({
          error: "Validation failed",
          code: "VALIDATION_ERROR",
          details: { field: "extension", message: "Invalid extension" },
        }),
      });

      try {
        await client.getHealth();
        // Should not reach here
        expect.fail("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        expect((error as ApiClientError).statusCode).toBe(422);
        expect((error as ApiClientError).details).toEqual({
          field: "extension",
          message: "Invalid extension",
        });
      }
    });

    it("should handle non-JSON error responses", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => {
          throw new Error("Not JSON");
        },
      });

      await expect(client.getHealth()).rejects.toThrow("HTTP 500: Internal Server Error");
    });
  });

  describe("Health Endpoint", () => {
    it("should call GET /health without auth", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "healthy",
          cli_available: true,
          workspace_accessible: true,
        }),
      });

      const result = await client.getHealth();

      expect(fetchMock).toHaveBeenCalledWith(
        "/health",
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
      expect(result).toEqual({
        status: "healthy",
        cli_available: true,
        workspace_accessible: true,
      });
    });
  });

  describe("File Upload", () => {
    it("should upload file with multipart/form-data", async () => {
      const token = "test-token";
      client.setToken(token);

      const file = new File(["content"], "test.stl", { type: "model/stl" });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          file_id: "file-123",
          original_name: "test.stl",
          size_bytes: 7,
          extension: "stl",
          uploaded_at: "2024-01-01T00:00:00Z",
        }),
      });

      const result = await client.uploadFile(file);

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/files/upload",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${token}`,
          }),
          body: expect.any(FormData),
        })
      );
      expect(result.file_id).toBe("file-123");
    });

    it("should handle upload errors", async () => {
      const file = new File(["content"], "test.txt", { type: "text/plain" });

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({
          error: "Invalid file extension",
          code: "INVALID_EXTENSION",
        }),
      });

      await expect(client.uploadFile(file)).rejects.toThrow(ApiClientError);
    });
  });

  describe("Job Endpoints", () => {
    it("should submit job with correct payload", async () => {
      client.setToken("test-token");

      const jobRequest = {
        file_ids: ["file-1"],
        printer_profile_path: "manufacturer/machine/printer.json",
        process_profile_path: "manufacturer/process/fast.json",
        filament_profile_paths: ["manufacturer/filament/pla.json"],
        action: "slice" as const,
        plate_number: 0,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({
          job_id: "job-123",
          status: "queued",
        }),
      });

      const result = await client.submitJob(jobRequest);

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/jobs",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(jobRequest),
        })
      );
      expect(result.job_id).toBe("job-123");
      expect(result.status).toBe("queued");
    });

    it("should get jobs with pagination", async () => {
      client.setToken("test-token");

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            job_id: "job-1",
            status: "completed",
            submitted_at: "2024-01-01T00:00:00Z",
            action_type: "slice",
          },
        ],
      });

      const result = await client.getJobs(10, 0);

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/jobs?limit=10&offset=0",
        expect.anything()
      );
      expect(result).toHaveLength(1);
      expect(result[0].job_id).toBe("job-1");
    });

    it("should get job detail", async () => {
      client.setToken("test-token");

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          job_id: "job-123",
          status: "completed",
          cli_args: '["orca-slicer", "--slice", "0"]',
          exit_code: 0,
          output_dir: "/workspace/jobs/job-123/output",
        }),
      });

      const result = await client.getJob("job-123");

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/jobs/job-123",
        expect.anything()
      );
      expect(result.job_id).toBe("job-123");
    });

    it("should cancel job", async () => {
      client.setToken("test-token");

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await client.cancelJob("job-123");

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/jobs/job-123",
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });
  });

  describe("Output File Download", () => {
    it("should download output file as blob", async () => {
      client.setToken("test-token");

      const blobData = new Blob(["gcode content"], { type: "text/plain" });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: async () => blobData,
      });

      const result = await client.downloadOutput("job-123", "output.gcode");

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/jobs/job-123/outputs/output.gcode",
        expect.anything()
      );
      expect(result).toBe(blobData);
    });
  });

  describe("WebSocket Connection", () => {
    it("should create WebSocket with token query parameter", () => {
      const token = "ws-token-123";
      client.setToken(token);

      // Mock WebSocket constructor
      const mockWebSocket = vi.fn();
      global.WebSocket = mockWebSocket as any;

      client.createProgressSocket("job-123");

      expect(mockWebSocket).toHaveBeenCalledWith(
        expect.stringContaining("/ws/jobs/job-123?token=ws-token-123")
      );
    });

    it("should use correct protocol based on current location", () => {
      const token = "ws-token";
      client.setToken(token);

      const mockWebSocket = vi.fn();
      global.WebSocket = mockWebSocket as any;

      // Test with http (should use ws:)
      Object.defineProperty(window, "location", {
        value: { protocol: "http:", host: "localhost:3000" },
        writable: true,
      });

      client.createProgressSocket("job-123");

      expect(mockWebSocket).toHaveBeenCalledWith(
        expect.stringContaining("ws://")
      );
    });
  });

  describe("Profile Endpoints", () => {
    it("should get manufacturers", async () => {
      client.setToken("test-token");

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ["Manufacturer1", "Manufacturer2"],
      });

      const result = await client.getManufacturers();

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/profiles/manufacturers",
        expect.anything()
      );
      expect(result).toEqual(["Manufacturer1", "Manufacturer2"]);
    });

    it("should get profiles for manufacturer", async () => {
      client.setToken("test-token");

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            name: "Printer 1",
            path: "manufacturer1/machine/printer1.json",
            category: "machine",
          },
        ],
      });

      const result = await client.getProfiles("manufacturer1");

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/profiles/manufacturer1",
        expect.anything()
      );
      expect(result).toHaveLength(1);
      expect(result[0].category).toBe("machine");
    });
  });

  describe("Parameters Endpoint", () => {
    it("should get parameter descriptors", async () => {
      client.setToken("test-token");

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            key: "layer_height",
            label: "Layer Height",
            tooltip: "Height of each printed layer",
            type: "float",
            default_value: 0.2,
            min: 0.05,
            max: 0.4,
            section: "quality",
          },
        ],
      });

      const result = await client.getParameters();

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/parameters",
        expect.anything()
      );
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("layer_height");
    });
  });
});
