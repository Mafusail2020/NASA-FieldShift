// One-line finance summary of a field, shown inside its row on the Fields page. Uses the same stored inputs as the Finance page.
import { Link } from 'react-router-dom'
import type { FieldItem } from '../../lib/field'
import { fmt } from '../../lib/format'
import { fieldRow, fmtMoney, inCurrency, useFinanceInputs, useFinSettings } from '../../lib/finance'
import StatusChip from '../StatusChip'
import './FinanceSummary.css'

export function FieldFinanceSummary({ field }: { field: FieldItem }) {
  const load = useFinanceInputs()
  const [S] = useFinSettings()
  const link = <Link className="fsum-link" to={`/finance?field=${encodeURIComponent(field.id)}`}>Finance for this field</Link>
  if (load.state !== 'ready') return <p className="fsum">{load.state === 'loading' ? 'Finance: loading…' : <span className="fsum-warn">Finance inputs unavailable</span>} {link}</p>
  const r = fieldRow(inCurrency(load.data, S.cur), field, S)
  const c = r.calc
  return (
    <p className="fsum">
      <b>{r.cropLabel ?? 'No crop'}</b>{r.area != null && <>, {fmt(r.area, 1)} ha</>}
      {!c || c.invalid ? (
        <> <span className="fsum-incomplete">Incomplete: {c?.invalid ? 'invalid inputs' : [r.area == null && 'no area', !r.cropLabel && 'no crop'].filter(Boolean).join(' and ')}</span></>
      ) : (
        <>: revenue {fmtMoney(c.revLow)} to {fmtMoney(c.revHigh)} {S.cur}
          {c.margin != null ? <>, margin {fmtMoney(c.marLow!)} to {fmtMoney(c.marHigh!)} {S.cur}</> : <> <span className="fsum-muted">margin needs a cost</span></>}
          {' '}<StatusChip status="estimate" source="Range from national FAOSTAT yields and prices (nominal) and your inputs; an estimate, not a promise." /></>
      )}
      {' '}{link}
    </p>
  )
}
