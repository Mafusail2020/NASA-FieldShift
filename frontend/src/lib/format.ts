export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

export const fmt = (v: number, digits = 0) =>
  v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
