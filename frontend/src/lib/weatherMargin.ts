// Stage 3: margin per historical weather year. ESTIMATE, not a yield model.
// Method (quantile mapping): the spread of yields is the national FAOSTAT spread (last 15 years, relative to its median);
// the ORDER of the years comes from the cell's own NASA POWER water balance (mean Ks in the mid-season window, higher Ks = better year).
// So "which years are bad" is local weather, "how bad" is the national record. Heat, frost, pests and the war are not in it.
import { useEffect, useState } from 'react'
import { loadCellRot, type CellRot, type Soil } from '../components/fields/rotation/model'
import { YIELD_RANGE_YEARS, lastN, percentile, validNonNeg, type CropInputs } from './finance'

export interface YearSeries { years: number[]; values: number[] }

/** Yields of the last years relative to their median, ascending. */
export function relativeYields(c: CropInputs): number[] {
  const v = lastN(c.yields, YIELD_RANGE_YEARS).map((p) => p.value).filter((x) => Number.isFinite(x) && x > 0)
  const med = percentile(v, 0.5)
  return v.map((x) => x / med).sort((a, b) => a - b)
}

/** Yield multiplier per weather year: the year with the r-th lowest Ks gets the national relative yield at the same quantile. Ties share the average rank. */
export function weatherFactors(years: number[], ks: (number | null)[], nat: number[]): YearSeries | null {
  const idx = years.map((_, i) => i).filter((i) => ks[i] != null)
  if (idx.length < 5 || nat.length < 5) return null
  const order = [...idx].sort((a, b) => ks[a]! - ks[b]!)
  const rank = new Map<number, number>()
  for (let a = 0; a < order.length; ) {
    let b = a
    while (b + 1 < order.length && ks[order[b + 1]] === ks[order[a]]) b++
    for (let t = a; t <= b; t++) rank.set(order[t], (a + b) / 2)
    a = b + 1
  }
  return { years: idx.map((i) => years[i]), values: idx.map((i) => percentile(nat, (rank.get(i)! + 0.5) / idx.length)) }
}

export const pairOf = (cell: CellRot, soil: Soil, pred: string, crop: string) => cell.soils[soil]?.[`${pred}>${crop}`] ?? null

/** Yield multiplier per year for one crop after one predecessor on this cell. */
export function cropFactors(cell: CellRot, soil: Soil, pred: string, crop: string, c: CropInputs): YearSeries | null {
  const p = pairOf(cell, soil, pred, crop)
  return p ? weatherFactors(p.year, p.mean_ks_mid, relativeYields(c)) : null
}

/** Predecessor of a crop in a cyclic rotation (the first position of that crop); the crop itself when it is not in the rotation. */
export function predecessorIn(rotation: string[], crop: string): string {
  const i = rotation.indexOf(crop)
  return i < 0 || rotation.length === 0 ? crop : rotation[(i - 1 + rotation.length) % rotation.length]
}

export interface Summary { n: number; mean: number; p10: number; p50: number; p90: number; losing: number; min: number; max: number }
export function summarize(v: number[]): Summary | null {
  if (!v.length) return null
  return { n: v.length, mean: v.reduce((a, b) => a + b, 0) / v.length, p10: percentile(v, 0.1), p50: percentile(v, 0.5), p90: percentile(v, 0.9), losing: v.filter((x) => x < 0).length, min: Math.min(...v), max: Math.max(...v) }
}

export interface CropMoney { y: number; p: number; cost: number | null; k: number }
/** Margin per ha per weather year for one crop: yield x factor x k x price - cost. Needs a cost. */
export function marginSeries(f: YearSeries, m: CropMoney): YearSeries | null {
  if (m.cost == null || !validNonNeg(m.cost)) return null
  return { years: f.years, values: f.values.map((r) => m.y * r * m.k * m.p - m.cost!) }
}

export interface RotationYears { series: YearSeries; fallowNoCost: boolean }
/** Rotation margin per ha per harvest year = mean over its positions. Black fallow earns 0 and costs what the user typed (else 0, flagged). */
export function rotationSeries(rot: string[], cell: CellRot, soil: Soil, crops: Record<string, CropInputs>, money: (id: string, prev: string) => CropMoney | null, fallowCost: number | null): RotationYears | null {
  const per: YearSeries[] = []
  let fallowNoCost = false
  for (let j = 0; j < rot.length; j++) {
    const crop = rot[j], prev = rot[(j - 1 + rot.length) % rot.length]
    const pair = pairOf(cell, soil, prev, crop)
    if (!pair) return null
    if (crop === 'black_fallow') {
      if (fallowCost == null) fallowNoCost = true
      per.push({ years: pair.year, values: pair.year.map(() => -(fallowCost ?? 0)) })
      continue
    }
    const c = crops[crop], m = money(crop, prev)
    if (!c || !m) return null
    const f = cropFactors(cell, soil, prev, crop, c)
    const s = f && marginSeries(f, m)
    if (!s) return null
    per.push(s)
  }
  const years = per[0].years.filter((y) => per.every((s) => s.years.includes(y)))
  if (!years.length) return null
  return { series: { years, values: years.map((y) => per.reduce((t, s) => t + s.values[s.years.indexOf(y)], 0) / per.length) }, fallowNoCost }
}

/** Cells of several fields at once (the farm view). Missing or failed cells stay out of the map. */
export function useCellRots(ids: string[]): Map<string, CellRot> {
  const key = [...new Set(ids)].sort().join('|')
  const [m, set] = useState<{ key: string; v: Map<string, CellRot> }>({ key: '', v: new Map() })
  useEffect(() => {
    if (!key) return
    let live = true
    Promise.all(key.split('|').map((id) => loadCellRot(id).then((d) => [id, d] as const, () => null))).then((r) => {
      if (live) set({ key, v: new Map(r.flatMap((x) => (x ? [x] : []))) })
    })
    return () => { live = false }
  }, [key])
  return m.key === key ? m.v : new Map()
}
