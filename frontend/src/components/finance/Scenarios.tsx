import { fmt } from '../../lib/format'
import { fmtMoney, type ScenarioCol } from '../../lib/finance'
import Info from './Info'
import './FinanceReport.css'

/** Bad / Base / Good side by side: yield, price, revenue and margin. Negative margins carry a minus sign and a tint. */
export function Scenarios({ cols, cur, area, info }: { cols: ScenarioCol[]; cur: string; area: number; info: string }) {
  const hasM = cols[0].res.marginPerHa != null
  const money = (v: number | null) => (v == null ? '-' : fmtMoney(v))
  const neg = (v: number | null) => (v != null && v < 0 ? 'fin-neg' : '')
  return (
    <section className="fin-card reveal" style={{ '--i': 3 } as React.CSSProperties} aria-labelledby="fin-scen">
      <div className="fin-head-row"><h2 id="fin-scen">Scenarios</h2><Info text={info} /></div>
      <div className="fin-table-wrap">
        <table className="fin-scen">
          <caption className="sr-only">Bad, base and good scenario</caption>
          <thead><tr><th scope="col" />{cols.map((c) => <th scope="col" key={c.name} className="fin-num">{c.name}</th>)}</tr></thead>
          <tbody>
            <tr><th scope="row">Yield, t/ha</th>{cols.map((c) => <td key={c.name} className="fin-num">{fmt(c.yieldTHa, 2)}</td>)}</tr>
            <tr><th scope="row">Price, {cur}/t</th>{cols.map((c) => <td key={c.name} className="fin-num">{fmtMoney(c.price)}</td>)}</tr>
            <tr><th scope="row">Revenue, {cur}/ha</th>{cols.map((c) => <td key={c.name} className="fin-num">{fmtMoney(c.res.revenuePerHa)}</td>)}</tr>
            {hasM && <tr><th scope="row">Margin, {cur}/ha</th>{cols.map((c) => <td key={c.name} className={`fin-num ${neg(c.res.marginPerHa)}`}>{money(c.res.marginPerHa)}</td>)}</tr>}
          </tbody>
          <tfoot>
            <tr><th scope="row">{hasM ? 'Margin' : 'Revenue'}, {fmt(area, 1)} ha</th>{cols.map((c) => { const v = hasM ? c.res.margin : c.res.revenue; return <td key={c.name} className={`fin-num ${neg(v)}`}>{money(v)}</td> })}</tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}
