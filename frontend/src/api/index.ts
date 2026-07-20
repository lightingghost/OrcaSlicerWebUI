/**
 * API module exports
 * 
 * Re-exports all API client types and the singleton instance
 */

export {
  apiClient,
  ApiClient,
  ApiClientError,
  type UploadedFile,
  type ProfileEntry,
  type ParameterDescriptor,
  type TransformOptions,
  type MiscOptions,
  type ActionFlags,
  type JobRequest,
  type JobResponse,
  type JobStatus,
  type JobDetail,
  type JobRecord,
  type OutputFileSummary,
  type HealthResponse,
  type ApiError,
} from "./client";
