# ObjectInfoOverlay Component

## Overview

The `ObjectInfoOverlay` component displays model information in the top-right corner of the 3D viewport. It shows:

- **Filename**: The name of the loaded model file
- **Dimensions**: Width × Depth × Height in millimeters (W × D × H mm)
- **Volume**: Estimated volume in cubic millimeters (mm³)
- **Triangle Count**: Number of triangles in the model

## Usage

The component automatically subscribes to the Zustand store and updates when model data changes. It will only render when both `modelBounds` and `modelMetadata` are available in the store.

### Integrating into the Viewport

The component is already integrated into `ViewportContainer`:

```tsx
import { ViewportContainer } from '../components/ViewportContainer';

function SlicerPage() {
  return (
    <div className="flex-1 bg-gray-900">
      <ViewportContainer />
    </div>
  );
}
```

### Updating Store on Model Load

When loading a model, update the store with the bounds and metadata:

```tsx
import { useStore } from '../store';
import { fetchAndLoadModel } from '../lib/modelLoader';

// In your component
const setModelBounds = useStore((state) => state.setModelBounds);
const setModelMetadata = useStore((state) => state.setModelMetadata);

// When loading a model
async function loadModelFromFile(fileId: string, filename: string) {
  const result = await fetchAndLoadModel(
    fileId,
    filename,
    setModelBounds,  // Pass store updaters
    setModelMetadata
  );
  
  // Add mesh to scene
  scene.add(result.mesh);
}
```

Alternatively, update the store manually:

```tsx
// After loading model with loadModel()
const result = await loadModel(arrayBuffer, filename);

// Update store
setModelBounds({
  min: { x: result.bounds.min.x, y: result.bounds.min.y, z: result.bounds.min.z },
  max: { x: result.bounds.max.x, y: result.bounds.max.y, z: result.bounds.max.z },
});

setModelMetadata({
  filename: result.filename,
  triangleCount: result.triangleCount,
});
```

## Store Schema

The component reads from two store slices:

### viewportSlice.modelBounds

```typescript
interface BoundingBox {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}
```

### viewportSlice.modelMetadata

```typescript
interface ModelMetadata {
  filename: string;
  triangleCount: number;
}
```

## Styling

The overlay uses Tailwind CSS classes and is styled to match the OrcaSlicer desktop UI:

- **Position**: Absolute, top-right corner (`top-4 right-4`)
- **Background**: Dark gray with 90% opacity (`bg-gray-800 bg-opacity-90`)
- **Text**: White, monospace font (`text-white font-mono`)
- **Layout**: Rounded corners, shadow, minimum width 250px
- **Z-index**: 10 (ensures it appears above viewport but below modals)

## Testing

The component has comprehensive unit tests covering:

- Conditional rendering (only shows when data is available)
- Number formatting (2 decimal places for dimensions and volume)
- Triangle count formatting (with thousands separators)
- Long filename truncation with ellipsis
- Proper CSS classes and positioning

Run tests:

```bash
npm test -- ObjectInfoOverlay.test.tsx
```

## Future Enhancements

Potential future additions:

- Material information (if multi-material models)
- File size
- File format indicator
- Collapsible/expandable sections
- Toggle visibility button
- Drag to reposition
