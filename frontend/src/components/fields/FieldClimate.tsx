// Per-field climate summary and historical climate-risk statistics of the field's NASA POWER grid cell.
// Data: public/data/grid.json cell (passed in) and public/data/grid_layers.json (built by pipeline/build_layers.py).
import { useEffect, useState, type ReactNode } from 'react'
import type { GridCell } from '../../types'
import Sparkline from '../Sparkline'
import StatusChip from '../StatusChip'
import { THRESHOLD_ORDER, doyLabel, type CellLayer, type FrostEntry, type LayerMeta, type LayersDoc } from './climate/types'
import './climate/climate.css'

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; doc: LayersDoc }
let cache: Promise<LayersDoc> | null = null
const loadDoc = () => (cache ??= fetch('/data/grid_layers.json').then((r) => { if (!r.ok) throw new Error('missing'); return r.json() }).catch((e) => { cache = null; throw e }))

const GRID_SOURCE = 'NASA POWER daily, community AG, 1991-2025 (MERRA-2 grid, 0.5 x 0.625 deg); ETo = FAO-56 Penman-Monteith (core/eto.py); tmean = (Tmax+Tmin)/2; a year with any missing day is skipped'
const fmt = (v: number, d: number) => v.toLocaleString('en', { maximumFractionDigits: d, minimumFractionDigits: d })
const mean = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN }
const digits = (v: number) => (Math.abs(v) < 100 ? 1 : 0)

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

  const precip = cell.precip_mm.filter((x): x is number => x != null)
  const n = precip.length
  return (
    <section className="fc" aria-label="Climate and risks">
      {head}
      <div className="fc-grid">
        <div className="fc-card fc-card-wide">
          <div className="fc-top"><p className="fc-title">Climate summary ({n} complete years)</p><StatusChip status="data" source={GRID_SOURCE} /></div>
          <div className="fc-stats">
            <Stat label="Precipitation" v={mean(cell.precip_mm)} d={0} unit="mm / yr" />
            <Stat label="Reference ET₀" v={mean(cell.eto_mm)} d={0} unit="mm / yr" />
            <Stat label="Mean temperature" v={mean(cell.tmean_c)} d={1} unit="°C" />
            <Stat label="July Tmax" v={mean(cell.july_tmax_c)} d={1} unit="°C" />
            <Stat label="Elevation" v={cell.elevation_m} d={0} unit="m" />
          </div>
          {n > 1 && <Sparkline values={precip} label="Annual precipitation, 1991–2025" height={48} />}
          <p className="fc-note">Annual precipitation by year. ET₀ is the water a well-watered grass surface would use (FAO-56 Penman-Monteith).</p>
        </div>
        {load.state === 'loading' && <p className="fc-msg" aria-busy="true">Loading climate risks…</p>}
        {load.state === 'error' && <p className="fc-msg fc-err fc-card-wide" role="alert">Climate risks are not available: <code>grid_layers.json</code> was not found. Run <code>python -m pipeline.build_layers</code> in <code>backend/</code>.</p>}
        {load.state === 'ready' && <Risks doc={load.doc} cellId={cell.id} />}
      </div>
    </section>
  )
}

function Stat({ label, v, d, unit }: { label: string; v: number; d: number; unit: string }) {
  return <div><div className="fc-label">{label}</div><div className="fc-val">{Number.isNaN(v) ? '–' : fmt(v, d)} <span className="fc-label">{unit}</span></div></div>
}

function Risks({ doc, cellId }: { doc: LayersDoc; cellId: string }) {
  const rec = doc.cells[cellId]
  const entries = Object.entries(doc.layers).filter(([, m]) => !m.disabled && m.kind !== 'frost')
  const groups = [...new Set(entries.map(([, m]) => m.group))]
  const disabled = Object.values(doc.layers).filter((m) => m.disabled)
  if (!rec) return <p className="fc-msg fc-card-wide">No risk statistics for this cell yet (its NASA POWER series has not been processed).</p>
  return (
    <>
      {groups.map((g) => {
        const items = entries.filter(([, m]) => m.group === g)
        return (
          <Card key={g} title={g} metas={items.map(([, m]) => m)} alpha={doc.alpha}>
            {items.map(([id, m]) => <LayerRow key={id} m={m} c={rec[id] as CellLayer | undefined} alpha={doc.alpha} />)}
          </Card>
        )
      })}
      <FrostCard doc={doc} rec={rec} />
      {disabled.length > 0 && (
        <p className="fc-note fc-card-wide"><b>{disabled.map((m) => m.label).join(' and ')}</b>: not available yet. They need SRTM slope and MODIS NDVI from NASA Earthdata (AppEEARS, account required). NASA POWER cannot measure them, and no proxy is shown.</p>
      )}
    </>
  )
}

function Card({ title, metas, alpha, children }: { title: string; metas: LayerMeta[]; alpha: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = `fc-info-${title.replace(/\W+/g, '-')}`
  return (
    <div className="fc-card">
      <div className="fc-top">
        <p className="fc-title">{title}</p>
        <button type="button" className="fc-info" aria-expanded={open} aria-controls={id} aria-label={`About ${title}: description, source, method, status`} title="About these numbers" onClick={() => setOpen(!open)}>i</button>
      </div>
      {open && (
        <div id={id} className="fc-infobox">
          {metas.map((m) => (
            <div key={m.label}>
              <b>{m.label}.</b> {m.description}
              <div>Source: {m.source} <StatusChip status={m.status} source={m.source} />{m.status === 'estimate' && ' (method choices are ours)'}</div>
            </div>
          ))}
          {metas.some((m) => m.kind !== 'frost' && m.trend_unit) && <div>Trends: Theil-Sen slope, Mann-Kendall test; significant when p &lt; {alpha}.</div>}
        </div>
      )}
      {children}
    </div>
  )
}

function LayerRow({ m, c, alpha }: { m: LayerMeta; c: CellLayer | undefined; alpha: number }) {
  if (!c || c.value == null || c.trend == null || c.p_value == null) {
    return <div className="fc-row"><span className="fc-label">{m.label}</span><span className="fc-sig">Not enough valid years{c ? ` (${c.n_years}, need 20)` : ''}.</span></div>
  }
  const sig = c.p_value < alpha
  const d = digits(c.value)
  return (
    <div className="fc-row">
      <span className="fc-label">{m.label}</span>
      <span className="fc-val">{fmt(c.value, d)} <span className="fc-label">{m.unit} (mean)</span></span>
      <span className={`fc-sig${sig ? ' is-sig' : ''}`}>
        Trend {c.trend > 0 ? '+' : ''}{fmt(c.trend, 2)} {m.trend_unit}: {sig ? 'significant trend' : 'no significant trend'} (p = {fmt(c.p_value, c.p_value < 0.001 ? 3 : 2)}), {c.n_years} years
      </span>
    </div>
  )
}

function FrostCard({ doc, rec }: { doc: LayersDoc; rec: LayersDoc['cells'][string] }) {
  const [thr, setThr] = useState('t0')
  const metas = (['frost_last', 'frost_first', 'frost_season'] as const).map((k) => doc.layers[k]).filter(Boolean)
  if (!metas.length) return null
  const get = (k: string) => (rec[k] as Record<string, FrostEntry | null> | undefined)?.[thr]
  const last = get('frost_last'), first = get('frost_first'), season = get('frost_season')
  const t = doc.layers.frost_last.thresholds?.[thr]
  const date = (e: FrostEntry | null | undefined, none: string) => (e ? (['d10', 'd50', 'd90'] as const).map((k) => `${k.slice(1)} %: ${e[k] == null ? none : doyLabel(e[k]!)}`).join(' · ') : null)
  return (
    <Card title="Frost dates" metas={metas} alpha={doc.alpha}>
      <div role="radiogroup" aria-label="Frost threshold" className="fc-seg">
        {THRESHOLD_ORDER.map((k) => <button key={k} type="button" role="radio" aria-checked={thr === k} className="fc-segbtn" onClick={() => setThr(k)}>Tmin ≤ {doc.layers.frost_last.thresholds?.[k]}</button>)}
      </div>
      <div className="fc-row"><span className="fc-label">Last spring frost (dates at 10 / 50 / 90 % of years)</span>
        <span className="fc-val">{date(last, 'no frost by then') ?? 'Not enough valid years'}</span>
        {last && <span className="fc-sig">Frost at or below {t} occurred in {last.n_frost} of {last.n_years} years. 90 % date: by then 9 in 10 years have had their last spring frost.</span>}</div>
      <div className="fc-row"><span className="fc-label">First autumn frost</span>
        <span className="fc-val">{date(first, 'frost-free through December') ?? 'Not enough valid years'}</span>
        {first && <span className="fc-sig">Frost at or below {t} occurred in {first.n_frost} of {first.n_years} years.</span>}</div>
      <div className="fc-row"><span className="fc-label">Frost-free season (median dates)</span>
        <span className="fc-val">{season ? `${season.days} days` : 'Not enough valid years'}</span>
        {season?.capped && <span className="fc-sig">The median year has no frost on one side; that side is counted as the window edge (1 Jan / 31 Dec).</span>}</div>
    </Card>
  )
}
