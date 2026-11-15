import { Outlet } from 'react-router-dom'
import Toolbar from './Toolbar'
import SourcesFold from '../components/SourcesFold'
import AgentWindow from '../components/agent/AgentWindow'
import './Layout.css'

export default function Layout() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <Toolbar />
      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
        <SourcesFold />
      </main>
      <AgentWindow />
    </>
  )
}
