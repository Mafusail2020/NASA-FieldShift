import { fmt } from '../../lib/format'
import { fmtMoney } from '../../lib/finance'
import StatusChip from '../StatusChip'
import Info from './Info'
import './FinanceReport.css'

export interface RotRow { key: string; name: string; crops: string; current: boolean; avg: number; cum: number; p10: number; losing: number; total: number; kmu: boolean | null; fallowNoCost: boolean }

/** Your rotation vs alternatives: margin per ha per year over the weather years. Delta flagged only above 10% of yours. */
export function RotationCompare({ rows, cur, years, idx }: { rows: RotRow[]; cur: string; years: [number, number]; idx: number }) {
  const base = rows.find((r) => r.current)
  return (
    <section className="fin-card reveal" style={{ '--i': idx } as React.CSSProperties} aria-labelledby="fin-rc">
      <div className="fin-head-row">
        <h2 id="fin-rc">Rotations compared</h2>
        <StatusChip status="estimate" source="Margin per ha per year, mean over the crops of the rotation, for each weather year (quantile mapping of national yields, NASA POWER water balance order). Draft rotations A-E from rotations.yaml. Money and water only: no agronomic effects beyond k when switched on." />
        <Info text={`Margin per ha per year, ${years[0]}-${years[1]} weather. Δ = difference to your rotation; a flag shows only above 10%. KMU: return interval of KMU No. 164. Black fallow costs what you type for it (else 0).`} />
      </div>
      <div className="fin-table-wrap">
        <table>
          <caption className="sr-only">Rotations by margin per hectare per year</caption>
          <thead><tr><th scope="col">Rotation</th><th scope="col" className="fin-num">Avg, {cur}/ha/yr</th><th scope="col" className="fin-num">Cycle, {cur}/ha</th><th scope="col" className="fin-num">P10</th><th scope="col" className="fin-num">Loss yrs</th><th scope="col" className="fin-num">Δ vs yours</th><th scope="col">KMU</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const d = base && !r.current ? r.avg - base.avg : null
              const big = d != null && base ? Math.abs(d) > 0.1 * Math.max(Math.abs(base.avg), 1) : false
              return (
                <tr key={r.key} className={r.current ? 'fin-row-cur' : ''}>
                  <th scope="row">{r.name}<br /><small>{r.crops}</small>{r.fallowNoCost && <> <StatusChip status="todo" source="Black fallow cost not set: counted as 0" /></>}</th>
                  <td className={`fin-num ${r.avg < 0 ? 'fin-neg' : ''}`}>{fmtMoney(r.avg)}</td>
                  <td className="fin-num">{fmtMoney(r.cum)}</td>
                  <td className={`fin-num ${r.p10 < 0 ? 'fin-neg' : ''}`}>{fmtMoney(r.p10)}</td>
                  <td className="fin-num">{r.losing} of {r.total}</td>
                  <td className={`fin-num ${big ? (d! > 0 ? 'fin-pos' : 'fin-neg') : ''}`}>{d == null ? '-' : `${d >= 0 ? '+' : '−'}${fmt(Math.abs(d), Math.abs(d) < 100 ? 1 : 0)}${big ? (d > 0 ? ' ▲' : ' ▼') : ''}`}</td>
                  <td>{r.kmu == null ? '-' : r.kmu ? <><span aria-hidden="true">✓</span><span className="sr-only">meets</span></> : <><span aria-hidden="true">✕</span><span className="sr-only">breaks</span></>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
