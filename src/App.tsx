import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import Layout from './components/Layout'
import HankNetHome from './pages/HankNetHome'
import HomePage from './pages/HomePage'
import QuoterPage from './pages/QuoterPage'
import JobsPage from './pages/JobsPage'
import JobDetailPage from './pages/JobDetailPage'
import AnalyticsApp from './analytics/AnalyticsApp'
import AuthGate from './auth/AuthGate'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HankNetHome />} />
      <Route path="/reefer" element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="quoter" element={<QuoterPage />} />
        <Route path="jobs" element={<JobsPage />} />
        <Route path="jobs/:id" element={<JobDetailPage />} />
      </Route>
      <Route path="/analytics/*" element={<AuthGate><AnalyticsApp /></AuthGate>} />
      {/* Back-compat: old pre-HankNet links land on the reefer tool instead of a blank screen */}
      <Route path="/quoter" element={<Navigate to="/reefer/quoter" replace />} />
      <Route path="/jobs" element={<Navigate to="/reefer/jobs" replace />} />
      <Route path="/jobs/:id" element={<RedirectJob />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function RedirectJob() {
  const { id } = useParams<{ id: string }>()
  return <Navigate to={`/reefer/jobs/${id}`} replace />
}
