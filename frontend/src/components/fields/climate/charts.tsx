// Small inline-SVG charts (no chart library). Drawn at the measured container width so text stays readable at 360 px.
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { MONTH_NAMES, MONTH_START, doyLabel, type FrostEntry } from './types'

// Data colours come from tokens.css: blue = water and frost, terracotta = heat, ochre = dry. None of them is the brand orange.
export const RAIN = 'var(--chart-water)'
export const RAIN_DEEP = 'var(--chart-water-deep)'
export const RAIN_SOFT = 'var(--chart-water-soft)'
export const WATER_TINT = 'var(--chart-water-tint)'
export const HEAT = 'var(--chart-heat)'
export const HEAT_STRONG = 'var(--chart-heat-strong)'
export const DRY = 'var(--chart-dry)'
export const DRY_STRONG = 'var(--chart-dry-strong)'

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

// negColor: bars below zero use this colour (legend shows posLabel / negLabel only for the signs that occur). stack: series with the same id stack bottom to top.
export interface Series {
  name: string; vals: (number | null | undefined)[]; kind: 'bar' | 'line'; color: string; narrow?: boolean
  negColor?: string; posLabel?: string; negLabel?: string; stack?: string
}
interface TimeProps {
  years: number[]; series: Series[]; unit: string; decimals: number; label: string
  mean?: number | null; meanLabel?: string          // dotted line, labelled on the line itself
  line?: [number, number] | null                     // trend line: pass it only when the trend is clear; its two end values are printed
  worst?: { side: 'low' | 'high'; color: string; label: string }   // darkens the worst 10 % of years of the first series and names the extreme one
  marks?: { years: number[]; color: string; label: string }        // small triangles under the axis, for years flagged on another chart
}

/** Indexes of the worst 10 % of values (at least one), the worst first. side 'low': smallest values are the worst. */
export function worstIdx(vals: (number | null | undefined)[], side: 'low' | 'high'): number[] {
  const idx = vals.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0).sort((a, b) => (side === 'low' ? vals[a]! - vals[b]! : vals[b]! - vals[a]!))
  return idx.slice(0, Math.max(1, Math.round(idx.length * 0.1)))
}

export function TimeChart({ years, series, unit, decimals, label, mean, meanLabel, line, worst, marks }: TimeProps) {
  const [ref, W] = useWidth()
  const traceId = `trace${useId().replace(/\W/g, '')}`
  const H = marks ? 204 : 190, m = { l: 44, r: 8, t: 20, b: marks ? 36 : 22 }
  const n = years.length
  const hasBars = series.some((s) => s.kind === 'bar')
  const all = series.flatMap((s) => s.vals).filter((v): v is number => v != null)
  // stacked bars: offset of each series on top of the earlier ones of its stack, and the stack totals
  const run: Record<string, number[]> = {}
  const offs = series.map((s) => {
    if (!s.stack) return null
    const r = (run[s.stack] ??= years.map(() => 0))
    const o = [...r]
    s.vals.forEach((v, i) => { if (v != null) r[i] += v })
    return o
  })
  const totals = Object.values(run)[0]
  if (totals) all.push(...totals)
  const at = (i: number, sep: string) => series.map((s) => (s.vals[i] == null ? 'no data' : fmt(s.vals[i]!, decimals))).join(sep)
  if (mean != null) all.push(mean)
  if (line) all.push(...line)
  if (!all.length) return <div ref={ref} />
  let lo = Math.min(...all), hi = Math.max(...all)
  if (hasBars) { lo = Math.min(lo, 0); hi = Math.max(hi, 0) }
  const pad = hasBars ? 0 : (hi - lo) * 0.1 || 1
  const ticks = niceTicks(lo - (hasBars && lo < 0 ? 0 : pad), hi + pad)
  let y0 = Math.min(lo - (lo < 0 || !hasBars ? pad : 0), ticks[0]), y1 = Math.max(hi + pad, ticks[ticks.length - 1])
  // room for the label of the extreme year, which is printed just beyond its bar
  const exv = worst ? series[0].vals[worstIdx(series[0].vals, worst.side)[0]] : null
  if (exv != null && exv < 0) y0 = Math.min(y0, lo - (hi - lo) * 0.1)
  else if (exv != null && exv > 0) y1 = Math.max(y1, hi + (hi - lo) * 0.1)
  const iw = W - m.l - m.r, ih = H - m.t - m.b
  const X = (i: number) => m.l + ((i + 0.5) / n) * iw
  const Y = (v: number) => m.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih
  const bw = Math.max(2, iw / n - 2)
  const every = W < 420 ? 10 : 5
  const zero = y0 <= 0 && y1 >= 0 ? Y(0) : null   // bars grow from the zero line: up for positive values, down for negative ones

  // worst 10 % of years of the first series
  const ranked = worst ? worstIdx(series[0].vals, worst.side) : []
  const flagged = new Set(ranked), extreme = ranked.length ? ranked[0] : -1
  const hasPos = series.some((s) => s.vals.some((v) => v != null && v > 0)), hasNeg = series.some((s) => s.vals.some((v) => v != null && v < 0))
  const legend: { key: string; color: string; text: string }[] = []
  for (const s of series) {
    if (s.negColor) {
      if (hasPos) legend.push({ key: `${s.name}+`, color: s.color, text: s.posLabel ?? s.name })
      if (hasNeg) legend.push({ key: `${s.name}-`, color: s.negColor, text: s.negLabel ?? 'below zero' })
    } else if (series.length > 1) legend.push({ key: s.name, color: s.color, text: s.name })
  }
  if (worst) legend.push({ key: 'worst', color: worst.color, text: worst.label })
  if (marks) legend.push({ key: 'marks', color: marks.color, text: marks.label })
  const ex = extreme >= 0 ? series[0].vals[extreme]! : null
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
        {years.map((yr, i) => (yr % every === 1991 % every ? <text key={yr} x={X(i)} y={m.t + ih + 14} textAnchor="middle" className="fc-ax">{yr}</text> : null))}
        {series.map((s, si) => (s.kind !== 'bar' ? null : years.map((yr, i) => {
          const v = s.vals[i]
          if (v == null) return null
          const w = s.narrow ? bw * 0.6 : bw
          const off = offs[si]?.[i]
          const base = off != null ? Y(off) : zero ?? Y(y0)
          const top = Y(off != null ? off + v : v)
          const fill = worst && si === 0 && flagged.has(i) ? worst.color : v < 0 && s.negColor ? s.negColor : s.color
          return <rect key={`${s.name}${yr}`} x={X(i) - w / 2} y={Math.min(top, base)} width={w} height={Math.max(1, Math.abs(top - base))} fill={fill} style={{ '--n': i } as CSSProperties} />
        })))}
        {mean != null && <line x1={m.l} x2={W - m.r} y1={Y(mean)} y2={Y(mean)} className="fc-mean" />}
        {mean != null && <text x={line ? m.l + 3 : W - m.r - 2} y={Y(mean) - 4} textAnchor={line ? 'start' : 'end'} className="fc-lbl">{meanLabel ?? 'mean'} {fmt(mean, decimals)}</text>}
        {series.filter((s) => s.kind === 'line').map((s) => {
          const segs: string[][] = [[]]
          s.vals.forEach((v, i) => { if (v == null) segs.push([]); else segs[segs.length - 1].push(`${X(i).toFixed(1)},${Y(v).toFixed(1)}`) })
          return (
            <g key={s.name}>
              {segs.filter((p) => p.length > 1).map((p, k) => <polyline key={k} points={p.join(' ')} fill="none" stroke={s.color} strokeWidth="1.5" />)}
              {s.vals.map((v, i) => (v == null ? null : <circle key={i} cx={X(i)} cy={Y(v)} r="2.6" fill={s.color} style={{ '--n': i } as CSSProperties} />))}
            </g>
          )
        })}
        {line && (
          <g>
            {/* the dashed trend line is revealed by a mask whose line is drawn along its length (see FieldsMotion.css) */}
            <mask id={traceId} maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
              <line x1={X(0)} x2={X(n - 1)} y1={Y(line[0])} y2={Y(line[1])} pathLength={1} className="fc-trace" />
            </mask>
            <line x1={X(0)} x2={X(n - 1)} y1={Y(line[0])} y2={Y(line[1])} className="fc-trend" mask={`url(#${traceId})`} />
            <text x={X(0)} y={Y(line[0]) - 7} className="fc-lbl fc-lbl-strong">{fmt(line[0], decimals)}</text>
            <text x={X(n - 1)} y={Y(line[1]) - 7} textAnchor="end" className="fc-lbl fc-lbl-strong">{fmt(line[1], decimals)}</text>
          </g>
        )}
        {ex != null && (
          <text x={X(extreme) + (extreme > n / 2 ? -6 : 6)} y={Y(ex) + (ex < 0 ? 12 : -5)} textAnchor={extreme > n / 2 ? 'end' : 'start'} className="fc-lbl fc-lbl-strong">{years[extreme]}: {fmt(ex, decimals)}</text>
        )}
        {marks && years.map((yr, i) => (marks.years.includes(yr)
          ? <path key={yr} d={`M${X(i) - 4},${H - 6} L${X(i) + 4},${H - 6} L${X(i)},${H - 13} Z`} fill={marks.color}><title>{`${yr}: ${marks.label}`}</title></path> : null))}
        {years.map((yr, i) => (
          <g key={yr} className="fc-hit">
            <rect x={m.l + (i / n) * iw} y={m.t} width={iw / n} height={ih} />
            <title>{`${yr}: ${series.map((s) => `${s.name} ${s.vals[i] == null ? 'no data' : fmt(s.vals[i]!, decimals)}`).join(', ')}${totals ? `, total ${fmt(totals[i], decimals)}` : ''} ${unit}`}</title>
          </g>
        ))}
      </svg>
      {legend.length > 0 && (
        <div className="fc-legend" aria-hidden="true">
          {legend.map((l) => <span key={l.key}><i className="fc-sw" style={{ background: l.color }} />{l.text}</span>)}
        </div>
      )}
      <p className="sr-only">{label}. Values by year: {years.map((yr, i) => `${yr}: ${at(i, ' / ')}`).join('; ')} {unit}.</p>
    </div>
  )
}

/** Averages per decade as four labelled numbers (1990s covers 1991-1999, 2020s covers 2020-2025). */
export function Decades({ years, vals, decimals, unit }: { years: number[]; vals: (number | null | undefined)[]; decimals: number; unit: string }) {
  const bins: [string, number, number][] = [['1990s', 1991, 1999], ['2000s', 2000, 2009], ['2010s', 2010, 2019], ['2020s', 2020, 2029]]
  const avg = (a: number, b: number) => {
    const v = years.map((y, i) => (y >= a && y <= b ? vals[i] : null)).filter((x): x is number => x != null)
    return v.length ? { m: v.reduce((p, q) => p + q, 0) / v.length, n: v.length } : null
  }
  return (
    <dl className="fc-dec" aria-label={`Average ${unit} by decade`}>
      {bins.map(([name, a, b]) => {
        const r = avg(a, b)
        return <div key={name} title={r ? `${r.n} years` : undefined}><dt>{name}</dt><dd>{r ? fmt(r.m, decimals) : '–'}</dd></div>
      })}
    </dl>
  )
}

// Calendar chart: last spring frost and first autumn frost as 10-90 % range bars with a median tick and the dates printed on the bars,
// and the frost-free season (median dates) with the safe window (9 years in 10) inside it.
export function FrostChart({ last, first, lastY, firstY, thr }: { last: FrostEntry | null | undefined; first: FrostEntry | null | undefined; lastY?: (number | null)[]; firstY?: (number | null)[]; thr: string }) {
  const [ref, W] = useWidth()
  const m = { l: 8, r: 8, t: 22 }, rowH = 46, H = m.t + rowH * 3 + 4
  const X = (d: number) => m.l + (d / 365) * (W - m.l - m.r)
  const narrow = W < 420
  const real = (e: FrostEntry) => (['d10', 'd50', 'd90'] as const).map((k) => e[k]).filter((d): d is number => d != null)
  const row = (e: FrostEntry | null | undefined, ys: (number | null)[] | undefined, kind: 'last' | 'first', r: number, color: string, name: string) => {
    const top = m.t + rowH * r, cy = top + 30
    const head = <text x={m.l + 2} y={top + 11} className="fc-lbl fc-lbl-strong">{name}</text>
    if (!e) return <g>{head}<text x={m.l} y={cy + 4} className="fc-ax">Not enough valid years</text></g>
    const re = real(e)
    const title = (['d10', 'd50', 'd90'] as const).map((k) => `${k.slice(1)} %: ${e[k] == null ? (kind === 'last' ? 'no frost by then' : 'frost-free through December') : doyLabel(e[k]!)}`).join(', ')
    const lo = re.length ? Math.min(...re) : null, hi = re.length ? Math.max(...re) : null
    const text = (['d10', 'd50', 'd90'] as const).map((k) => e[k]).filter((d): d is number => d != null).map(doyLabel).join(' · ')
    const tw = text.length * 5.8 + 8
    const right = hi != null && X(hi) + 8 + tw < W - 4
    return (
      <g>
        {head}
        {ys?.map((d, i) => (d != null && d > 0 && d < 367 ? <circle key={i} cx={X(d)} cy={cy + ((i % 5) - 2) * 2.5} r="1.8" fill={color} opacity="0.3" /> : null))}
        {re.length === 0
          ? <line x1={X(0)} x2={X(365)} y1={cy} y2={cy} className="fc-cens" />
          : <>
            {kind === 'last' && lo! > 0 && e.d10 == null && <line x1={X(0)} x2={X(lo!)} y1={cy} y2={cy} className="fc-cens" />}
            {kind === 'first' && hi! < 365 && e.d90 == null && <line x1={X(hi!)} x2={X(365)} y1={cy} y2={cy} className="fc-cens" />}
            <rect x={X(lo!)} y={cy - 6} width={Math.max(3, X(hi!) - X(lo!))} height="12" rx="3" fill={color} opacity="0.85"><title>{title}</title></rect>
            {text && <text x={right ? X(hi!) + 8 : X(lo!) - 8} y={cy + 4} textAnchor={right ? 'start' : 'end'} className="fc-lbl">{text}</text>}
          </>}
        {e.d50 != null && <line x1={X(e.d50)} x2={X(e.d50)} y1={cy - 10} y2={cy + 10} className="fc-median"><title>{title}</title></line>}
      </g>
    )
  }
  const a = last?.d50 ?? (last ? 0 : null), b = first?.d50 ?? (first ? 365 : null)
  const sa = last?.d90 ?? null, sb = first?.d10 ?? null
  const season = a != null && b != null && b > a ? b - a : null
  const safe = sa != null && sb != null && sb > sa ? sb - sa : null
  const sTop = m.t + rowH * 2, sCy = sTop + 30
  return (
    <div ref={ref} className="fc-chart">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Frost calendar for threshold ${thr}: last spring frost, first autumn frost, frost-free season and safe window`}>
        {MONTH_START.map((d, i) => (
          <g key={d}>
            <line x1={X(d)} x2={X(d)} y1={m.t - 4} y2={H} className="fc-grid-line" />
            <text x={X(d) + (X(i < 11 ? MONTH_START[i + 1] : 365) - X(d)) / 2} y={13} textAnchor="middle" className="fc-ax">{narrow ? MONTH_NAMES[i][0] : MONTH_NAMES[i]}</text>
          </g>
        ))}
        {row(last, lastY, 'last', 0, RAIN, 'Last spring frost')}
        {row(first, firstY, 'first', 1, RAIN_DEEP, 'First autumn frost')}
        <text x={m.l + 2} y={sTop + 11} className="fc-lbl fc-lbl-strong">Frost-free season{season != null ? `: ${season} days typical` : ''}{safe != null ? ` · ${safe} days in 9 years of 10` : ''}</text>
        {season != null && <rect x={X(a!)} y={sCy - 8} width={X(b!) - X(a!)} height="16" rx="3" fill={WATER_TINT} stroke={RAIN}><title>{`Frost-free season between the median dates: ${season} days`}</title></rect>}
        {safe != null && <rect x={X(sa!)} y={sCy - 4} width={X(sb!) - X(sa!)} height="8" rx="2" fill={RAIN_DEEP}><title>{`Safe window, ${doyLabel(sa!)} to ${doyLabel(sb!)}: ${safe} days, free of frost in 9 years out of 10`}</title></rect>}
      </svg>
    </div>
  )
}
