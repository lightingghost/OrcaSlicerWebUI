# ParameterTabs Component Suite

## Overview

This component suite provides a tabbed interface for viewing and editing OrcaSlicer parameters, replicating the native OrcaSlicer desktop app's Process tab: same pages, same option groups, same order, and the same left-label/right-value row layout. It consists of three cooperating components:

1. **ParameterTabs** - Main container with tab navigation
2. **ParameterPanel** - Content area filtered by section, grouped into native-UI option groups
3. **ParameterField** - Individual parameter rows (label left, value control + unit right)

## Component Hierarchy

```
ParameterTabs
├── TabList (Quality | Strength | Speed | Support | Multimaterial | Others)
└── ParameterPanel (section-filtered, grouped)
    ├── Group header ("Layer height", "Line width", "Seam", ...)
    └── ParameterField[] (per descriptor, in native UI order)
```

## Features

### ParameterTabs
- Fetches parameter descriptors from API on mount via `parameterSlice.fetchDescriptors()`
- Renders 6 tab buttons matching the native `TabPrint` pages exactly: Quality, Strength, Speed, Support, Multimaterial, Others
- Defaults to the Quality tab (matches native UI default)
- Manages active tab state
- Displays loading and error states
- Skips fetch if descriptors are already loaded

### ParameterPanel
- Filters `parameterDescriptors` by the active section
- Sorts and groups descriptors by `group_order` then `order`, exactly matching the option group order used in `TabPrint::build()` (Tab.cpp)
- Renders a sticky group header (e.g. "Layer height", "Precision", "Ironing") above each group's fields
- Parameters with no native-UI group (`group == null`, e.g. printer/filament-only settings) are rendered last under "Other"
- Displays appropriate messages for loading/empty states
- Scrollable container that fills available vertical space

### ParameterField
- Renders each parameter as a single row: label on the left, value control (+ unit suffix, e.g. "mm", "mm or %") on the right — matching the native desktop UI layout
- Renders appropriate input control based on parameter type:
  - **float/int**: `<input type="number">` with min/max and step, right-aligned, unit shown to its right
  - **bool**: `<input type="checkbox">` on the right
  - **enum**: `<select>` dropdown on the right
  - **string**: `<input type="text">` on the right
- Displays validation errors inline (red border + error text)
- Shows "Reset" button when value is overridden
- Applies purple border to indicate overridden state
- Includes tooltip on hover (title attribute)
- Real-time validation via `parameterSlice.setOverride()`

## State Management

All components are wired to the Zustand `parameterSlice`:

```typescript
interface ParameterSlice {
  parameterDescriptors: ParameterDescriptor[];
  overrides: Record<string, string | number | boolean>;
  validationErrors: Record<string, string>;
  fetchDescriptors: () => Promise<void>;
  setOverride: (key: string, value: string | number | boolean) => void;
  clearOverride: (key: string) => void;
  validateAll: () => boolean;
}
```

## Parameter Descriptor Schema

```typescript
interface ParameterDescriptor {
  key: string;                    // e.g., "layer_height"
  label: string;                  // e.g., "Layer height"
  tooltip: string;                // Hover text
  type: 'float' | 'int' | 'bool' | 'enum' | 'string';
  default_value: string | number | boolean;
  min?: number;                   // For numeric types
  max?: number;                   // For numeric types
  enum_values?: string[];         // For enum type
  section: 'quality' | 'strength' | 'speed' | 'support' 
         | 'multi_material' | 'gcode' | 'other';
  group?: string | null;          // Native UI optgroup title, e.g. "Line width"
  group_order?: number | null;    // Position of the group within its section
  order?: number | null;          // Position of the field within its group
  unit?: string | null;           // Unit suffix, e.g. "mm", "mm or %", "%"
}
```

`section`, `group`, `group_order`, and `order` are derived from parsing
`TabPrint::build()` in OrcaSlicer's `Tab.cpp`, so the web UI's grouping and
ordering is identical to the native desktop app for every Process-tab
parameter. Parameters that only exist on the printer/filament tabs (not
Process) have `group: null` and are shown under an "Other" heading.

## Styling

- Tailwind CSS for all styling
- Dark theme (gray-800/gray-700 backgrounds)
- Purple accents for active/overridden state
- Red for validation errors
- Teal for success indicators

### Tab Styling
- Active tab: purple text + purple bottom border
- Inactive tab: gray text with hover effect

### Input Field Styling
- Default: gray border
- Overridden: purple border
- Error: red border
- Disabled: reduced opacity

## Usage Example

```tsx
import { ParameterTabs } from './components/LeftPanel';

function LeftPanel() {
  return (
    <div className="w-80 p-4">
      <ParameterTabs />
    </div>
  );
}
```

## Validation

Client-side validation enforces:
- Numeric min/max bounds
- Integer vs float type checking
- Enum value membership
- Type coercion for string inputs

Validation errors are stored in `validationErrors` and displayed inline below the input field.

## API Integration

On mount, `ParameterTabs` calls:
```
GET /api/parameters
Authorization: Bearer <token>
```

Returns array of `ParameterDescriptor` objects.

## Testing

Comprehensive unit tests cover:
- ✅ All parameter types (float, int, bool, enum, string)
- ✅ Validation error display
- ✅ Override state indication  
- ✅ Reset button functionality
- ✅ Tab navigation
- ✅ Section filtering
- ✅ Loading and error states
- ✅ Tooltip display

Run tests:
```bash
npm test -- ParameterField.test.tsx ParameterPanel.test.tsx ParameterTabs.test.tsx
```

## Requirements Validation

This implementation satisfies:
- **Requirement 3.2**: ✅ Appropriate form controls per parameter type
- **Requirement 3.5**: ✅ Parameters organized into sections with tabs

From `design.md`:
- ✅ Renders `ParameterField[]` per descriptor filtered by section
- ✅ Loads descriptors via `parameterSlice.fetchDescriptors`
- ✅ Tab component with Quality / Strength / Speed / Support / Multi-material / G-code / Other sections
