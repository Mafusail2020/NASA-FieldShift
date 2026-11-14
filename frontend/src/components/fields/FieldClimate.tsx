// Per-field climate summary and historical climate-risk charts of the field's NASA POWER grid cell.
// Data: public/data/grid.json cell (passed in) and public/data/grid_layers.json (built by pipeline/build_layers.py).
// Order: the numbers, then the charts as evidence (water, then heat and frost). The plain findings are in FieldGlance, above this panel.
import { useState, type ReactNode } from 'react'
import type { GridCell } from '../../types'
import StatusChip from '../StatusChip'
import { Decades, DRY, DRY_STRONG, FrostChart, HEAT, HEAT_STRONG, RAIN, RAIN_DEEP, RAIN_SOFT, TimeChart, fmt, worstIdx, type Series } from './climate/charts'
import { THRESHOLD_ORDER, doyLabel as doy, type CellLayer, type FrostEntry, type LayerMeta, type LayersDoc } from './climate/types'
import { clear, mean, ok, round10, useLayersDoc, yearsOf } from './climate/util'
import './climate/climate.css'

const GRID_SOURCE = 'NASA POWER daily, community AG, 1991-2025 (MERRA-2 grid, 0.5 x 0.625 deg); ETo = FAO-56 Penman-Monteith (core/eto.py); tmean = (Tmax+Tmin)/2; a year with any missing day is skipped'
const FROST_NAMES: Record<string, string> = { t0: 'Light frost', t2: 'Moderate frost', t4: 'Hard frost' }
const sign = (v: number, d: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), d)}`

// Fixed sentence templates, filled from computed numbers only. `subject` goes after the direction word ("More days above 32 °C by ...").
function takeaway(c: CellLayer, words: [string, string], unit: string, d = 2, subject?: string): string {
  if (c.trend == null || c.p_value == null) return 'Not enough valid years for a trend.'
  if (c.p_value < 0.05) return `${c.trend > 0 ? words[0] : words[1]}${subject ? ` ${subject}` : ''} by ${fmt(Math.abs(c.trend), d)} ${unit} per decade. A clear trend, not chance.`
  return `No clear trend: ${c.trend > 0 ? '+' : ''}${fmt(c.trend, d)} ${unit} per decade is within normal year-to-year swings.`
}

// One sentence for the yearly total and the growing-season part; spelled out separately only when one of them has a clear trend.
function rainTake(y: CellLayer, g: CellLayer | null): string {
  const w: [string, string] = ['Wetter', 'Drier']
  if (!g) return takeaway(y, w, 'mm', 1)
  if (!clear(y) && !clear(g) && y.trend != null && g.trend != null) {
    return `No clear trend in yearly rain (${sign(y.trend, 1)} mm per decade) or Apr–Sep rain (${sign(g.trend, 1)} mm per decade): within normal year-to-year swings.`
  }
  return `Whole year: ${takeaway(y, w, 'mm', 1)} Apr–Sep: ${takeaway(g, w, 'mm', 1)}`
}

export function FieldClimate({ cell }: { cell: GridCell | null }) {
  const load = useLayersDoc()

  const head = (
    <div className="fc-head">
      <h3>Climate and risks</h3>
      <p>Historical 1991–2025 statistics of reanalysis data (MERRA-2 via NASA POWER) for a ~50 km grid cell, not a forecast and not one field. A trend is called clear when chance alone is unlikely to explain it (statistical test, p &lt; 0.05; details under the i button). Charts show a trend line only when the trend is clear.</p>
    </div>
  )
  if (!cell) return <section className="fc">{head}<p className="fc-msg">Enter the field's latitude and longitude (inside Ukraine) to see its climate and risks.</p></section>
  return (
    <section className="fc" aria-label="Climate and risks">
      {head}
      {load.state === 'ready' ? <Charts doc={load.doc} cell={cell} /> : <Summary cell={cell} />}
      {load.state === 'loading' && <p className="fc-msg" aria-busy="true">Loading climate charts…</p>}
      {load.state === 'error' && <p className="fc-msg fc-err" role="alert">Climate charts are not available: <code>grid_layers.json</code> was not found. Run <code>python -m pipeline.build_layers</code> in <code>backend/</code>.</p>}
    </section>
  )
}

function Summary({ cell, tempTrend }: { cell: GridCell; tempTrend?: CellLayer }) {
  const n = cell.precip_mm.filter((x) => x != null).length
  const rain = mean(cell.precip_mm), eto = mean(cell.eto_mm)
  const items: { label: string; v: number; d: number; unit: string; sub?: string }[] = [
    { label: 'Rain', v: rain, d: 0, unit: 'mm / yr' },
    { label: 'Reference ET₀', v: eto, d: 0, unit: 'mm / yr' },
    { label: 'Yearly shortfall', v: rain - eto, d: 0, unit: 'mm / yr', sub: 'rain minus ET₀' },
    { label: 'Mean temperature', v: mean(cell.tmean_c), d: 1, unit: '°C', sub: tempTrend?.trend != null ? (clear(tempTrend) ? `${sign(tempTrend.trend, 2)} °C per decade` : 'no clear trend') : undefined },
    { label: 'July Tmax', v: mean(cell.july_tmax_c), d: 1, unit: '°C' },
  ]
  return (
    <div className="fc-card">
      <div className="fc-top"><p className="fc-title">Climate summary: averages of {n} complete years</p><StatusChip status="data" source={GRID_SOURCE} /></div>
      <div className="fc-stats">
        {items.map((it) => (
          <div key={it.label}>
            <div className="fc-label">{it.label}</div>
            <div className="fc-val">{Number.isNaN(it.v) ? '–' : it.label === 'Yearly shortfall' ? sign(it.v, 0) : fmt(it.v, it.d)} <span className="fc-label">{it.unit}</span></div>
            {it.sub && <span className="fc-stat-sub">{it.sub}</span>}
          </div>
        ))}
      </div>
      <p className="fc-note">ET₀ is the water a well-watered grass surface would use (FAO-56 Penman-Monteith). A negative shortfall means the air asks for more water than rain supplies over the year.</p>
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
          {sig != null && <span className={`fc-badge${sig ? ' is-sig' : ''}`}>{sig ? '✓ Clear trend' : 'No clear trend'}</span>}
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
          {metas.some((m) => m.kind !== 'frost') && <div>Trend line: Theil-Sen slope; significance: Mann-Kendall test; shown as a clear trend when p &lt; 0.05. Years with missing days are skipped, never filled.</div>}
        </div>
      )}
      {children}
      <p className="fc-take">{take}</p>
    </div>
  )
}

function Charts({ doc, cell }: { doc: LayersDoc; cell: GridCell }) {
  const rec = doc.cells[cell.id]
  const [thr, setThr] = useState('t0')
  if (!rec) return <><Summary cell={cell} /><p className="fc-msg">No risk statistics for this cell yet (its NASA POWER series has not been processed).</p></>
  const years = yearsOf(doc)
  const L = (id: string) => rec[id] as CellLayer | undefined
  const M = (id: string) => doc.layers[id]
  const disabled = Object.values(doc.layers).filter((m) => m.disabled)
  const trendLine = (c: CellLayer) => (clear(c) ? c.line : null)   // a trend line is drawn only where there is a trend

  const temp = L('temp_trend'), hot32 = L('hot32'), hot35 = L('hot35'), heavyShare = L('heavy_share'), heavyDays = L('heavy_days')
  const wb = L('water_balance'), rainY = L('precip_trend'), rainG = L('precip_growing_trend')
  const dryYears = ok(wb) ? worstIdx(wb.y!, 'low').map((i) => years[i]) : []   // the driest growing seasons, flagged on both water charts

  // ---- charts ----
  type CardOpts = {
    id: string; title: string; what: string; unit: string; dec: number; color: string; kind: 'bar' | 'line'; words: [string, string]; tUnit: string
    lead?: string; extra?: string; td?: number; neg?: { color: string; pos: string; neg: string }
    worst?: { side: 'low' | 'high'; color: string; label: string }; marks?: { years: number[]; color: string; label: string }; meanLabel?: string
  }
  const timeCard = (o: CardOpts) => {
    const c = L(o.id)
    if (!ok(c)) return <Card key={o.id} title={o.title} metas={[M(o.id)]} take="Not enough valid years (at least 20 needed) for this chart."><p className="fc-msg">{o.what}</p></Card>
    return (
      <Card key={o.id} title={o.title} metas={[M(o.id)]} badge={c} take={`${o.lead ? `${o.lead} ` : ''}${takeaway(c, o.words, o.tUnit, o.td ?? 2)}${o.extra ?? ''}`}>
        <TimeChart years={years} unit={o.unit} decimals={o.dec} label={`${o.title}. ${o.what}`} mean={c.value} meanLabel={o.meanLabel ?? `${years.length}-yr mean`} line={trendLine(c)}
          worst={o.worst} marks={o.marks}
          series={[{ name: o.what, vals: c.y!, kind: o.kind, color: o.color, ...(o.neg ? { negColor: o.neg.color, posLabel: o.neg.pos, negLabel: o.neg.neg } : {}) }]} />
      </Card>
    )
  }

  const waterCard = timeCard({
    id: 'water_balance', title: 'Growing-season water balance (Apr–Sep)', what: 'Rain minus reference evapotranspiration, April to September', unit: 'mm (rain − ETo)', dec: 0, color: RAIN, kind: 'bar',
    words: ['Wetter', 'Drier'], tUnit: 'mm', td: 1, neg: { color: DRY, pos: 'Rain covers the need', neg: 'Water shortage' },
    worst: { side: 'low', color: DRY_STRONG, label: 'Driest 10 % of seasons' },
    lead: ok(wb) && wb.value != null
      ? `In a typical Apr–Sep season a well-watered crop would use about ${round10(Math.abs(wb.value))} mm ${wb.value < 0 ? 'more' : 'less'} water than rain supplies.`
      : undefined,
  })

  const rainCard = () => {
    if (!ok(rainY)) return <Card key="rain" title="Rain per year" metas={[M('precip_trend')]} take="Not enough valid years (at least 20 needed) for this chart."><p className="fc-msg">Total rain of each year.</p></Card>
    const grow = ok(rainG) ? rainG.y! : null
    const series: Series[] = grow
      ? [
        { name: 'Apr–Sep (growing season)', vals: grow, kind: 'bar', color: RAIN_DEEP, stack: 'rain' },
        { name: 'Rest of the year', vals: rainY.y!.map((v, i) => (v != null && grow[i] != null ? Math.max(0, v - grow[i]!) : null)), kind: 'bar', color: RAIN_SOFT, stack: 'rain' },
      ]
      : [{ name: 'Total rain', vals: rainY.y!, kind: 'bar', color: RAIN_DEEP }]
    const share = grow && rainG!.value != null && rainY.value ? ` ${fmt((100 * rainG!.value) / rainY.value, 0)} % of the yearly rain falls in April to September.` : ''
    const metas = grow ? [M('precip_trend'), M('precip_growing_trend')] : [M('precip_trend')]
    return (
      <Card key="rain" title="Rain per year (mm)" metas={metas} badge={rainY}
        take={`${rainTake(rainY, grow ? rainG! : null)}${share}${dryYears.length ? ' Triangles mark the driest growing seasons from the chart above.' : ''}`}>
        <TimeChart years={years} unit="mm per year" decimals={0} label="Rain of each year in mm, split into April to September and the rest of the year" mean={rainY.value} meanLabel={`${years.length}-yr mean`}
          line={trendLine(rainY)} series={series} marks={dryYears.length ? { years: dryYears, color: DRY_STRONG, label: 'Driest growing seasons (water balance)' } : undefined} />
      </Card>
    )
  }

  const heavyThr = heavyDays?.threshold_mm
  const heavyWhat = heavyThr != null ? `Days with more than ${fmt(heavyThr, 1)} mm of rain` : 'Days with rain above this cell’s own 95th percentile of wet-day rain'
  const heavyBlock = ok(heavyDays) && !clear(heavyDays)
    // nothing changed: one sentence instead of a chart
    ? <p key="heavy" className="fc-quiet"><b>Heavy rain:</b> about {fmt(heavyDays.value!, 0)} days a year with more than {heavyThr != null ? `${fmt(heavyThr, 1)} mm` : 'this cell’s 95th-percentile rain'}{heavyShare?.value != null ? `, carrying ${fmt(heavyShare.value, 0)} % of the yearly rain` : ''}. {takeaway(heavyDays, ['More', 'Fewer'], 'days', 1)}</p>
    : timeCard({ id: 'heavy_days', title: 'Heavy-rain days per year', what: heavyWhat, unit: 'days per year', dec: 0, color: RAIN, kind: 'bar', words: ['More', 'Fewer'], tUnit: 'days', td: 1,
      extra: heavyShare?.value != null ? ` On average ${fmt(heavyShare.value, 1)} % of yearly rain falls on such days.` : undefined })

  const tempCard = timeCard({
    id: 'temp_trend', title: 'Yearly mean temperature', what: 'Mean air temperature of each year', unit: '°C', dec: 1, color: HEAT, kind: 'line', words: ['Warmer', 'Cooler'], tUnit: '°C',
    extra: ok(temp) && clear(temp) && temp.line ? ` About ${fmt(Math.abs(temp.line[1] - temp.line[0]), 1)} °C ${temp.line[1] > temp.line[0] ? 'warmer' : 'cooler'} than the early 1990s (${fmt(temp.line[0], 1)} → ${fmt(temp.line[1], 1)} °C on the trend line).` : undefined,
  })

  const hotCard = ok(hot32) ? (
    <Card key="hot" title="Days above 32 °C and 35 °C per summer (Jun–Aug)" metas={[M('hot32'), M('hot35')]} badge={hot32}
      take={`${takeaway(hot32, ['More', 'Fewer'], 'days', 1, 'days above 32 °C')} Average ${fmt(hot32.value!, 1)} days above 32 °C${hot35?.value != null ? ` and ${fmt(hot35.value, 1)} days above 35 °C` : ''} per summer.`}>
      <TimeChart years={years} unit="days per summer (Jun–Aug)" decimals={0} label="Days per summer with maximum temperature above 32 and 35 °C" mean={hot32.value} meanLabel="mean above 32 °C" line={trendLine(hot32)}
        series={[{ name: 'Above 32 °C', vals: hot32.y!, kind: 'bar', color: HEAT }, { name: 'Above 35 °C', vals: hot35?.y ?? [], kind: 'bar', color: HEAT_STRONG, narrow: true }]} />
      <p className="fc-note">Average days above 32 °C per summer, by decade:</p>
      <Decades years={years} vals={hot32.y!} decimals={1} unit="days above 32 °C per summer" />
    </Card>
  ) : <Card key="hot" title="Days above 32 °C and 35 °C per summer" metas={[M('hot32')]} take="Not enough valid years for this chart."><p className="fc-msg">Days above 32 °C and 35 °C.</p></Card>

  const frostLast = (rec.frost_last as Record<string, FrostEntry | null> | undefined)?.[thr]
  const frostFirst = (rec.frost_first as Record<string, FrostEntry | null> | undefined)?.[thr]
  const frostSeason = (rec.frost_season as Record<string, FrostEntry | null> | undefined)?.[thr]
  const ly = (rec.frost_last_y as Record<string, (number | null)[]> | undefined)?.[thr]
  const fy = (rec.frost_first_y as Record<string, (number | null)[]> | undefined)?.[thr]
  const tLabel = M('frost_last')?.thresholds?.[thr]
  const frostMetas = ['frost_last', 'frost_first', 'frost_season'].map(M).filter(Boolean)
  const safeA = frostLast?.d90, safeB = frostFirst?.d10
  const frostTake = frostSeason
    ? `Typical frost-free season: ${frostLast?.d50 != null ? doy(frostLast.d50) : 'before Jan 1'} to ${frostFirst?.d50 != null ? doy(frostFirst.d50) : 'after Dec 31'}, about ${frostSeason.days} days.${safeA != null && safeB != null && safeB > safeA ? ` Safe window, free of frost in 9 years out of 10: ${doy(safeA)} to ${doy(safeB)}, about ${safeB - safeA} days.` : ''}${frostSeason.capped ? ' One side is counted as the window edge (no median frost).' : ''}`
    : 'Not enough valid years for frost dates at this threshold.'
  const censored = [frostLast, frostFirst].some((e) => e && [e.d10, e.d50, e.d90].some((d) => d == null))

  return (
    <>
      <Summary cell={cell} tempTrend={temp} />
      <Group title="Water">
        {waterCard}
        {rainCard()}
        {heavyBlock}
      </Group>
      <Group title="Heat and frost">
        {tempCard}
        {hotCard}
        <Card title="Frost dates and frost-free season" metas={frostMetas} take={frostTake}>
          <div role="radiogroup" aria-label="Frost threshold" className="fc-seg">
            {THRESHOLD_ORDER.map((k) => <button key={k} type="button" role="radio" aria-checked={thr === k} className="fc-segbtn" onClick={() => setThr(k)}>{FROST_NAMES[k] ?? k} · {M('frost_last')?.thresholds?.[k]}</button>)}
          </div>
          <FrostChart last={frostLast} first={frostFirst} lastY={ly} firstY={fy} thr={tLabel ?? thr} />
          <p className="fc-note">
            Each bar spans the 10 % to 90 % dates, the black tick is the median, dots are single years.{censored ? ' Dashed line: no frost in that part of the year.' : ''}
            {' '}Frost at or below {tLabel} came in {frostLast?.n_frost ?? '–'} of {frostLast?.n_years ?? '–'} springs and {frostFirst?.n_frost ?? '–'} of {frostFirst?.n_years ?? '–'} autumns.
          </p>
        </Card>
      </Group>
      {disabled.length > 0 && <p className="fc-note">{disabled.map((m) => m.label).join(' and ')}: not available yet. They need SRTM slope and MODIS NDVI from NASA Earthdata (AppEEARS, account required). No proxy is shown.</p>}
    </>
  )
}
