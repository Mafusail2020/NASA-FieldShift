import { useEffect, useState } from 'react'
import CoordPicker from '../components/fields/CoordPicker'
import FieldRow from '../components/fields/FieldRow'
import { FarmFinanceSummary } from '../components/finance/FarmFinanceSummary'
import { useField } from '../lib/field'
import { findCell, useGrid } from '../lib/grid'
import './FieldsPage.css'

const fmtHa = (v: number) => v.toLocaleString('en', { maximumFractionDigits: v < 10 ? 2 : 1 })

export default function FieldsPage() {
  const { fields, activeId, selectField, addField, removeField, updateField } = useField()
  const g = useGrid()
  const grid = g.state === 'ready' ? g.grid : null
  const [openId, setOpenId] = useState<string | null>(activeId)
  const [helpOpen, setHelpOpen] = useState(false)

  // Keep every field's cell in step with its coordinates (also once the grid has loaded).
  useEffect(() => {
    if (!grid) return
    for (const f of fields) {
      const id = f.lat != null && f.lon != null ? findCell(grid, f.lat, f.lon)?.id ?? null : null
      if (id !== f.cellId) updateField(f.id, { cellId: id })
    }
  }, [grid, fields, updateField])

  const total = fields.reduce((s, f) => s + (f.areaHa ?? 0), 0)
  const toggle = (id: string) => { if (openId === id) setOpenId(null); else { setOpenId(id); selectField(id) } }
  const add = () => { const id = addField(); setOpenId(id) }

  return (
    <section className="fp" aria-label="Fields">
      <header className="fp-head">
        <h1>Fields</h1>
        <p>Enter each field's coordinates and area. The site does the rest: climate, soil, rotation analysis and finance.</p>
        <details className="fp-help" onToggle={(e) => setHelpOpen(e.currentTarget.open)}>
          <summary>How do I find the coordinates?</summary>
          <p>On a phone, use "Use my location" while standing in the field, or open a maps app, long-press the field and copy the numbers it shows. You can paste a pair such as 49.84, 24.03 into either box. Use decimal degrees. Or move the satellite map below so the pin sits on your field.</p>
          {helpOpen && <CoordPicker fields={fields} activeId={activeId} grid={grid} onUse={(id, lat, lon) => updateField(id, { lat, lon })} />}
        </details>
        <div className="fp-sum" aria-live="polite">
          <b>{fields.length}</b> {fields.length === 1 ? 'field' : 'fields'} · <b>{fmtHa(total)}</b> ha in total
        </div>
      </header>

      <FarmFinanceSummary />

      {g.state === 'loading' && <p className="fp-note" role="status">Loading the climate grid…</p>}
      {g.state === 'error' && <p className="fp-note fp-error" role="alert">Could not load the climate grid, so cells cannot be found yet. You can still enter fields; reload to try again.</p>}

      <div className="fp-rows">
        {fields.map((f) => (
          <FieldRow
            key={f.id} field={f} grid={grid} open={openId === f.id && activeId === f.id}
            onToggle={() => toggle(f.id)} onUpdate={(p) => updateField(f.id, p)} onDelete={() => removeField(f.id)}
          />
        ))}
      </div>
      <button type="button" className="fp-add" onClick={add}>Add field</button>
    </section>
  )
}
