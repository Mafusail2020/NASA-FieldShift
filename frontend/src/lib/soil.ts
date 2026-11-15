// Soil effects of one field: salt and pH factors per crop, humus balance of the rotation. Same formulas as backend/core/salinity.py,
// ph.py, humus.py and soil.py; tables from public/data/soil_params.json (backend/pipeline/export_soil.py), which also carries
// test vectors computed in Python (checked by checkVectors). Missing table data gives null ("no data"), never a silent 1.
import { useEffect, useState } from 'react'
import type { Status } from '../types'

export interface SaltRow { a: number; b: number; low_confidence: boolean; status: Status; source: string }
export interface PhRow { limits: [number, number, number, number]; status: Status; source: string }
export interface HumusRow { res_a: number; res_b: number; root_c: number; root_d: number; k_humif: number; mineral_t_ha: number; status: Status; source: string }
export interface SpeciesSoil { label: string; salt: SaltRow | null; ph: PhRow | null; humus: HumusRow | null; gaps: string[] }
export interface SoilDoc {
  generated: string; source: string; status: Status; notes: string[]
  model: { salt_exclude_below: number; gypsum_shift_dsm: number; manure_coef: number; green_manure_coef: number; plough_layer_mass_t_ha: number }
  species: Record<string, SpeciesSoil>
  vectors: { fn: string; args: (number | string)[]; expected: number }[]
}

/** What the farmer enters for one field (all optional). Manure is t/ha per rotation, yields are the normal yield in c/ha. */
export interface SoilAnalysis {
  ece: number | null; ph: number | null; humusPct: number | null; gypsum: boolean
  manure: number | null; greenT: number | null; greenAfter: string[]; yields: Record<string, number>
}
export const EMPTY_ANALYSIS: SoilAnalysis = { ece: null, ph: null, humusPct: null, gypsum: false, manure: null, greenT: null, greenAfter: [], yields: {} }

// ---- formulas ----
export function relativeYieldPct(ece: number, a: number, b: number): number {
  return ece > a ? Math.max(0, Math.min(100, 100 - b * (ece - a))) : 100
}
export function fSalt(ece: number, s: SaltRow, shift = 0): number {
  return relativeYieldPct(Math.max(ece - shift, 0), s.a, s.b) / 100
}
export function fPh(v: number, [min, lo, hi, max]: [number, number, number, number]): number {
  if (v < min || v > max) return 0
  if (v >= lo && v <= hi) return 1
  return v < lo ? (v - min) / (lo - min) : (max - v) / (max - hi)
}
export function annualBalance(h: HumusRow, y: number, manure: number, green: number, doc: SoilDoc) {
  const q = ((h.res_a * y + h.res_b) + (h.root_c * y + h.root_d)) / 10
  const p1 = q * h.k_humif, p2 = manure * doc.model.manure_coef, p3 = green * doc.model.green_manure_coef
  return { p1, p2, p3, p: h.mineral_t_ha, balance: p1 + p2 + p3 - h.mineral_t_ha }
}

export interface CropSoil {
  crop: string; label: string; fSalt: number | null; fPh: number | null; factor: number
  excluded: boolean; phWarning: boolean; lowConfidence: boolean; notes: string[]; salt: SaltRow | null; ph: PhRow | null
}
export function cropSoil(crop: string, a: SoilAnalysis, doc: SoilDoc): CropSoil {
  const sp = doc.species[crop]
  const out: CropSoil = { crop, label: sp?.label ?? crop, fSalt: null, fPh: null, factor: 1, excluded: false, phWarning: false, lowConfidence: false, notes: [], salt: sp?.salt ?? null, ph: sp?.ph ?? null }
  if (a.ece == null) out.notes.push('ECe not entered')
  else if (!sp?.salt) out.notes.push('no salt-tolerance data for this crop')
  else {
    out.fSalt = fSalt(a.ece, sp.salt, a.gypsum ? doc.model.gypsum_shift_dsm : 0)
    out.excluded = out.fSalt < doc.model.salt_exclude_below
    out.lowConfidence = sp.salt.low_confidence
  }
  if (a.ph == null) out.notes.push('pH not entered')
  else if (!sp?.ph) out.notes.push('no pH data for this crop')
  else { out.fPh = fPh(a.ph, sp.ph.limits); out.phWarning = out.fPh < 1 }
  out.factor = out.fSalt ?? 1 // salt only: pH only warns (see backend/core/soil.py yield_factor)
  return out
}

export interface HumusYear { year: number; crop: string; label: string; p1: number; p2: number; p3: number; p: number; balance: number; status: Status; source: string }
export interface HumusResult {
  years: HumusYear[]; missing: string[]; meanBalance: number | null; perRotation: number | null
  manureNorm: number | null; humusAfter10y: number | null
}
/** Cyclic rotation, one crop per year. Manure per rotation is spread evenly over its years (the formulas are per year). */
export function rotationHumus(rotation: string[], a: SoilAnalysis, doc: SoilDoc): HumusResult {
  const manureYear = (a.manure ?? 0) / Math.max(rotation.length, 1)
  const years: HumusYear[] = [], missing: string[] = []
  rotation.forEach((crop, i) => {
    const sp = doc.species[crop], y = a.yields[crop]
    if (!sp?.humus || !(y >= 0)) { missing.push(crop); return }
    const b = annualBalance(sp.humus, y, manureYear, a.greenAfter.includes(crop) ? a.greenT ?? 0 : 0, doc)
    years.push({ year: i + 1, crop, label: sp.label, ...b, status: sp.humus.status, source: sp.humus.source })
  })
  const r: HumusResult = { years, missing: [...new Set(missing)], meanBalance: null, perRotation: null, manureNorm: null, humusAfter10y: null }
  if (years.length) {
    const sum = years.reduce((t, y) => t + y.balance, 0), mean = sum / years.length
    r.meanBalance = mean; r.perRotation = sum
    r.manureNorm = manureYear + (mean < 0 ? Math.abs(mean) / doc.model.manure_coef : 0)
    if (a.humusPct != null) r.humusAfter10y = Math.max(0, a.humusPct + (10 * mean) / doc.model.plough_layer_mass_t_ha * 100)
  }
  return r
}

/** Yield multiplier of the field's crop this season (salt only); 1 when nothing is entered or the table has no data. */
export function soilFactorOf(crop: string | null, a: SoilAnalysis | undefined, doc: SoilDoc | null): number {
  return crop && a && doc && crop !== 'black_fallow' ? cropSoil(crop, a, doc).factor : 1
}

/** Compares the formulas above with the vectors computed by backend/core; returns the failures (empty = in step). */
export function checkVectors(doc: SoilDoc): string[] {
  const bad: string[] = []
  for (const v of doc.vectors) {
    let got: number
    if (v.fn === 'f_salt') { const [ece, a, b, shift] = v.args as number[]; got = fSalt(ece, { a, b } as SaltRow, shift) }
    else if (v.fn === 'f_ph') { const [x, ...lim] = v.args as number[]; got = fPh(x, lim as [number, number, number, number]) }
    else { const [crop, y, m, g] = v.args as [string, number, number, number]; got = annualBalance(doc.species[crop].humus!, y, m, g, doc).balance }
    if (Math.abs(got - v.expected) > 1e-9) bad.push(`${v.fn}(${v.args.join(', ')}): ${got} vs ${v.expected}`)
  }
  return bad
}

// ---- loading ----
type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: SoilDoc }
let promise: Promise<SoilDoc> | null = null
export function useSoilDoc(): Load {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  useEffect(() => {
    promise ??= fetch('/data/soil_params.json').then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<SoilDoc> })
    promise.then((data) => setLoad({ state: 'ready', data }), () => { promise = null; setLoad({ state: 'error' }) })
  }, [])
  return load
}
