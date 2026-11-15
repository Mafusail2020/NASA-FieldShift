// Data loading and the rotation chaining for the rotation panel. Same rule as backend/core/rotations.py:
// position j of a cyclic rotation is the precomputed pair (rotation[j-1] -> rotation[j]) for every harvest year.
import { useEffect, useState } from 'react'
import type { Status } from '../../../types'

export type Soil = 'light' | 'medium' | 'heavy'
export const METRIC_KEYS = ['mean_ks_mid', 'water_stress_days', 'heat_days_1', 'heat_days_2', 'bare_months', 'soil_water_at_sowing_frac', 'min_winter_tmin_no_snow'] as const
export type MetricKey = (typeof METRIC_KEYS)[number]

export interface CropStatus { computable: boolean; missing: string[]; heat_missing: string[] }
export interface Candidate { id: string; name: string; crops: string[]; source: string; status: Status }
export interface SoilRow { soil: string; parameter: string; value: string; unit: string; source: string; status: Status }
export interface RotIndex {
  generated: string; cells: string[]; years: [number, number]; soils: Soil[]
  crops: Record<string, CropStatus>; candidates: Candidate[]
  kmu_164: { crop: string; min_return_years: number; source: string; status: Status }[]
  soil_params: SoilRow[]; snow: string; source: string; status: Status
}
export type PairCols = { year: number[] } & Record<MetricKey, (number | null)[]>
export interface CellRot { id: string; soils: Record<Soil, Record<string, PairCols>>; filled_gap_days: number }

export const CROP_LABEL: Record<string, string> = {
  winter_wheat: 'Winter wheat', maize: 'Maize', sunflower: 'Sunflower', pea: 'Pea', soybean: 'Soybean', sugar_beet: 'Sugar beet',
  spring_barley: 'Spring barley', millet: 'Millet', black_fallow: 'Black fallow',
}
export const ALL_CROPS = ['winter_wheat', 'maize', 'sunflower', 'pea', 'soybean', 'sugar_beet', 'spring_barley', 'millet', 'black_fallow']
export const cropName = (c: string) => CROP_LABEL[c] ?? c

// ---- loading (module cache, one request per file) ----
const cache = new Map<string, Promise<unknown>>()
function getJson<T>(url: string): Promise<T> {
  let p = cache.get(url) as Promise<T> | undefined
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(url)
      return r.json() as Promise<T>
    })
    p.catch(() => cache.delete(url))
    cache.set(url, p)
  }
  return p
}

/** One cell's pair data (module cache); used by the Finance page for several fields at once. */
export const loadCellRot = (id: string) => getJson<CellRot>(`/data/rotations/${id}.json`)

export type Load<T> = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: T }

export function useRotIndex(): Load<RotIndex> {
  const [s, set] = useState<Load<RotIndex>>({ state: 'loading' })
  useEffect(() => {
    let live = true
    getJson<RotIndex>('/data/rotations_grid.json').then((d) => live && set({ state: 'ready', data: d }), () => live && set({ state: 'error' }))
    return () => { live = false }
  }, [])
  return s
}

/** Cell data; `skip` (no cell, or the index says the cell has no file yet) avoids a request. */
export function useCellRot(id: string | null, skip: boolean): Load<CellRot> {
  const [s, set] = useState<{ id: string | null; v: Load<CellRot> }>({ id: null, v: { state: 'loading' } })
  useEffect(() => {
    if (!id || skip) return
    let live = true
    getJson<CellRot>(`/data/rotations/${id}.json`).then((d) => live && set({ id, v: { state: 'ready', data: d } }), () => live && set({ id, v: { state: 'error' } }))
    return () => { live = false }
  }, [id, skip])
  return s.id === id ? s.v : { state: 'loading' }
}

// ---- statistics ----
export interface Stat { n: number; med: number; p10: number; p90: number; min: number; max: number }

function pct(sorted: number[], q: number) {
  const i = (sorted.length - 1) * q
  const lo = Math.floor(i), hi = Math.ceil(i)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}
export function stat(xs: number[]): Stat | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return { n: s.length, med: pct(s, 0.5), p10: pct(s, 0.1), p90: pct(s, 0.9), min: s[0], max: s[s.length - 1] }
}

// ---- evaluation ----
// mult: factor from the stored value to the displayed one (Ks 0-1 is shown as the percentage of the water need met)
export interface Criterion { key: 'ks' | 'wsd' | 'heat' | 'bare'; label: string; unit: string; digits: number; status: Status; source: string; better: 'high' | 'low'; mult?: number }
export const CRITERIA: Criterion[] = [
  { key: 'ks', label: 'Water need met, mid-season window', unit: '%', digits: 0, mult: 100, status: 'estimate', better: 'high',
    source: 'FAO-56 Ch. 8 Ks (x 100) from a daily single-bucket water balance; window = FAO-56 mid-season stage (project choice). 100 % = no water stress.' },
  { key: 'wsd', label: 'Water-stress days (Ks < 1) per season', unit: 'days', digits: 0, status: 'estimate', better: 'low',
    source: 'FAO-56 Ch. 8: days when depletion is beyond RAW. No runoff, irrigation or capillary rise modelled.' },
  { key: 'heat', label: 'Heat days in the heat window', unit: 'days', digits: 0, status: 'estimate', better: 'low',
    source: 'Winter wheat only: days with Tmax >= 30 C in days 310-335 after sowing. Threshold not verified (status estimate). Maize and sunflower windows are todo.' },
  { key: 'bare', label: 'Bare-soil months per year', unit: 'months', digits: 1, status: 'estimate', better: 'low',
    source: 'Months with at least half of the days without a crop (fallow and gaps between crops), from the project sowing and harvest calendar.' },
]

export interface Evaluation {
  rotation: string[]
  stats: Record<Criterion['key'], Stat | null>
  heatCrops: string[]       // crops that contribute heat days
  noHeatCrops: string[]     // crops in the rotation without a heat window
  returns: { crop: string; gap: number; norm: number | null }[]
  years: [number, number]
  cropYears: number
}
export type EvalResult = { ok: true; ev: Evaluation } | { ok: false; reasons: string[] }

export function returnGap(rot: string[], crop: string): number {
  const n = rot.length
  const pos = rot.flatMap((c, i) => (c === crop ? [i] : []))
  if (pos.length === 1) return n
  return Math.min(...pos.map((p, k) => (((pos[(k + 1) % pos.length] - p) % n) + n) % n || n))
}

export function evaluate(rot: string[], index: RotIndex, cell: CellRot, soil: Soil): EvalResult {
  const bad = [...new Set(rot)].filter((c) => !index.crops[c]?.computable)
  if (bad.length) {
    return { ok: false, reasons: [`${bad.map(cropName).join(' and ')}: not available yet`] }
  }
  const pairs = cell.soils[soil]
  const acc: Record<Criterion['key'], number[]> = { ks: [], wsd: [], heat: [], bare: [] }
  const heatCrops = new Set<string>(), noHeat = new Set<string>()
  let ymin = 9999, ymax = 0, cropYears = 0
  for (let j = 0; j < rot.length; j++) {
    const p = pairs[`${rot[(j - 1 + rot.length) % rot.length]}>${rot[j]}`]
    if (!p) return { ok: false, reasons: [`No precomputed pair for ${rot[(j - 1 + rot.length) % rot.length]} to ${rot[j]}`] }
    ymin = Math.min(ymin, ...p.year); ymax = Math.max(ymax, ...p.year)
    p.year.forEach((_, i) => {
      if (p.bare_months[i] != null) acc.bare.push(p.bare_months[i]!)
      if (rot[j] === 'black_fallow') return
      cropYears++
      if (p.mean_ks_mid[i] != null) acc.ks.push(p.mean_ks_mid[i]!)
      if (p.water_stress_days[i] != null) acc.wsd.push(p.water_stress_days[i]!)
      if (p.heat_days_1[i] != null) { acc.heat.push(p.heat_days_1[i]!); heatCrops.add(rot[j]) } else noHeat.add(rot[j])
    })
  }
  const kmu = Object.fromEntries(index.kmu_164.map((k) => [k.crop, k.min_return_years]))
  const returns = [...new Set(rot)].map((c) => ({ crop: c, gap: returnGap(rot, c), norm: kmu[c] ?? null }))
  return {
    ok: true,
    ev: {
      rotation: rot, stats: { ks: stat(acc.ks), wsd: stat(acc.wsd), heat: stat(acc.heat), bare: stat(acc.bare) },
      heatCrops: [...heatCrops], noHeatCrops: [...noHeat].filter((c) => !heatCrops.has(c)), returns, years: [ymin, ymax], cropYears,
    },
  }
}

export const canonical = (rot: string[]) =>
  rot.map((_, i) => [...rot.slice(i), ...rot.slice(0, i)].join('>')).sort()[0]

export type Priority = 'water' | 'cover' | 'stress'
export const PRIORITIES: { id: Priority; label: string; hint: string }[] = [
  { id: 'water', label: 'Water supply', hint: 'Higher median share of the water need met first (less water stress in the mid-season window).' },
  { id: 'cover', label: 'Soil cover', hint: 'Fewer bare-soil months first. Erosion itself is not modelled; bare months are only a proxy for exposure.' },
  { id: 'stress', label: 'Dry-year risk', hint: 'Higher share of the water need met in the driest 10% of crop-years (p10) first.' },
]
/** Sort key: smaller is better. null when the rotation has no value for the priority. */
export function sortKey(ev: Evaluation, p: Priority): number | null {
  if (p === 'water') return ev.stats.ks ? -ev.stats.ks.med : null
  if (p === 'cover') return ev.stats.bare ? ev.stats.bare.med : null
  return ev.stats.ks ? -ev.stats.ks.p10 : null
}

// ---- soil from SoilGrids (public/data/grid_soil.json) ----
export interface SoilCell { id: string; clay_pct?: number; sand_pct?: number; silt_pct?: number; texture: string | null; preset: Soil | null; reason?: string }
export interface SoilDoc { depth?: string; source: string; status: Status; cells: SoilCell[] }
export function useGridSoil(): Load<SoilDoc> {
  const [s, set] = useState<Load<SoilDoc>>({ state: 'loading' })
  useEffect(() => {
    let live = true
    getJson<SoilDoc>('/data/grid_soil.json').then((d) => live && set({ state: 'ready', data: d }), () => live && set({ state: 'error' }))
    return () => { live = false }
  }, [])
  return s
}
