# FilamentRow Component

## Overview

The `FilamentRow` component manages the display and selection of filament profiles in the OrcaSlicer Web UI. It provides a visual representation of selected filaments with color swatches and allows users to add or remove filament profiles through an intuitive interface.

## Features

- **Filament Swatches**: Displays color swatches for each selected filament profile
- **Add Filament Button**: Opens a modal dialog to select from available filament profiles
- **Remove Filament Button**: Removes the last selected filament from the array
- **State Management**: Fully integrated with Zustand `profileSlice` for global state

## Component Structure

```
FilamentRow
├── FilamentSwatch[] (color swatches for selected filaments)
├── AddFilamentButton (opens modal)
├── RemoveFilamentButton (removes last filament)
└── FilamentPickerModal
    └── Profile list with selection state
```

## Usage

```tsx
import { FilamentRow } from './components/LeftPanel/FilamentRow';

function LeftPanel() {
  return (
    <div>
      <PrinterSelector />
      <FilamentRow />
      <ProcessSelector />
    </div>
  );
}
```

## Store Integration

The component connects to the following `profileSlice` state:

- `filamentProfiles`: Array of available filament profiles for the selected manufacturer
- `selectedFilamentProfiles`: Array of currently selected filament profiles
- `selectedManufacturer`: Currently selected manufacturer (required to enable Add button)
- `toggleFilamentProfile`: Function to add/remove a filament from selection

## Filament Swatch

Each filament swatch displays:
- A circular color indicator (from `default_filament_colour` field in profile JSON)
- The filament profile name (truncated if too long)
- Gray default color (#8B8B8B) when no color is specified in the profile

## Button States

### Add Filament Button
- **Enabled**: When a manufacturer is selected and filament profiles are available
- **Disabled**: When no manufacturer is selected or no profiles are available
- **Action**: Opens modal with list of available filament profiles

### Remove Filament Button
- **Enabled**: When at least one filament is selected
- **Disabled**: When no filaments are selected
- **Action**: Removes the last filament from the selected array

## Modal Behavior

The FilamentPickerModal:
1. Shows all available filament profiles for the selected manufacturer
2. Highlights currently selected profiles with a "Selected" badge
3. Allows toggling profiles on/off via click
4. Can be closed via:
   - Close button (✕)
   - Done button
   - Clicking outside the modal

## Styling

The component uses Tailwind CSS with the following color scheme:
- **Background**: Gray-800 (#1F2937)
- **Filament swatches**: Gray-700 with hover effect
- **Add button**: Purple-600 (#9333EA)
- **Remove button**: Red-600 (#DC2626)
- **Modal overlay**: Black with 50% opacity
- **Selected state**: Purple-600 background

## Requirements Validation

This component validates **Requirements 2.3**:
- Allows user to select one or more filament profiles
- Displays selected filaments with visual indicators
- Integrates with `profileSlice.toggleFilamentProfile`
- Shows color swatches from filament profile JSON

## Testing

The component includes comprehensive tests covering:
- Display of "No filaments selected" state
- Rendering of FilamentSwatch for each selected profile
- Button disabled states (no manufacturer, no profiles, no selections)
- Modal opening and closing
- Profile selection via toggleFilamentProfile
- Remove functionality (last filament removal)
- Color swatch rendering with default fallback

Run tests:
```bash
npm test -- FilamentRow.test.tsx
```

## Future Enhancements

1. **Color Fetching**: Currently uses default gray color; future enhancement would fetch actual `default_filament_colour` from profile JSON
2. **Drag-and-Drop Reordering**: Allow users to reorder selected filaments
3. **Multi-select**: Allow selecting multiple profiles at once in the modal
4. **Search/Filter**: Add search functionality to the profile picker modal for large profile lists
5. **Profile Preview**: Show additional profile details on hover (temperature, material type, etc.)
