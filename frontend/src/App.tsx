import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { BackendProvider } from './backend'
import { FieldProvider } from './lib/field'
import Layout from './layout/Layout'
import FinancePage from './pages/FinancePage'
import HomePage from './pages/HomePage'
import FieldsPage from './pages/FieldsPage'

export default function App() {
  return (
    <BackendProvider>
      <FieldProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="fields" element={<FieldsPage />} />
            <Route path="map" element={<Navigate to="/fields" replace />} />
            <Route path="finance" element={<FinancePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </FieldProvider>
    </BackendProvider>
  )
}
