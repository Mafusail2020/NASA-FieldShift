export type LayerStatus = 'data' | 'literature' | 'estimate' | 'todo'

export interface LayerMeta {
  label: string; group: string; unit: string; trend_unit: string
  color_by: 'trend' | 'value'; ramp: 'diverging' | 'sequential'
  description: string; source: string; status: LayerStatus
  disabled: boolean; reason: string | null
  kind?: 'frost'; thresholds?: Record<string, string> // frost layers: one record per threshold key (t0, t2, t4)
}
export interface CellLayer { value: number | null; trend: number | null; p_value: number | null; n_years: number; y?: (number | null)[]; line?: [number, number] | null; threshold_mm?: number }
export interface LayersDoc {
  years: [number, number]; alpha: number; min_years: number; note: string
  layers: Record<string, LayerMeta>
  series_coding?: string
  cells: Record<string, Record<string, CellLayer | Record<string, FrostEntry | null> | Record<string, (number | null)[]>>>
}

// Frost layers: d10/d50/d90 are days of year in a non-leap calendar; the season layer has `days`.
// A null date means the percentile falls on a year with no frost in the search window (no frost by then / frost-free through December).
export interface FrostEntry { d10?: number | null; d50?: number | null; d90?: number | null; n_frost?: number; days?: number; capped?: boolean; n_years: number }
export const THRESHOLD_ORDER = ['t0', 't2', 't4']

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LEN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
export function doyLabel(doy: number): string {
  let d = Math.round(doy), m = 0
  while (m < 11 && d > LEN[m]) { d -= LEN[m]; m++ }
  return `${MONTHS[m]} ${d}`
}

export const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
