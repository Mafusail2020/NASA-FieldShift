import { fmt } from '../../lib/format'
import { fmtMoney } from '../../lib/finance'
import Info from './Info'
import './FinanceReport.css'

interface G { yields: number[]; prices: number[]; cells: number[][]; hasCost: boolean }

/** Yield x price grid of margin per ha. Loss cells: minus sign, tint. Centre cell outlined. */
export function Grid({ g, cur, info }: { g: G; cur: string; info: string }) {
  return (
    <section className="fin-card reveal" style={{ '--i': 3 } as React.CSSProperties} aria-labelledby="fin-grid">
      <div className="fin-head-row"><h2 id="fin-grid">{g.hasCost ? 'Margin' : 'Revenue'}, {cur}/ha</h2><Info text={info} /></div>
      <div className="fin-table-wrap">
        <table className="fin-gridt">
          <caption className="sr-only">{g.hasCost ? 'Margin' : 'Revenue'} per hectare by yield (rows) and price (columns)</caption>
          <thead><tr><th scope="col" className="fin-corner">t/ha ╲ {cur}/t</th>{g.prices.map((p, i) => <th scope="col" key={i} className="fin-num">{fmtMoney(p)}</th>)}</tr></thead>
          <tbody>
            {g.yields.map((y, r) => (
              <tr key={r}>
                <th scope="row" className="fin-num">{fmt(y, 2)}</th>
                {g.cells[r].map((v, c) => <td key={c} className={`fin-num${g.hasCost && v < 0 ? ' fin-neg' : ''}${r === 2 && c === 2 ? ' fin-mid' : ''}`}>{fmtMoney(v)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
