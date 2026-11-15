// A heading row that opens and closes a panel with a height animation (CSS only: grid rows 0fr -> 1fr). Closed content stays mounted but
// is inert and hidden from assistive technology. Honors prefers-reduced-motion (no animation).
import { useId, useState, type ReactNode } from 'react'
import './Collapsible.css'

export default function Collapsible({ title, hint, defaultOpen = false, children }: { title: string; hint?: string; defaultOpen?: boolean; children: ReactNode }) {
  const uid = useId()
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`coll${open ? ' coll-open' : ''}`}>
      <h3 className="coll-h">
        <button type="button" className="coll-btn" aria-expanded={open} aria-controls={`${uid}p`} onClick={() => setOpen((o) => !o)}>
          <span className="coll-title">{title}{hint && <small>{hint}</small>}</span>
          <span className="coll-chev" aria-hidden="true" />
        </button>
      </h3>
      <div className="coll-panel" id={`${uid}p`} role="region" aria-label={title} inert={!open}>
        <div className="coll-inner">{children}</div>
      </div>
    </div>
  )
}
