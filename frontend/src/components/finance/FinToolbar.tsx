import StatusChip from '../StatusChip'
import { fmt } from '../../lib/format'
import type { Currency, FStatus } from '../../lib/finance'
import './FinanceReport.css'

interface Props {
  scope: 'all' | 'one'; setScope: (s: 'all' | 'one') => void
  fields: { id: string; name: string }[]; fieldId: string; setField: (id: string) => void
  cur: Currency; setCur: (c: Currency) => void
  fx: number; fxStatus: FStatus; fxSource: string; rateStr: string; rateErr: boolean; setRateStr: (v: string) => void
  onPrint: () => void; onCsv: () => void; canExport: boolean
}

/** Scope, field, currency, exchange rate and export in one slim row. */
export function FinToolbar(p: Props) {
  return (
    <div className="fin-toolbar reveal" style={{ '--i': 0 } as React.CSSProperties} role="toolbar" aria-label="Finance view">
      <div className="fin-seg" role="group" aria-label="Scope">
        <button type="button" aria-pressed={p.scope === 'all'} onClick={() => p.setScope('all')}>Farm ({p.fields.length})</button>
        <button type="button" aria-pressed={p.scope === 'one'} onClick={() => p.setScope('one')}>Field</button>
      </div>
      {p.scope === 'one' && (
        <select aria-label="Field" value={p.fieldId} onChange={(e) => p.setField(e.target.value)}>
          {p.fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      )}
      <div className="fin-seg" role="group" aria-label="Currency">
        {(['USD', 'UAH'] as Currency[]).map((c) => <button key={c} type="button" aria-pressed={p.cur === c} onClick={() => p.setCur(c)}>{c}</button>)}
      </div>
      <details className="fin-pop">
        <summary>UAH/USD {Number.isFinite(p.fx) ? fmt(p.fx, 2) : '-'}</summary>
        <div className="fin-pop-body">
          <label className="fin-field">
            <span>UAH per USD <StatusChip status={p.rateStr.trim() !== '' && !p.rateErr ? 'estimate' : p.fxStatus} source={p.fxSource} /></span>
            <input type="number" inputMode="decimal" min="0" step="any" value={p.rateStr} placeholder={Number.isFinite(p.fx) ? fmt(p.fx, 2) : ''} onChange={(e) => p.setRateStr(e.target.value)} aria-invalid={p.rateErr} />
            {p.rateErr && <em className="fin-error">Above 0</em>}
          </label>
        </div>
      </details>
      <span className="fin-toolbar-gap" />
      <button type="button" className="fin-btn" onClick={p.onPrint} disabled={!p.canExport}>Print</button>
      <button type="button" className="fin-btn" onClick={p.onCsv} disabled={!p.canExport}>CSV</button>
    </div>
  )
}
