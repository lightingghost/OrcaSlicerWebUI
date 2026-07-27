/**
 * API Client for OrcaSlicer Web UI
 * 
 * Provides typed functions for all REST endpoints with automatic authentication.
 * Injects Authorization: Bearer <token> header on all requests.
 * For WebSocket connections, appends ?token= query parameter.
 */

// ============================================================================
// Types
// ============================================================================

export interface UploadedFile {
  file_id: string;
  original_name: string;
  size_bytes: number;
  extension: "stl" | "3mf" | "obj" | "amf" | "json";
  uploaded_at: string; // ISO-8601
}

export interface ProfileEntry {
  name: string;
  path: string;
  category: "machine" | "process" | "filament";
}

export interface FilamentProfileInfo {
  name: string;
  path: string;
  material_type: string;
  compatible_printers: string[];
}

export interface FilamentMetadata {
  manufacturers: string[];
  material_types: string[];
  filaments: FilamentProfileInfo[];
}

export interface PrinterConfigEntry {
  name: string;
  path: string;
  autosave: boolean;
}

export interface UserConfig {
  selected_manufacturer?: string | null;
  selected_printer_profile_path?: string | null;
  selected_bed_type?: string | null;
  selected_process_profile_path?: string | null;
  selected_filament_profile_paths?: string[];
  /** Pending (unsaved) edits from the Printer settings dialog, mirroring
   *  USER_WORKSPACE/autosave/printer_config.json. Null if no pending edits. */
  printer_config_autosave?: Record<string, unknown> | null;
  /** Pending (unsaved) edits from the Process parameter panel, mirroring
   *  USER_WORKSPACE/autosave/process_config.json. Null if no pending edits. */
  process_config_autosave?: Record<string, unknown> | null;
  /** Pending (unsaved) edits from each Filament settings dialog, parallel
   *  to selected_filament_profile_paths. Null entries mean no pending
   *  edits for that filament slot. */
  filament_config_autosaves?: (Record<string, unknown> | null)[];
  /** Per-object process (print) config overrides, keyed by the plate
   *  object's file_id, mirroring
   *  USER_WORKSPACE/autosave/process_config_object_{file_id}.json. See
   *  parameterSlice.ts's objectOverrides for the in-memory equivalent. */
  object_config_autosaves?: Record<string, Record<string, unknown> | null>;
}

export interface ParameterDescriptor {
  key: string;
  label: string;
  tooltip: string;
  type: "float" | "int" | "bool" | "enum" | "string";
  default_value: string | number | boolean;
  min?: number;
  max?: number;
  enum_values?: string[];
  section: "quality" | "strength" | "speed" | "support" | "multi_material" | "gcode" | "other";
}

export interface TransformOptions {
  rotate?: number;
  rotate_x?: number;
  rotate_y?: number;
  scale?: number;
  arrange?: 0 | 1 | 2;
  orient?: 0 | 1 | 2;
  repetitions?: number;
  ensure_on_bed?: boolean;
  assemble?: boolean;
  convert_unit?: boolean;
  allow_rotations?: boolean;
  allow_multicolor_oneplate?: boolean;
  avoid_extrusion_cali_region?: boolean;
}

export interface MiscOptions {
  datadir?: string;
  debug?: 0 | 1 | 2 | 3 | 4 | 5;
  load_custom_gcodes_file_id?: string;
  load_filament_ids?: number[];
  skip_objects?: number[];
  clone_objects?: number[];
  allow_newer_file?: boolean;
  allow_mix_temp?: boolean;
  skip_modified_gcodes?: boolean;
  downward_check?: boolean;
  enable_timelapse?: boolean;
}

export interface ActionFlags {
  min_save?: boolean;
  no_check?: boolean;
  normative_check?: boolean;
  uptodate?: boolean;
  load_defaultfila?: boolean;
  enable_timelapse?: boolean;
}

export interface JobRequest {
  file_ids: string[];
  printer_profile_path: string;
  process_profile_path: string;
  filament_profile_paths: string[];
  action: "slice" | "export_3mf" | "export_stl" | "export_stls" | "export_settings";
  plate_number?: number;
  output_filename?: string;
  transforms?: TransformOptions;
  parameter_overrides?: Record<string, string | number | boolean>;
  misc?: MiscOptions;
  action_flags?: ActionFlags;
}

export interface JobResponse {
  job_id: string;
  status: JobStatus;
}

export type JobStatus = "queued" | "running" | "completed" | "failed" | "timed_out";

export interface JobDetail {
  job_id: string;
  session_id: string;
  submitted_at: string;
  started_at: string | null;
  completed_at: string | null;
  status: JobStatus;
  action_type: string;
  cli_args: string;
  exit_code: number | null;
  error_message: string | null;
  output_dir: string;
}

export interface JobRecord {
  job_id: string;
  status: JobStatus;
  submitted_at: string;
  action_type: string;
}

export interface OutputFileSummary {
  filename: string;
  size_bytes: number;
  download_url: string;
}

export interface HealthResponse {
  status: string;
  cli_available: boolean;
  workspace_accessible: boolean;
}

// ============================================================================
// Arrange (real CLI-backed placement — see backend/app/routers/arrange.py)
// ============================================================================

export interface ArrangePlateInstance {
  /** Opaque per-plate-object id — the frontend's own UploadedFile.file_id
   *  (which is unique per plate entry even for clones), NOT necessarily a
   *  real uploaded file. */
  instance_id: string;
  /** The real uploaded file backing this instance's geometry — for
   *  clones this is UploadedFile.source_file_id, shared by every clone
   *  of the same source. */
  file_id: string;
}

export interface ArrangeRequest {
  instances: ArrangePlateInstance[];
  printer_profile_path: string;
  process_profile_path: string;
  spacing_mm: number;
  enable_rotation: boolean;
  align_to_y_axis: boolean;
}

export interface ArrangedInstance {
  instance_id: string;
  /** Bed-absolute mm, matching the printer's `printable_area` coordinate
   *  space (see profileSlice's `bedCenter` for how to convert this into
   *  the Three.js scene's origin-centered coordinates). */
  x: number;
  y: number;
  rotation_z_deg: number;
}

export interface ArrangeResponse {
  instances: ArrangedInstance[];
}

// ============================================================================
// Device Connection (Device tab — local printer connection)
// ============================================================================

export type HostType = 'octo_klipper';
export type PrinterAgent = 'moonraker';

export interface DeviceConnection {
  host_type: HostType;
  printer_agent: PrinterAgent;
  print_host: string;
  device_ui: string;
  printhost_apikey: string;
  printhost_cafile: string;
  connected: boolean;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  klippy_state?: string | null;
}

export interface UploadJobRequest {
  job_id: string;
  filename?: string;
  start_print: boolean;
}

export interface UploadJobResult {
  success: boolean;
  message: string;
  uploaded_filename?: string | null;
  print_started: boolean;
}

export interface ApiError {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// Configuration
// ============================================================================

class ApiClient {
  private baseUrl: string;

  constructor() {
    // Base URL defaults to empty string (same origin) for proxied requests
    this.baseUrl = import.meta.env.VITE_API_BASE_URL || "";
  }

  /**
   * Get the current authentication token
   * Reads from localStorage (preferred) or falls back to environment variable
   */
  private getToken(): string | null {
    return localStorage.getItem("api_token") || import.meta.env.VITE_API_SECRET || null;
  }

  /**
   * Set the authentication token
   */
  setToken(token: string) {
    localStorage.setItem("api_token", token);
  }

  /**
   * Get the authentication token (public accessor)
   */
  getAuthToken(): string | null {
    return this.getToken();
  }

  /**
   * Clear the authentication token
   */
  clearToken() {
    localStorage.removeItem("api_token");
  }

  /**
   * Build headers with authentication
   */
  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    const token = this.getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    return headers;
  }

  /**
   * Build headers for file upload (multipart/form-data)
   */
  private getUploadHeaders(): HeadersInit {
    const headers: HeadersInit = {};

    const token = this.getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // Don't set Content-Type for FormData - browser will set it with boundary
    return headers;
  }

  /**
   * Make a request and handle common errors
   */
  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options.headers,
      },
    });

    if (!response.ok) {
      // Try to parse error response
      let errorData: ApiError;
      try {
        errorData = await response.json();
      } catch {
        errorData = {
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      throw new ApiClientError(
        errorData.error || `Request failed with status ${response.status}`,
        response.status,
        errorData.code,
        errorData.details
      );
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  // ============================================================================
  // Health Endpoint
  // ============================================================================

  async getHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health");
  }

  // ============================================================================
  // File Endpoints
  // ============================================================================

  async uploadFile(file: File, sessionId?: string): Promise<UploadedFile> {
    const formData = new FormData();
    formData.append("file", file);
    
    if (sessionId) {
      formData.append("session_id", sessionId);
    }

    const response = await fetch(`${this.baseUrl}/api/files/upload`, {
      method: "POST",
      headers: this.getUploadHeaders(),
      body: formData,
    });

    if (!response.ok) {
      let errorData: ApiError;
      try {
        errorData = await response.json();
      } catch {
        errorData = {
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      throw new ApiClientError(
        errorData.error || `Upload failed with status ${response.status}`,
        response.status,
        errorData.code,
        errorData.details
      );
    }

    return response.json();
  }

  async getFile(fileId: string): Promise<UploadedFile> {
    return this.request<UploadedFile>(`/api/files/${fileId}`);
  }

  async deleteFile(fileId: string): Promise<void> {
    return this.request<void>(`/api/files/${fileId}`, {
      method: "DELETE",
    });
  }

  // ============================================================================
  // Profile Endpoints
  // ============================================================================

  async getManufacturers(): Promise<string[]> {
    return this.request<string[]>("/api/profiles/manufacturers");
  }

  async getFilamentMetadata(): Promise<FilamentMetadata> {
    return this.request<FilamentMetadata>("/api/filament-metadata");
  }

  async getProfiles(manufacturer: string): Promise<ProfileEntry[]> {
    return this.request<ProfileEntry[]>(`/api/profiles/${manufacturer}`);
  }

  async getProfile(
    manufacturer: string,
    category: string,
    filename: string
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/api/profiles/${manufacturer}/${category}/${filename}`
    );
  }

  async getResolvedProfile(
    manufacturer: string,
    category: string,
    filename: string
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/api/profiles/${manufacturer}/${category}/${encodeURIComponent(filename)}/resolved`
    );
  }

  async uploadCustomProfile(
    file: File,
    sessionId?: string
  ): Promise<{ profile_id: string }> {
    const formData = new FormData();
    formData.append("file", file);
    
    if (sessionId) {
      formData.append("session_id", sessionId);
    }

    const response = await fetch(`${this.baseUrl}/api/profiles/custom`, {
      method: "POST",
      headers: this.getUploadHeaders(),
      body: formData,
    });

    if (!response.ok) {
      let errorData: ApiError;
      try {
        errorData = await response.json();
      } catch {
        errorData = {
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      throw new ApiClientError(
        errorData.error || `Upload failed with status ${response.status}`,
        response.status,
        errorData.code,
        errorData.details
      );
    }

    return response.json();
  }

  // ============================================================================
  // Parameter Endpoints
  // ============================================================================

  async getParameters(): Promise<ParameterDescriptor[]> {
    return this.request<ParameterDescriptor[]>("/api/parameters");
  }

  // ============================================================================
  // User Config Endpoints
  // ============================================================================

  async getUserConfig(sessionId: string = "default"): Promise<UserConfig> {
    const params = new URLSearchParams({ session_id: sessionId });
    return this.request<UserConfig>(`/api/user-config?${params}`);
  }

  async saveUserConfig(config: UserConfig, sessionId: string = "default"): Promise<UserConfig> {
    const params = new URLSearchParams({ session_id: sessionId });
    return this.request<UserConfig>(`/api/user-config?${params}`, {
      method: "POST",
      body: JSON.stringify(config),
    });
  }

  async deleteUserConfig(sessionId: string = "default"): Promise<{ message: string }> {
    const params = new URLSearchParams({ session_id: sessionId });
    return this.request<{ message: string }>(`/api/user-config?${params}`, {
      method: "DELETE",
    });
  }

  // ==========================================================================
  // Device Connection (Device tab)
  // ==========================================================================

  async getDeviceConnection(sessionId: string = "default"): Promise<DeviceConnection> {
    const params = new URLSearchParams({ session_id: sessionId });
    return this.request<DeviceConnection>(`/api/device-connection?${params}`);
  }

  async saveDeviceConnection(
    connection: DeviceConnection,
    sessionId: string = "default"
  ): Promise<DeviceConnection> {
    const params = new URLSearchParams({ session_id: sessionId });
    return this.request<DeviceConnection>(`/api/device-connection?${params}`, {
      method: "POST",
      body: JSON.stringify(connection),
    });
  }

  async deleteDeviceConnection(sessionId: string = "default"): Promise<{ message: string }> {
    const params = new URLSearchParams({ session_id: sessionId });
    return this.request<{ message: string }>(`/api/device-connection?${params}`, {
      method: "DELETE",
    });
  }

  async testDeviceConnection(connection: DeviceConnection): Promise<ConnectionTestResult> {
    return this.request<ConnectionTestResult>(`/api/device-connection/test`, {
      method: "POST",
      body: JSON.stringify(connection),
    });
  }

  async uploadJobToPrinter(request: UploadJobRequest): Promise<UploadJobResult> {
    return this.request<UploadJobResult>(`/api/device-connection/upload`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  // ============================================================================
  // Printer Config Endpoints  →  USER_WORKSPACE/printer/
  // ============================================================================

  async listPrinterConfigs(): Promise<PrinterConfigEntry[]> {
    return this.request<PrinterConfigEntry[]>("/api/printer-configs");
  }

  async getPrinterConfig(name: string, autosave = false): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ autosave: String(autosave) });
    return this.request<Record<string, unknown>>(`/api/printer-configs/${encodeURIComponent(name)}?${params}`);
  }

  async savePrinterConfig(
    name: string,
    config: Record<string, unknown>,
    autosave = false
  ): Promise<PrinterConfigEntry> {
    return this.request<PrinterConfigEntry>("/api/printer-configs", {
      method: "POST",
      body: JSON.stringify({ name, config, autosave }),
    });
  }

  async deletePrinterConfig(name: string, autosave = false): Promise<{ message: string }> {
    const params = new URLSearchParams({ autosave: String(autosave) });
    return this.request<{ message: string }>(
      `/api/printer-configs/${encodeURIComponent(name)}?${params}`,
      { method: "DELETE" }
    );
  }

  // ============================================================================
  // Filament Config Endpoints  →  USER_WORKSPACE/filament/
  // ============================================================================

  async listFilamentConfigs(): Promise<PrinterConfigEntry[]> {
    return this.request<PrinterConfigEntry[]>("/api/filament-configs");
  }

  async getFilamentConfig(name: string, autosave = false): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ autosave: String(autosave) });
    return this.request<Record<string, unknown>>(`/api/filament-configs/${encodeURIComponent(name)}?${params}`);
  }

  async saveFilamentConfig(
    name: string,
    config: Record<string, unknown>,
    autosave = false
  ): Promise<PrinterConfigEntry> {
    return this.request<PrinterConfigEntry>("/api/filament-configs", {
      method: "POST",
      body: JSON.stringify({ name, config, autosave }),
    });
  }

  // ============================================================================
  // Process Config Endpoints  →  USER_WORKSPACE/process/
  // ============================================================================

  async listProcessConfigs(): Promise<PrinterConfigEntry[]> {
    return this.request<PrinterConfigEntry[]>("/api/process-configs");
  }

  async getProcessConfig(name: string, autosave = false): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ autosave: String(autosave) });
    return this.request<Record<string, unknown>>(`/api/process-configs/${encodeURIComponent(name)}?${params}`);
  }

  async saveProcessConfig(
    name: string,
    config: Record<string, unknown>,
    autosave = false
  ): Promise<PrinterConfigEntry> {
    return this.request<PrinterConfigEntry>("/api/process-configs", {
      method: "POST",
      body: JSON.stringify({ name, config, autosave }),
    });
  }

  // ============================================================================
  // Autosave Endpoints  →  USER_WORKSPACE/autosave/  (flat, shared by all types)
  // Fixed names: printer_config, process_config, filament_1, filament_2, ...
  // ============================================================================

  async getAutosave(name: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(`/api/autosave/${encodeURIComponent(name)}`);
  }

  async saveAutosave(name: string, config: Record<string, unknown>): Promise<{ name: string }> {
    return this.request<{ name: string }>(`/api/autosave/${encodeURIComponent(name)}`, {
      method: "POST",
      body: JSON.stringify({ config }),
    });
  }

  async deleteAutosave(name: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/api/autosave/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  }

  // ============================================================================
  // Arrange Endpoint
  // ============================================================================

  /**
   * Compute native-accurate object placement by invoking the real
   * OrcaSlicer CLI's own arrange algorithm (see
   * backend/app/routers/arrange.py) — NOT an approximation. Used by
   * ThreeViewport's Arrange button so Prepare-tab positions always match
   * what Slice will actually produce.
   */
  async arrangeObjects(request: ArrangeRequest): Promise<ArrangeResponse> {
    return this.request<ArrangeResponse>("/api/arrange", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  // ============================================================================
  // Job Endpoints
  // ============================================================================

  async submitJob(jobRequest: JobRequest): Promise<JobResponse> {
    return this.request<JobResponse>("/api/jobs", {
      method: "POST",
      body: JSON.stringify(jobRequest),
    });
  }

  async getJobs(limit: number = 50, offset: number = 0): Promise<JobRecord[]> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    });
    return this.request<JobRecord[]>(`/api/jobs?${params}`);
  }

  async getJob(jobId: string): Promise<JobDetail> {
    return this.request<JobDetail>(`/api/jobs/${jobId}`);
  }

  async cancelJob(jobId: string): Promise<void> {
    return this.request<void>(`/api/jobs/${jobId}`, {
      method: "DELETE",
    });
  }

  async getJobOutputs(jobId: string): Promise<OutputFileSummary[]> {
    // GET /api/jobs/{id}/outputs responds with
    // { job_id, status, output_files: [...] }, not a bare array — see
    // backend/app/routers/jobs.py.
    const response = await this.request<{ output_files: OutputFileSummary[] }>(
      `/api/jobs/${jobId}/outputs`
    );
    return response.output_files;
  }

  async downloadOutput(jobId: string, filename: string): Promise<Blob> {
    const url = `${this.baseUrl}/api/jobs/${jobId}/outputs/${filename}`;
    
    const response = await fetch(url, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      let errorData: ApiError;
      try {
        errorData = await response.json();
      } catch {
        errorData = {
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      throw new ApiClientError(
        errorData.error || `Download failed with status ${response.status}`,
        response.status,
        errorData.code,
        errorData.details
      );
    }

    return response.blob();
  }

  // ============================================================================
  // WebSocket Connection
  // ============================================================================

  /**
   * Create a WebSocket connection for job progress
   * Automatically appends token query parameter for authentication
   */
  createProgressSocket(jobId: string): WebSocket {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = this.baseUrl || window.location.host;
    
    // Build WebSocket URL with token query param
    const params = new URLSearchParams();
    const token = this.getToken();
    if (token) {
      params.set("token", token);
    }
    
    const url = `${protocol}//${host}/ws/jobs/${jobId}?${params}`;
    
    return new WebSocket(url);
  }
}

// ============================================================================
// Error Class
// ============================================================================

export class ApiClientError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

// ============================================================================
// Export singleton instance
// ============================================================================

export const apiClient = new ApiClient();

// Also export the class for testing
export { ApiClient };
