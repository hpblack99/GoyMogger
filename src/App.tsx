import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import QuotePage from './pages/QuotePage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<QuotePage />} />
      </Route>
    </Routes>
  )
}
