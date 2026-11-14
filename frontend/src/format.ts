import type { Criterion } from './types'

type T = (key: string, vars?: Record<string, string | number>) => string

export const num = (v: number, digits = 2) => (Math.round(v * 10 ** digits) / 10 ** digits).toLocaleString('en-US', { maximumFractionDigits: digits })

export const critKey = (c: Criterion) => c.id + (c.crop ? `:${c.crop}` : '') + (c.value === null ? ':todo' : '')

export function critLabel(c: Criterion, t: T) {
  if (c.value === null && c.id.startsWith('heat_days')) return t('crit.heat_days_1.todo.label')
  return t(`crit.${c.id}.label`) + (c.crop ? ` (${t('crop.' + c.crop)})` : '')
}

// Deterministic templates filled from computed values; no generated text.
export function critText(c: Criterion, t: T): string {
  const v = c.value
  switch (c.id) {
    case 'mean_ks_mid': return t('crit.mean_ks_mid.text', { v: num(v ?? 0), p10: num(c.p10 ?? 0) })
    case 'water_stress_days': return t('crit.water_stress_days.text', { v: num(v ?? 0, 0) })
    case 'bare_months': return t('crit.bare_months.text', { v: num(v ?? 0, 1) })
    case 'heat_days_1':
    case 'heat_days_2':
      if (v === null) return t('crit.heat_days_1.todo', { crops: (c.crops ?? []).map((x) => t('crop.' + x)).join(', ') })
      return t(`crit.${c.id}.text`, { list: Object.entries(c.by_crop ?? {}).map(([k, x]) => `${t('crop.' + k)}: ${num(x, 1)}`).join('; ') })
    case 'min_winter_tmin_no_snow': return t('crit.min_winter_tmin_no_snow.text', { v: num(v ?? 0, 1) })
    case 'return_years':
      return t('crit.return_years.text', { crop: t('crop.' + (c.crop ?? '')), v: v ?? 0, norm: c.norm ?? t('crit.norm.none') })
    default: return c.text
  }
}

export const slope = (xs: number[], ys: number[]) => {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  return xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0)
}
