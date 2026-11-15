import { fmtMoney } from '../../lib/finance'
import type { Summary } from '../../lib/weatherMargin'
import StatusChip from '../StatusChip'
import Info from './Info'
import './FinanceReport.css'

const BINS = 12

/** Histogram of margin per weather year (one value per year). Loss bins in the danger colour; P10 / P50 / P90 listed under the chart. */
export function Distribution({ values, years, s, unit, title, info }: { values: number[]; years: [number, number]; s: Summary; unit: string; title: string; info: string }) {
  const W = 640, H = 170, L = 8, R = 8, T = 10, B = 24
  const lo = Math.min(s.min, 0), hi = Math.max(s.max, 0)
  const span = hi - lo || 1
  const w = span / BINS
  const bins = Array.from({ length: BINS }, (_, i) => ({ a: lo + i * w, n: 0 }))
  for (const v of values) bins[Math.min(BINS - 1, Math.floor((v - lo) / w))].n++
  const top = Math.max(...bins.map((b) => b.n), 1)
  const X = (v: number) => L + ((v - lo) / span) * (W - L - R)
  const bw = (W - L - R) / BINS
  return (
    <section className="fin-card reveal" style={{ '--i': 3 } as React.CSSProperties} aria-labelledby="fin-dist">
      <div className="fin-head-row">
        <h2 id="fin-dist">{title}</h2><StatusChip status="estimate" source="Weather order from the NASA POWER water balance (Ks), spread from national FAOSTAT yields (quantile mapping). Not a yield model: heat, frost, pests and the war are not in it." /><Info text={info} />
      </div>
      <svg className="fin-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${s.losing} of ${s.n} years below zero. P10 ${fmtMoney(s.p10)}, median ${fmtMoney(s.p50)}, P90 ${fmtMoney(s.p90)} ${unit}.`}>
        <title>{title}</title>
        {bins.map((b, i) => {
          const loss = b.a + w <= 0 || (b.a < 0 && b.a + w / 2 < 0)
          const h = (b.n / top) * (H - T - B)
          return <rect key={i} x={L + i * bw + 1} y={H - B - h} width={bw - 2} height={h} rx="2" className={loss ? 'fin-bar-loss' : 'fin-bar-ok'}><title>{`${fmtMoney(b.a)} to ${fmtMoney(b.a + w)}: ${b.n} years`}</title></rect>
        })}
        <line x1={X(0)} x2={X(0)} y1={T} y2={H - B} className="fin-zero" />
        {([['P10', s.p10], ['P50', s.p50], ['P90', s.p90]] as const).map(([n, v]) => <line key={n} x1={X(v)} x2={X(v)} y1={H - B} y2={H - B + 6} className="fin-tick" />)}
        <text x={L} y={H - 6} className="fin-axis">{fmtMoney(lo)}</text>
        <text x={W - R} y={H - 6} textAnchor="end" className="fin-axis">{fmtMoney(hi)}</text>
      </svg>
      <ul className="fin-pcts">
        <li><span>P10</span><b>{fmtMoney(s.p10)}</b></li>
        <li><span>P50</span><b>{fmtMoney(s.p50)}</b></li>
        <li><span>P90</span><b>{fmtMoney(s.p90)}</b></li>
        <li className={s.losing > 0 ? 'fin-neg' : ''}><span>Loss</span><b>{s.losing} of {s.n}</b></li>
      </ul>
      <p className="fin-muted">{unit}, weather {years[0]}-{years[1]}</p>
    </section>
  )
}
