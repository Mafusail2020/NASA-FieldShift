import { fmt } from '../../lib/format'
import type { YearValue } from '../../lib/finance'

interface Props { points: YearValue[]; unit: string; label: string; digits?: number; highlightFrom?: number; marker?: { value: number; label: string } | null }

// Inline SVG line chart; the highlighted years (the ones used for the yield range) are drawn as filled dots.
export default function LineChart({ points, unit, label, digits = 0, highlightFrom, marker }: Props) {
  if (points.length < 2) return <p className="fin-muted">Not enough data to draw a chart.</p>
  const W = 640, H = 220, L = 56, R = 16, T = 14, B = 30
  const xs = points.map((p) => p.year), vs = points.map((p) => p.value)
  const x0 = Math.min(...xs), x1 = Math.max(...xs)
  const top = Math.max(...vs, marker?.value ?? 0) * 1.08
  const X = (y: number) => L + ((y - x0) / (x1 - x0)) * (W - L - R)
  const Y = (v: number) => T + (1 - v / top) * (H - T - B)
  const ticks = [0, 0.5, 1].map((f) => f * top)
  const yearTicks = [x0, Math.round((x0 + x1) / 2), x1]
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.year).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ')
  return (
    <svg className="fin-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <title>{label}</title>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} className="fin-grid" />
          <text x={L - 8} y={Y(t) + 4} textAnchor="end" className="fin-axis">{fmt(t, digits)}</text>
        </g>
      ))}
      {yearTicks.map((y) => <text key={y} x={X(y)} y={H - 8} textAnchor="middle" className="fin-axis">{y}</text>)}
      <text x={L} y={10} className="fin-axis">{unit}</text>
      {marker && (
        <g>
          <line x1={L} x2={W - R} y1={Y(marker.value)} y2={Y(marker.value)} className="fin-marker" />
          <text x={W - R} y={Y(marker.value) - 5} textAnchor="end" className="fin-axis fin-marker-text">{marker.label}</text>
        </g>
      )}
      <path d={path} className="fin-line" />
      {points.map((p) => (
        <circle key={p.year} cx={X(p.year)} cy={Y(p.value)} r={highlightFrom != null && p.year >= highlightFrom ? 3.5 : 2}
          className={highlightFrom != null && p.year >= highlightFrom ? 'fin-dot-hi' : 'fin-dot'}>
          <title>{`${p.year}: ${fmt(p.value, digits)} ${unit}`}</title>
        </circle>
      ))}
    </svg>
  )
}
