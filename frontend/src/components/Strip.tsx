import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useI18n } from '../i18n'
import type { Evaluation } from '../types'

const COLOR: Record<string, string> = { winter_wheat: '#d9b44a', maize: '#7cb342', sunflower: '#f9a825', pea: '#66bb6a', bare: '#cfcfcf' }
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

export function Strip({ ev }: { ev: Evaluation }) {
  const { t } = useI18n()
  const data = ev.strip.flatMap((s, i) =>
    s.months.map((m) => ({ x: `${i + 1}${MONTHS[m.month - 1]}`, water: m.frac == null ? null : Math.round(m.frac * 100) })))
  return (
    <div className="strip">
      {ev.strip.map((s) => (
        <div key={s.slot} className="year">
          <div className="yl">{t('rot.year', { n: s.slot + 1, crop: t('crop.' + s.crop) })}</div>
          <div className="months">
            {s.months.map((m) => {
              const bare = m.label == null || m.label === 'bare'
              return (
                <div key={m.month} className="cell" title={t('crop.' + (m.label ?? 'bare'))}
                  style={{ background: bare ? COLOR.bare : COLOR[m.label!] ?? COLOR.bare, opacity: bare ? 0.6 : 1 }}>
                  {MONTHS[m.month - 1]}
                </div>
              )
            })}
          </div>
        </div>
      ))}
      <div className="chart" role="img" aria-label={t('rot.soilwater')}>
        <ResponsiveContainer width="100%" height={170}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="x" interval={0} tick={{ fontSize: 9 }} />
            <YAxis domain={[0, 100]} unit="%" width={44} />
            <Tooltip />
            <Line dataKey="water" name={t('rot.soilwater')} stroke="#1976d2" dot={false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="legend">{t('rot.legend')}</p>
    </div>
  )
}
