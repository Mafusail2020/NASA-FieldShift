interface Props { values: number[]; label: string; width?: number; height?: number }

export default function Sparkline({ values, label, width = 280, height = 64 }: Props) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * width, height - 6 - ((v - min) / span) * (height - 12)])
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const [lx, ly] = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={label} preserveAspectRatio="none">
      <path d={`${line} L${width} ${height} L0 ${height} Z`} fill="var(--color-primary-tint)" />
      <path d={line} fill="none" stroke="var(--color-primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="4" fill="var(--color-primary-strong)" />
    </svg>
  )
}
