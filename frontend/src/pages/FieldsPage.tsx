import { useEffect, useRef, useState } from 'react'
import FieldDetail from '../components/fields/FieldDetail'
import { FarmFinanceSummary } from '../components/finance/FarmFinanceSummary'
import { CROP_LABEL, useField, type FieldItem } from '../lib/field'
import { findCell, useGrid } from '../lib/grid'
import './FieldsPage.css'

const fmtHa = (v: number) => v.toLocaleString('en', { maximumFractionDigits: v < 10 ? 2 : 1 })

function Plus() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
}

function cellState(f: FieldItem, hasGrid: boolean): 'ok' | 'out' | 'idle' {
  if (f.lat == null || f.lon == null || !hasGrid) return 'idle'
  return f.cellId ? 'ok' : 'out'
}

export default function FieldsPage() {
  const { fields, activeId, selectField, addField, removeField, updateField } = useField()
  const g = useGrid()
  const grid = g.state === 'ready' ? g.grid : null
  const [listOpen, setListOpen] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const noRefs = useRef<Record<string, HTMLButtonElement>>({})
  useEffect(() => { if (confirmId) noRefs.current[confirmId]?.focus() }, [confirmId]) // the trash is gone: focus the safe choice

  // Keep every field's cell in step with its coordinates (also once the grid has loaded).
  useEffect(() => {
    if (!grid) return
    for (const f of fields) {
      const id = f.lat != null && f.lon != null ? findCell(grid, f.lat, f.lon)?.id ?? null : null
      if (id !== f.cellId) updateField(f.id, { cellId: id })
    }
  }, [grid, fields, updateField])

  const notes = (
    <>
      {g.state === 'loading' && <p className="fp-note" role="status">Loading the climate grid…</p>}
      {g.state === 'error' && <p className="fp-note fp-error" role="alert">Could not load the climate grid, so cells cannot be found yet. You can still enter fields; reload to try again.</p>}
    </>
  )

  if (fields.length === 0) {
    return (
      <section className="fp fp-empty-wrap" aria-label="Fields">
        <div className="fp-empty reveal">
          <svg className="fp-empty-art" viewBox="0 0 200 140" aria-hidden="true">
            <g fill="none" stroke="currentColor" strokeWidth="1.5">
              <ellipse cx="100" cy="72" rx="86" ry="56" opacity=".25" />
              <ellipse cx="100" cy="72" rx="62" ry="40" opacity=".45" />
              <ellipse cx="100" cy="72" rx="38" ry="24" opacity=".7" />
            </g>
            <circle cx="100" cy="72" r="7" fill="var(--color-primary)" />
            <circle cx="100" cy="72" r="14" fill="none" stroke="var(--color-primary)" strokeWidth="2" opacity=".5" />
          </svg>
          <h1>No fields yet</h1>
          <p>Add a field with its coordinates and area. The site then finds its NASA climate cell and shows climate, soil, rotation options and income.</p>
          <button type="button" className="fp-add fp-add-lg" onClick={() => addField()}><Plus />Create your first field</button>
          {notes}
        </div>
      </section>
    )
  }

  const total = fields.reduce((s, f) => s + (f.areaHa ?? 0), 0)
  const active = fields.find((f) => f.id === activeId) ?? fields[0]
  const pick = (id: string) => { selectField(id); setListOpen(false) }

  return (
    <section className="fp" aria-label="Fields">
      <aside className={`fp-side${listOpen ? ' fp-side-open' : ''}`} aria-label="Your fields">
        <div className="fp-side-top">
          <h1>Fields</h1>
          <button type="button" className="fp-add" onClick={() => addField()}><Plus />New field</button>
        </div>
        <button type="button" className="fp-side-toggle" aria-expanded={listOpen} aria-controls="fp-list" onClick={() => setListOpen((o) => !o)}>
          <span>{active.name}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4" /></svg>
        </button>
        <ul className="fp-list" id="fp-list">
          {fields.map((f, i) => {
            const st = cellState(f, !!grid)
            const sub = [f.crop ? CROP_LABEL[f.crop] : null, f.areaHa != null ? `${fmtHa(f.areaHa)} ha` : null].filter(Boolean).join(' · ')
            return (
              <li key={f.id} className={`fp-li reveal${confirmId === f.id ? ' fp-li-ask' : ''}`} style={{ '--i': i } as React.CSSProperties}
                onKeyDown={(e) => { if (e.key === 'Escape' && confirmId === f.id) setConfirmId(null) }}>
                <button type="button" className={`fp-item${f.id === active.id ? ' fp-item-on' : ''}`} aria-current={f.id === active.id ? 'true' : undefined} onClick={() => pick(f.id)}>
                  <i className={`fp-dot fp-dot-${st}`} aria-hidden="true" />
                  <span className="fp-item-name">{f.name || 'Untitled field'}</span>
                  <span className="fp-item-sub">{sub || 'No crop or area yet'}</span>
                  <span className="sr-only">{st === 'ok' ? 'Climate cell found' : st === 'out' ? 'Outside the analysed area' : 'Coordinates not set'}</span>
                </button>
                <div className="fp-acts">
                  <button type="button" className="fp-act fp-trash" aria-label={`Delete ${f.name || 'field'}`} inert={confirmId === f.id} onClick={() => setConfirmId(f.id)}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
                  </button>
                  <button type="button" className="fp-act fp-yes" aria-label={`Confirm: delete ${f.name || 'field'}`} inert={confirmId !== f.id} onClick={() => { setConfirmId(null); removeField(f.id) }}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                  </button>
                  <button type="button" className="fp-act fp-no" ref={(el) => { if (el) noRefs.current[f.id] = el; else delete noRefs.current[f.id] }} aria-label={`Keep ${f.name || 'field'}`} inert={confirmId !== f.id} onClick={() => setConfirmId(null)}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
        <p className="fp-sum" aria-live="polite"><b>{fields.length}</b> {fields.length === 1 ? 'field' : 'fields'} · <b>{fmtHa(total)}</b> ha</p>
      </aside>

      <div className="fp-main">
        {notes}
        <FieldDetail
          key={active.id} field={active} grid={grid} afterHead={<FarmFinanceSummary />}
          onUpdate={(p) => updateField(active.id, p)}
        />
      </div>
    </section>
  )
}
