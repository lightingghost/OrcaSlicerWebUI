# PrinterSelector Component

## Overview

The `PrinterSelector` component provides three dropdowns for configuring the printer in the OrcaSlicer Web UI:

1. **Manufacturer Dropdown**: Fetches and displays available printer manufacturers
2. **Model Dropdown**: Shows printer profiles for the selected manufacturer
3. **Bed Type Display**: Shows bed information derived from the selected printer profile

## Features

- **Automatic manufacturer loading**: Fetches manufacturers on component mount
- **Cascading selection**: Model dropdown is populated when a manufacturer is selected
- **Bed size extraction**: Automatically extracts bed dimensions from the selected printer profile JSON
- **Loading states**: Shows appropriate loading indicators during async operations
- **Error handling**: Displays user-friendly error messages when API calls fail
- **Profile integration**: All selections are wired to the global `profileSlice` store

## Usage

```tsx
import { PrinterSelector } from './components/LeftPanel';

function LeftPanel() {
  return (
    <div>
      <PrinterSelector />
    </div>
  );
}
```

## Store Integration

The component uses the following store methods from `profileSlice`:

- `fetchManufacturers()`: Called on mount to populate manufacturer list
- `fetchProfiles(manufacturer)`: Called when manufacturer is selected
- `selectPrinterProfile(profile)`: Called when a printer model is selected

The component reads the following state from the store:

- `manufacturers`: Array of manufacturer names
- `selectedManufacturer`: Currently selected manufacturer
- `printerProfiles`: Array of available printer profiles for selected manufacturer
- `selectedPrinterProfile`: Currently selected printer profile
- `bedSize`: Object containing `width` and `depth` of the bed in mm

## Bed Type Heuristics

The component attempts to extract bed type information using the following heuristics:

1. Checks profile name for keywords: "textured", "smooth", "engineering", "high temp"
2. Falls back to displaying bed dimensions if available
3. Shows "Standard Bed" if no specific information is available
4. Shows "N/A" if no profile is selected

## Error Handling

The component handles two types of errors:

1. **Manufacturer fetch errors**: Displayed immediately on mount if the fetch fails
2. **Profile fetch errors**: Displayed after selecting a manufacturer if the fetch fails

Both error types show a red error banner with the error message.

## Testing

The component includes comprehensive unit tests covering:

- All three sections render correctly
- Manufacturers are fetched on mount
- Manufacturer list is displayed in dropdown
- Profile selection calls appropriate store methods
- Bed size is displayed when available
- Dropdown states (disabled/enabled) based on data availability
- Error message display for failed API calls
- Bed type heuristics for different profile names
- Selection summary display

Run tests with:

```bash
npm test -- PrinterSelector.test.tsx
```

## Task Reference

This component implements **Task 15.1** from the OrcaSlicer Web UI implementation plan:

> Create `frontend/src/components/LeftPanel/PrinterSelector.tsx` — `ManufacturerDropdown` (calls `fetchManufacturers`, populates select), `ModelDropdown` (calls `fetchProfiles` for selected manufacturer, populates printer profiles), `BedTypeDropdown` (derived from printer profile JSON); wire selections to `profileSlice`

**Requirements validated**: 2.1, 2.2, 2.3
