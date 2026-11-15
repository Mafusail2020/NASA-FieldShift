import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { useAgent, type ChatMsg } from '../../lib/agent'
import ChatSidebar, { ICON } from './ChatSidebar'
import useDismiss from './useDismiss'
import StatusChip from '../StatusChip'
import type { Status } from '../../types'
import AgentChart from './AgentChart'
import MiniMarkdown from './miniMarkdown'
import './AgentChat.css'

const WHEAT = 'M12 21V9M12 2.5c1.6 1.4 1.6 3.2 0 4.8-1.6-1.6-1.6-3.4 0-4.8ZM12 10c-2.6 0-4.2-1.5-4.2-3.6 2.6 0 4.2 1.6 4.2 3.6ZM12 10c2.6 0 4.2-1.5 4.2-3.6-2.6 0-4.2 1.6-4.2 3.6ZM12 15.5c-2.6 0-4.2-1.5-4.2-3.6 2.6 0 4.2 1.6 4.2 3.6ZM12 15.5c2.6 0 4.2-1.5 4.2-3.6-2.6 0-4.2 1.6-4.2 3.6Z'

const TOOL_LABEL: Record<string, string> = {
  list_fields: 'Read your fields', get_field: 'Read field details', get_climate: 'Yearly climate', get_monthly_climate: 'Monthly climate',
  get_risk_layers: 'Climate trends', season_twin: 'Season twins', get_crop: 'Crop parameters', search_kb: 'Knowledge base',
  evaluate_rotation: 'Rotation risk', compare_rotations: 'Compare rotations', soil_check: 'Soil check', web_search: 'Web search',
}

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
  const uniq = [...new Map(m.sources.map((s) => [`${s.tool}|${s.url ?? ''}`, s])).values()]
  const copy = () => { void navigator.clipboard?.writeText(m.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => undefined) }
  return (
    <div className="ag-msg ag-bot" aria-busy={m.pending}>
      {m.steps.length > 0 && (
        <ul className="ag-steps" aria-label="Data used">
          {m.steps.map((s, i) => (
            <li key={i} className={s.ok === false ? 'ag-step bad' : s.ok ? 'ag-step ok' : 'ag-step run'} title={s.error ?? s.detail ?? undefined}>
              {TOOL_LABEL[s.name] ?? s.name}{s.detail ? `: “${s.detail.length > 48 ? `${s.detail.slice(0, 46)}…` : s.detail}”` : ''}{s.ok === false ? ' (failed)' : ''}
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
              <ul>{uniq.map((s) => (
                <li key={`${s.tool}|${s.url ?? ''}`}>{s.status && <StatusChip status={s.status as Status} />}{' '}
                  {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.source}</a> : <span>{s.source}</span>}</li>
              ))}</ul>
            </details>
          )}
          {m.provider && <span className="ag-prov">{m.provider.startsWith('local') ? 'Local model' : 'Claude'}</span>}
        </div>
      )}
    </div>
  )
}

function KeyPanel({ onClose }: { onClose: () => void }) {
  const { apiKey, setApiKey, webSearch, setWebSearch } = useAgent()
  const [draft, setDraft] = useState(apiKey)
  const save = (e: FormEvent) => { e.preventDefault(); setApiKey(draft); onClose() }
  return (
    <form className="ag-key" onSubmit={save}>
      <label htmlFor="ag-key">Anthropic API key (optional)</label>
      <input id="ag-key" type="password" autoComplete="off" spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="sk-ant-…" />
      <label className="ag-check"><input type="checkbox" checked={webSearch} onChange={(e) => setWebSearch(e.target.checked)} />Let Claude search the web when the project data cannot answer</label>
      <div className="ag-row">
        <button type="submit" className="ag-btn">Save key</button>
        {apiKey && <button type="button" className="ag-btn ag-ghost" onClick={() => { setDraft(''); setApiKey(''); onClose() }}>Remove</button>}
      </div>
      <p className="ag-hint">Stored in this browser only and sent with each question to the Field Shift server, which passes it to Anthropic. Without a key the assistant uses the local model (Ollama) if it runs. Web search is Claude only; its results are shown as "Web" (unverified) with links, never as project data.</p>
    </form>
  )
}

// ---- voice input (browser speech recognition; hidden where the browser has none) ----
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean
  start(): void; stop(): void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null; onerror: (() => void) | null
}
const Rec = typeof window === 'undefined' ? undefined
  : (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition
const DICTATION = [{ lang: 'en-US', label: 'English' }, { lang: 'uk-UA', label: 'Ukrainian' }]

function useWide(ref: RefObject<HTMLElement | null>, min = 760) {
  const [wide, setWide] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWide(e.contentRect.width >= min))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, min])
  return wide
}

function Menu({ label, children, wrapClass }: { label: ReactNode; children: (close: () => void) => ReactNode; wrapClass?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)
  return (
    <div className={`ag-pop ${wrapClass ?? ''}`} ref={ref}>
      <button type="button" className="ag-ctxbtn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{label}<svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICON.chevron} /></svg></button>
      {open && <div className="ag-menu up" role="menu">{children(close)}</div>}
    </div>
  )
}
export default function AgentChat({ variant = 'window' }: { variant?: 'page' | 'window' }) {
  const { messages, busy, send, stop, newChat, providers, popOut, canFloat } = useAgent()
  const [text, setText] = useState('')
  const [keyOpen, setKeyOpen] = useState(false)
  const [side, setSide] = useState<boolean | null>(null)  // null = automatic: open when the container is wide
  const [lang, setLang] = useState(DICTATION[0].lang)
  const [listening, setListening] = useState(false)
  const shell = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const rec = useRef<Recognition | null>(null)
  const wide = useWide(shell)
  const visible = side ?? wide
  const empty = messages.length === 0

  // the box grows with the text up to a limit
  useEffect(() => { const a = area.current; if (a) { a.style.height = 'auto'; a.style.height = `${Math.min(a.scrollHeight, 200)}px` } }, [text])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [messages])
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); newChat() } }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('keydown', key); rec.current?.stop() }
  }, [newChat])
  const submit = (e: FormEvent) => { e.preventDefault(); rec.current?.stop(); send(text); setText('') }

  const dictate = () => {
    if (!Rec) return
    if (listening) { rec.current?.stop(); return }
    const r = new Rec()
    const base = text ? `${text.trimEnd()} ` : ''
    r.lang = lang; r.continuous = true; r.interimResults = true
    r.onresult = (e) => setText(base + Array.from(e.results).map((x) => x[0].transcript).join(' ').trim())
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    rec.current = r
    r.start()
    setListening(true)
    area.current?.focus()
  }

  const claude = providers?.find((p) => p.name === 'anthropic' && p.available)
  const local = providers?.find((p) => p.name === 'local' && p.available)
  const model = providers === null ? 'Checking…' : claude ? modelName(claude.model) : local ? (local.model ?? 'Local model') : 'No model'
  const tier = providers === null || !(claude || local) ? '' : claude ? 'Cloud' : 'Local'

  return (
    <div className={`ag-shell${wide ? ' wide' : ''}`} ref={shell}>
      {visible && !wide && <div className="ag-scrim" onClick={() => setSide(false)} aria-hidden="true" />}
      {visible && <ChatSidebar onToggle={() => setSide(false)} onPick={() => { if (!wide) setSide(false) }} />}
      <div className="ag-main">
        <div className="ag-top">
          {!visible && <button type="button" className="ag-ibtn" onClick={() => setSide(true)} aria-label="Open sidebar" title="Open sidebar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICON.panel} /></svg></button>}
          <span className="ag-grow" />
          {variant === 'page' && canFloat && (
            <button type="button" className="ag-ibtn" onClick={() => popOut()} aria-label="Pop out into a window" title="Pop out into a window">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-8 8M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></svg>
            </button>
          )}
        </div>

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
            <textarea id="ag-q" ref={area} rows={1} value={text} placeholder={empty ? 'How can I help you today?' : 'Reply…'}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(e) } }} />
            <div className="ag-bar">
              <button type="button" className="ag-icon" onClick={newChat} disabled={empty} aria-label="New chat" title="New chat">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICON.plus} /></svg>
              </button>
              <span className="ag-bar-end">
                {Rec && (
                  <>
                    <button type="button" className={`ag-icon${listening ? ' rec' : ''}`} onClick={dictate} aria-pressed={listening} aria-label={listening ? 'Stop dictation' : 'Dictate'} title={listening ? 'Stop dictation' : 'Dictate'}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
                    </button>
                    <Menu wrapClass="ag-lang" label={<span className="sr-only">Dictation language</span>}>
                      {(close) => DICTATION.map((d) => <button key={d.lang} type="button" role="menuitemradio" aria-checked={d.lang === lang} className={d.lang === lang ? 'sel' : undefined} onClick={() => { setLang(d.lang); close() }}>{d.label}</button>)}
                    </Menu>
                  </>
                )}
                {busy
                  ? <button type="button" className="ag-send" onClick={stop} aria-label="Stop" title="Stop"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" /></svg></button>
                  : <button type="submit" className="ag-send" disabled={!text.trim()} aria-label="Send" title="Send"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg></button>}
              </span>
            </div>
          </form>

          {keyOpen && <KeyPanel onClose={() => setKeyOpen(false)} />}
          <div className="ag-meta">
            <button type="button" className="ag-model" onClick={() => setKeyOpen((o) => !o)} aria-expanded={keyOpen} title="Model and API key">
              {model}{tier && <span className="ag-tier">{tier}</span>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
