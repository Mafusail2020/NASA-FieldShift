import type { ReactNode } from 'react'
import type { Tone } from './Kpi'
import './FinanceReport.css'

/** Top block of the report: the bottom line first (value, range, one-line takeaway), flags after. */
export function Verdict({ label, value, cur, range, tone, take, flags }: { label: string; value: string; cur: string; range?: string; tone: Tone; take: ReactNode; flags?: ReactNode }) {
  return (
    <section className={`fin-verdict fin-tone-${tone} reveal`} style={{ '--i': 1 } as React.CSSProperties} aria-labelledby="fin-verdict-h" aria-live="polite">
      <h2 id="fin-verdict-h" className="fin-verdict-label">{label}</h2>
      <p className="fin-verdict-value">{value} <span>{cur}</span></p>
      {range && <p className="fin-verdict-range">{range} {cur}</p>}
      <p className="fin-take">{take}</p>
      {flags && <div className="fin-flags">{flags}</div>}
    </section>
  )
}
