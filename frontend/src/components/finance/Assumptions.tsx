import { useEffect, useRef } from 'react'
import StatusChip from '../StatusChip'
import type { FStatus } from '../../lib/finance'
import './FinanceReport.css'

export interface AssumptionRow { name: string; value: string; year?: string; status: FStatus; source: string }

const NOTES = ['National yields, not your farm', 'Nominal prices, last year 2023', 'Raw yields: no trend, no war effect', 'Estimate, not a forecast']

/** One collapsed block with every input, its year, status and source (in the chip tooltip). Opens itself for printing. */
export function Assumptions({ rows }: { rows: AssumptionRow[] }) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    let was = false
    const before = () => { was = ref.current?.open ?? false; if (ref.current) ref.current.open = true }
    const after = () => { if (ref.current) ref.current.open = was }
    window.addEventListener('beforeprint', before); window.addEventListener('afterprint', after)
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after) }
  }, [])
  return (
    <details className="fin-card fin-assume reveal" style={{ '--i': 6 } as React.CSSProperties} ref={ref}>
      <summary><h2>Assumptions</h2></summary>
      <div className="fin-table-wrap">
        <table>
          <caption className="sr-only">Inputs, years, status and sources</caption>
          <thead><tr><th scope="col">Input</th><th scope="col">Value</th><th scope="col">Year</th><th scope="col">Status</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.name}><th scope="row">{r.name}</th><td>{r.value}</td><td>{r.year ?? '-'}</td><td><StatusChip status={r.status} source={r.source} /></td></tr>
          ))}</tbody>
        </table>
      </div>
      <ul className="fin-notes">{NOTES.map((n) => <li key={n}>{n}</li>)}</ul>
    </details>
  )
}
