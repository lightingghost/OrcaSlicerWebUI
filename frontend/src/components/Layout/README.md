# Layout Components

The Layout components compose all previously built components into the final application shell for the OrcaSlicer Web UI.

## Components

### Layout

The main application shell that provides the overall structure:

```tsx
<Layout />
```

**Structure:**
- Full-screen flex container
- TopBar at the top
- LeftPanel (320px fixed) + MainArea (flexible) below

**Features:**
- Manages active tab state
- Handles slice/export button clicks
- Determines button enabled/disabled state based on prerequisites
- Prerequisites for submission:
  - At least one uploaded file
  - Printer profile selected
  - Process profile selected

**Validates:** Requirements 13.1, 13.4

---

### TopBar

The application header with navigation and primary actions:

```tsx
<TopBar
  activeTab="prepare"
  onTabChange={(tab) => console.log(tab)}
  onSlice={() => handleSlice()}
  onExport={() => handleExport()}
  isSliceDisabled={false}
  isExportDisabled={false}
/>
```

**Props:**
- `activeTab?: Tab` - Currently active tab (default: 'prepare')
- `onTabChange?: (tab: Tab) => void` - Callback when tab is clicked
- `onSlice?: () => void` - Callback when Slice button is clicked
- `onExport?: () => void` - Callback when Export button is clicked
- `isSliceDisabled?: boolean` - Whether Slice button should be disabled
- `isExportDisabled?: boolean` - Whether Export button should be disabled

**Features:**
- **TabNav**: Five tabs (Prepare | Preview | Device | Project | Calibration)
- **TransformToolbar**: Quick action icons (Move | Rotate | Scale | Arrange)
- **SliceButton**: Primary CTA with Play icon and purple styling
- **ExportButton**: Secondary CTA with Download icon and gray styling
- Proper ARIA attributes for accessibility

**Validates:** Requirements 13.1, 13.4

---

### LeftPanel

Fixed 320px width configuration panel:

```tsx
<LeftPanel />
```

**Features:**
- **PrinterSelector**: Manufacturer, Model, and Bed Type selection
- **FilamentRow**: Filament profile selection with add/remove
- **ProcessSelector**: Process profile selection
- **ParameterTabs**: Tabbed parameter configuration interface

**Sections:**
1. Printer Configuration
2. Filaments
3. Process
4. Parameters (Quality | Strength | Support | Others)

**Validates:** Requirements 2, 3, 13.1

---

### MainArea

The main content area containing the viewport and job panels:

```tsx
<MainArea />
```

**Features:**
- **ViewportContainer**: 3D viewport with model and build plate
- **JobPanel**: Action selection, transform controls, advanced options
- **JobStatusPanel**: Real-time progress and output file download
  - Queue position indicator
  - Progress bar
  - Status messages
  - Warning banner
  - Output file list (on completion)

**Layout:**
```
┌─────────────────────────────────┐
│     ViewportContainer (flex-1)  │
│                                 │
├─────────────────────────────────┤
│     JobPanel (fixed height)     │
│  ┌────────────┬──────────────┐  │
│  │ Action &   │  Advanced    │  │
│  │ Transform  │  Options     │  │
│  └────────────┴──────────────┘  │
│  [ Submit Button ]              │
├─────────────────────────────────┤
│ JobStatusPanel (conditional)    │
│  - Queue indicator              │
│  - Progress bar                 │
│  - Status messages              │
│  - Output files                 │
└─────────────────────────────────┘
```

**Validates:** Requirements 13.1, 13.4

---

## File Structure

```
Layout/
├── Layout.tsx          # Main shell component
├── TopBar.tsx          # Application header
├── LeftPanel.tsx       # Configuration panel
├── MainArea.tsx        # Content area with viewport and job panels
├── Layout.test.tsx     # Layout component tests
├── TopBar.test.tsx     # TopBar component tests
├── index.ts            # Barrel exports
└── README.md           # This file
```

---

## Integration

The Layout component is used as the root of the application:

```tsx
// App.tsx
import { Layout } from './components/Layout';

function App() {
  return <Layout />;
}
```

All child components are wired to the Zustand store for state management, so the Layout doesn't need to pass props down manually.

---

## State Management

The Layout components interact with the following Zustand store slices:

- **FileSlice**: Uploaded files
- **ProfileSlice**: Printer, process, and filament selections
- **JobSlice**: Job submission, status, and progress
- **ActionSlice**: Selected action and flags
- **TransformSlice**: Transform options
- **ParameterSlice**: Parameter overrides
- **MiscSlice**: Miscellaneous CLI options

---

## Accessibility

All Layout components follow accessibility best practices:

- Semantic HTML elements (`<header>`, `<aside>`, `<main>`)
- Proper ARIA attributes (`role="tablist"`, `aria-selected`, etc.)
- Keyboard navigation support
- Screen reader friendly labels
- Visual focus indicators

---

## Styling

- Uses Tailwind CSS utility classes
- Dark theme (gray-900 background)
- Purple accent color for primary actions
- Responsive layout (adapts to screen size)
- Fixed dimensions where specified (320px left panel, 64px top bar)

---

## Testing

Comprehensive test coverage includes:

- **Layout.test.tsx**: Main layout composition, button state logic
- **TopBar.test.tsx**: Tab navigation, button interactions, accessibility

Run tests:
```bash
npm test -- Layout
```

---

## Future Enhancements

Potential improvements for future iterations:

1. **Responsive sidebar**: Collapsible left panel on mobile
2. **Persistent tab state**: Remember last active tab
3. **Keyboard shortcuts**: Ctrl+S for slice, etc.
4. **Customizable layout**: Draggable panel sizes
5. **Theme switching**: Light/dark mode toggle
6. **Multi-language support**: i18n for tab labels

---

## Related Components

- [LeftPanel Components](../LeftPanel/)
- [JobPanel Components](../JobPanel/)
- [Progress Components](../Progress/)
- [ViewportContainer](../ViewportContainer.tsx)

---

## Design References

Based on the design document section:

> React Component Hierarchy
> ```
> App
> ├── Layout
> │   ├── TopBar
> │   │   ├── TabNav
> │   │   ├── TransformToolbar
> │   │   ├── SliceButton
> │   │   └── ExportButton
> │   ├── LeftPanel (320px fixed)
> │   └── MainArea
> ```

See: [Design Document - React Component Hierarchy](../../../.kiro/specs/orca-slicer-web-ui/design.md)
