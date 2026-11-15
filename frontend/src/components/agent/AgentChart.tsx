import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ChartSpec } from '../../lib/agent'

const COLORS = ['var(--chart-water)', 'var(--chart-heat)', 'var(--chart-dry)']

export default function AgentChart({ spec }: { spec: ChartSpec }) {
  const rows = spec.x.map((x, i) => ({ x, ...Object.fromEntries(spec.series.map((s) => [s.name, s.values[i]])) }))
  const axis = { stroke: 'var(--color-muted)', fontSize: 11, tickLine: false } as const
  const common = (
    <>
      <CartesianGrid stroke="var(--color-border)" vertical={false} />
      <XAxis dataKey="x" {...axis} interval="preserveStartEnd" minTickGap={16} />
      <YAxis {...axis} width={40} />
      <Tooltip />
      {spec.series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
    </>
  )
  return (
    <figure className="agent-chart">
      <figcaption>{spec.title}</figcaption>
      <div className="agent-chart-box" role="img" aria-label={`${spec.title}: ${spec.series.map((s) => s.name).join(', ')}`}>
        <ResponsiveContainer width="100%" height={170}>
          {spec.kind === 'bar' ? (
            <BarChart data={rows}>{common}{spec.series.map((s, i) => <Bar key={s.name} dataKey={s.name} fill={COLORS[i % 3]} radius={[2, 2, 0, 0]} />)}</BarChart>
          ) : (
            <LineChart data={rows}>{common}{spec.series.map((s, i) => <Line key={s.name} dataKey={s.name} stroke={COLORS[i % 3]} dot={false} strokeWidth={2} />)}</LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </figure>
  )
}
