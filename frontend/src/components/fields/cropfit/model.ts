// Crop fit: for every crop, does this field's cell and soil allow it? Pure logic, no React.
// Water: the pair metrics of the cell (rotations/<cell>.json), pooled over every possible previous crop (an "average predecessor").
// Soil: salt and pH factors of lib/soil.ts from the farmer's soil analysis. Limits below are our own, marked estimate.
// Only salt can make a crop "not advised" (team rule); water and pH can only ask for a check.
import type { CropSoil } from '../../../lib/soil'
import { ALL_CROPS, stat, type CellRot, type RotIndex, type Soil } from '../rotation/model'

export const WATER_GOOD = 0.85   // median share of the water need met in the mid-season window: at or above this, water is not a worry
export const WATER_DRY_POOR = 0.4 // a dry year (10th percentile) below this is a warning even when typical years are fine
export const SALT_OK = 0.95      // salt leaves at least this share of normal yield: no concern
export const SALT_EXCLUDE = 0.5  // team rule (params/model.csv salt_exclude_below): below this the crop is not recommended

export type Fit = 'suits' | 'check' | 'no'
export interface WaterStat { med: number; p10: number; wsd: number; n: number }
export interface CropRow {
  crop: string; water: WaterStat | null; soil: CropSoil | null
  fit: Fit | null            // null = no weather data for this crop in this cell
  reasons: string[]          // why it is not a plain "suits"
  unchecked: string[]        // what could not be checked (not entered, no data)
  kmu: number | null         // KMU No. 164 minimum years between two crops of it on one field
}

/** Water supply of one crop, pooled over all previous crops, for one soil preset. null when the cell has no pairs for it. */
export function cropWater(cell: CellRot, soil: Soil, crop: string): WaterStat | null {
  const ks: number[] = [], wsd: number[] = []
  for (const [key, p] of Object.entries(cell.soils[soil] ?? {})) {
    if (key.split('>')[1] !== crop) continue
    for (const v of p.mean_ks_mid) if (v != null) ks.push(v)
    for (const v of p.water_stress_days) if (v != null) wsd.push(v)
  }
  const k = stat(ks), w = stat(wsd)
  return k && w ? { med: k.med, p10: k.p10, wsd: w.med, n: k.n } : null
}

/** Verdict of one crop from water and soil. `soil` is null when no analysis or crop table is available. */
export function judge(crop: string, water: WaterStat | null, soil: CropSoil | null, entered: { ece: boolean; ph: boolean }, label: (c: string) => string): Pick<CropRow, 'fit' | 'reasons' | 'unchecked'> {
  const reasons: string[] = [], unchecked: string[] = []
  let no = false, check = false
  const pc = (v: number) => `${Math.round(v * 100)} %`
  if (!water) unchecked.push('no weather data for this crop in this cell')
  // water never rules a crop out: the model has no irrigation, runoff or capillary rise and is not yet checked against yields, so it can only warn
  else if (water.med < WATER_GOOD) { check = true; reasons.push(`${pc(water.med)} of the water need is met in a typical year, ${pc(water.p10)} in a dry one`) }
  else if (water.p10 < WATER_DRY_POOR) { check = true; reasons.push(`fine in a typical year, but only ${pc(water.p10)} of the water need is met in a dry one`) }
  if (soil) {
    if (entered.ece) {
      if (soil.fSalt == null) unchecked.push(`no salt data for ${label(crop).toLowerCase()}`)
      else if (soil.fSalt < SALT_EXCLUDE) { no = true; reasons.push(`salt leaves only ${pc(soil.fSalt)} of the yield`) }
      else if (soil.fSalt < SALT_OK) { check = true; reasons.push(`salt takes about ${pc(1 - soil.fSalt)} of the yield`) }
    }
    if (entered.ph) {
      if (soil.fPh == null) unchecked.push(`no pH data for ${label(crop).toLowerCase()}`)
      else if (soil.fPh < 1) { check = true; reasons.push(soil.fPh === 0 ? 'pH is outside the limits of this crop (a warning only: the limits are probably too narrow for alkaline soils)' : 'pH is outside the comfort zone (a warning only)') }
    }
  }
  const fit: Fit | null = !water ? null : no ? 'no' : check ? 'check' : 'suits'
  return { fit, reasons, unchecked }
}

const ORDER: Record<Fit, number> = { suits: 0, check: 1, no: 2 }
/** Rows for every crop except black fallow, best fit first, then by typical water supply. Crops without a verdict go last. */
export function cropRows(cell: CellRot, soil: Soil, index: RotIndex, soilOf: (c: string) => CropSoil | null, entered: { ece: boolean; ph: boolean }, label: (c: string) => string): CropRow[] {
  const kmu = Object.fromEntries(index.kmu_164.map((k) => [k.crop, k.min_return_years]))
  const rows = ALL_CROPS.filter((c) => c !== 'black_fallow' && index.crops[c]?.computable).map((crop): CropRow => {
    const water = cropWater(cell, soil, crop), s = soilOf(crop)
    return { crop, water, soil: s, kmu: kmu[crop] ?? null, ...judge(crop, water, s, entered, label) }
  })
  return rows.sort((a, b) => (a.fit ? ORDER[a.fit] : 3) - (b.fit ? ORDER[b.fit] : 3) || (b.water?.med ?? -1) - (a.water?.med ?? -1))
}
