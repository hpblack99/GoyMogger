import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import HankNetHome from './pages/HankNetHome'
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
        <Route index element={<QuoterPage />} />
        <Route path="quoter" element={<QuoterPage />} />
        <Route path="jobs" element={<JobsPage />} />
        <Route path="jobs/:id" element={<JobDetailPage />} />
      </Route>
      <Route path="/analytics/*" element={<AuthGate><AnalyticsApp /></AuthGate>} />
    </Routes>
  )
}
