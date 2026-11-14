import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useBackend } from '../backend'
import { num, slope } from '../format'
import { useI18n } from '../i18n'
import type { Climate } from '../types'
import { Info } from './Num'

function Series({ title, data, keys, unit, source, status }: {
  title: string; data: Record<string, number | null>[]; keys: { k: string; color: string; name: string }[]; unit?: string
  source: string; status: Climate['status']
}) {
  return (
    <section className="card">
      <h3>{title} <Info source={source} status={status} /></h3>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="year" tick={{ fontSize: 10 }} />
          <YAxis unit={unit} width={52} tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
          <Tooltip />
          {keys.map((s) => <Line key={s.k} dataKey={s.k} name={s.name} stroke={s.color} dot={false} connectNulls isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </section>
  )
}

export function ClimateTab({ region, soil }: { region: string; soil: string }) {
  const { t } = useI18n()
  const backend = useBackend()
  const [c, setC] = useState<Climate | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => { setErr(false); backend.climate(region, soil).then(setC).catch(() => setErr(true)) }, [region, soil]) // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <p className="err">{t('error')}</p>
  if (!c) return <p>{t('loading')}</p>
  const a = c.years[0], b = c.years[c.years.length - 1]
  const trend = (what: string, ys: number[], unit: string) => {
    const v = slope(c.years, ys) * 10
    return <li key={what}>{t('climate.trend', { what: t('climate.trend.' + what), v: `${v >= 0 ? '+' : ''}${num(v, 1)} ${unit}`, a, b })}</li>
  }
  const climateData = c.years.map((y, i) => ({ year: y, precip: c.precip_mm[i], eto: c.eto_mm[i], july: c.july_tmax_c[i] }))
  return (
    <div>
      <ul>{trend('precip', c.precip_mm, 'mm')}{trend('eto', c.eto_mm, 'mm')}{trend('july', c.july_tmax_c, '°C')}</ul>
      <div className="grid">
        <Series title={t('climate.precip')} data={climateData} keys={[{ k: 'precip', color: '#1976d2', name: 'mm' }]} source={c.source} status={c.status} />
        <Series title={t('climate.eto')} data={climateData} keys={[{ k: 'eto', color: '#e65100', name: 'mm' }]} source={c.source} status={c.status} />
        <Series title={t('climate.july')} data={climateData} keys={[{ k: 'july', color: '#c62828', name: '°C' }]} source={c.source} status={c.status} />
      </div>
      {Object.entries(c.stress).map(([crop, s]) => {
        const rows = s.years.map((y, i) => ({ year: y, ks: s.mean_ks_mid[i], days: s.water_stress_days[i], heat: s.heat_days_1[i], heat2: s.heat_days_2[i] }))
        const ks = rows.filter((r) => r.ks !== null) as { year: number; ks: number }[]
        const dry = ks.reduce((m, r) => (r.ks < m.ks ? r : m), ks[0])
        const wet = ks.reduce((m, r) => (r.ks > m.ks ? r : m), ks[0])
        const heatRows = rows.filter((r) => r.heat !== null)
        const heatN = heatRows.filter((r) => (r.heat as number) > 0).length
        const days = rows.filter((r) => r.days !== null).map((r) => r.days as number)
        const name = t('crop.' + crop)
        return (
          <section key={crop} className="crop-block">
            <h2>{name}</h2>
            <ul>
              <li>{t('climate.dry', { crop: name, year: dry.year, ks: num(dry.ks), year2: wet.year, ks2: num(wet.ks) })}</li>
              <li>{t('climate.stressavg', { crop: name, d: num(days.reduce((x, y) => x + y, 0) / days.length, 0) })}</li>
              {s.heat_threshold_1_c !== null && heatRows.length > 0 &&
                <li>{t('climate.heatyears', { n: heatN, N: heatRows.length, crop: name, thr: s.heat_threshold_1_c })} <sup>{t('status.' + s.heat_status)}</sup></li>}
            </ul>
            <div className="grid">
              <Series title={t('climate.ks')} data={rows} keys={[{ k: 'ks', color: '#2e7d32', name: 'Ks' }]} source={s.source} status={s.status} />
              <Series title={t('climate.stressdays')} data={rows} keys={[{ k: 'days', color: '#6d4c41', name: 'days' }]} source={s.source} status={s.status} />
              {heatRows.length > 0
                ? (
                  <section className="card">
                    <h3>{t('climate.heat', { thr: s.heat_threshold_1_c ?? '' })} <Info source={s.source} status={s.heat_status} /> <sup>{t('status.' + s.heat_status)}</sup></h3>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={rows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" tick={{ fontSize: 10 }} /><YAxis width={40} />
                        <Tooltip /><Bar dataKey="heat" fill="#ef6c00" isAnimationActive={false} /></BarChart>
                    </ResponsiveContainer>
                  </section>)
                : <section className="card"><p className="todo">{t('climate.heat.todo', { crop: name })}</p></section>}
            </div>
          </section>
        )
      })}
      <section className="crop-block"><h2>{t('climate.frost')}</h2><p className="todo">{t('climate.frost.todo')} <sup>{t('status.' + c.frost_status)}</sup></p></section>
    </div>
  )
}
