import { NavLink, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useBackend } from '../backend'
import { useAgent } from '../lib/agent'
import './Toolbar.css'

const ITEMS = [
  { to: '/', label: 'Home', icon: <path d="M4 11 12 4l8 7v9h-5v-6H9v6H4v-9Z" /> },
  { to: '/fields', label: 'Fields', icon: <path d="M4 6h16M4 12h16M4 18h16" /> },
  { to: '/finance', label: 'Finance', icon: <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" /> },
  { to: '/assistant', label: 'Assistant', icon: <path d="M12 21V9M12 2.5c1.6 1.4 1.6 3.2 0 4.8-1.6-1.6-1.6-3.4 0-4.8ZM12 10c-2.6 0-4.2-1.5-4.2-3.6 2.6 0 4.200 1.600 4.200 3.600ZM12 10c2.600 0 4.200-1.500 4.200-3.600-2.600 0-4.200 1.600-4.200 3.600ZM12 15.500c-2.600 0-4.200-1.500-4.200-3.600 2.600 0 4.200 1.600 4.200 3.600ZM12 15.500c2.600 0 4.200-1.500 4.200-3.600-2.600 0-4.200 1.600-4.200 3.600Z" /> },
]
const DRAG_PX = 36  // dragging the Assistant tab this far pulls it out into a floating window

export default function Toolbar() {
  const { pathname } = useLocation()
  const backend = useBackend()
  const agent = useAgent()
  const dragged = useRef(false)
  const [leaving, setLeaving] = useState(false)   // the tab plays its exit animation after being pulled out
  const [entering, setEntering] = useState(false) // the tab plays its entrance animation after the window is docked back
  const [holding, setHolding] = useState(false)  // the tab is pressed: show the "Unclip" hint
  const prev = useRef(agent.dock)
  useEffect(() => {
    const was = prev.current
    prev.current = agent.dock
    if (was === agent.dock) return
    const on = agent.dock === 'float' ? setLeaving : setEntering
    on(true)
    const t = setTimeout(() => on(false), 600)
    return () => clearTimeout(t)
  }, [agent.dock])

  // Drag the Assistant tab out of the bar: the tab follows the pointer on a rubber band, then at DRAG_PX it "clicks" out
  // into a floating window that keeps following the pointer.
  const pullOut = (e: React.PointerEvent<HTMLAnchorElement>) => {
    if (!agent.canFloat || agent.dock === 'float' || e.button !== 0) return
    const el = e.currentTarget
    setHolding(true)
    const sx = e.clientX, sy = e.clientY
    dragged.current = false
    const reset = (snap: boolean) => {
      el.classList.remove('nav-pulling'); el.classList.toggle('nav-snapback', snap)
      el.style.transform = ''
    }
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy, d = Math.hypot(dx, dy)
      if (d < DRAG_PX) {
        const k = Math.min(d / DRAG_PX, 1)
        el.classList.add('nav-pulling')
        el.style.transform = `translate(${dx * 0.45}px, ${dy * 0.45}px) scale(${1 + k * 0.12})`
        return
      }
      const r = el.getBoundingClientRect()  // measured while the tab is still pulled, so the window grows from where the tab visibly is
      cleanup(false)
      dragged.current = true
      agent.popOut({ x: ev.clientX, y: ev.clientY }, { x: r.left, y: r.top, w: r.width, h: r.height })
      agent.startMove(ev)
    }
    const cleanup = (snap: boolean) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
      reset(snap)
      setHolding(false)
    }
    const up = () => cleanup(true)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  // the Assistant tab is part of the bar only while docked (plus its exit/entrance animation and the drop target while a window hovers the bar)
  const items = ITEMS.filter((i) => i.to !== '/assistant' || agent.dock === 'tab' || leaving || agent.overDock || agent.closing)
  const index = Math.max(0, items.findIndex((i) => (i.to === '/' ? pathname === '/' : pathname.startsWith(i.to))))

  return (
    <header className="toolbar">
      <NavLink to="/" className="brand" aria-label="Field Shift, home">
        <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="9" fill="currentColor" />
          <path d="M6 22c4-8 9-10 20-10M6 16c3-5 7-6 14-6M10 26c4-5 8-6 16-6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <span className="brand-name">Field <b>Shift</b></span>
      </NavLink>

      <nav className="nav" aria-label="Sections" style={{ '--idx': index, '--n': items.length } as React.CSSProperties}>
        <span className="nav-indicator" aria-hidden="true" />
        {items.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.to === '/'} className={`nav-link${i.to === '/assistant' ? ` nav-asst${agent.dock === 'float' ? (agent.closing ? ' nav-slot' : agent.overDock ? ' nav-drop' : ' nav-slot') : entering ? ' nav-enter' : ''}` : ''}`} draggable={false}
            {...(i.to === '/assistant' ? { onPointerDown: pullOut, onClick: (e: React.MouseEvent) => { if (dragged.current) { e.preventDefault(); dragged.current = false } },
              title: 'Drag out to open in a floating window' } : {})}>
            <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">{i.icon}</svg>
            <span>{i.label}</span>
            {i.to === '/assistant' && holding && agent.canFloat && (
              <span className="nav-hint" aria-hidden="true">Unclip <svg viewBox="0 0 24 24"><path d="M12 5v14m-6-6 6 6 6-6" /></svg></span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="toolbar-end">
        {backend.offline && <span className="chip chip-warn" role="status">Offline data</span>}
      </div>
    </header>
  )
}
