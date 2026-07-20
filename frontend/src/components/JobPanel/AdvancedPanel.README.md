# AdvancedPanel Component

## Overview

The `AdvancedPanel` component provides a collapsible drawer containing controls for all miscellaneous CLI options (MiscOptions) that don't fit into the main job submission form. This panel allows advanced users to configure additional OrcaSlicer CLI parameters.

## Features

### Collapsible UI
- Starts collapsed by default to keep the interface clean
- Expands/collapses with a single click on the header
- Animated chevron icon indicates current state

### Input Controls

#### Text Inputs
- **Data Directory**: Custom path for OrcaSlicer resources
- **Load Filament IDs**: Comma-separated list of positive integers
- **Skip Objects**: Comma-separated list of positive integers (with validation)
- **Clone Objects**: Comma-separated list of positive integers (with validation)

#### Dropdown
- **Debug Level**: Select from 0-5 (None, Minimal, Low, Medium, High, Very High, Maximum)

#### File Upload
- **Load Custom G-codes**: Upload a JSON file containing custom G-code definitions

#### Boolean Checkboxes
- Allow Newer File
- Allow Mixed Temperature
- Skip Modified G-codes
- Downward Check
- Enable Timelapse

### Validation

The component includes inline validation for comma-separated integer inputs:
- Validates that each value is a positive integer (> 0)
- Shows red border and error message for invalid inputs
- Trims whitespace from inputs automatically
- Handles empty inputs gracefully

### State Management

All values are stored in the Zustand `miscSlice`:
- `misc`: Contains all MiscOptions values
- `miscValidationErrors`: Tracks validation errors for each field
- Changes are immediately persisted to the store

## Usage

```tsx
import { AdvancedPanel } from './components/JobPanel/AdvancedPanel';

function JobPanel() {
  return (
    <div>
      {/* Other job controls */}
      <AdvancedPanel />
    </div>
  );
}
```

## Design Decisions

1. **Collapsible by default**: Reduces visual clutter for typical users
2. **Inline validation**: Provides immediate feedback for invalid input
3. **Comma-separated format**: More user-friendly than JSON arrays
4. **File upload for custom gcodes**: Matches the backend API design
5. **Descriptive help text**: Each field includes a brief explanation

## Requirements Validated

- **Requirement 10.1**: Exposes all misc CLI options through the Advanced panel
- **Requirement 10.4**: Validates skip_objects and clone_objects as positive integers with inline error display

## Related Files

- `/src/store/miscSlice.ts` - State management for MiscOptions
- `/src/components/JobPanel/AdvancedPanel.test.tsx` - Component tests
- `/src/components/JobPanel/TransformPanel.tsx` - Similar pattern for transform options
- `/src/components/JobPanel/ActionSelector.tsx` - Similar pattern for action options
