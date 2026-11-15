import { Navigate } from 'react-router-dom'
import { useAgent } from '../lib/agent'
import AgentChat from '../components/agent/AgentChat'
import './AssistantPage.css'

export default function AssistantPage() {
  const { dock, popOut, canFloat } = useAgent()
  if (dock === 'float') return <Navigate to="/fields" replace />  // the tab is gone from the bar while the window is out
  return (
    <section className="asst reveal" aria-labelledby="asst-h">
      <div className="asst-head">
        <div>
          <h1 id="asst-h">Assistant</h1>
          <p className="asst-sub">An agronomist that reads your fields, the NASA weather history and the crop knowledge base.</p>
        </div>
        {canFloat && <button type="button" className="ag-btn ag-ghost" onClick={() => popOut()}>Pop out</button>}
      </div>
      <div className="asst-card"><AgentChat /></div>
    </section>
  )
}
