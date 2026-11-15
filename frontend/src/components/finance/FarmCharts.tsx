import { fmtMoney } from '../../lib/finance'
import Info from './Info'
import { fmtShort } from './RangeBar'
import './FinanceReport.css'

export interface FieldBar { name: string; low: number; mid: number; high: number }

const SLICE = ['--color-primary-strong', '--chart-water', '--color-primary', '--chart-dry', '--chart-heat', '--chart-water-soft', '--color-border-strong']
const polar = (cx: number, cy: number, r: number, deg: number) => [cx + r * Math.sin((deg * Math.PI) / 180), cy - r * Math.cos((deg * Math.PI) / 180)]
// Arc from deg a to b (clockwise from 12 o'clock) on radius r.
const arc = (cx: number, cy: number, r: number, a: number, b: number) => {
  const [x1, y1] = polar(cx, cy, r, a), [x2, y2] = polar(cx, cy, r, b)
  return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`
}

/** Revenue by crop as a donut. Up to 6 crops, the rest merged into "Other". Centre = total revenue. */
function Donut({ share, total, cur }: { share: { label: string; value: number }[]; total: number; cur: string }) {
  const sorted = [...share].sort((a, b) => b.value - a.value)
  const items = sorted.length > 6 ? [...sorted.slice(0, 5), { label: 'Other', value: sorted.slice(5).reduce((t, s) => t + s.value, 0) }] : sorted
  const sum = items.reduce((t, s) => t + s.value, 0) || 1
  const R = 70, SW = 26, C = 2 * Math.PI * R
  let off = 0
  return (
    <div className="fin-radial">
      <svg viewBox="0 0 200 200" className="fin-radial-svg" role="img" aria-label={`Revenue by crop: ${items.map((s) => `${s.label} ${Math.round((s.value / sum) * 100)}%`).join(', ')}`}>
        <circle cx="100" cy="100" r={R} fill="none" stroke="var(--color-neutral-tint)" strokeWidth={SW} />
        {items.map((s, i) => {
          const len = (s.value / sum) * C
          const gap = items.length > 1 ? Math.min(2, len * 0.3) : 0
          const el = <circle key={s.label} cx="100" cy="100" r={R} fill="none" stroke={`var(${SLICE[i % SLICE.length]})`} strokeWidth={SW} strokeDasharray={`${Math.max(len - gap, 0)} ${C - Math.max(len - gap, 0)}`} strokeDashoffset={-off} transform="rotate(-90 100 100)"><title>{`${s.label}: ${Math.round((s.value / sum) * 100)}%`}</title></circle>
          off += len
          return el
        })}
        <text x="100" y="98" textAnchor="middle" className="fin-radial-big">{fmtShort(total)}</text>
        <text x="100" y="116" textAnchor="middle" className="fin-axis">{cur}</text>
      </svg>
      <ul className="fin-radial-legend">
        {items.map((s, i) => (
          <li key={s.label}><i style={{ background: `var(${SLICE[i % SLICE.length]})` }} aria-hidden="true" />{s.label} <b>{Math.round((s.value / sum) * 100)}%</b></li>
        ))}
      </ul>
    </div>
  )
}

const SWEEP = 270
/** Margin by field as radial bars: one ring per field on a shared 270° scale (low at 12 o'clock). Arc = low to high, tick = middle, dashed = zero. */
function RadialRanges({ fields, cur }: { fields: FieldBar[]; cur: string }) {
  const lo = Math.min(0, ...fields.map((f) => f.low)), hi = Math.max(0, ...fields.map((f) => f.high))
  const span = hi - lo || 1
  const ang = (v: number) => ((v - lo) / span) * SWEEP
  const n = fields.length
  const R0 = 88, gap = 4
  const t = Math.max(5, Math.min(16, (R0 - 22) / n - gap))
  return (
    <div className="fin-radial">
      <svg viewBox="0 0 200 200" className="fin-radial-svg" role="img" aria-label={`Margin by field, ${cur}: ${fields.map((f) => `${f.name} ${fmtMoney(f.low)} to ${fmtMoney(f.high)}`).join('; ')}`}>
        {fields.map((f, i) => {
          const r = R0 - i * (t + gap) - t / 2
          const a1 = ang(f.low), a2 = Math.max(ang(f.high), a1 + 1.5)
          const [mx1, my1] = polar(100, 100, r - t / 2 - 1, ang(f.mid)), [mx2, my2] = polar(100, 100, r + t / 2 + 1, ang(f.mid))
          const [zx1, zy1] = polar(100, 100, r - t / 2 - 1, ang(0)), [zx2, zy2] = polar(100, 100, r + t / 2 + 1, ang(0))
          return (
            <g key={f.name + i}>
              <path d={arc(100, 100, r, 0, SWEEP)} fill="none" stroke="var(--color-neutral-tint)" strokeWidth={t} strokeLinecap="round" />
              <path d={arc(100, 100, r, a1, a2)} fill="none" stroke="var(--color-primary)" strokeWidth={t} strokeLinecap="round"><title>{`${f.name}: ${fmtMoney(f.low)} to ${fmtMoney(f.high)} ${cur}`}</title></path>
              <line x1={mx1} y1={my1} x2={mx2} y2={my2} stroke="var(--color-text)" strokeWidth="2" />
              {lo < 0 && <line x1={zx1} y1={zy1} x2={zx2} y2={zy2} stroke="var(--color-danger)" strokeWidth="1.5" strokeDasharray="2 2" />}
              <text x="94" y={100 - r + 3} textAnchor="end" className="fin-radial-lbl">{f.name.length > 11 ? `${f.name.slice(0, 10)}…` : f.name}</text>
            </g>
          )
        })}
      </svg>
      <ul className="fin-radial-legend fin-radial-vals">
        {fields.map((f) => <li key={f.name}>{f.name} <b>{fmtMoney(f.low)} to {fmtMoney(f.high)}</b></li>)}
      </ul>
    </div>
  )
}

/** Two radial charts for the farm: revenue share by crop (donut) and margin range by field (radial bars). */
export function FarmCharts({ share, fields, cur, weather, idx }: { share: { label: string; value: number }[]; fields: FieldBar[]; cur: string; weather: boolean; idx: number }) {
  const total = share.reduce((t, s) => t + s.value, 0)
  return (
    <div className="fin-pair">
      <section className="fin-card reveal" style={{ '--i': idx } as React.CSSProperties} aria-labelledby="fin-share">
        <div className="fin-head-row"><h2 id="fin-share">Revenue by crop</h2></div>
        <Donut share={share} total={total} cur={cur} />
      </section>
      <section className="fin-card reveal" style={{ '--i': idx } as React.CSSProperties} aria-labelledby="fin-fm">
        <div className="fin-head-row"><h2 id="fin-fm">Margin by field</h2><Info text={weather ? `Arc = P10 to P90 over the weather years, black tick = median, red dashes = 0, ${cur}.` : `Arc = low to high of the national yield range, black tick = central, red dashes = 0, ${cur}.`} /></div>
        <RadialRanges fields={fields} cur={cur} />
      </section>
    </div>
  )
}
