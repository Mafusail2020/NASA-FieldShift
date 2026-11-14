// Whole-farm finance summary card, shown at the top of the Fields page. Uses the same stored inputs as the Finance page.
import { Link } from 'react-router-dom'
import { useField } from '../../lib/field'
import { fmt } from '../../lib/format'
import { farmTotals, fieldRow, fmtMoney, inCurrency, useFinanceInputs, useFinSettings } from '../../lib/finance'
import StatusChip from '../StatusChip'
import './FinanceSummary.css'

export function FarmFinanceSummary() {
  const { fields } = useField()
  const load = useFinanceInputs()
  const [S] = useFinSettings()
  if (load.state === 'loading') return <section className="fsum-card" aria-busy="true"><p className="fsum">Finance: loading…</p></section>
  if (load.state === 'error') return <section className="fsum-card"><p className="fsum"><span className="fsum-warn">Finance inputs unavailable.</span> <Link className="fsum-link" to="/finance">Open Finance</Link></p></section>
  const T = farmTotals(fields.map((f) => fieldRow(inCurrency(load.data, S.cur), f, S)))
  const left = T.total - T.counted
  return (
    <section className="fsum-card" aria-labelledby="fsum-farm-h">
      <div className="fsum-head">
        <h2 id="fsum-farm-h">Farm income estimate</h2>
        <Link className="fsum-link" to="/finance">Open Finance</Link>
      </div>
      {T.counted === 0 ? (
        <p className="fsum"><span className="fsum-incomplete">Incomplete</span> Add an area and a crop to a field to see an estimate.</p>
      ) : (
        <p className="fsum">
          <b>{T.counted}</b> of {T.total} fields counted, {fmt(T.area, 1)} ha. Revenue <b>{fmtMoney(T.rev.low)} to {fmtMoney(T.rev.high)} {S.cur}</b>
          {T.mar ? <>, margin <b>{fmtMoney(T.mar.low)} to {fmtMoney(T.mar.high)} {S.cur}</b></> : <> <span className="fsum-muted">margin: needs all costs</span></>}
          {' '}<StatusChip status="estimate" source="Range from national FAOSTAT yields (10th-90th percentile) and nominal prices with your price spread; not a promise of income." />
        </p>
      )}
      {left > 0 && T.counted > 0 && <p className="fsum-muted">{left} field{left > 1 ? 's are' : ' is'} incomplete and left out of the totals.</p>}
    </section>
  )
}
