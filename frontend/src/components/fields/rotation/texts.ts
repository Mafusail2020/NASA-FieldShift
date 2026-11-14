// Fixed templates, filled only from computed values. No generated prose, no numbers that were not computed.
import { cropName, CRITERIA, type Candidate, type Evaluation, type RotIndex, type Stat } from './model'

export const f = (v: number, d: number) => v.toFixed(d)
export const range = (s: Stat, d: number) => `${f(s.med, d)} (p10 to p90: ${f(s.p10, d)} to ${f(s.p90, d)})`
export const label = (rot: string[]) => rot.map(cropName).join(' > ')

export function why(ev: Evaluation, cand: Candidate | null, base: Evaluation | null): string[] {
  const out: string[] = []
  if (cand) {
    out.push(`Draft candidate "${cand.name}" (status: ${cand.status}). It was written by the project team from the crops that currently have a complete parameter set, not by an agronomist. It is a rotation to compare, not a recommendation.`)
  } else {
    out.push('This is the rotation you entered. It is the baseline for the comparison.')
  }
  if (cand && base) {
    const a = ev.stats.ks, b = base.stats.ks
    if (a && b) out.push(`Median mean Ks ${f(a.med, 2)} here against ${f(b.med, 2)} for your rotation.`)
    const c = ev.stats.bare, d = base.stats.bare
    if (c && d) out.push(`Median bare-soil months per year ${f(c.med, 1)} here against ${f(d.med, 1)} for your rotation.`)
  }
  return out
}

export function evidence(ev: Evaluation, soilName: string): string[] {
  const out = [`Computed from NASA POWER daily weather of this ~50 km cell, harvest years ${ev.years[0]} to ${ev.years[1]}, ${ev.cropYears} crop-years over all phases of the rotation, ${soilName} soil preset.`]
  for (const c of CRITERIA) {
    const s = ev.stats[c.key]
    if (s) out.push(`${c.label}: median ${range(s, c.digits)}${c.unit ? ' ' + c.unit : ''}; min ${f(s.min, c.digits)}, max ${f(s.max, c.digits)}; n = ${s.n}.`)
  }
  for (const r of ev.returns) {
    out.push(r.norm != null
      ? `${cropName(r.crop)} returns after ${r.gap} years (norm: ${r.norm}).`
      : `${cropName(r.crop)} returns after ${r.gap} years (norm: not set for this crop).`)
  }
  return out
}

export function gaps(ev: Evaluation, idx: RotIndex): string[] {
  const out: string[] = []
  if (ev.noHeatCrops.length) out.push(`Heat days are not computed for ${ev.noHeatCrops.map(cropName).join(', ')}: heat window not set in the parameters (todo).`)
  if (!ev.heatCrops.length) out.push('No heat-stress number for this rotation.')
  else out.push(`Heat days use the winter wheat threshold of 30 C, which is not yet verified (status estimate).`)
  out.push('Frost thresholds are not set (todo), so frost is not evaluated.')
  const miss = Object.entries(idx.crops).filter(([, c]) => !c.computable)
  if (miss.length) out.push(`Not computable, so not offered: ${miss.map(([k, c]) => `${cropName(k)} (missing ${c.missing.join(', ')})`).join('; ')}.`)
  out.push('Yield and margin are not part of this panel; they are on the Finance page.')
  return out
}

export function risks(ev: Evaluation): string[] {
  const rot = ev.rotation
  const out: string[] = []
  const rep = rot.some((c, i) => c !== 'black_fallow' && rot[(i + 1) % rot.length] === c)
  if (rep) out.push('The same crop follows itself in this rotation. Pests, diseases and nutrient balance are not modelled; the agronomist should check them.')
  if (rot.includes('black_fallow')) out.push('Black fallow: water stored in the fallow year is a model result (sanity range from literature: 10 to 53% of fallow-period rainfall). Check against local measurements, and check erosion and nitrogen, which are not modelled.')
  if (ev.stats.ks) out.push(`In the driest 10% of crop-years the mean Ks drops to ${f(ev.stats.ks.p10, 2)}. The model has no irrigation, runoff or capillary rise, so check the water balance against local conditions.`)
  out.push('The cell is about 50 km across: soil, slope and microclimate of the actual field can differ. The soil preset is a generic texture class, not a measured soil.')
  out.push('Sowing and harvest dates follow a temperature rule and the FAO-56 stage lengths, not local practice.')
  return out
}

export const NOT_MODELLED = [
  'Soil organic matter and soil carbon',
  'Nitrogen balance and fertiliser',
  'Pests, diseases and weeds',
  'Erosion in numbers (bare-soil months are only a proxy)',
  'Effects from two or more years back (only the previous crop is used)',
  'Surface runoff, runoff from frozen ground, capillary rise and irrigation',
  'Field-scale conditions: the cell is about 50 km, and the soil is a generic preset',
  'Only the variables above are modelled; no claim is made about "all soil variables"',
]
