import { Navigate } from 'react-router-dom'
import { useAgent } from '../lib/agent'
import AgentChat from '../components/agent/AgentChat'
import './AssistantPage.css'

export default function AssistantPage() {
  const { dock } = useAgent()
  if (dock === 'float') return <Navigate to="/fields" replace />  // the tab is gone from the bar while the window is out
  return (
    <section className="asst" aria-label="Assistant">
      <AgentChat variant="page" />
    </section>
  )
}
