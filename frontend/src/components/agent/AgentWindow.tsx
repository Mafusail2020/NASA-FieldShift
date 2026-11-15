import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAgent, type Edge } from '../../lib/agent'
import AgentChat from './AgentChat'
import './AgentWindow.css'

const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

// Floating, draggable, resizable window with the assistant. It grows out of the Assistant tab (same position and size, same orange)
// and shrinks back into the tab slot when docked: a FLIP animation driven by CSS variables.
export default function AgentWindow() {
  const { dock, rect, dockBack, startMove, startResize, moving, overDock, closing, anchor } = useAgent()
  const ref = useRef<HTMLElement>(null)

  // entrance: start as the tab's box, end as the window
  useLayoutEffect(() => {
    const el = ref.current
    if (dock !== 'float' || !el || !anchor) return
    el.style.setProperty('--fx', `${anchor.x - rect.x}px`)
    el.style.setProperty('--fy', `${anchor.y - rect.y}px`)
    el.style.setProperty('--fsx', String(anchor.w / rect.w))
    el.style.setProperty('--fsy', String(anchor.h / rect.h))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dock, anchor])

  // Dragged over the toolbar: the window turns into the tab slot while the button is still held; leaving the bar turns it back.
  const slot = useRef<DOMRect | null>(null)
  const wasOver = useRef(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const to = (r: DOMRect, t: DOMRect) => `translate(${t.left - r.left}px, ${t.top - r.top}px) scale(${t.width / r.width}, ${t.height / r.height})`
    if (overDock) {
      const tab = document.querySelector('.nav-asst')?.getBoundingClientRect()
      if (!tab) return
      slot.current = tab
      el.style.transform = to(el.getBoundingClientRect(), tab)
    } else if (wasOver.current && slot.current) {
      // the window follows the pointer again from its new position: start the transition from where the slot is on screen
      el.style.transition = 'none'
      el.style.transform = 'none'
      el.style.transform = to(el.getBoundingClientRect(), slot.current)
      void el.offsetWidth
      el.style.transition = ''
      el.style.transform = ''
    }
    wasOver.current = overDock
  }, [overDock])

  // exit: end as the tab slot, measured from where the window is now
  useLayoutEffect(() => {
    const el = ref.current
    const tab = document.querySelector('.nav-asst')?.getBoundingClientRect()
    if (!closing || !el || !tab) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--tx', `${tab.left - r.left}px`)
    el.style.setProperty('--ty', `${tab.top - r.top}px`)
    el.style.setProperty('--tsx', String(tab.width / r.width))
    el.style.setProperty('--tsy', String(tab.height / r.height))
  }, [closing])

  useEffect(() => {
    if (dock !== 'float') return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') dockBack() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [dock, dockBack])
  if (dock !== 'float') return null
  return createPortal(
    <section ref={ref} className={`agw${moving ? ' agw-moving' : ''}${overDock ? ' agw-over' : ''}${closing ? ' agw-out' : ''}`} role="dialog" aria-label="Assistant"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
      <header className="agw-head" onPointerDown={(e) => { if ((e.target as HTMLElement).closest('button')) return; e.preventDefault(); startMove(e) }}>
        <span className="agw-title">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21V9M12 2.5c1.6 1.4 1.6 3.2 0 4.8-1.6-1.6-1.6-3.4 0-4.8ZM12 10c-2.6 0-4.2-1.5-4.2-3.6 2.6 0 4.2 1.6 4.2 3.6ZM12 10c2.6 0 4.2-1.5 4.2-3.6-2.6 0-4.2 1.6-4.2 3.6ZM12 15.5c-2.6 0-4.2-1.5-4.2-3.6 2.6 0 4.2 1.6 4.2 3.6ZM12 15.5c2.6 0 4.2-1.5 4.2-3.6-2.6 0-4.2 1.6-4.2 3.6Z" /></svg>
          {overDock ? 'Release to dock' : 'Assistant'}
        </span>
        <button type="button" className="agw-btn" onClick={dockBack} aria-label="Dock the assistant back to its tab" title="Dock (Esc)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" /></svg>
        </button>
      </header>
      <div className="agw-body"><AgentChat /></div>
      {EDGES.map((e) => <span key={e} className={`agw-grip agw-${e}`} aria-hidden="true" onPointerDown={(ev) => { ev.preventDefault(); startResize(ev, e) }} />)}
    </section>,
    document.body,
  )
}
