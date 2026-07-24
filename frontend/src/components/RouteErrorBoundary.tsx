import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom';

/**
 * RouteErrorBoundary
 *
 * Top-level `errorElement` for the app's router. Without this, any
 * uncaught render error anywhere in the tree (e.g. `new
 * THREE.WebGLRenderer(...)` throwing when the browser's WebGL context
 * limit is exhausted — see ThreeViewport.tsx/PreviewViewport.tsx's own
 * try/catch, added as the primary fix) falls through to React Router's
 * default error boundary, which shows a raw stack trace and takes the
 * whole app down with no way to recover short of a hard reload.
 *
 * This gives the user a plain-language message and a way back to a
 * working state without losing more context than necessary.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  const message = isRouteErrorResponse(error)
    ? error.statusText || error.data
    : error instanceof Error
      ? error.message
      : 'An unexpected error occurred.';

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-gray-900 text-white p-8">
      <div className="max-w-lg text-center space-y-4">
        <h1 className="text-lg font-semibold text-red-400">Something went wrong</h1>
        <p className="text-sm text-gray-300">{message}</p>
        <p className="text-xs text-gray-500">
          This can happen if the browser ran out of graphics resources (e.g. too many 3D tabs
          open at once). Reloading usually resolves it.
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 text-sm font-medium bg-gray-700 text-white rounded hover:bg-gray-600 transition-colors"
          >
            Go back
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 text-sm font-medium bg-purple-600 text-white rounded hover:bg-purple-500 transition-colors"
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}
