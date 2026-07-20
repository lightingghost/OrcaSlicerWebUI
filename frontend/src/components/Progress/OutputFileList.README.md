# OutputFileList Component

## Overview

The `OutputFileList` component displays a list of output files for a completed job with download functionality. It fetches the list of output files from `/api/jobs/{job_id}/outputs` and provides download buttons for each file.

## Features

- ✅ Fetches output files for a given job ID
- ✅ Displays filename and formatted file size for each output file
- ✅ Provides download button that triggers browser download
- ✅ Shows "File expired" message when API returns 404
- ✅ Handles loading, error, and empty states gracefully
- ✅ Displays downloading state during file download
- ✅ Responsive design with hover effects

## Usage

```typescript
import { OutputFileList } from '../components/Progress';

function JobCompletedView() {
  const jobId = 'some-job-id';
  
  return (
    <div>
      <h2>Job Completed Successfully!</h2>
      <OutputFileList jobId={jobId} />
    </div>
  );
}
```

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `jobId` | `string` | Yes | The ID of the job whose output files should be displayed |

## States

### Loading State
Displays a spinner and "Loading output files..." message while fetching from the API.

### Success State
Shows a list of output files with:
- File icon
- Filename (truncated with tooltip if too long)
- Formatted file size (B, KB, MB, GB)
- Download button

### Error States

#### File Expired (404)
Shows a red banner with:
- Error icon
- "File expired" heading
- Message: "The output files for this job are no longer available."

#### Other Errors
Shows a red banner with:
- Error icon
- "Error" heading
- Specific error message from the API

### Empty State
Displays when the API returns an empty array of files:
- Document icon
- "No output files available" message

## File Size Formatting

The component automatically formats file sizes in human-readable format:
- 0 B
- 500.00 B
- 1.00 KB
- 1.95 MB
- 1.00 GB

## Download Behavior

When a user clicks the download button:
1. The button shows a loading spinner and "Downloading" text
2. The file blob is fetched from `/api/jobs/{job_id}/outputs/{filename}`
3. A temporary link element is created and clicked to trigger browser download
4. The downloaded file uses the original filename
5. If download fails with 404, the entire component transitions to "File expired" state
6. Button returns to "Download" state when complete

## Requirements Validated

- **Requirement 8.1**: Fetches output files from `/api/jobs/{job_id}/outputs`
- **Requirement 8.2**: Displays filename and size for each output file
- **Requirement 8.3**: Provides download button that triggers browser download
- **Requirement 8.5**: Displays "File expired" message if API returns 404

## Testing

The component includes comprehensive unit tests covering:
- Loading state rendering
- Successful file list display
- 404 error handling (file expired)
- Generic error handling
- Empty state
- Download functionality
- Download state management
- File size formatting
- Job ID changes

Run tests:
```bash
npm test -- OutputFileList.test.tsx
```

## Styling

The component uses Tailwind CSS classes consistent with the rest of the application:
- Dark theme (gray-800, gray-700 backgrounds)
- Blue accent color for download buttons (blue-600, blue-700)
- Red error states (red-500, red-900)
- Hover effects on file rows
- Smooth transitions

## Integration Example

Typically used in job status views when `jobStatus === 'completed'`:

```typescript
function JobStatusPanel() {
  const jobId = useStore((state) => state.activeJobId);
  const jobStatus = useStore((state) => state.jobStatus);
  
  if (jobStatus === 'completed' && jobId) {
    return (
      <div>
        <h3>Job Completed!</h3>
        <OutputFileList jobId={jobId} />
      </div>
    );
  }
  
  // ... other status views
}
```
