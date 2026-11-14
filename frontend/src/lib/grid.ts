// The NASA POWER grid (public/data/grid.json) and the lookup from coordinates to a cell.
import { useEffect, useState } from 'react'
import type { GridCell, GridDoc } from '../types'

let cache: Promise<GridDoc> | null = null
export const loadGrid = (): Promise<GridDoc> => {
  if (!cache) cache = fetch('/data/grid.json').then((r) => { if (!r.ok) throw new Error('grid.json'); return r.json() })
  return cache
}

export type GridState = { state: 'loading' } | { state: 'error' } | { state: 'ready'; grid: GridDoc }

export function useGrid(): GridState {
  const [s, setS] = useState<GridState>({ state: 'loading' })
  useEffect(() => { loadGrid().then((grid) => setS({ state: 'ready', grid })).catch(() => { cache = null; setS({ state: 'error' }) }) }, [])
  return s
}

// A point belongs to the cell centred at (c.lat, c.lon) when it is within half a cell on both axes.
export function findCell(grid: GridDoc, lat: number, lon: number): GridCell | null {
  const [dLat, dLon] = grid.cell_size_deg
  return grid.cells.find((c) => Math.abs(lat - c.lat) <= dLat / 2 && Math.abs(lon - c.lon) <= dLon / 2) ?? null
}
