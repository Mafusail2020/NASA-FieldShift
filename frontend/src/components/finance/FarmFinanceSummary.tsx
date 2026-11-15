// Whole-farm finance summary card, shown at the top of the Fields page. Uses the same stored inputs as the Finance page.
import { Link } from 'react-router-dom'
import { useField } from '../../lib/field'
import { fmt } from '../../lib/format'
import { farmTotals, fieldRow, fmtMoney, inCurrency, useFinanceInputs, useFinSettings } from '../../lib/finance'
import { useSoilDoc } from '../../lib/soil'
import StatusChip from '../StatusChip'
import { RangeBar, fmtShort } from './RangeBar'
import './FinanceSummary.css'

export function FarmFinanceSummary() {
  const { fields } = useField()
  const load = useFinanceInputs()
  const [S] = useFinSettings()
  const soil = useSoilDoc()
  const sd = soil.state === 'ready' ? soil.data : null
  if (load.state === 'loading') return <section className="fsum-card" aria-busy="true"><p className="fsum">Finance: loading…</p></section>
  if (load.state === 'error') return <section className="fsum-card"><p className="fsum"><span className="fsum-warn">Finance inputs unavailable.</span> <Link className="fsum-link" to="/finance">Open Finance</Link></p></section>
  const T = farmTotals(fields.map((f) => fieldRow(inCurrency(load.data, S.cur), f, S, sd)))
  const left = T.total - T.counted
  const per = (v: number) => (T.area > 0 ? v / T.area : null)
  const row = (name: string, r: { low: number; high: number }) => {
    const pl = per(r.low), ph = per(r.high)
    return (
      <div className="fsum-row">
        <div className="fsum-row-h"><span>{name}: <b>{fmtShort(r.low)} to {fmtShort(r.high)} {S.cur}</b></span>
          {pl != null && ph != null && <span className="fsum-muted">about {fmtMoney(pl)} to {fmtMoney(ph)} {S.cur} per ha</span>}</div>
        <RangeBar low={r.low} high={r.high} cur={S.cur} label={name} />
      </div>
    )
  }
  return (
    <section className="fsum-card" aria-labelledby="fsum-farm-h">
      <div className="fsum-head">
        <h2 id="fsum-farm-h">Farm income estimate <StatusChip status="estimate" source="Range from national FAOSTAT yields (10th-90th percentile) and nominal prices with your price spread; not a promise of income." /></h2>
        <Link className="fsum-link" to="/finance">Open Finance</Link>
      </div>
      {T.counted === 0 ? (
        <p className="fsum"><span className="fsum-incomplete">Incomplete</span> Add an area and a crop to a field to see an estimate.</p>
      ) : (
        <>
          <p className="fsum"><b>{T.counted}</b> of {T.total} fields counted, {fmt(T.area, 1)} ha. All ranges are estimates from national FAOSTAT yields (10th to 90th percentile) and nominal prices with your price spread, not a promise of income.</p>
          <div className="fsum-rows">
            {row('Revenue', T.rev)}
            {T.mar ? row('Margin', T.mar) : <p className="fsum-muted">Margin: needs all costs.</p>}
          </div>
        </>
      )}
      {left > 0 && T.counted > 0 && <p className="fsum-muted">{left} field{left > 1 ? 's are' : ' is'} incomplete and left out of the totals.</p>}
    </section>
  )
}
