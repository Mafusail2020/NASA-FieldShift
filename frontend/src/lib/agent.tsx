// AI assistant state: chat, model settings and the dock (tab or floating window). Lives above the router so a chat survives navigation.
// The fields live in the browser, so every request carries a snapshot of them; the server tools read that snapshot.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useField } from './field'
import type { Status } from '../types'

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? ''
const KEY_STORE = 'fieldshift.anthropicKey'
const LAYOUT_STORE = 'fieldshift.agent.layout.v1'
const WEB_STORE = 'fieldshift.agent.web.v1'
const CHATS_STORE = 'fieldshift.agent.chats.v1'
const MAX_CHATS = 30
const MIN_W = 320, MIN_H = 360, TOP = 60
const SNAP_MS = 120
export const EXIT_MS = 380  // the window shrinks back into the tab slot over this long

export interface Step { name: string; detail?: string; ok?: boolean; error?: string | null; status?: string | null }
export interface ChartSpec { kind: 'line' | 'bar'; title: string; x: (string | number)[]; series: { name: string; values: number[] }[] }
export interface SourceRef { tool: string; source: string; status: Status | ''; url?: string }
export interface ChatMsg {
  id: string; role: 'user' | 'assistant'; text: string
  steps: Step[]; charts: ChartSpec[]; sources: SourceRef[]
  provider?: string; error?: string; pending?: boolean
}
export interface Chat { id: string; title: string; updatedAt: number; pinned?: boolean; messages: ChatMsg[] }
export interface ProviderInfo { name: string; available: boolean; model?: string | null }
export interface Rect { x: number; y: number; w: number; h: number }
export type Dock = 'tab' | 'float'
export type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

interface Ctx {
  messages: ChatMsg[]
  busy: boolean
  send(text: string): void
  stop(): void
  chats: (Pick<Chat, 'id' | 'title' | 'updatedAt' | 'pinned'> & { text: string })[]   // history, newest first; `text` = all message text, for search
  activeId: string                                  // '' = a new chat that has no message yet
  newChat(): void
  openChat(id: string): void
  deleteChat(id: string): void
  pinChat(id: string): void
  providers: ProviderInfo[] | null
  apiKey: string
  webSearch: boolean          // let Claude search the web (Anthropic's server-side tool); the local model ignores it
  setWebSearch(on: boolean): void
  setApiKey(k: string): void
  dock: Dock
  rect: Rect
  canFloat: boolean
  popOut(at?: { x: number; y: number }, from?: Rect): void
  moving: boolean            // the window is being dragged (lifted look)
  overDock: boolean          // the dragged window is over the toolbar: dropping it docks it back
  closing: boolean           // the window is playing its exit animation
  anchor: Rect | null        // screen rect of the tab the window grows out of
  dockBack(): void
  startMove(e: { clientX: number; clientY: number }): void
  startResize(e: { clientX: number; clientY: number }, edge: Edge): void
}

const Ctx = createContext<Ctx | null>(null)
const uid = () => Math.random().toString(36).slice(2, 9)
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k) } catch { /* private mode */ } }
const small = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches

function loadChats(): Chat[] {
  try {
    const raw = JSON.parse(read(CHATS_STORE) ?? '[]') as Chat[]
    // a stream cannot survive a reload: close any unfinished answer
    return raw.map((c) => ({ ...c, messages: c.messages.map((m) => (m.pending ? { ...m, pending: false, error: m.text ? undefined : 'Interrupted.' } : m)) }))
  } catch { return [] }
}

function clampRect(r: Rect): Rect {
  const w = Math.max(MIN_W, Math.min(r.w, window.innerWidth - 16))
  const h = Math.max(MIN_H, Math.min(r.h, window.innerHeight - TOP - 8))
  return { w, h, x: Math.max(-w + 96, Math.min(r.x, window.innerWidth - 96)), y: Math.max(TOP, Math.min(r.y, window.innerHeight - 48)) }
}
function loadRect(): Rect {
  try { const r = JSON.parse(read(LAYOUT_STORE) ?? 'null'); if (r && typeof r.x === 'number') return r } catch { /* ignore */ }
  return { x: Math.max(16, window.innerWidth - 436), y: TOP + 16, w: 420, h: 560 }
}

export function AgentProvider({ children }: { children: ReactNode }) {
  const { fields } = useField()
  const [chats, setChats] = useState<Chat[]>(loadChats)
  const [webSearch, setWeb] = useState(() => read(WEB_STORE) !== 'off')
  const [activeId, setActiveId] = useState('')
  const messages = useMemo(() => chats.find((c) => c.id === activeId)?.messages ?? [], [chats, activeId])
  const [busy, setBusy] = useState(false)
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null)
  const [apiKey, setKey] = useState(() => read(KEY_STORE) ?? '')
  const [dock, setDock] = useState<Dock>('tab')
  const [rect, setRect] = useState<Rect>(() => clampRect(loadRect()))
  const [moving, setMoving] = useState(false)
  const [overDock, setOverDock] = useState(false)
  const [closing, setClosing] = useState(false)
  const [anchor, setAnchor] = useState<Rect | null>(null)
  const overRef = useRef(false)
  const abort = useRef<AbortController | null>(null)
  const rectRef = useRef(rect)
  useEffect(() => { rectRef.current = rect }, [rect])

  const headers = useCallback((): Record<string, string> => (apiKey ? { 'X-Anthropic-Key': apiKey } : {}), [apiKey])

  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      fetch(`${API}/api/agent/status`, { headers: headers() }).then((r) => r.json()).then((j) => live && setProviders(j.providers)).catch(() => live && setProviders([]))
    }, 300)
    return () => { live = false; clearTimeout(t) }
  }, [apiKey, headers])

  const setWebSearch = useCallback((on: boolean) => { setWeb(on); write(WEB_STORE, on ? '' : 'off') }, [])
  const setApiKey = useCallback((k: string) => { const v = k.trim(); setKey(v); write(KEY_STORE, v) }, [])
  const patchIn = (cid: string, id: string, f: (m: ChatMsg) => ChatMsg) =>
    setChats((cs) => cs.map((c) => (c.id === cid ? { ...c, messages: c.messages.map((m) => (m.id === id ? f(m) : m)) } : c)))

  // history lives in this browser, like the fields; saved shortly after the last change (streaming changes it many times a second)
  useEffect(() => {
    const t = setTimeout(() => write(CHATS_STORE, chats.length ? JSON.stringify(chats) : ''), 500)
    return () => clearTimeout(t)
  }, [chats])

  const send = useCallback((text: string) => {
    const q = text.trim()
    if (!q || busy) return
    const aid = uid()
    let cid = activeId
    const userMsg: ChatMsg = { id: uid(), role: 'user', text: q, steps: [], charts: [], sources: [] }
    const botMsg: ChatMsg = { id: aid, role: 'assistant', text: '', steps: [], charts: [], sources: [], pending: true }
    if (!cid) {
      cid = uid()
      const fresh: Chat = { id: cid, title: q.length > 42 ? `${q.slice(0, 40)}…` : q, updatedAt: Date.now(), messages: [userMsg, botMsg] }
      setChats((cs) => [fresh, ...cs].slice(0, MAX_CHATS))
      setActiveId(cid)
    } else {
      const at = cid
      setChats((cs) => cs.map((c) => (c.id === at ? { ...c, updatedAt: Date.now(), messages: [...c.messages, userMsg, botMsg] } : c)))
    }
    const chatId = cid
    const patch = (id: string, f: (m: ChatMsg) => ChatMsg) => patchIn(chatId, id, f)
    const history = [...messages.filter((m) => !m.error && !m.pending && m.text), { id: '', role: 'user' as const, text: q }].slice(-12)
    setBusy(true)
    const ctrl = new AbortController()
    abort.current = ctrl
    void (async () => {
      try {
        const r = await fetch(`${API}/api/agent/chat`, {
          method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', ...headers() },
          body: JSON.stringify({ messages: history.map((m) => ({ role: m.role, content: m.text })), fields, web_search: webSearch }),
        })
        if (!r.ok || !r.body) {
          let d = ''
          try { d = (await r.json()).detail ?? '' } catch { /* not JSON */ }
          // 500-504 without a message = the dev proxy or gateway cannot reach the backend
          throw new Error(d || (r.status >= 500 ? 'Cannot reach the assistant server. Start the backend (make backend) and try again.' : `The assistant answered ${r.status}.`))
        }
        const reader = r.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        let gap = false  // text after a tool step starts a new paragraph
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let i
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2)
            if (!line.startsWith('data:')) continue
            const ev = JSON.parse(line.slice(5))
            if (ev.type === 'provider') patch(aid, (m) => ({ ...m, provider: ev.name }))
            else if (ev.type === 'tool_start') patch(aid, (m) => ({ ...m, steps: [...m.steps, { name: ev.name, detail: typeof ev.input?.query === 'string' ? ev.input.query : undefined }] }))
            else if (ev.type === 'tool_end') patch(aid, (m) => {
              const steps = [...m.steps]
              const k = steps.map((s) => s.name).lastIndexOf(ev.name)
              if (k >= 0) steps[k] = { ...steps[k], ok: ev.ok, error: ev.error, status: ev.status }
              return { ...m, steps }
            })
            else if (ev.type === 'chart') patch(aid, (m) => ({ ...m, charts: [...m.charts, ev as ChartSpec] }))
            else if (ev.type === 'text_break') gap = true
            else if (ev.type === 'text_delta') { const sep = gap ? '\n\n' : ''; gap = false; patch(aid, (m) => ({ ...m, text: m.text + (m.text ? sep : '') + ev.text })) }
            else if (ev.type === 'text') patch(aid, (m) => ({ ...m, text: ev.text }))
            else if (ev.type === 'done') patch(aid, (m) => ({ ...m, sources: ev.sources ?? [], pending: false }))
            else if (ev.type === 'error') patch(aid, (m) => ({ ...m, error: ev.message, pending: false }))
          }
        }
        patch(aid, (m) => ({ ...m, pending: false }))
      } catch (e) {
        const aborted = (e as Error).name === 'AbortError'
        const net = e instanceof TypeError  // fetch failed: no network or server down
        patch(aid, (m) => ({ ...m, pending: false, error: aborted ? 'Stopped.' : net ? 'Cannot reach the assistant server. Start the backend (make backend) and try again.' : (e as Error).message }))
      } finally {
        setBusy(false)
        abort.current = null
      }
    })()
  }, [busy, messages, activeId, fields, webSearch, headers])

  const stop = useCallback(() => abort.current?.abort(), [])
  const newChat = useCallback(() => { abort.current?.abort(); setActiveId('') }, [])
  const openChat = useCallback((id: string) => { abort.current?.abort(); setActiveId(id) }, [])
  const deleteChat = useCallback((id: string) => {
    if (id === activeId) { abort.current?.abort(); setActiveId('') }
    setChats((cs) => cs.filter((c) => c.id !== id))
  }, [activeId])
  const pinChat = useCallback((id: string) => setChats((cs) => cs.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c))), [])
  const list = useMemo(() => [...chats].sort((a, b) => b.updatedAt - a.updatedAt).map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, pinned: c.pinned, text: c.messages.map((m) => m.text).join(' ') })), [chats])

  const commit = useCallback((r: Rect) => { const c = clampRect(r); setRect(c); return c }, [])
  const dockBack = useCallback(() => {
    setClosing(true)
    setTimeout(() => { setDock('tab'); setClosing(false) }, EXIT_MS)
  }, [])
  const track = useCallback((onMove: (dx: number, dy: number) => Rect, sx: number, sy: number, drag = false) => {
    if (drag) setMoving(true)
    const move = (e: PointerEvent) => {
      const r = onMove(e.clientX - sx, e.clientY - sy)
      if (!drag) { commit(r); return }
      // Over the toolbar the window turns into the tab right away (and back when the pointer leaves). Hysteresis avoids flicker at the edge.
      const over = overRef.current ? e.clientY < TOP + 40 : e.clientY < TOP + 8
      if (over !== overRef.current) { overRef.current = over; setOverDock(over) }
      if (!over) commit(r)  // while over, the window stays pinned to the tab slot
    }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      write(LAYOUT_STORE, JSON.stringify(rectRef.current))
      if (!drag) return
      setMoving(false)
      if (overRef.current) {  // released while it is already the tab: just swap it for the real tab
        overRef.current = false
        setTimeout(() => { setDock('tab'); setOverDock(false) }, SNAP_MS)
      } else setOverDock(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [commit])

  const startMove: Ctx['startMove'] = useCallback((e) => { const s = rectRef.current; track((dx, dy) => ({ ...s, x: s.x + dx, y: s.y + dy }), e.clientX, e.clientY, true) }, [track])
  const startResize: Ctx['startResize'] = useCallback((e, edge) => {
    const s = rectRef.current
    track((dx, dy) => {
      let { x, y, w, h } = s
      if (edge.includes('e')) w = s.w + dx
      if (edge.includes('s')) h = s.h + dy
      if (edge.includes('w')) { w = Math.max(MIN_W, s.w - dx); x = s.x + s.w - w }
      if (edge.includes('n')) { h = Math.max(MIN_H, s.h - dy); y = s.y + s.h - h }
      return { x, y, w, h }
    }, e.clientX, e.clientY)
  }, [track])

  const popOut: Ctx['popOut'] = useCallback((at, from) => {
    if (small()) return
    const el = document.querySelector('.nav-asst')?.getBoundingClientRect()
    setAnchor(from ?? (el ? { x: el.left, y: el.top, w: el.width, h: el.height } : null))
    if (at) { rectRef.current = commit({ ...rectRef.current, x: at.x - rectRef.current.w / 2, y: at.y - 20 }) }
    setDock('float')
  }, [commit])

  const value = useMemo<Ctx>(() => ({
    messages, busy, send, stop, chats: list, activeId, newChat, openChat, deleteChat, pinChat, providers, apiKey, setApiKey, webSearch, setWebSearch, dock, rect, canFloat: !small(), popOut, dockBack, startMove, startResize,
    moving, overDock, closing, anchor,
  }), [messages, busy, send, stop, list, activeId, newChat, openChat, deleteChat, pinChat, providers, apiKey, setApiKey, webSearch, setWebSearch, dock, rect, popOut, dockBack, startMove, startResize, moving, overDock, closing, anchor])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAgent(): Ctx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAgent outside AgentProvider')
  return c
}
