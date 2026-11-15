// CSV download of the report numbers. Plain values only; no data is invented here.
export type Cell = string | number | null
const esc = (c: Cell) => { const s = c == null ? '' : String(c); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

export function downloadCsv(name: string, rows: Cell[][]) {
  const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}
