import { fmt } from '../../lib/format'
import { fmtMoney, type BreakEvenRow } from '../../lib/finance'
import StatusChip from '../StatusChip'
import Info from './Info'
import './FinanceReport.css'

const flag = (v: number, be: number | null) => (be == null ? null : v / be - 1)
const tone = (h: number | null) => (h == null ? 'todo' : h < 0 ? 'loss' : h < 0.2 ? 'warn' : 'ok')
const GLYPH = { ok: '✓', warn: '!', loss: '✕', todo: '–' } as const

/** Break-even yield and price for every crop, with headroom of the current yield / price. */
export function BreakEven({ rows, cur, idx }: { rows: BreakEvenRow[]; cur: string; idx: number }) {
  if (rows.length === 0) return null
  return (
    <section className="fin-card reveal" style={{ '--i': idx } as React.CSSProperties} aria-labelledby="fin-be">
      <div className="fin-head-row"><h2 id="fin-be">Break-even</h2><Info text="Yield and price where margin is 0 with the current cost. Flag: your yield and price above (✓), close to (!) or below (✕) it." /></div>
      <div className="fin-table-wrap">
        <table>
          <caption className="sr-only">Break-even yield and price per crop</caption>
          <thead><tr><th scope="col">Crop</th><th scope="col" className="fin-num">Cost, {cur}/ha</th><th scope="col" className="fin-num">Yield, t/ha</th><th scope="col" className="fin-num">Break-even</th><th scope="col" className="fin-num">Price, {cur}/t</th><th scope="col" className="fin-num">Break-even</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const ty = tone(flag(r.y, r.beY)), tp = tone(flag(r.p, r.beP))
              return (
                <tr key={r.id}>
                  <th scope="row">{r.label}</th>
                  <td className="fin-num">{r.cost != null ? fmtMoney(r.cost) : '-'}{r.costDefault && <> <StatusChip status="sample" source="Sample cost, not a real source" /></>}</td>
                  <td className="fin-num">{fmt(r.y, 2)}</td>
                  <td className={`fin-num fin-tone-${ty}`}><span className="fin-be">{r.beY != null ? fmt(r.beY, 2) : '-'} <b aria-hidden="true">{GLYPH[ty]}</b><span className="sr-only">{ty}</span></span></td>
                  <td className="fin-num">{fmtMoney(r.p)}</td>
                  <td className={`fin-num fin-tone-${tp}`}><span className="fin-be">{r.beP != null ? fmtMoney(r.beP) : '-'} <b aria-hidden="true">{GLYPH[tp]}</b><span className="sr-only">{tp}</span></span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
