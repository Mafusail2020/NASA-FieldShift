// Season twins: API client (GET /api/twin) with a saved-example fallback (public/data/twin_sample.json). Backend: core/twin.py.
import { useEffect, useState } from 'react'

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

export interface Twin {
  year: number; distance: number; sowing: string; harvest_date: string
  diff: { rain_mm: number; gdd: number; tmax_c: number }
  heat_days: number; late_rain_mm: number; late_dry_spell_days: number; cycle_rain_mm: number; frost_days: number
  next30_rain_mm: number | null; next30_heat_days: number | null; flags: string[]
}
export interface TwinSeries {
  days: number[]; now_rain: number[]; now_gdd: number[]
  twins: Record<string, { rain: number[]; gdd: number[] }>
  rain_min: number[]; rain_max: number[]; gdd_min: number[]; gdd_max: number[]
}
export type TwinResult =
  | { status: 'too_early'; days_since_sowing: number; min_days: number; as_of: string }
  | { status: 'no_data'; as_of: string }
  | {
    status: 'ok'; crop: string; sowing: string; as_of: string; days_since_sowing: number; cycle_d: number; years_compared: number
    twins: Twin[]; series: TwinSeries; cell: string; data_last_day: string; source: string; notes: string[]; note: string
    reference: { late_rain_mm_median: number; heat_days_median: number; cycle_rain_mm_median: number }
    windows: { heat_from: number; heat_to: number; heat_tmax_c: number; late_from: number; late_to: number }
  }

export const TWIN_CROPS = ['winter_wheat', 'maize']
export const TYPICAL_SOWING: Record<string, [number, number]> = { winter_wheat: [10, 1], maize: [4, 25] } // month, day

// A typical sowing date for the season now running (winter wheat sown last autumn until October).
export function typicalSowing(crop: string, today = new Date()): string {
  const [m, d] = TYPICAL_SOWING[crop] ?? [4, 25]
  const y = crop === 'winter_wheat' && today.getMonth() + 1 < 10 ? today.getFullYear() - 1 : today.getFullYear()
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export type TwinState = { state: 'idle' } | { state: 'loading' } | { state: 'error'; message: string }
  | { state: 'ready'; result: TwinResult; saved: boolean }

export function useTwin(lat: number | null, lon: number | null, crop: string | null, sowing: string | null, asOf: string): TwinState {
  const [s, setS] = useState<TwinState>({ state: 'idle' })
  useEffect(() => {
    if (lat == null || lon == null || !crop || !TWIN_CROPS.includes(crop) || !sowing) { setS({ state: 'idle' }); return }
    let dead = false
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    setS({ state: 'loading' })
    const q = new URLSearchParams({ lat: String(lat), lon: String(lon), crop, sowing, ...(asOf ? { as_of: asOf } : {}) })
    fetch(`${API}/api/twin?${q}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (dead) return
        if (r.ok) return setS({ state: 'ready', result: (await r.json()) as TwinResult, saved: false })
        let detail = ''
        try { detail = (await r.json()).detail ?? '' } catch { /* not JSON */ }
        if (r.status < 500) return setS({ state: 'error', message: typeof detail === 'string' && detail ? detail : `Request failed (${r.status}).` })
        throw new Error(String(r.status))
      })
      .catch(async (e) => {
        if (dead) return
        try {
          const r = await fetch('/data/twin_sample.json')
          if (!r.ok) throw e
          if (dead) return
          setS({ state: 'ready', result: (await r.json()) as TwinResult, saved: true })
        } catch { setS({ state: 'error', message: 'The server did not answer and there is no saved example.' }) }
      })
      .finally(() => clearTimeout(timer))
    return () => { dead = true; clearTimeout(timer); ctrl.abort() }
  }, [lat, lon, crop, sowing, asOf])
  return s
}
