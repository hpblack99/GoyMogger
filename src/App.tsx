import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import QuoterPage from './pages/QuoterPage'
import JobsPage from './pages/JobsPage'
import JobDetailPage from './pages/JobDetailPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="quoter" element={<QuoterPage />} />
        <Route path="jobs" element={<JobsPage />} />
        <Route path="jobs/:id" element={<JobDetailPage />} />
      </Route>
    </Routes>
  )
}
