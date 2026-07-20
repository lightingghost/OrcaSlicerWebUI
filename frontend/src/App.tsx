import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import Layout from './components/Layout/Layout'
import SlicerPage from './pages/SlicerPage'
import JobHistory from './pages/JobHistory'
import { ConfigAutoSave } from './components/ConfigAutoSave'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
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
      <RouterProvider router={router} />
    </>
  )
}

export default App
