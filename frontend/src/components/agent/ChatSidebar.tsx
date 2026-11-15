import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAgent } from '../../lib/agent'
import useDismiss from './useDismiss'

const Icon = ({ d, className }: { d: string; className?: string }) => <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
export const ICON = {
  panel: 'M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7Zm5.5-3v16',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4',
  fields: 'M4 6h16M4 12h16M4 18h16',
  finance: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  chat: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  chevron: 'm6 9 6 6 6-6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  pin: 'M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Zm3 11v5',
  trash: 'M5 7h14M10 7V4h4v3m-8 0 1 13h10l1-13',
}
const MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
export const NEW_CHAT_KEYS = MAC ? '⇧⌘O' : 'Ctrl+⇧+O'

function Row({ c, active, onOpen }: { c: { id: string; title: string; pinned?: boolean }; active: boolean; onOpen: () => void }) {
  const { deleteChat, pinChat } = useAgent()
  const [menu, setMenu] = useState(false)
  const ref = useRef<HTMLLIElement>(null)
  useDismiss(ref, menu, () => setMenu(false))
  return (
    <li ref={ref} className={`ag-chat-row${active ? ' on' : ''}${menu ? ' menu-open' : ''}`}>
      <button type="button" className="ag-chat" aria-current={active ? 'true' : undefined} title={c.title} onClick={onOpen}>
        {c.pinned && <Icon d={ICON.chat} className="ag-chat-ico" />}<span>{c.title}</span>
      </button>
      <button type="button" className="ag-more" aria-label={`Options for ${c.title}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((o) => !o)}><Icon d={ICON.more} /></button>
      {menu && (
        <div className="ag-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { pinChat(c.id); setMenu(false) }}><Icon d={ICON.pin} />{c.pinned ? 'Unpin' : 'Pin'}</button>
          <button type="button" role="menuitem" className="danger" onClick={() => { deleteChat(c.id); setMenu(false) }}><Icon d={ICON.trash} />Delete</button>
        </div>
      )}
    </li>
  )
}

// Left column, laid out like Claude's: brand row, nav rows, Pinned and Recents (collapsible).
export default function ChatSidebar({ onToggle, onPick }: { onToggle: () => void; onPick: () => void }) {
  const { chats, activeId, newChat, openChat } = useAgent()
  const navigate = useNavigate()
  const [searching, setSearching] = useState(false)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState({ pinned: true, recent: true })
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? chats.filter((c) => c.title.toLowerCase().includes(t) || c.text.toLowerCase().includes(t)) : chats
  }, [chats, q])
  const pinned = shown.filter((c) => c.pinned), recent = shown.filter((c) => !c.pinned)
  const list = (items: typeof shown) => (
    <ul className="ag-chats">{items.map((c) => <Row key={c.id} c={c} active={c.id === activeId} onOpen={() => { openChat(c.id); onPick() }} />)}</ul>
  )
  const section = (key: 'pinned' | 'recent', label: string, items: typeof shown) => items.length > 0 && (
    <section>
      <button type="button" className="ag-label" aria-expanded={open[key]} onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}>
        {label}<Icon d={ICON.chevron} className={open[key] ? '' : 'shut'} />
      </button>
      {open[key] && list(items)}
    </section>
  )

  return (
    <nav className="ag-side" aria-label="Assistant">
      <div className="ag-brand">
        <button type="button" className="ag-ibtn" onClick={onToggle} aria-label="Close sidebar" title="Close sidebar"><Icon d={ICON.panel} /></button>
        <span className="ag-brand-name">Assistant</span>
      </div>
      <div className="ag-navrows">
        <button type="button" className="ag-nav on" onClick={() => { newChat(); onPick() }} aria-current={activeId ? undefined : 'true'}>
          <Icon d={ICON.plus} /><span>New chat</span><kbd>{NEW_CHAT_KEYS}</kbd>
        </button>
        <button type="button" className="ag-nav" onClick={() => setSearching((s) => { if (s) setQ(''); return !s })} aria-expanded={searching}><Icon d={ICON.search} /><span>Search</span></button>
        {searching && <input className="ag-search" type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" aria-label="Search chats" />}
        <button type="button" className="ag-nav" onClick={() => navigate('/fields')}><Icon d={ICON.fields} /><span>My fields</span></button>
        <button type="button" className="ag-nav" onClick={() => navigate('/finance')}><Icon d={ICON.finance} /><span>Finance</span></button>
      </div>
      <div className="ag-scroll">
        {section('pinned', 'Pinned', pinned)}
        {section('recent', 'Recents', recent)}
        {chats.length === 0 && <p className="ag-side-empty">Your chats will appear here.</p>}
        {chats.length > 0 && shown.length === 0 && <p className="ag-side-empty">No chats match.</p>}
      </div>
    </nav>
  )
}
