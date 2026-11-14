import { useEffect, useState } from 'react'
import type { CellLayer, LayersDoc } from './types'

export type LayersLoad = { state: 'loading' } | { state: 'error' } | { state: 'ready'; doc: LayersDoc }
let cache: Promise<LayersDoc> | null = null
const loadDoc = () => (cache ??= fetch('/data/grid_layers.json').then((r) => { if (!r.ok) throw new Error('missing'); return r.json() }).catch((e) => { cache = null; throw e }))

/** public/data/grid_layers.json, one request shared by everything that needs it. */
export function useLayersDoc(): LayersLoad {
  const [load, setLoad] = useState<LayersLoad>({ state: 'loading' })
  useEffect(() => {
    let live = true
    loadDoc().then((doc) => live && setLoad({ state: 'ready', doc })).catch(() => live && setLoad({ state: 'error' }))
    return () => { live = false }
  }, [])
  return load
}

export const mean = (xs: (number | null | undefined)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN }
/** A trend is clear when the Mann-Kendall test gives p < 0.05. */
export const clear = (c?: CellLayer) => !!c && c.p_value != null && c.p_value < 0.05
export const round10 = (v: number) => Math.round(v / 10) * 10
export const yearsOf = (doc: LayersDoc) => Array.from({ length: doc.years[1] - doc.years[0] + 1 }, (_, i) => doc.years[0] + i)
/** Mean of a layer's yearly values between two years (inclusive); NaN when none. */
export const decadeMean = (years: number[], c: CellLayer | undefined, a: number, b: number) => mean(c?.y ? c.y.filter((_, i) => years[i] >= a && years[i] <= b) : [])
export const ok = (c?: CellLayer): c is CellLayer => !!c && c.value != null && !!c.y
