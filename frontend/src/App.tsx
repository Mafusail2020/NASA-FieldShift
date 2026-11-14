import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Results from './Results'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Results />} />
      </Routes>
    </BrowserRouter>
  )
}
