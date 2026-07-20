# Progress Components

This directory contains components for displaying job progress, status, and queue information in the OrcaSlicer Web UI.

## Components

### JobProgressModal

The main modal component that appears when a job is queued or running.

**Features:**
- Appears automatically when a job is submitted
- Shows different content based on job status (queued vs running)
- Integrates all sub-components (ProgressBar, StatusMessage, WarningBanner, QueuePositionIndicator)
- Provides cancel button for active jobs
- Displays job ID and metadata

**Props:**
- None (connects to Zustand store directly)

**Usage:**
```tsx
import { JobProgressModal } from './components/Progress';

function App() {
  return (
    <div>
      {/* Other app content */}
      <JobProgressModal />
    </div>
  );
}
```

**Store Dependencies:**
- `activeJobId` - Current job ID
- `jobStatus` - Current job status ('queued' | 'running' | 'completed' | 'failed' | 'timed_out')
- `queuePosition` - Position in queue (1-based)
- `progress` - Progress update event data
- `cancelJob` - Function to cancel a job
- `disconnectProgressSocket` - Function to disconnect WebSocket

---

### ProgressBar

A horizontal progress bar showing completion percentage.

**Props:**
- `percent: number` - Progress value from 0 to 100

**Features:**
- Automatically clamps values to 0-100 range
- Smooth transition animations
- Displays percentage text overlay
- Blue gradient fill color

**Usage:**
```tsx
<ProgressBar percent={65.5} />
```

---

### StatusMessage

Displays the current status message from the CLI progress stream.

**Props:**
- `message: string` - Status text to display

**Features:**
- Shows animated info icon
- Default "Processing..." message for empty strings
- Gray background with blue accent

**Usage:**
```tsx
<StatusMessage message="Slicing plate 1 of 3..." />
```

---

### WarningBanner

Displays warning messages in amber/yellow styling.

**Props:**
- `warning?: string | null` - Warning text (null/undefined = no warning)

**Features:**
- Only renders when warning is present
- Amber color scheme for high visibility
- Warning triangle icon
- Supports long messages with proper wrapping

**Usage:**
```tsx
<WarningBanner warning="Temperature threshold exceeded" />
<WarningBanner warning={null} /> {/* Does not render */}
```

---

### QueuePositionIndicator

Shows the job's position in the queue when status is 'queued'.

**Props:**
- `queuePosition?: number | null` - 1-based queue position

**Features:**
- Only renders when queue position is provided and > 0
- Special message when position is 1 ("next in line")
- Purple color scheme
- Position badge with large number
- Clock icon

**Usage:**
```tsx
<QueuePositionIndicator queuePosition={3} />
<QueuePositionIndicator queuePosition={1} /> {/* Shows "next in line" */}
<QueuePositionIndicator queuePosition={null} /> {/* Does not render */}
```

---

## Design Patterns

### Color Scheme

The components follow a consistent color palette:

- **Progress/Running**: Blue (`blue-400`, `blue-500`, `blue-600`)
- **Queued**: Purple (`purple-300`, `purple-400`, `purple-500`)
- **Warning**: Amber/Yellow (`amber-200`, `amber-300`, `amber-500`)
- **Error**: Red (`red-500`, `red-600`, `red-700`)
- **Neutral**: Gray (`gray-400`, `gray-500`, `gray-700`, `gray-800`, `gray-900`)

### Responsive Design

All components use Tailwind CSS classes for responsive behavior:
- Flexible layouts with flexbox
- Proper text wrapping for long messages
- Appropriate spacing and padding
- Mobile-friendly touch targets

### Accessibility

- Semantic HTML elements
- ARIA labels on interactive elements
- Sufficient color contrast ratios
- Clear visual hierarchy

---

## Testing

All components have comprehensive test coverage including:

### ProgressBar Tests
- ✅ Renders correct percentage
- ✅ Handles edge cases (0%, 100%, negative, >100%)
- ✅ Formats decimals correctly
- ✅ Applies correct styles and animations

### StatusMessage Tests
- ✅ Renders provided message
- ✅ Shows default message for empty string
- ✅ Displays icon with animation
- ✅ Handles long messages

### WarningBanner Tests
- ✅ Renders warning when provided
- ✅ Does not render when null/undefined/empty
- ✅ Applies amber color scheme
- ✅ Displays warning icon
- ✅ Handles multi-line and long warnings

### QueuePositionIndicator Tests
- ✅ Renders queue position
- ✅ Shows special message for position 1
- ✅ Does not render when null/undefined/0
- ✅ Applies purple color scheme
- ✅ Displays position badge correctly

### JobProgressModal Tests
- ✅ Renders when job is queued/running
- ✅ Does not render when no active job or job completed
- ✅ Shows appropriate sub-components based on status
- ✅ Handles cancel button click
- ✅ Displays job metadata correctly
- ✅ Error handling

Run tests:
```bash
npm test -- src/components/Progress
```

---

## Requirements Coverage

This implementation validates the following requirements from the design document:

- **Requirement 7.3**: Progress bar reflecting `total_percent`
- **Requirement 7.4**: Status message reflecting the `message` field
- **Requirement 7.7**: Queue position indicator when status = queued

---

## WebSocket Integration

The `JobProgressModal` connects to the job store which manages WebSocket connections for real-time progress updates. Progress events are received through the store and automatically update the UI.

**Event Types:**
- `queued` → Shows QueuePositionIndicator
- `started` → Transitions to progress view
- `progress` → Updates ProgressBar and StatusMessage
- `warning` → Would show WarningBanner (future enhancement)
- `completed` → Modal disappears
- `failed` → Modal disappears
- `timed_out` → Modal disappears

---

## Future Enhancements

Potential improvements:

1. **Warning Event Handling**: Currently warnings are prepared but not fully wired to WebSocket warning events
2. **Animation Polish**: Add enter/exit animations for the modal
3. **Estimated Time Remaining**: Calculate and display ETA based on progress rate
4. **Progress History**: Show mini-progress bars for completed plates
5. **Sound Notifications**: Optional audio alerts for completion/errors
6. **Minimize Option**: Allow minimizing the modal while keeping job running
7. **Multiple Jobs View**: Show progress for multiple concurrent jobs

---

## Related Files

- `/store/jobSlice.ts` - Job state management and WebSocket handling
- `/store/index.ts` - Global store configuration
- `/api/*` - API client for job operations
