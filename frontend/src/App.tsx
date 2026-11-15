import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { BackendProvider } from './backend'
import { FieldProvider } from './lib/field'
import { AgentProvider } from './lib/agent'
import Layout from './layout/Layout'
import FinancePage from './pages/FinancePage'
import HomePage from './pages/HomePage'
import FieldsPage from './pages/FieldsPage'
import AssistantPage from './pages/AssistantPage'

export default function App() {
  return (
    <BackendProvider>
      <FieldProvider>
      <AgentProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="fields" element={<FieldsPage />} />
            <Route path="map" element={<Navigate to="/fields" replace />} />
            <Route path="finance" element={<FinancePage />} />
            <Route path="assistant" element={<AssistantPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </AgentProvider>
      </FieldProvider>
    </BackendProvider>
  )
}
