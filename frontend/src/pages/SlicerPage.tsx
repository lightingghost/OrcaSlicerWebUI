import { ViewportContainer } from '../components/ViewportContainer';

function SlicerPage() {
  return (
    <div className="flex flex-col h-full">
      {/* 3D Viewport area */}
      <div className="flex-1 bg-gray-900">
        <ViewportContainer />
      </div>
      
      {/* Job panel and status panel placeholder */}
      <div className="h-64 bg-gray-800 border-t border-gray-700 p-4">
        <p className="text-sm text-gray-400">Job Panel Placeholder</p>
        <p className="text-xs text-gray-500 mt-2">
          This will contain action selector, transform controls, and job submission.
        </p>
      </div>
    </div>
  )
}

export default SlicerPage
