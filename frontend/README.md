# OrcaSlicer Web UI Frontend

React 18 + TypeScript + Vite frontend for OrcaSlicer Web UI.

## Tech Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Styling
- **Zustand** - State management
- **React Router** - Client-side routing
- **Three.js** - 3D viewport rendering
- **Vitest** - Unit testing
- **fast-check** - Property-based testing

## Getting Started

### Install Dependencies

```bash
npm install
```

### Configuration

**When using the project's `run-local.sh` script**, the API secret is automatically passed from the backend configuration. No `.env` file is needed.

**When running the frontend standalone**, create a `.env` file:

```bash
VITE_API_SECRET=your-api-secret
```

The `VITE_API_SECRET` must match the `API_SECRET` configured in the backend. For local development, use `test-secret-key`. See `.env.example` for reference.

### Development

```bash
npm run dev
```

The dev server will start at `http://localhost:5173` with proxy rules for `/api` and `/ws` pointing to the backend at `http://localhost:8000`.

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

## Project Structure

```
src/
├── components/     # React components
├── lib/            # Utility functions and helpers
├── store/          # Zustand state management slices
├── api/            # API client functions
├── pages/          # Top-level page components
└── main.tsx        # Application entry point
```

## Configuration

- `vite.config.ts` - Vite configuration with proxy rules
- `vitest.config.ts` - Vitest test configuration
- `tailwind.config.js` - Tailwind CSS configuration
- `tsconfig.json` - TypeScript configuration
