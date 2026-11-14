// "At a glance" for one field: six tiles and one plain sentence, before the detailed charts.
// Data: grid_layers.json (the field's NASA POWER cell), grid_soil.json and rotations_grid.json (soil water). All values are computed here from those files.
import { useId } from 'react'
import type { GridCell } from '../../types'
import type { FieldItem } from '../../lib/field'
import { fmt } from './climate/charts'
import { doyLabel } from './climate/types'
import type { CellLayer, FrostEntry } from './climate/types'
import { clear, decadeMean, ok, round10, useLayersDoc, yearsOf } from './climate/util'
import { useGridSoil, useRotIndex, type Soil } from './rotation/model'
import './climate/climate.css'

const DRY_SHARE = 0.8   // a "dry season" has Apr-Sep rain below this share of the cell's own average (our definition, not a standard)
const sign = (v: number, d: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), d)}`

interface Tile { key: string; kind: 'heat' | 'water' | 'dry' | 'frost' | 'soil'; label: string; value: string; unit?: string; sub: string; note?: string; source: string }

export function FieldGlance({ field, cell }: { field: FieldItem; cell: GridCell | null }) {
  const uid = useId()
  const load = useLayersDoc()
  const gs = useGridSoil()
  const idx = useRotIndex()
  if (!cell || load.state === 'error') return null
  const rec = load.state === 'ready' ? load.doc.cells[cell.id] : undefined
  if (load.state === 'loading') return <section className="fg" aria-busy="true" aria-labelledby={`${uid}h`}><h3 id={`${uid}h`}>At a glance</h3><p className="fc-msg">Loading…</p></section>
  if (!rec) return null

  const doc = load.doc, years = yearsOf(doc)
  const L = (id: string) => rec[id] as CellLayer | undefined
  const temp = L('temp_trend'), hot32 = L('hot32'), wb = L('water_balance'), grow = L('precip_growing_trend')
  const SRC = 'NASA POWER daily, 1991-2025 (MERRA-2), ~50 km cell'
  const tiles: Tile[] = []

  if (ok(temp) && temp.trend != null) {
    tiles.push(clear(temp) && temp.line
      ? { key: 'warm', kind: 'heat', label: 'Warming', value: `${sign(temp.trend, 2)} °C`, unit: 'per decade', sub: `about ${fmt(temp.line[1] - temp.line[0], 1)} °C warmer than the early 1990s`, source: SRC }
      : { key: 'warm', kind: 'heat', label: 'Warming', value: 'No clear change', sub: `yearly mean ${fmt(temp.value!, 1)} °C`, source: SRC })
  }
  if (ok(hot32)) {
    const a = decadeMean(years, hot32, 1991, 1999), b = decadeMean(years, hot32, 2020, 2029)
    tiles.push({
      key: 'hot', kind: 'heat', label: 'Hot days', value: Number.isNaN(b) ? fmt(hot32.value!, 0) : fmt(b, 0), unit: 'days per summer above 32 °C',
      sub: Number.isNaN(a) || Number.isNaN(b) ? 'average of all years' : `in the 2020s, against ${fmt(a, 0)} in the 1990s`,
      note: clear(hot32) ? (hot32.trend! > 0 ? 'Clear rise' : 'Clear fall') : 'No clear trend', source: SRC,
    })
  }
  if (ok(grow) && grow.value != null) {
    const ys = grow.y!.filter((v): v is number => v != null)
    const dry = ys.filter((v) => v < DRY_SHARE * grow.value!).length
    tiles.push({ key: 'dry', kind: 'water', label: 'Dry seasons', value: `${dry} of ${ys.length}`, sub: `April to September with less than ${Math.round(DRY_SHARE * 100)} % of the average rain (${fmt(grow.value, 0)} mm)`, source: `${SRC}; the 80 % limit is our own definition` })
  }
  if (ok(wb) && wb.value != null) {
    tiles.push({
      key: 'short', kind: 'dry', label: wb.value < 0 ? 'Water shortage' : 'Water surplus', value: `${sign(round10(wb.value), 0)}`, unit: 'mm in a typical Apr–Sep',
      sub: 'rain minus the water a well-watered crop would use', note: clear(wb) ? (wb.trend! < 0 ? 'Clear worsening' : 'Clear easing') : 'No clear trend', source: `${SRC}; the season is our choice, not crop-specific`,
    })
  }
  const fl = (rec.frost_last as Record<string, FrostEntry | null> | undefined)?.t0, ff = (rec.frost_first as Record<string, FrostEntry | null> | undefined)?.t0
  if (fl?.d90 != null && ff?.d10 != null && ff.d10 > fl.d90) {
    tiles.push({ key: 'frost', kind: 'frost', label: 'Frost-free window', value: `${ff.d10 - fl.d90} days`, sub: `${doyLabel(fl.d90)} to ${doyLabel(ff.d10)}, free of frost (0 °C) in 9 years out of 10`, source: `${SRC}; cell values are smoother than a weather station` })
  }
  // soil water: the preset from SoilGrids (or the user's choice) and its available water capacity
  const index = idx.state === 'ready' ? idx.data : null
  const sc = gs.state === 'ready' ? gs.data.cells.find((c) => c.id === cell.id) : undefined
  const soil: Soil = field.soil ?? sc?.preset ?? 'medium'
  const row = (p: string) => index?.soil_params.find((r) => r.soil === soil && r.parameter === p)
  const awc = Number(row('awc_m3m3')?.value)
  if (index && Number.isFinite(awc)) {
    tiles.push({
      key: 'soil', kind: 'soil', label: 'Soil water', value: fmt(awc * 1000, 0), unit: 'mm per metre of soil',
      sub: field.soil ? `${soil} soil, your choice` : sc?.preset ? `${soil} soil (${sc.texture}), from SoilGrids` : 'medium soil, a default: no soil data for this cell',
      source: row('awc_m3m3')?.source ?? 'soil preset',
    })
  }

  // one plain sentence, only from the numbers above
  const parts: string[] = []
  if (ok(wb) && wb.value != null && ok(grow) && grow.value != null) {
    const dry = grow.y!.filter((v): v is number => v != null && v < DRY_SHARE * grow.value!).length
    parts.push(wb.value < 0
      ? `Water is the main limit here: in a typical April to September season a well-watered crop would use about ${round10(-wb.value)} mm more than rain supplies, and ${dry} of ${grow.y!.filter((v) => v != null).length} seasons were dry.`
      : `Rain covers a well-watered crop in a typical April to September season, but ${dry} of ${grow.y!.filter((v) => v != null).length} seasons were dry.`)
  }
  const heat = [clear(temp) && temp!.trend! > 0 ? 'it is getting warmer' : null, clear(hot32) && hot32!.trend! > 0 ? 'hot summer days are increasing' : null].filter(Boolean)
  if (heat.length) { const h = heat.join(' and '); parts.push(`${h[0].toUpperCase()}${h.slice(1)}.`) }
  if (!parts.length && !tiles.length) return null

  return (
    <section className="fg" aria-labelledby={`${uid}h`}>
      <h3 id={`${uid}h`}>At a glance</h3>
      {parts.length > 0 && <p className="fg-verdict">{parts.join(' ')}</p>}
      <ul className="fg-tiles">
        {tiles.map((t) => (
          <li key={t.key} className={`fg-tile fg-${t.kind}`} title={`Source: ${t.source}`}>
            <span className="fg-label">{t.label}</span>
            <b className="fg-val">{t.value}</b>
            {t.unit && <span className="fg-unit">{t.unit}</span>}
            <span className="fg-sub">{t.sub}</span>
            {t.note && <span className="fg-note">{t.note}</span>}
          </li>
        ))}
      </ul>
      <p className="fc-note">History of this ~50 km cell, 1991–2025, not a forecast and not one field. Dry seasons and the shortage are our own definitions, so treat them as estimates. Hover a tile for its source.</p>
    </section>
  )
}
