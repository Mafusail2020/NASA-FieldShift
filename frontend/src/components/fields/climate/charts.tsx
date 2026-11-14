// Small inline-SVG charts (no chart library). Drawn at the measured container width so text stays readable at 360 px.
import { useEffect, useRef, useState } from 'react'
import { MONTH_NAMES, MONTH_START, doyLabel, type FrostEntry } from './types'

// Data colours (colour-blind safe pair: blue for water, orange for heat; dark red for the hotter threshold).
export const RAIN = '#2f6fa8'
export const HEAT = 'var(--color-primary)'
export const HEAT_STRONG = '#8c2d04'

export function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(480)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const set = () => setW(Math.max(260, Math.round(el.getBoundingClientRect().width)))
    set()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export const fmt = (v: number, d: number) => v.toLocaleString('en', { maximumFractionDigits: d, minimumFractionDigits: d })

function niceTicks(lo: number, hi: number, count = 4): number[] {
  const span = hi - lo || 1
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.abs(v) < 1e-9 ? 0 : v)
  return out
}

export interface Series { name: string; vals: (number | null | undefined)[]; kind: 'bar' | 'line'; color: string; narrow?: boolean }
interface TimeProps {
  years: number[]; series: Series[]; unit: string; decimals: number; label: string
  mean?: number | null; meanLabel?: string; line?: [number, number] | null
}

export function TimeChart({ years, series, unit, decimals, label, mean, meanLabel, line }: TimeProps) {
  const [ref, W] = useWidth()
  const H = 190, m = { l: 44, r: 8, t: 20, b: 22 }
  const n = years.length
  const hasBars = series.some((s) => s.kind === 'bar')
  const all = series.flatMap((s) => s.vals).filter((v): v is number => v != null)
  if (mean != null) all.push(mean)
  if (line) all.push(...line)
  if (!all.length) return <div ref={ref} />
  let lo = Math.min(...all), hi = Math.max(...all)
  if (hasBars) { lo = Math.min(lo, 0); hi = Math.max(hi, 0) }
  const pad = hasBars ? 0 : (hi - lo) * 0.1 || 1
  const ticks = niceTicks(lo - (hasBars && lo < 0 ? 0 : pad), hi + pad)
  const y0 = Math.min(lo - (lo < 0 || !hasBars ? pad : 0), ticks[0]), y1 = Math.max(hi + pad, ticks[ticks.length - 1])
  const iw = W - m.l - m.r, ih = H - m.t - m.b
  const X = (i: number) => m.l + ((i + 0.5) / n) * iw
  const Y = (v: number) => m.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih
  const bw = Math.max(2, iw / n - 2)
  const every = W < 420 ? 10 : 5
  const zero = y0 < 0 && y1 > 0 ? Y(0) : null
  return (
    <div ref={ref} className="fc-chart">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <text x={m.l - 40} y={11} className="fc-ax">{unit}</text>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={Y(t)} y2={Y(t)} className={t === 0 && hasBars ? 'fc-zero' : 'fc-grid-line'} />
            <text x={m.l - 5} y={Y(t) + 4} textAnchor="end" className="fc-ax">{fmt(t, Math.abs(t) < 10 && t % 1 ? 1 : 0)}</text>
          </g>
        ))}
        {years.map((yr, i) => (yr % every === 1991 % every ? <text key={yr} x={X(i)} y={H - 6} textAnchor="middle" className="fc-ax">{yr}</text> : null))}
        {series.filter((s) => s.kind === 'bar').map((s) => years.map((yr, i) => {
          const v = s.vals[i]
          if (v == null) return null
          const w = s.narrow ? bw * 0.5 : bw
          const base = zero ?? Y(y0)
          return <rect key={`${s.name}${yr}`} x={X(i) - w / 2} y={Math.min(Y(v), base)} width={w} height={Math.max(1, Math.abs(Y(v) - base))} fill={s.color} />
        }))}
        {mean != null && <line x1={m.l} x2={W - m.r} y1={Y(mean)} y2={Y(mean)} className="fc-mean" />}
        {series.filter((s) => s.kind === 'line').map((s) => {
          const segs: string[][] = [[]]
          s.vals.forEach((v, i) => { if (v == null) segs.push([]); else segs[segs.length - 1].push(`${X(i).toFixed(1)},${Y(v).toFixed(1)}`) })
          return (
            <g key={s.name}>
              {segs.filter((p) => p.length > 1).map((p, k) => <polyline key={k} points={p.join(' ')} fill="none" stroke={s.color} strokeWidth="1.5" />)}
              {s.vals.map((v, i) => (v == null ? null : <circle key={i} cx={X(i)} cy={Y(v)} r="2.6" fill={s.color} />))}
            </g>
          )
        })}
        {line && <line x1={X(0)} x2={X(n - 1)} y1={Y(line[0])} y2={Y(line[1])} className="fc-trend" />}
        {years.map((yr, i) => (
          <g key={yr} className="fc-hit">
            <rect x={m.l + (i / n) * iw} y={m.t} width={iw / n} height={ih} />
            <title>{`${yr}: ${series.map((s) => `${s.name} ${s.vals[i] == null ? 'no data' : fmt(s.vals[i]!, decimals)}`).join(', ')} ${unit}`}</title>
          </g>
        ))}
      </svg>
      <div className="fc-legend" aria-hidden="true">
        {series.map((s) => <span key={s.name}><i className="fc-sw" style={{ background: s.color }} />{s.name}</span>)}
        {mean != null && <span><i className="fc-sw fc-sw-mean" />{meanLabel ?? 'mean'} {fmt(mean, decimals)}</span>}
        {line && <span><i className="fc-sw fc-sw-trend" />Trend line</span>}
      </div>
      <p className="sr-only">{label}. Values by year: {years.map((yr, i) => `${yr}: ${series.map((s) => (s.vals[i] == null ? 'no data' : fmt(s.vals[i]!, decimals))).join(' / ')}`).join('; ')} {unit}.</p>
    </div>
  )
}

// Calendar chart: last spring frost and first autumn frost as 10-90 % range bars with a median tick, and the frost-free season between the medians.
export function FrostChart({ last, first, lastY, firstY, thr }: { last: FrostEntry | null | undefined; first: FrostEntry | null | undefined; lastY?: (number | null)[]; firstY?: (number | null)[]; thr: string }) {
  const [ref, W] = useWidth()
  const m = { l: 8, r: 8, t: 22 }, rowH = 40, H = m.t + rowH * 3 + 4
  const X = (d: number) => m.l + (d / 365) * (W - m.l - m.r)
  const narrow = W < 420
  const real = (e: FrostEntry) => (['d10', 'd50', 'd90'] as const).map((k) => e[k]).filter((d): d is number => d != null)
  const row = (e: FrostEntry | null | undefined, ys: (number | null)[] | undefined, kind: 'last' | 'first', r: number, color: string) => {
    const cy = m.t + rowH * r + rowH / 2
    if (!e) return <text x={m.l} y={cy + 4} className="fc-ax">Not enough valid years</text>
    const re = real(e)
    const title = (['d10', 'd50', 'd90'] as const).map((k) => `${k.slice(1)} %: ${e[k] == null ? (kind === 'last' ? 'no frost by then' : 'frost-free through December') : doyLabel(e[k]!)}`).join(', ')
    const lo = re.length ? Math.min(...re) : null, hi = re.length ? Math.max(...re) : null
    return (
      <g>
        {ys?.map((d, i) => (d != null && d > 0 && d < 367 ? <circle key={i} cx={X(d)} cy={cy + ((i % 5) - 2) * 2.5} r="1.8" fill={color} opacity="0.3" /> : null))}
        {re.length === 0
          ? <line x1={X(0)} x2={X(365)} y1={cy} y2={cy} className="fc-cens" />
          : <>
            {kind === 'last' && lo! > 0 && e.d10 == null && <line x1={X(0)} x2={X(lo!)} y1={cy} y2={cy} className="fc-cens" />}
            {kind === 'first' && hi! < 365 && e.d90 == null && <line x1={X(hi!)} x2={X(365)} y1={cy} y2={cy} className="fc-cens" />}
            <rect x={X(lo!)} y={cy - 6} width={Math.max(3, X(hi!) - X(lo!))} height="12" rx="3" fill={color} opacity="0.85"><title>{title}</title></rect>
          </>}
        {e.d50 != null && <line x1={X(e.d50)} x2={X(e.d50)} y1={cy - 10} y2={cy + 10} className="fc-median"><title>{title}</title></line>}
      </g>
    )
  }
  const a = last?.d50 ?? (last ? 0 : null), b = first?.d50 ?? (first ? 365 : null)
  return (
    <div ref={ref} className="fc-chart">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Frost calendar for threshold ${thr}: last spring frost, first autumn frost and frost-free season`}>
        {MONTH_START.map((d, i) => (
          <g key={d}>
            <line x1={X(d)} x2={X(d)} y1={m.t - 4} y2={H} className="fc-grid-line" />
            <text x={X(d) + (X(i < 11 ? MONTH_START[i + 1] : 365) - X(d)) / 2} y={13} textAnchor="middle" className="fc-ax">{narrow ? MONTH_NAMES[i][0] : MONTH_NAMES[i]}</text>
          </g>
        ))}
        {row(last, lastY, 'last', 0, RAIN)}
        {row(first, firstY, 'first', 1, HEAT_STRONG)}
        {a != null && b != null && b > a && (
          <rect x={X(a)} y={m.t + rowH * 2 + rowH / 2 - 6} width={X(b) - X(a)} height="12" rx="3" fill="var(--color-primary-tint)" stroke="var(--color-primary)"><title>{`Frost-free season: ${b - a} days`}</title></rect>
        )}
        {a != null && b != null && b > a && <text x={(X(a) + X(b)) / 2} y={m.t + rowH * 2 + rowH / 2 + 4} textAnchor="middle" className="fc-ax fc-ax-strong">{b - a} days</text>}
      </svg>
      <div className="fc-legend" aria-hidden="true">
        <span><i className="fc-sw" style={{ background: RAIN }} />Last spring frost</span>
        <span><i className="fc-sw" style={{ background: HEAT_STRONG }} />First autumn frost</span>
        <span><i className="fc-sw fc-sw-season" />Frost-free season</span>
      </div>
      <p className="fc-note">Bars show the 10 % to 90 % dates, the black tick the 50 % (median) date, dots the individual years. Dashed line: no frost in that part of the year.</p>
    </div>
  )
}
