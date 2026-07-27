import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import Layout from './components/Layout/Layout'
import SlicerPage from './pages/SlicerPage'
import JobHistory from './pages/JobHistory'
import { ConfigAutoSave } from './components/ConfigAutoSave'
import { ProjectAutoSave } from './components/ProjectAutoSave'
import { RouteErrorBoundary } from './components/RouteErrorBoundary'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    // Catches uncaught render errors (e.g. WebGL context exhaustion) so
    // they show a recoverable message instead of a raw crash page — see
    // RouteErrorBoundary.tsx.
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        index: true,
        element: <SlicerPage />,
      },
      {
        path: 'history',
        element: <JobHistory />,
      },
    ],
  },
])

function App() {
  return (
    <>
      <ConfigAutoSave />
      <ProjectAutoSave />
      <RouterProvider router={router} />
    </>
  )
}

export default App
