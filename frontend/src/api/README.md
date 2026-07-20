# API Client

Typed API client for OrcaSlicer Web UI backend.

## Usage

### Basic Setup

```typescript
import { apiClient } from '@/api';

// Set authentication token
apiClient.setToken('your-api-secret');
```

### File Upload

```typescript
const file = new File(['content'], 'model.stl');
const uploadedFile = await apiClient.uploadFile(file);
console.log(uploadedFile.file_id);
```

### Profile Management

```typescript
// Get list of manufacturers
const manufacturers = await apiClient.getManufacturers();

// Get profiles for a manufacturer
const profiles = await apiClient.getProfiles('BambuLab');

// Get specific profile
const profile = await apiClient.getProfile('BambuLab', 'machine', 'X1C.json');
```

### Job Submission

```typescript
const jobRequest = {
  file_ids: ['file-uuid-1'],
  printer_profile_path: 'BambuLab/machine/X1C.json',
  process_profile_path: 'BambuLab/process/0.20mm Standard.json',
  filament_profile_paths: ['BambuLab/filament/PLA Basic.json'],
  action: 'slice',
  plate_number: 0,
  transforms: {
    rotate: 45,
    scale: 1.0,
  },
  parameter_overrides: {
    layer_height: 0.15,
    infill_density: 20,
  },
};

const response = await apiClient.submitJob(jobRequest);
console.log(response.job_id, response.status);
```

### Job Monitoring

```typescript
// Get job details
const job = await apiClient.getJob('job-uuid');

// Get all jobs
const jobs = await apiClient.getJobs(50, 0);

// Cancel a job
await apiClient.cancelJob('job-uuid');
```

### WebSocket Progress Streaming

```typescript
const ws = apiClient.createProgressSocket('job-uuid');

ws.onmessage = (event) => {
  const progressEvent = JSON.parse(event.data);
  
  switch (progressEvent.type) {
    case 'queued':
      console.log('Job queued at position:', progressEvent.queue_position);
      break;
    case 'started':
      console.log('Job started');
      break;
    case 'progress':
      console.log('Progress:', progressEvent.total_percent, '%');
      break;
    case 'completed':
      console.log('Job completed with outputs:', progressEvent.output_files);
      break;
    case 'failed':
      console.error('Job failed:', progressEvent.error_message);
      break;
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('WebSocket closed');
};
```

### Output File Download

```typescript
// Get list of output files
const outputs = await apiClient.getJobOutputs('job-uuid');

// Download a specific file
const blob = await apiClient.downloadOutput('job-uuid', 'plate_1.gcode');

// Create download link
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'plate_1.gcode';
a.click();
URL.revokeObjectURL(url);
```

### Error Handling

```typescript
import { ApiClientError } from '@/api';

try {
  await apiClient.uploadFile(file);
} catch (error) {
  if (error instanceof ApiClientError) {
    console.error('Status:', error.statusCode);
    console.error('Code:', error.code);
    console.error('Message:', error.message);
    console.error('Details:', error.details);
  }
}
```

## Authentication

The API client automatically injects authentication on all requests:

- **HTTP Requests**: `Authorization: Bearer <token>` header
- **WebSocket**: `?token=<token>` query parameter

The token is stored in `localStorage` and persists across page reloads.

## Configuration

Set environment variables to configure the client:

- `VITE_API_BASE_URL`: Base URL for API requests (default: empty string for same-origin)
- `VITE_API_SECRET`: API authentication token (can also be set via `apiClient.setToken()`)

## Type Safety

All endpoints return strongly-typed responses. Import types as needed:

```typescript
import type {
  UploadedFile,
  JobRequest,
  JobResponse,
  JobDetail,
  ParameterDescriptor,
  ProfileEntry,
  OutputFileSummary,
} from '@/api';
```
