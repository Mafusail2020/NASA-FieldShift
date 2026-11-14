import { Outlet } from 'react-router-dom'
import Toolbar from './Toolbar'
import './Layout.css'

export default function Layout() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <Toolbar />
      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>
    </>
  )
}
