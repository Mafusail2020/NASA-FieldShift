import { fmtMoney } from '../../lib/finance'

/** Compact money for tight labels: 2.3M, 470k, 850. */
export const fmtShort = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e4 ? `${Math.round(v / 1e3)}k` : fmtMoney(v))

/** One range drawn on a scale from 0 to its high end: the pale part is the amount reached in nearly every case, the dark part the spread. */
export function RangeBar({ low, high, cur, label }: { low: number; high: number; cur: string; label: string }) {
  const top = Math.max(high, 0) || 1
  const l = Math.max(0, Math.min(100, (low / top) * 100))
  return (
    <div className="rbar" role="img" aria-label={`${label}: ${fmtMoney(low)} to ${fmtMoney(high)} ${cur}`}>
      <span className="rbar-track"><span className="rbar-low" style={{ width: `${l}%` }} /><span className="rbar-spread" style={{ left: `${l}%`, width: `${100 - l}%` }} /></span>
      <span className="rbar-ends"><span>{fmtShort(low)}</span><span>{fmtShort(high)} {cur}</span></span>
    </div>
  )
}
