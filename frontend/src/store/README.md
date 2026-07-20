# Zustand Store Slices

This directory contains all Zustand store slices for the OrcaSlicer Web UI frontend application. The store is organized into six modular slices, each responsible for a specific domain of the application state.

## Store Architecture

The store uses Zustand's slice pattern, where each slice is a separate module that can be composed together into a single store. This approach provides:

- **Separation of concerns**: Each slice manages its own domain
- **Type safety**: Full TypeScript support with strongly typed interfaces
- **Modularity**: Slices can be developed and tested independently
- **Composability**: All slices are combined in `index.ts`

## Usage

```typescript
import { useStore } from '@/store';

function MyComponent() {
  // Select only the state you need
  const uploadedFiles = useStore((state) => state.uploadedFiles);
  const uploadFile = useStore((state) => state.uploadFile);

  // Or destructure multiple properties
  const { selectedPrinterProfile, selectPrinterProfile } = useStore((state) => ({
    selectedPrinterProfile: state.selectedPrinterProfile,
    selectPrinterProfile: state.selectPrinterProfile,
  }));

  return (
    // Your component JSX
  );
}
```

## Store Slices

### 1. FileSlice (`fileSlice.ts`)

Manages uploaded model files (STL, 3MF, OBJ, AMF).

**State:**
- `uploadedFiles: UploadedFile[]` - Array of uploaded files
- `uploadError: string | null` - Error message from last upload attempt

**Actions:**
- `uploadFile(file: File): Promise<void>` - Uploads a file to the backend
- `removeFile(fileId: string): void` - Removes a file from state and backend

### 2. ProfileSlice (`profileSlice.ts`)

Manages printer, process, and filament profiles from OrcaSlicer resources.

**State:**
- `manufacturers: string[]` - Available manufacturers
- `selectedManufacturer: string | null` - Currently selected manufacturer
- `printerProfiles: ProfileEntry[]` - Available printer profiles
- `processProfiles: ProfileEntry[]` - Available process profiles
- `filamentProfiles: ProfileEntry[]` - Available filament profiles
- `selectedPrinterProfile: ProfileEntry | null` - Selected printer
- `selectedProcessProfile: ProfileEntry | null` - Selected process
- `selectedFilamentProfiles: ProfileEntry[]` - Selected filaments (multi-select)
- `bedSize: { width: number; depth: number } | null` - Extracted from printer profile

**Actions:**
- `fetchManufacturers(): Promise<void>` - Loads manufacturer list
- `fetchProfiles(manufacturer: string): Promise<void>` - Loads profiles for a manufacturer
- `selectPrinterProfile(profile: ProfileEntry): void` - Selects printer and extracts bed size
- `selectProcessProfile(profile: ProfileEntry): void` - Selects process profile
- `toggleFilamentProfile(profile: ProfileEntry): void` - Toggles filament selection

### 3. JobSlice (`jobSlice.ts`)

Manages slicing jobs, job history, and real-time progress via WebSocket.

**State:**
- `activeJobId: string | null` - Current job ID
- `jobStatus: JobStatus | null` - Current job status (queued, running, completed, failed, timed_out)
- `queuePosition: number | null` - Position in queue if queued
- `progress: ProgressUpdateEvent | null` - Latest progress update
- `outputFiles: OutputFileSummary[]` - Output files from completed job
- `jobs: JobRecord[]` - Job history

**Actions:**
- `submitJob(request: JobRequest): Promise<void>` - Submits a new job
- `cancelJob(jobId: string): Promise<void>` - Cancels a queued/running job
- `fetchJobHistory(): Promise<void>` - Refreshes job history
- `connectProgressSocket(jobId: string): void` - Connects WebSocket for job progress
- `disconnectProgressSocket(): void` - Disconnects WebSocket

**WebSocket Features:**
- Automatic reconnection with exponential backoff (max 5 attempts)
- Real-time progress updates
- Handles all job lifecycle events (queued, started, progress, warning, completed, failed, timed_out)

### 4. ParameterSlice (`parameterSlice.ts`)

Manages OrcaSlicer parameter descriptors and user overrides.

**State:**
- `parameterDescriptors: ParameterDescriptor[]` - All available parameters from CLI
- `overrides: Record<string, string | number | boolean>` - User-specified parameter values
- `validationErrors: Record<string, string>` - Validation errors per parameter

**Actions:**
- `fetchDescriptors(): Promise<void>` - Loads parameter descriptors from backend
- `setOverride(key: string, value: string | number | boolean): void` - Sets a parameter override with validation
- `clearOverride(key: string): void` - Removes a parameter override
- `validateAll(): boolean` - Validates all overrides, returns true if all valid

**Validation:**
The slice includes a `validateParameter()` function that enforces:
- Type checking (float, int, bool, enum, string)
- Range validation (min/max for numeric types)
- Enum value validation

### 5. TransformSlice (`transformSlice.ts`)

Manages 3D model transformation options.

**State:**
- `transforms: TransformOptions` - All transform settings

**Transform Options:**
- `rotate?: number` - Z-axis rotation in degrees
- `rotate_x?: number` - X-axis rotation
- `rotate_y?: number` - Y-axis rotation
- `scale?: number` - Scale factor
- `arrange?: 0 | 1 | 2` - Arrange mode
- `orient?: 0 | 1 | 2` - Orient mode
- `repetitions?: number` - Object repetitions
- `ensure_on_bed?: boolean` - Ensure model is on bed
- `assemble?: boolean` - Assemble multiple parts
- `convert_unit?: boolean` - Convert units
- `allow_rotations?: boolean` - Allow rotations during arrange
- `allow_multicolor_oneplate?: boolean` - Allow multicolor on one plate
- `avoid_extrusion_cali_region?: boolean` - Avoid calibration region

**Actions:**
- `setTransform(key: keyof TransformOptions, value: unknown): void` - Updates a transform value
- `resetTransforms(): void` - Resets all transforms to defaults

### 6. ViewportSlice (`viewportSlice.ts`)

Manages 3D viewport state and camera controls.

**State:**
- `modelBounds: BoundingBox | null` - Current model bounding box
- `isOutOfBounds: boolean` - Whether model exceeds bed boundaries
- `cameraPreset: 'home' | 'top' | 'front' | 'side' | 'free'` - Active camera view

**Actions:**
- `setCameraPreset(preset: ...): void` - Changes camera view preset
- `setModelBounds(bounds: BoundingBox): void` - Updates model bounds (called from Three.js)

## API Integration

All API requests use `fetch` with authentication via `Bearer` token stored in `localStorage`:

```typescript
const response = await fetch('/api/endpoint', {
  headers: {
    Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
  },
});
```

WebSocket connections include the token as a query parameter:

```typescript
const wsUrl = `ws://host/ws/jobs/${jobId}?token=${token}`;
```

## Testing

Tests are located in `store.test.ts` and cover:
- Initial state validation
- Action functionality
- State updates after actions
- Type safety

Run tests with:
```bash
npm test -- src/store/store.test.ts
```

## Design Compliance

This implementation follows the design specification exactly:
- All interfaces match the design document
- All actions are implemented as specified
- WebSocket reconnection logic with exponential backoff (max 5 attempts)
- Parameter validation enforces type and range constraints
- Profile selection automatically extracts bed size
- Transform updates are optimized for <100ms viewport updates (see design)
