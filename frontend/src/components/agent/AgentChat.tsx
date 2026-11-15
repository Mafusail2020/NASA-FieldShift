import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAgent, type ChatMsg } from '../../lib/agent'
import { useField } from '../../lib/field'
import StatusChip from '../StatusChip'
import type { Status } from '../../types'
import AgentChart from './AgentChart'
import MiniMarkdown from './miniMarkdown'
import './AgentChat.css'

const WHEAT = 'M12 21V9M12 2.5c1.6 1.4 1.6 3.2 0 4.8-1.6-1.6-1.6-3.4 0-4.8ZM12 10c-2.6 0-4.2-1.5-4.2-3.6 2.6 0 4.2 1.6 4.2 3.6ZM12 10c2.6 0 4.2-1.5 4.2-3.6-2.6 0-4.2 1.6-4.2 3.6ZM12 15.5c-2.6 0-4.2-1.5-4.2-3.6 2.6 0 4.2 1.6 4.2 3.6ZM12 15.5c2.6 0 4.2-1.5 4.2-3.6-2.6 0-4.2 1.6-4.2 3.6Z'

const TOOL_LABEL: Record<string, string> = {
  list_fields: 'Read your fields', get_field: 'Read field details', get_climate: 'Yearly climate', get_monthly_climate: 'Monthly climate',
  get_risk_layers: 'Climate trends', season_twin: 'Season twins', get_crop: 'Crop parameters', search_kb: 'Knowledge base',
  evaluate_rotation: 'Rotation risk', compare_rotations: 'Compare rotations', soil_check: 'Soil check',
}

const SUGGESTIONS = [
  { label: 'Brief me on my fields', q: 'Brief me on all my fields: the main weather risks of each.' },
  { label: 'Driest year', q: 'Which year was driest at my field, and is it getting drier?' },
  { label: 'Compare rotations', q: 'Compare my rotation with the alternatives for the active field.' },
  { label: 'Sunflower before wheat?', q: 'Why is sunflower a poor predecessor for winter wheat?' },
]

// 'claude-sonnet-5-5' -> 'Sonnet 5.5'
function modelName(id?: string | null): string {
  if (!id) return ''
  const parts = id.replace(/^claude-/, '').split('-')
  const words = parts.filter((p) => !/^\d+$/.test(p)).map((p) => p[0].toUpperCase() + p.slice(1))
  const ver = parts.filter((p) => /^\d+$/.test(p)).join('.')
  return [...words, ver].filter(Boolean).join(' ')
}

function Wheat({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d={WHEAT} /></svg>
}

function Bubble({ m }: { m: ChatMsg }) {
  const [copied, setCopied] = useState(false)
  if (m.role === 'user') return <div className="ag-msg ag-user"><p>{m.text}</p></div>
  const uniq = [...new Map(m.sources.map((s) => [s.tool, s])).values()]
  const copy = () => { void navigator.clipboard?.writeText(m.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => undefined) }
  return (
    <div className="ag-msg ag-bot" aria-busy={m.pending}>
      {m.steps.length > 0 && (
        <ul className="ag-steps" aria-label="Data used">
          {m.steps.map((s, i) => (
            <li key={i} className={s.ok === false ? 'ag-step bad' : s.ok ? 'ag-step ok' : 'ag-step run'} title={s.error ?? undefined}>
              {TOOL_LABEL[s.name] ?? s.name}{s.ok === false ? ': no data' : ''}
            </li>
          ))}
        </ul>
      )}
      {m.charts.map((c, i) => <AgentChart key={i} spec={c} />)}
      {m.pending && !m.text && <p className="ag-wait" role="status"><Wheat className="ag-pulse" />Thinking</p>}
      {m.text && <MiniMarkdown text={m.text} />}
      {m.pending && m.text && <span className="ag-caret" aria-hidden="true" />}
      {m.error && <p className="ag-error" role="alert">{m.error}</p>}
      {!m.pending && m.text && (
        <div className="ag-foot">
          <button type="button" className="ag-mini" onClick={copy} aria-label="Copy answer" title="Copy">
            {copied ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></svg>}
          </button>
          {uniq.length > 0 && (
            <details className="ag-sources">
              <summary>Sources ({uniq.length})</summary>
              <ul>{uniq.map((s) => <li key={s.tool}>{s.status && <StatusChip status={s.status as Status} />} <span>{s.source}</span></li>)}</ul>
            </details>
          )}
          {m.provider && <span className="ag-prov">{m.provider.startsWith('local') ? 'Local model' : 'Claude'}</span>}
        </div>
      )}
    </div>
  )
}

function KeyPanel({ onClose }: { onClose: () => void }) {
  const { apiKey, setApiKey } = useAgent()
  const [draft, setDraft] = useState(apiKey)
  const save = (e: FormEvent) => { e.preventDefault(); setApiKey(draft); onClose() }
  return (
    <form className="ag-key" onSubmit={save}>
      <label htmlFor="ag-key">Anthropic API key (optional)</label>
      <input id="ag-key" type="password" autoComplete="off" spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="sk-ant-…" />
      <div className="ag-row">
        <button type="submit" className="ag-btn">Save key</button>
        {apiKey && <button type="button" className="ag-btn ag-ghost" onClick={() => { setDraft(''); setApiKey(''); onClose() }}>Remove</button>}
      </div>
      <p className="ag-hint">Stored in this browser only and sent with each question to the Field Shift server, which passes it to Anthropic. Without a key the assistant uses the local model (Ollama) if it runs.</p>
    </form>
  )
}

export default function AgentChat() {
  const { messages, busy, send, stop, clear, providers } = useAgent()
  const { fields } = useField()
  const [text, setText] = useState('')
  const [keyOpen, setKeyOpen] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const empty = messages.length === 0
  // the box grows with the text up to a limit
  useEffect(() => { const a = area.current; if (a) { a.style.height = 'auto'; a.style.height = `${Math.min(a.scrollHeight, 160)}px` } }, [text])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [messages])
  const submit = (e: FormEvent) => { e.preventDefault(); send(text); setText('') }

  const claude = providers?.find((p) => p.name === 'anthropic' && p.available)
  const local = providers?.find((p) => p.name === 'local' && p.available)
  const model = providers === null ? 'Checking…' : claude ? `Claude ${modelName(claude.model)}` : local ? `Local · ${local.model ?? 'model'}` : 'No model'

  return (
    <div className={`ag${empty ? ' ag-is-empty' : ''}`}>
      <div className="ag-log" role="log" aria-live="polite" aria-label="Conversation">
        {empty && (
          <div className="ag-hello">
            <Wheat className="ag-logo" />
            <h2>Back to the fields</h2>
          </div>
        )}
        {messages.map((m) => <Bubble key={m.id} m={m} />)}
        <div ref={end} />
      </div>

      <form className="ag-composer" onSubmit={submit}>
        <label htmlFor="ag-q" className="sr-only">Your question</label>
        <textarea id="ag-q" ref={area} rows={1} value={text} placeholder="Ask about your fields…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(e) } }} />
        <div className="ag-bar">
          <button type="button" className="ag-icon" onClick={clear} disabled={empty} aria-label="New chat" title="New chat">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          {busy
            ? <button type="button" className="ag-send" onClick={stop} aria-label="Stop" title="Stop"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" /></svg></button>
            : <button type="submit" className="ag-send" disabled={!text.trim()} aria-label="Send" title="Send"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg></button>}
        </div>
      </form>

      {keyOpen && <KeyPanel onClose={() => setKeyOpen(false)} />}
      <div className="ag-meta">
        <span>{fields.length ? `${fields.length} field${fields.length > 1 ? 's' : ''} shared` : 'No fields shared'}</span>
        <button type="button" className="ag-model" onClick={() => setKeyOpen((o) => !o)} aria-expanded={keyOpen} title="Model and API key">
          {model}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>

      {empty && (
        <div className="ag-pills">
          {SUGGESTIONS.map((s) => <button key={s.label} type="button" className="ag-pill" onClick={() => send(s.q)} disabled={busy}>{s.label}</button>)}
        </div>
      )}
    </div>
  )
}
