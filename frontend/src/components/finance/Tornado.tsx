import { fmtMoney, type TornadoRow } from '../../lib/finance'
import Info from './Info'
import './FinanceReport.css'

/** What moves margin most: margin per ha when one driver changes by -10% / +10%. Bars on a shared scale, base line in the middle. */
export function Tornado({ base, rows, cur, info }: { base: number; rows: TornadoRow[]; cur: string; info: string }) {
  const lo = Math.min(base, ...rows.map((r) => r.low)), hi = Math.max(base, ...rows.map((r) => r.high))
  const span = hi - lo || 1
  const pos = (v: number) => ((v - lo) / span) * 100
  return (
    <section className="fin-card reveal" style={{ '--i': 3 } as React.CSSProperties} aria-labelledby="fin-torn">
      <div className="fin-head-row"><h2 id="fin-torn">What moves margin</h2><Info text={info} /></div>
      <ul className="fin-torn" role="list">
        {rows.map((r) => (
          <li key={r.name} aria-label={`${r.name}: margin ${fmtMoney(r.low)} to ${fmtMoney(r.high)} ${cur} per ha`}>
            <span className="fin-torn-name">{r.name}</span>
            <span className="fin-torn-track" aria-hidden="true">
              <span className="fin-torn-bar" style={{ left: `${pos(r.low)}%`, width: `${Math.max(pos(r.high) - pos(r.low), 1)}%` }} />
              <span className="fin-torn-base" style={{ left: `${pos(base)}%` }} />
            </span>
            <span className="fin-torn-val">{fmtMoney(r.low)} to {fmtMoney(r.high)}</span>
          </li>
        ))}
      </ul>
      <p className="fin-muted">Base {fmtMoney(base)} {cur}/ha, each driver ±10%</p>
    </section>
  )
}
