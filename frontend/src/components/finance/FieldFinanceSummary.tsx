// One-line finance summary of a field, shown inside its row on the Fields page. Uses the same stored inputs as the Finance page.
import { Link } from 'react-router-dom'
import type { FieldItem } from '../../lib/field'
import { fmt } from '../../lib/format'
import { fieldRow, fmtMoney, inCurrency, useFinanceInputs, useFinSettings } from '../../lib/finance'
import { useSoilDoc } from '../../lib/soil'
import { RangeBar, fmtShort } from './RangeBar'
import './FinanceSummary.css'

export function FieldFinanceSummary({ field }: { field: FieldItem }) {
  const load = useFinanceInputs()
  const [S] = useFinSettings()
  const soil = useSoilDoc()
  const link = <Link className="fsum-link" to={`/finance?field=${encodeURIComponent(field.id)}`}>Finance for this field</Link>
  if (load.state !== 'ready') return <p className="fsum">{load.state === 'loading' ? 'Finance: loading…' : <span className="fsum-warn">Finance inputs unavailable</span>} {link}</p>
  const r = fieldRow(inCurrency(load.data, S.cur), field, S, soil.state === 'ready' ? soil.data : null)
  const c = r.calc
  const perHa = c && !c.invalid && r.area ? { lo: c.revLow / r.area, hi: c.revHigh / r.area } : null
  return (
    <div>
      <p className="fsum">
        <b>{r.cropLabel ?? 'No crop'}</b>{r.area != null && <>, {fmt(r.area, 1)} ha</>}
        {!c || c.invalid ? (
          <> <span className="fsum-incomplete">Incomplete: {c?.invalid ? 'invalid inputs' : [r.area == null && 'no area', !r.cropLabel && 'no crop'].filter(Boolean).join(' and ')}</span></>
        ) : (
          <>: estimated revenue {fmtShort(c.revLow)} to {fmtShort(c.revHigh)} {S.cur}{perHa && <> (about {fmtMoney(perHa.lo)} to {fmtMoney(perHa.hi)} {S.cur} per ha)</>}
            {c.margin != null ? <>, margin {fmtShort(c.marLow!)} to {fmtShort(c.marHigh!)} {S.cur}</> : <> <span className="fsum-muted">margin needs a cost</span></>}</>
        )}
        {' '}{link}
      </p>
      {c && !c.invalid && <RangeBar low={c.revLow} high={c.revHigh} cur={S.cur} label="Revenue" />}
    </div>
  )
}
