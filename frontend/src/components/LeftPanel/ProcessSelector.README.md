# ProcessSelector Component

## Overview

The `ProcessSelector` component provides UI controls for selecting process profiles and toggling global object settings for the OrcaSlicer Web UI.

## Features

### Process Profile Dropdown
- Displays available process profiles from `profileSlice.processProfiles`
- Populated automatically when a manufacturer is selected
- Disabled when no manufacturer is selected or no profiles are available
- Wires directly to `profileSlice.selectProcessProfile` for state management

### GlobalObjectsToggle Checkbox
- Allows users to enable/disable global objects for process-level settings
- Currently stores state locally (will be integrated with CLI parameter overrides in future tasks)
- Provides user-friendly help text explaining the setting

## Usage

```tsx
import { ProcessSelector } from './components/LeftPanel';

function LeftPanel() {
  return (
    <div>
      <ProcessSelector />
    </div>
  );
}
```

## State Management

The component connects to the Zustand `profileSlice` and retrieves:
- `processProfiles`: Array of available process profiles
- `selectedProcessProfile`: Currently selected process profile
- `selectedManufacturer`: Currently selected manufacturer (for enabling/disabling dropdown)
- `selectProcessProfile`: Action to select a process profile

## Styling

- Uses Tailwind CSS classes for styling
- Follows the same design patterns as `PrinterSelector`
- Dark theme with purple accent colors (`ring-purple-500`)
- Responsive and accessible design

## Testing

Comprehensive unit tests verify:
- Component rendering
- Profile dropdown population
- Profile selection behavior
- GlobalObjectsToggle checkbox state management
- Selection summary display
- Disabled states when appropriate

Run tests with:
```bash
npm test -- ProcessSelector.test.tsx
```

## Future Enhancements

- The `globalObjectsEnabled` state will be connected to the job submission logic
- It will be passed as a CLI parameter override when implementing job submission
- Additional process-level settings may be added as checkboxes or controls
