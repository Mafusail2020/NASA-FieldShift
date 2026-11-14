// Rough extent of the analysed area (Ukraine); the grid decides what is actually covered.
export const LAT_RANGE = [44, 53]
export const LON_RANGE = [22, 41]

// Decimal degrees; a comma may be the decimal separator. Empty or not a number gives null.
export function num(s: string): number | null {
  const t = s.trim().replace(',', '.')
  if (!t) return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

// A pasted pair such as '49.84, 24.03', '49.84 24.03' or '49,84; 24,03'.
export function parsePair(s: string): [string, string] | null {
  const m = s.trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/)
  return m ? [m[1].replace(',', '.'), m[2].replace(',', '.')] : null
}
