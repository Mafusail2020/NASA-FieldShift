import { NavLink, useLocation } from 'react-router-dom'
import { useBackend } from '../backend'
import './Toolbar.css'

const ITEMS = [
  { to: '/fields', label: 'Fields', icon: <path d="M4 6h16M4 12h16M4 18h16" /> },
  { to: '/finance', label: 'Finance', icon: <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" /> },
]

export default function Toolbar() {
  const { pathname } = useLocation()
  const backend = useBackend()
  const index = Math.max(0, ITEMS.findIndex((i) => pathname.startsWith(i.to)))

  return (
    <header className="toolbar">
      <NavLink to="/fields" className="brand" aria-label="Field Shift, home">
        <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="9" fill="currentColor" />
          <path d="M6 22c4-8 9-10 20-10M6 16c3-5 7-6 14-6M10 26c4-5 8-6 16-6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <span className="brand-name">Field <b>Shift</b></span>
      </NavLink>

      <nav className="nav" aria-label="Sections" style={{ '--idx': index } as React.CSSProperties}>
        <span className="nav-indicator" aria-hidden="true" />
        {ITEMS.map((i) => (
          <NavLink key={i.to} to={i.to} className="nav-link">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">{i.icon}</svg>
            <span>{i.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="toolbar-end">
        {backend.offline && <span className="chip chip-warn" role="status">Offline data</span>}
      </div>
    </header>
  )
}
