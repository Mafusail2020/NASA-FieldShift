// Season twins of one field: the historical seasons (NASA POWER, 1991-2025) whose weather since sowing looks most like this one,
// and how those seasons ended. Backend: GET /api/twin (core/twin.py). Not a forecast.
import { useState } from 'react'
import { CROP_LABEL, type FieldItem } from '../../lib/field'
import { typicalSowing, TWIN_CROPS, useTwin, type Twin, type TwinSeries } from '../../lib/twin'
import StatusChip from '../StatusChip'
import { useWidth } from './climate/charts'
import './twin/twin.css'

const COLORS = ['var(--chart-water-deep)', 'var(--chart-heat-strong)', 'var(--chart-dry-strong)']
const dm = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const strength = (d: number) => (d < 0.8 ? 'close match' : d < 1.2 ? 'fair match' : 'weak match')

export function FieldTwin({ field, onUpdate }: { field: FieldItem; onUpdate(patch: Partial<Omit<FieldItem, 'id'>>): void }) {
  const [asOf, setAsOf] = useState('')
  const t = useTwin(field.lat, field.lon, field.crop, field.sowingDate, asOf)
  const supported = field.crop != null && TWIN_CROPS.includes(field.crop)

  let body
  if (field.lat == null || field.lon == null) body = <p className="ft-msg">Enter the field's coordinates to find its season twins.</p>
  else if (!field.crop) body = <p className="ft-msg">Choose the crop of this season.</p>
  else if (!supported) body = <p className="ft-msg">Season twins work for winter wheat and maize so far. {CROP_LABEL[field.crop]} is not covered yet.</p>
  else if (!field.sowingDate) {
    body = (
      <div className="ft-msg">
        <p>Enter the sowing date of this season (field settings above) to compare it with 35 past seasons.</p>
        <button type="button" className="fr-btn" onClick={() => onUpdate({ sowingDate: typicalSowing(field.crop!) })}>Use a typical date ({typicalSowing(field.crop).slice(5).split('-').reverse().join('.')})</button>
      </div>
    )
  } else if (t.state === 'loading' || t.state === 'idle') body = <p className="ft-msg" aria-busy="true">Comparing with past seasons…</p>
  else if (t.state === 'error') body = <p className="ft-msg ft-err" role="alert">{t.message}</p>
  else {
    const r = t.result
    if (r.status === 'too_early') body = <p className="ft-msg">Too early: {r.days_since_sowing} days since sowing. At least {r.min_days} days of weather are needed to match a season. Come back after {r.min_days} days, or pick an earlier sowing date.</p>
    else if (r.status === 'no_data') body = <p className="ft-msg ft-err" role="alert">Not enough weather data for this location and sowing date.</p>
    else {
      const done = r.days_since_sowing >= r.cycle_d
      const late = r.twins.filter((x) => x.flags.includes('late drought')).length
      const heat = r.twins.filter((x) => x.flags.includes('heat in grain fill')).length
      const verdict = [late ? `${late} of ${r.twins.length} ended with a late drought` : null, heat ? `${heat} of ${r.twins.length} had heat in the grain-fill window` : null].filter(Boolean).join('; ')
      body = (
        <>
          {t.saved && <p className="ft-msg ft-warn" role="status">The server did not answer. This is a saved example for a maize field near Lviv, not your field.</p>}
          <p className="ft-lead">
            {done ? 'This season is complete.' : `Day ${r.days_since_sowing} of about ${r.cycle_d}.`} The seasons most like it up to {dm(r.as_of)}: <b>{r.twins.map((x) => x.year).join(', ')}</b>.
            {' '}{verdict ? <b className="ft-verdict">{verdict[0].toUpperCase() + verdict.slice(1)}.</b> : <>None of them ended with a late drought or grain-fill heat.</>}
          </p>
          <div className="ft-cards">
            {r.twins.map((x, i) => <TwinCard key={x.year} t={x} color={COLORS[i]} done={done} ref0={r.reference} winter={r.crop === 'winter_wheat'} />)}
          </div>
          <Chart s={r.series} twins={r.twins} nowDay={r.days_since_sowing} />
          <p className="ft-src">Weather up to {dm(r.data_last_day)} (cell {r.cell}); {r.years_compared} past seasons compared.</p>
        </>
      )
    }
  }

  return (
    <section className="ft" aria-label="Season twins">
      <div className="ft-head">
        <h3>Season twins</h3>
        <StatusChip status="estimate" source="NASA POWER daily 1991-2025 plus current season; matching of cumulative rain, growing degree-days, Tmax and radiation by 10-day blocks (core/twin.py). Windows and thresholds are estimates." />
      </div>
      {supported && field.sowingDate && (
        <label className="ft-asof">
          <span>Compare the season up to</span>
          <input type="date" value={asOf} min={field.sowingDate} onChange={(e) => setAsOf(e.target.value)} />
          <small>{asOf ? '' : 'latest weather'}</small>
          {asOf && <button type="button" className="fr-btn" onClick={() => setAsOf('')}>Latest</button>}
        </label>
      )}
      {body}
    </section>
  )
}

function TwinCard({ t, color, done, ref0, winter }: { t: Twin; color: string; done: boolean; winter: boolean; ref0: { late_rain_mm_median: number; heat_days_median: number } }) {
  const drought = t.flags.includes('late drought'), heat = t.flags.includes('heat in grain fill'), wet = t.flags.includes('wet finish')
  return (
    <article className="ft-card" style={{ borderTopColor: color }}>
      <h4>{t.year} <small>{strength(t.distance)}</small></h4>
      <p className="ft-out" aria-label="How that season ended">
        <span className="ft-out-label">Result:</span>
        {t.flags.length ? t.flags.map((f) => <span key={f} className={`ft-tag${f === 'wet finish' ? ' ft-tag-good' : ''}`}>{f}</span>) : <span className="ft-tag ft-tag-good">no late drought or heat</span>}
      </p>
      <dl>
        <div className={drought ? 'ft-bad' : wet ? 'ft-good' : ''}><dt>Rain in the late stages</dt><dd>{t.late_rain_mm} mm <small>(usual {ref0.late_rain_mm_median})</small></dd></div>
        <div className={drought ? 'ft-bad' : ''}><dt>Longest dry spell then</dt><dd>{t.late_dry_spell_days} days</dd></div>
        <div className={heat ? 'ft-bad' : ''}><dt>Hot days in the grain-fill window</dt><dd>{t.heat_days} <small>(usual {ref0.heat_days_median})</small></dd></div>
        <div><dt>{winter ? 'Frost days after winter' : 'Frost days in the season'}</dt><dd>{t.frost_days}</dd></div>
        <div><dt>Ripe about</dt><dd>{dm(t.harvest_date)}</dd></div>
        {!done && t.next30_rain_mm != null && <div><dt>Next 30 days after this point</dt><dd>{t.next30_rain_mm} mm rain, {t.next30_heat_days} hot days</dd></div>}
      </dl>
      <p className="ft-diff">Why it matches: rain {t.diff.rain_mm >= 0 ? '+' : '−'}{Math.abs(t.diff.rain_mm)} mm, warmth {t.diff.gdd >= 0 ? '+' : '−'}{Math.abs(t.diff.gdd)} degree-days, Tmax {t.diff.tmax_c >= 0 ? '+' : '−'}{Math.abs(t.diff.tmax_c)} °C against this season so far.</p>
    </article>
  )
}

function Chart({ s, twins, nowDay }: { s: TwinSeries; twins: Twin[]; nowDay: number }) {
  const [what, setWhat] = useState<'rain' | 'gdd'>('rain')
  const [ref, w] = useWidth()
  const H = 220, L = 44, R = 10, T = 10, B = 28
  const lo = what === 'rain' ? s.rain_min : s.gdd_min, hi = what === 'rain' ? s.rain_max : s.gdd_max
  const now = what === 'rain' ? s.now_rain : s.now_gdd
  const maxY = Math.max(...hi) || 1, maxX = s.days[s.days.length - 1] || 1
  const x = (d: number) => L + (d / maxX) * (w - L - R)
  const y = (v: number) => T + (1 - v / maxY) * (H - T - B)
  const line = (a: number[]) => a.map((v, i) => `${i ? 'L' : 'M'}${x(s.days[i]).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const band = `${lo.map((v, i) => `${i ? 'L' : 'M'}${x(s.days[i]).toFixed(1)},${y(v).toFixed(1)}`).join('')}${[...hi].reverse().map((v, i) => `L${x(s.days[hi.length - 1 - i]).toFixed(1)},${y(v).toFixed(1)}`).join('')}Z`
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round((f * maxY) / (what === 'rain' ? 50 : 500)) * (what === 'rain' ? 50 : 500)).filter((v, i, a) => a.indexOf(v) === i && v <= maxY)
  const unit = what === 'rain' ? 'mm' : '°C·days'
  return (
    <figure className="ft-fig">
      <div className="ft-figtop">
        <figcaption>{what === 'rain' ? 'Rain added up since sowing' : 'Warmth added up since sowing (degree-days)'}</figcaption>
        <div className="fs-row" role="group" aria-label="Chart variable">
          <button type="button" className="fs-tog" aria-pressed={what === 'rain'} onClick={() => setWhat('rain')}>Rain</button>
          <button type="button" className="fs-tog" aria-pressed={what === 'gdd'} onClick={() => setWhat('gdd')}>Warmth</button>
        </div>
      </div>
      <div ref={ref}>
        <svg width={w} height={H} role="img" aria-label={`Cumulative ${what === 'rain' ? 'rain' : 'degree-days'} of this season and its ${twins.length} twin years, against the range of all years`}>
          <path d={band} fill="var(--color-border)" opacity="0.55" />
          {ticks.map((v) => <g key={v}><line x1={L} x2={w - R} y1={y(v)} y2={y(v)} stroke="var(--color-border)" strokeWidth="0.5" /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--color-muted)">{v}</text></g>)}
          <text x={L} y={H - 8} fontSize="11" fill="var(--color-muted)">sowing</text>
          <text x={w - R} y={H - 8} fontSize="11" textAnchor="end" fill="var(--color-muted)">harvest, day {maxX}</text>
          {twins.map((t, i) => <path key={t.year} d={line(what === 'rain' ? s.twins[t.year].rain : s.twins[t.year].gdd)} fill="none" stroke={COLORS[i]} strokeWidth="1.5" opacity="0.85" />)}
          <line x1={x(Math.min(nowDay, maxX))} x2={x(Math.min(nowDay, maxX))} y1={T} y2={H - B} stroke="var(--color-text)" strokeDasharray="3 3" strokeWidth="1" />
          <path d={line(now.slice(0, Math.floor(nowDay / 5) + 1)).replace(/^$/, 'M0,0')} fill="none" stroke="var(--color-primary)" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </div>
      <p className="ft-legend">
        <span><i style={{ background: 'var(--color-primary)' }} />This season</span>
        {twins.map((t, i) => <span key={t.year}><i style={{ background: COLORS[i] }} />{t.year}</span>)}
        <span><i style={{ background: 'var(--color-border)' }} />range of all years ({unit})</span>
      </p>
    </figure>
  )
}
