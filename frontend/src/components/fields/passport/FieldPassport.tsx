// Field passport: one place with everything the site knows about one field, in three groups (water, heat and frost, soil).
// Climate: grid_layers.json (the field's NASA POWER cell, 1991-2025, ~50 km). Soil water: grid_soil.json + rotations_grid.json (SoilGrids preset).
// Soil analysis: what the farmer entered (field.analysis). Every value is computed here from those; nothing is invented.
// Replaces FieldGlance. Per-crop heat sums (GDD) are not shown: the crop requirements are not in params/crops.csv yet.
import { useId } from 'react'
import type { GridCell, Status } from '../../../types'
import type { FieldItem } from '../../../lib/field'
import { cropSoil, useSoilDoc } from '../../../lib/soil'
import StatusChip from '../../StatusChip'
import { fmt } from '../climate/charts'
import { doyLabel } from '../climate/types'
import type { CellLayer, FrostEntry } from '../climate/types'
import { clear, decadeMean, ok, round10, useLayersDoc, yearsOf } from '../climate/util'
import { useGridSoil, useRotIndex, type Soil } from '../rotation/model'
import '../climate/climate.css'
import './passport.css'

const DRY_SHARE = 0.8   // a "dry season" has Apr-Sep rain below this share of the cell's own average (our definition, not a standard)
const sign = (v: number, d: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), d)}`

/** Percentile by linear interpolation between the sorted values; NaN for an empty list. */
function pctl(xs: (number | null)[], p: number): number {
  const v = xs.filter((x): x is number => x != null).sort((a, b) => a - b)
  if (!v.length) return NaN
  const i = (v.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i)
  return v[lo] + (v[hi] - v[lo]) * (i - lo)
}

// Classes are the common ones (USDA salinity classes by ECe; the usual pH words; a rough humus scale), marked estimate: ask an agronomist.
const eceClass = (e: number) => (e < 2 ? 'Not saline' : e < 4 ? 'Slightly saline' : e < 8 ? 'Moderately saline' : e < 16 ? 'Strongly saline' : 'Very strongly saline')
const phClass = (p: number) => (p < 5.5 ? 'Acid' : p < 6.5 ? 'Slightly acid' : p <= 7.5 ? 'Neutral' : p <= 8.5 ? 'Alkaline' : 'Strongly alkaline')
const humusClass = (h: number) => (h < 2 ? 'Low' : h < 4 ? 'Medium' : 'High')

type Group = 'water' | 'heat' | 'soil'
interface Tile {
  key: string; group: Group; kind: 'heat' | 'water' | 'dry' | 'frost' | 'soil'; label: string; value: string; unit?: string; sub: string; note?: string
  source: string; status: Status; empty?: boolean
  tone?: 'good' | 'bad'; rule?: string   // colour of the number: favourable / unfavourable for farming, with the limit that decided it
}
const GROUPS: { id: Group; title: string }[] = [
  { id: 'water', title: 'Water' },
  { id: 'heat', title: 'Heat and frost' },
  { id: 'soil', title: 'Soil' },
]

export function FieldPassport({ field, cell }: { field: FieldItem; cell: GridCell | null }) {
  const uid = useId()
  const load = useLayersDoc()
  const gs = useGridSoil()
  const idx = useRotIndex()
  const sd = useSoilDoc()
  const head = (
    <div className="pass-head">
      <h3 id={`${uid}h`}>Field passport</h3>
      <p className="pass-meta">
        {field.name}{field.areaHa != null && <> · {fmt(field.areaHa, field.areaHa < 10 ? 1 : 0)} ha</>}
        {cell && <> · climate cell {cell.id} (~50 km), elevation {Math.round(cell.elevation_m)} m</>}
      </p>
    </div>
  )
  if (!cell) return <section className="pass" aria-labelledby={`${uid}h`}>{head}<p className="pass-state">Enter the field&rsquo;s coordinates to see its passport. The site finds the ~50 km NASA POWER cell that contains them.</p></section>
  if (load.state === 'loading') return <section className="pass" aria-busy="true" aria-labelledby={`${uid}h`}>{head}<p className="pass-state">Loading…</p></section>
  if (load.state === 'error') return <section className="pass" aria-labelledby={`${uid}h`}>{head}<p className="pass-state" role="alert">The climate layers could not be loaded (data/grid_layers.json).</p></section>
  const rec = load.doc.cells[cell.id]
  if (!rec) return <section className="pass" aria-labelledby={`${uid}h`}>{head}<p className="pass-state">No climate data for this cell yet.</p></section>

  const doc = load.doc, years = yearsOf(doc)
  const L = (id: string) => rec[id] as CellLayer | undefined
  const temp = L('temp_trend'), hot32 = L('hot32'), wb = L('water_balance'), grow = L('precip_growing_trend')
  const SRC = 'NASA POWER daily, 1991-2025 (MERRA-2), ~50 km cell'
  const tiles: Tile[] = []
  const add = (t: Tile) => tiles.push(t)

  // ---- water ----
  if (ok(wb)) {
    const p10 = pctl(wb.y!, 0.1), p50 = pctl(wb.y!, 0.5), p90 = pctl(wb.y!, 0.9)
    add({
      key: 'wb', group: 'water', kind: 'dry', label: p50 < 0 ? 'Water shortage' : 'Water surplus', value: sign(round10(p50), 0), unit: 'mm in a typical Apr–Sep',
      sub: `dry year ${sign(round10(p10), 0)} mm · wet year ${sign(round10(p90), 0)} mm (rain minus what a well-watered crop would use)`,
      note: clear(wb) ? (wb.trend! < 0 ? 'Clear worsening' : 'Clear easing') : 'No clear trend', source: `${SRC}; the season is our choice, not crop-specific`, status: 'estimate',
    })
  }
  if (ok(grow)) {
    const p10 = pctl(grow.y!, 0.1), p50 = pctl(grow.y!, 0.5), p90 = pctl(grow.y!, 0.9)
    add({ key: 'rain', group: 'water', kind: 'water', label: 'Rain, April to September', value: fmt(round10(p50), 0), unit: 'mm in a typical year', sub: `dry year ${fmt(round10(p10), 0)} mm · wet year ${fmt(round10(p90), 0)} mm`, source: SRC, status: 'data' })
    if (grow.value != null) {
      const ys = grow.y!.filter((v): v is number => v != null)
      const dry = ys.filter((v) => v < DRY_SHARE * grow.value!).length
      add({ key: 'dry', group: 'water', kind: 'water', label: 'Dry seasons', value: `${dry} of ${ys.length}`, sub: `April to September with less than ${Math.round(DRY_SHARE * 100)} % of the average rain (${fmt(grow.value, 0)} mm)`, source: `${SRC}; the 80 % limit is our own definition`, status: 'estimate' })
    }
  }
  // soil water: the preset from SoilGrids (or the user's choice) and its available water capacity
  const index = idx.state === 'ready' ? idx.data : null
  const sc = gs.state === 'ready' ? gs.data.cells.find((c) => c.id === cell.id) : undefined
  const soil: Soil = field.soil ?? sc?.preset ?? 'medium'
  const row = (p: string) => index?.soil_params.find((r) => r.soil === soil && r.parameter === p)
  const awc = Number(row('awc_m3m3')?.value)
  if (index && Number.isFinite(awc)) {
    add({
      key: 'awc', group: 'water', kind: 'soil', label: 'Soil water holding', value: fmt(awc * 1000, 0), unit: 'mm per metre of soil',
      sub: field.soil ? `${soil} soil, your choice` : sc?.preset ? `${soil} soil (${sc.texture}), from SoilGrids` : 'medium soil, a default: no soil data for this cell',
      source: row('awc_m3m3')?.source ?? 'soil preset', status: field.soil || !sc?.preset ? 'estimate' : row('awc_m3m3')?.status ?? 'estimate',
    })
  }

  // ---- heat and frost ----
  if (ok(temp) && temp.trend != null) {
    add(clear(temp) && temp.line
      ? { key: 'warm', group: 'heat', kind: 'heat', label: 'Warming', value: `${sign(temp.trend, 2)} °C`, unit: 'per decade', sub: `about ${fmt(temp.line[1] - temp.line[0], 1)} °C warmer than the early 1990s`, source: SRC, status: 'data' }
      : { key: 'warm', group: 'heat', kind: 'heat', label: 'Warming', value: 'No clear change', sub: `yearly mean ${fmt(temp.value!, 1)} °C`, source: SRC, status: 'data' })
  }
  if (ok(hot32)) {
    const a = decadeMean(years, hot32, 1991, 1999), b = decadeMean(years, hot32, 2020, 2029)
    add({
      key: 'hot', group: 'heat', kind: 'heat', label: 'Hot days', value: Number.isNaN(b) ? fmt(hot32.value!, 0) : fmt(b, 0), unit: 'days per summer above 32 °C',
      sub: Number.isNaN(a) || Number.isNaN(b) ? 'average of all years' : `in the 2020s, against ${fmt(a, 0)} in the 1990s`,
      note: clear(hot32) ? (hot32.trend! > 0 ? 'Clear rise' : 'Clear fall') : 'No clear trend', source: SRC, status: 'data',
    })
  }
  const fl = (rec.frost_last as Record<string, FrostEntry | null> | undefined)?.t0, ff = (rec.frost_first as Record<string, FrostEntry | null> | undefined)?.t0
  const real = (d: number | null | undefined): d is number => d != null && d > 0 && d < 367   // 0 / 367 = "no frost in the window"
  const FSRC = `${SRC}; frost = daily minimum at or below 0 °C; cell values are smoother than a weather station`
  if (fl && real(fl.d50) && real(fl.d90) && real(fl.d10)) {
    add({ key: 'last', group: 'heat', kind: 'frost', label: 'Last spring frost', value: doyLabel(fl.d50), unit: 'median date', sub: `in 9 years out of 10 it is over by ${doyLabel(fl.d90)}; in 1 year out of 10 it is over by ${doyLabel(fl.d10)}`, source: FSRC, status: 'data' })
  }
  if (ff && real(ff.d50) && real(ff.d10) && real(ff.d90)) {
    add({ key: 'first', group: 'heat', kind: 'frost', label: 'First autumn frost', value: doyLabel(ff.d50), unit: 'median date', sub: `as early as ${doyLabel(ff.d10)} in 1 year out of 10; as late as ${doyLabel(ff.d90)} in 1 out of 10`, source: FSRC, status: 'data' })
  }
  if (real(fl?.d90) && real(ff?.d10) && ff!.d10! > fl!.d90!) {
    add({ key: 'free', group: 'heat', kind: 'frost', label: 'Frost-free window', value: `${ff!.d10! - fl!.d90!} days`, sub: `${doyLabel(fl!.d90!)} to ${doyLabel(ff!.d10!)}, free of frost in 9 years out of 10`, source: FSRC, status: 'data' })
  }

  // ---- soil analysis (what the farmer entered) ----
  const a = field.analysis
  const NOT = 'Not entered. Add it under Soil analysis below.'
  const ASRC = 'Entered by the farmer from a lab analysis; classes are the common ones, check them with an agronomist'
  // Salt and pH are judged on the crops of this field's rotation (the crop of this season when no rotation is entered), with the same
  // per-crop tables as the Soil analysis section (salt: Maas-Hoffman, FAO Paper 61; pH: ECOCROP trapezoid).
  const rotCrops = [...new Set<string>(field.rotation.length ? field.rotation : field.crop ? [field.crop] : [])].filter((c) => c !== 'black_fallow')
  const cs = sd.state === 'ready' ? rotCrops.map((c) => cropSoil(c, a, sd.data)) : []
  const saltIn = cs.filter((c) => c.fSalt != null), saltNo = cs.filter((c) => c.fSalt == null)
  const phIn = cs.filter((c) => c.fPh != null), phNo = cs.filter((c) => c.fPh == null)
  const names = (xs: { label: string }[]) => xs.map((x) => x.label.toLowerCase()).join(', ')
  const none = rotCrops.length === 0 ? '. Set a crop or a rotation to see which crops it suits.' : sd.state === 'loading' ? '. Loading crop tables…' : ''
  let eceSub = a.ece != null ? eceClass(a.ece) : ''
  if (a.ece != null && cs.length) {
    const worst = saltIn.length ? saltIn.reduce((m, c) => (c.fSalt! < m.fSalt! ? c : m)) : null
    eceSub += !worst ? `; no salt data for ${names(saltNo)}`
      : worst.fSalt! >= 0.995 ? `; no yield loss for ${names(saltIn)}${saltNo.length ? `; no salt data for ${names(saltNo)}` : ''}`
      : `; ${worst.label.toLowerCase()} keeps ${fmt(worst.fSalt! * 100, 0)} % of its yield${saltNo.length ? `; no salt data for ${names(saltNo)}` : ''}`
  } else eceSub += none
  let phSub = a.ph != null ? phClass(a.ph) : ''
  if (a.ph != null && cs.length) {
    const off = phIn.filter((c) => c.fPh! < 1)
    phSub += !phIn.length ? `; no pH data for ${names(phNo)}` : off.length ? `; outside the comfort zone for ${names(off)}` : `; comfortable for ${names(phIn)}`
  } else phSub += none
  add(a.ece != null
    ? { key: 'ece', group: 'soil', kind: 'soil', label: 'Salinity (ECe)', value: fmt(a.ece, 1), unit: 'dS/m', sub: eceSub, source: ASRC, status: 'estimate' }
    : { key: 'ece', group: 'soil', kind: 'soil', label: 'Salinity (ECe)', value: 'Not entered', sub: NOT, source: ASRC, status: 'estimate', empty: true })
  add(a.ph != null
    ? { key: 'ph', group: 'soil', kind: 'soil', label: 'Acidity (pH, water)', value: fmt(a.ph, 1), sub: phSub, source: ASRC, status: 'estimate' }
    : { key: 'ph', group: 'soil', kind: 'soil', label: 'Acidity (pH, water)', value: 'Not entered', sub: NOT, source: ASRC, status: 'estimate', empty: true })
  add(a.humusPct != null
    ? { key: 'humus', group: 'soil', kind: 'soil', label: 'Humus', value: fmt(a.humusPct, 1), unit: '%', sub: `${humusClass(a.humusPct)}; the 10-year outlook for your rotation is under Soil analysis`, source: ASRC, status: 'estimate' }
    : { key: 'humus', group: 'soil', kind: 'soil', label: 'Humus', value: 'Not entered', sub: NOT, source: ASRC, status: 'estimate', empty: true })

  // ---- colour of the numbers: favourable (green) or unfavourable (red) by limits of our own, written next to each rule. No colour = neither. ----
  const verdictOf: Record<string, [('good' | 'bad') | null, string] | undefined> = {}
  if (ok(wb)) { const p50 = pctl(wb.y!, 0.5); verdictOf.wb = [p50 >= -50 ? 'good' : p50 <= -150 ? 'bad' : null, 'favourable at +/−50 mm or better, unfavourable at −150 mm or worse'] }
  if (ok(grow) && grow.value != null) {
    const ys = grow.y!.filter((v): v is number => v != null), share = ys.filter((v) => v < DRY_SHARE * grow.value!).length / ys.length
    verdictOf.dry = [share <= 0.1 ? 'good' : share >= 0.25 ? 'bad' : null, 'favourable when 1 season in 10 or fewer is dry, unfavourable at 1 in 4 or more']
  }
  if (Number.isFinite(awc)) verdictOf.awc = [awc * 1000 >= 150 ? 'good' : awc * 1000 < 135 ? 'bad' : null, 'favourable at 150 mm per metre or more, unfavourable below 135']
  if (ok(temp)) verdictOf.warm = [clear(temp) ? (temp.trend! > 0 ? 'bad' : 'good') : null, 'unfavourable when the rise is statistically clear']
  if (ok(hot32)) verdictOf.hot = [clear(hot32) ? (hot32.trend! > 0 ? 'bad' : 'good') : null, 'unfavourable when the rise is statistically clear, favourable when the fall is']
  if (real(fl?.d90) && real(ff?.d10) && ff!.d10! > fl!.d90!) { const d = ff!.d10! - fl!.d90!; verdictOf.free = [d >= 180 ? 'good' : d <= 140 ? 'bad' : null, 'favourable at 180 days or more, unfavourable at 140 or fewer'] }
  const crops = `the crops of this field's rotation (${names(cs)})`
  if (a.ece != null && cs.length) verdictOf.ece = [saltIn.length && !saltNo.length && saltIn.every((c) => c.fSalt! >= 0.995) ? 'good' : saltIn.some((c) => c.fSalt! < 0.9) ? 'bad' : null,
    `judged on ${crops}: favourable when none loses yield to salt, unfavourable when one loses 10 % or more (Maas–Hoffman, FAO Paper 61)`]
  if (a.ph != null && cs.length) verdictOf.ph = [phIn.length && !phNo.length && phIn.every((c) => c.fPh! === 1) ? 'good' : phIn.some((c) => c.fPh! === 0) ? 'bad' : null,
    `judged on ${crops}: favourable when pH is in every crop's comfort zone, unfavourable when it is outside the limits of one (ECOCROP; its limits are probably too narrow for alkaline southern soils, so only the clear cases are red)`]
  if (a.humusPct != null) verdictOf.humus = [a.humusPct >= 4 ? 'good' : a.humusPct < 2 ? 'bad' : null, 'favourable at 4 % or more, unfavourable below 2 %']
  for (const t of tiles) { const v = verdictOf[t.key]; if (v?.[0]) { t.tone = v[0]; t.rule = t.key === 'ece' || t.key === 'ph' ? v[1] : `for field crops in general: ${v[1]}` } }

  // one plain sentence, only from the numbers above
  const parts: string[] = []
  if (ok(wb) && ok(grow)) {
    const p50 = pctl(wb.y!, 0.5), n = grow.y!.filter((v) => v != null).length
    const dry = grow.y!.filter((v): v is number => v != null && v < DRY_SHARE * grow.value!).length
    parts.push(p50 < 0
      ? `Water is the main limit here: in a typical April to September season a well-watered crop would use about ${round10(-p50)} mm more than rain supplies, and ${dry} of ${n} seasons were dry.`
      : `Rain covers a well-watered crop in a typical April to September season, but ${dry} of ${n} seasons were dry.`)
  }
  const heat = [clear(temp) && temp!.trend! > 0 ? 'it is getting warmer' : null, clear(hot32) && hot32!.trend! > 0 ? 'hot summer days are increasing' : null].filter(Boolean)
  if (heat.length) { const h = heat.join(' and '); parts.push(`${h[0].toUpperCase()}${h.slice(1)}.`) }
  const saltHit = saltIn.filter((c) => c.fSalt! < 0.9)
  if (a.ece != null && saltHit.length) parts.push(`With ECe ${fmt(a.ece, 1)} dS/m salt would cost ${saltHit.map((c) => `${c.label.toLowerCase()} about ${fmt((1 - c.fSalt!) * 100, 0)} % of its yield`).join(' and ')}: see the crop table under Soil analysis.`)
  if (!parts.length && !tiles.length) return null

  return (
    <section className="pass" aria-labelledby={`${uid}h`}>
      {head}
      {parts.length > 0 && <p className="fg-verdict">{parts.join(' ')}</p>}
      {GROUPS.map((g) => {
        const ts = tiles.filter((t) => t.group === g.id)
        return ts.length === 0 ? null : (
          <div className="pass-group" key={g.id} role="group" aria-label={g.title}>
            <h4>{g.title}</h4>
            <ul className="fg-tiles">
              {ts.map((t) => (
                <li key={t.key} className={`fg-tile fg-${t.kind}${t.empty ? ' pass-empty' : ''}`} title={`Source: ${t.source}${t.rule ? `. Colour: ${t.rule}. Our own limits, an estimate.` : ''}`}>
                  <span className="fg-label">{t.label}</span>
                  <b className={`fg-val${t.tone ? ` pass-${t.tone}` : ''}`}>{t.value}</b>
                  {t.unit && <span className="fg-unit">{t.unit}</span>}
                  {t.tone && <span className={`pass-flag pass-flag-${t.tone}`}><span aria-hidden="true">{t.tone === 'good' ? '✓' : '✗'}</span> {t.tone === 'good' ? 'Favourable' : 'Unfavourable'}</span>}
                  <span className="fg-sub">{t.sub}</span>
                  {t.note && <span className="fg-note">{t.note}</span>}
                  <StatusChip status={t.status} source={t.source} quiet />
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}
