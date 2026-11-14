// Per-field climate summary and historical climate-risk charts of the field's NASA POWER grid cell.
// Data: public/data/grid.json cell (passed in) and public/data/grid_layers.json (built by pipeline/build_layers.py).
import { useEffect, useState, type ReactNode } from 'react'
import type { GridCell } from '../../types'
import StatusChip from '../StatusChip'
import { FrostChart, HEAT, HEAT_STRONG, RAIN, TimeChart, fmt } from './climate/charts'
import { THRESHOLD_ORDER, doyLabel as doy, type CellLayer, type FrostEntry, type LayerMeta, type LayersDoc } from './climate/types'
import './climate/climate.css'

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; doc: LayersDoc }
let cache: Promise<LayersDoc> | null = null
const loadDoc = () => (cache ??= fetch('/data/grid_layers.json').then((r) => { if (!r.ok) throw new Error('missing'); return r.json() }).catch((e) => { cache = null; throw e }))

const GRID_SOURCE = 'NASA POWER daily, community AG, 1991-2025 (MERRA-2 grid, 0.5 x 0.625 deg); ETo = FAO-56 Penman-Monteith (core/eto.py); tmean = (Tmax+Tmin)/2; a year with any missing day is skipped'
const mean = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN }

// Fixed sentence templates, filled from computed numbers only.
function takeaway(c: CellLayer, words: [string, string], unit: string, d = 2): string {
  if (c.trend == null || c.p_value == null) return 'Not enough valid years for a trend.'
  const p = `p = ${fmt(c.p_value, c.p_value < 0.001 ? 3 : 2)}`
  if (c.p_value < 0.05) return `${c.trend > 0 ? words[0] : words[1]} by ${fmt(Math.abs(c.trend), d)} ${unit} per decade, significant (${p}).`
  return `No significant trend: ${c.trend > 0 ? '+' : ''}${fmt(c.trend, d)} ${unit} per decade (${p}).`
}

export function FieldClimate({ cell }: { cell: GridCell | null }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  useEffect(() => {
    let live = true
    loadDoc().then((doc) => live && setLoad({ state: 'ready', doc })).catch(() => live && setLoad({ state: 'error' }))
    return () => { live = false }
  }, [])

  const head = (
    <div className="fc-head">
      <h3>Climate and risks</h3>
      <p>Historical 1991–2025 statistics of reanalysis data (MERRA-2 via NASA POWER) for a ~50 km grid cell, not a forecast and not one field. A trend is called significant when p &lt; 0.05.</p>
    </div>
  )
  if (!cell) return <section className="fc">{head}<p className="fc-msg">Enter the field's latitude and longitude (inside Ukraine) to see its climate and risks.</p></section>
  return (
    <section className="fc" aria-label="Climate and risks">
      {head}
      <Summary cell={cell} />
      {load.state === 'loading' && <p className="fc-msg" aria-busy="true">Loading climate charts…</p>}
      {load.state === 'error' && <p className="fc-msg fc-err" role="alert">Climate charts are not available: <code>grid_layers.json</code> was not found. Run <code>python -m pipeline.build_layers</code> in <code>backend/</code>.</p>}
      {load.state === 'ready' && <Charts doc={load.doc} cellId={cell.id} />}
    </section>
  )
}

function Summary({ cell }: { cell: GridCell }) {
  const n = cell.precip_mm.filter((x) => x != null).length
  const items: [string, number, number, string][] = [
    ['Precipitation', mean(cell.precip_mm), 0, 'mm / yr'], ['Reference ET₀', mean(cell.eto_mm), 0, 'mm / yr'],
    ['Mean temperature', mean(cell.tmean_c), 1, '°C'], ['July Tmax', mean(cell.july_tmax_c), 1, '°C'], ['Elevation', cell.elevation_m, 0, 'm'],
  ]
  return (
    <div className="fc-card">
      <div className="fc-top"><p className="fc-title">Climate summary: averages of {n} complete years</p><StatusChip status="data" source={GRID_SOURCE} /></div>
      <div className="fc-stats">
        {items.map(([l, v, d, u]) => <div key={l}><div className="fc-label">{l}</div><div className="fc-val">{Number.isNaN(v) ? '–' : fmt(v, d)} <span className="fc-label">{u}</span></div></div>)}
      </div>
      <p className="fc-note">ET₀ is the water a well-watered grass surface would use (FAO-56 Penman-Monteith).</p>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <div className="fc-group"><h4>{title}</h4><div className="fc-charts">{children}</div></div>
}

function Card({ title, metas, badge, take, children }: { title: string; metas: LayerMeta[]; badge?: CellLayer; take: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = `fc-info-${title.replace(/\W+/g, '-')}`
  const sig = badge?.p_value != null ? badge.p_value < 0.05 : null
  return (
    <div className="fc-card">
      <div className="fc-top">
        <p className="fc-title">{title}</p>
        <span className="fc-actions">
          {sig != null && <span className={`fc-badge${sig ? ' is-sig' : ''}`}>{sig ? '✓ Significant trend' : 'No significant trend'}</span>}
          <button type="button" className="fc-info" aria-expanded={open} aria-controls={id} aria-label={`About "${title}": description, source, method, status`} title="About this chart" onClick={() => setOpen(!open)}>i</button>
        </span>
      </div>
      {open && (
        <div id={id} className="fc-infobox">
          {metas.map((m) => (
            <div key={m.label}>
              <b>{m.label}.</b> {m.description}
              <div>Source: {m.source} <StatusChip status={m.status} source={m.source} />{m.status === 'estimate' && ' (method choices are ours)'}</div>
            </div>
          ))}
          {metas.some((m) => m.kind !== 'frost') && <div>Trend line: Theil-Sen slope; significance: Mann-Kendall test, significant when p &lt; 0.05. Years with missing days are skipped, never filled.</div>}
        </div>
      )}
      {children}
      <p className="fc-take">{take}</p>
    </div>
  )
}

function Charts({ doc, cellId }: { doc: LayersDoc; cellId: string }) {
  const rec = doc.cells[cellId]
  const [thr, setThr] = useState('t0')
  if (!rec) return <p className="fc-msg">No risk statistics for this cell yet (its NASA POWER series has not been processed).</p>
  const years = Array.from({ length: doc.years[1] - doc.years[0] + 1 }, (_, i) => doc.years[0] + i)
  const L = (id: string) => rec[id] as CellLayer | undefined
  const M = (id: string) => doc.layers[id]
  const ok = (c?: CellLayer): c is CellLayer => !!c && c.value != null && !!c.y
  const disabled = Object.values(doc.layers).filter((m) => m.disabled)

  const timeCard = (id: string, title: string, what: string, unit: string, dec: number, color: string, kind: 'bar' | 'line', words: [string, string], tUnit: string, extra?: string, td = 2) => {
    const c = L(id)
    if (!ok(c)) return <Card key={id} title={title} metas={[M(id)]} take="Not enough valid years (at least 20 needed) for this chart."><p className="fc-msg">{what}</p></Card>
    return (
      <Card key={id} title={title} metas={[M(id)]} badge={c} take={`${takeaway(c, words, tUnit, td)}${extra ?? ''}`}>
        <TimeChart years={years} unit={unit} decimals={dec} label={`${title}. ${what}`} mean={c.value} meanLabel={`${years.length}-yr mean`} line={c.line}
          series={[{ name: what, vals: c.y!, kind, color }]} />
      </Card>
    )
  }

  const hot32 = L('hot32'), hot35 = L('hot35'), heavyShare = L('heavy_share')
  const frostLast = (rec.frost_last as Record<string, FrostEntry | null> | undefined)?.[thr]
  const frostFirst = (rec.frost_first as Record<string, FrostEntry | null> | undefined)?.[thr]
  const frostSeason = (rec.frost_season as Record<string, FrostEntry | null> | undefined)?.[thr]
  const ly = (rec.frost_last_y as Record<string, (number | null)[]> | undefined)?.[thr]
  const fy = (rec.frost_first_y as Record<string, (number | null)[]> | undefined)?.[thr]
  const tLabel = M('frost_last')?.thresholds?.[thr]
  const frostMetas = ['frost_last', 'frost_first', 'frost_season'].map(M).filter(Boolean)

  return (
    <>
      <Group title="Temperature">
        {timeCard('temp_trend', 'Yearly mean temperature', 'Mean air temperature of each year', '°C', 1, HEAT, 'line', ['Warmer', 'Cooler'], '°C')}
      </Group>
      <Group title="Rain">
        {timeCard('precip_trend', 'Yearly rain', 'Total rain of each year', 'mm per year', 0, RAIN, 'bar', ['Wetter', 'Drier'], 'mm', undefined, 1)}
        {timeCard('precip_summer_trend', 'Summer rain (Jun–Aug)', 'Rain in June to August of each year', 'mm per summer', 0, RAIN, 'bar', ['Wetter', 'Drier'], 'mm', undefined, 1)}
      </Group>
      <Group title="Water">
        {timeCard('water_balance', 'Growing-season water balance (Apr–Sep)', 'Rain minus reference evapotranspiration, April to September', 'mm (rain − ETo)', 0, RAIN, 'bar', ['Wetter', 'Drier'], 'mm', ' Below zero means the air asks for more water than rain supplies.', 1)}
      </Group>
      <Group title="Extremes">
        {ok(hot32) ? (
          <Card title="Hot days per summer" metas={[M('hot32'), M('hot35')]} badge={hot32}
            take={`${takeaway(hot32, ['More', 'Fewer'], 'days', 1).replace(/^(\w+) by/, '$1 days ≥ 32 °C by')} Average ${fmt(hot32.value!, 1)} days ≥ 32 °C${hot35?.value != null ? ` and ${fmt(hot35.value, 1)} days ≥ 35 °C` : ''} per summer.`}>
            <TimeChart years={years} unit="days per summer (Jun–Aug)" decimals={0} label="Days per summer with maximum temperature at or above 32 and 35 °C" mean={hot32.value} meanLabel="mean ≥32 °C" line={hot32.line}
              series={[{ name: 'Tmax ≥ 32 °C', vals: hot32.y!, kind: 'bar', color: HEAT }, { name: 'Tmax ≥ 35 °C', vals: hot35?.y ?? [], kind: 'bar', color: HEAT_STRONG, narrow: true }]} />
          </Card>
        ) : <Card title="Hot days per summer" metas={[M('hot32')]} take="Not enough valid years for this chart."><p className="fc-msg">Days at or above 32 °C and 35 °C.</p></Card>}
        {timeCard('heavy_days', 'Heavy-rain days per year', 'Days with rain above this cell’s own 95th percentile of wet-day rain', 'days per year', 0, RAIN, 'bar', ['More', 'Fewer'], 'days',
          heavyShare?.value != null ? ` On average ${fmt(heavyShare.value, 1)} % of yearly rain falls on such days.` : undefined, 1)}
      </Group>
      <Group title="Frost">
        <Card title="Frost dates and frost-free season" metas={frostMetas}
          take={frostSeason ? `About ${frostSeason.days} frost-free days between the median last and first frost.${frostSeason.capped ? ' One side is counted as the window edge (no median frost).' : ''}` : 'Not enough valid years for frost dates at this threshold.'}>
          <div role="radiogroup" aria-label="Frost threshold" className="fc-seg">
            {THRESHOLD_ORDER.map((k) => <button key={k} type="button" role="radio" aria-checked={thr === k} className="fc-segbtn" onClick={() => setThr(k)}>Tmin ≤ {M('frost_last')?.thresholds?.[k]}</button>)}
          </div>
          <FrostChart last={frostLast} first={frostFirst} lastY={ly} firstY={fy} thr={tLabel ?? thr} />
          <FrostText last={frostLast} first={frostFirst} t={tLabel} />
        </Card>
      </Group>
      {disabled.length > 0 && <p className="fc-note">{disabled.map((m) => m.label).join(' and ')}: not available yet. They need SRTM slope and MODIS NDVI from NASA Earthdata (AppEEARS, account required). No proxy is shown.</p>}
    </>
  )
}

function FrostText({ last, first, t }: { last: FrostEntry | null | undefined; first: FrostEntry | null | undefined; t?: string }) {
  const f = (e: FrostEntry | null | undefined, none: string) => (e ? (['d10', 'd50', 'd90'] as const).map((k) => `${k.slice(1)} %: ${e[k] == null ? none : doy(e[k]!)}`).join(' · ') : 'not enough valid years')
  return (
    <ul className="fc-frost-list">
      <li><b>Last spring frost</b> (10 / 50 / 90 % dates): {f(last, 'no frost by then')}. Frost at or below {t} occurred in {last?.n_frost ?? '–'} of {last?.n_years ?? '–'} years. 90 % date: by then 9 in 10 years have had their last spring frost.</li>
      <li><b>First autumn frost</b>: {f(first, 'frost-free through December')}. Frost at or below {t} occurred in {first?.n_frost ?? '–'} of {first?.n_years ?? '–'} years.</li>
    </ul>
  )
}