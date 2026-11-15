// "Sources and status": every source and status label of the numbers on the current page, collapsed at the bottom.
import { STATUS_LABEL } from './StatusChip'
import { useSources } from '../lib/sources'
import type { Status } from '../types'
import './SourcesFold.css'

const ORDER: Status[] = ['data', 'literature', 'estimate', 'sample', 'todo']
const MEANING: Record<Status, string> = {
  data: 'Measured or official data, read as published.',
  literature: 'A published value (paper, FAO table, law) used as is.',
  estimate: 'Our choice, assumption or model result. Treat it as a rough number, not a fact.',
  sample: 'Example numbers, not real data.',
  todo: 'Not available yet; the page shows "no data" instead of a guess.',
}

export default function SourcesFold() {
  const all = useSources()
  if (all.length === 0) return null
  return (
    <details className="srcfold">
      <summary>Sources and status <span className="srcfold-n">{all.length}</span></summary>
      <p className="srcfold-help">Every number on this page has a source and a status. They are listed here, so they do not crowd the page.</p>
      {ORDER.map((st) => {
        const items = all.filter((e) => e.status === st)
        if (!items.length) return null
        return (
          <section key={st} className="srcfold-grp" aria-label={STATUS_LABEL[st]}>
            <h3><span className={`status status-${st}`}>{STATUS_LABEL[st]}</span> <small>{MEANING[st]}</small></h3>
            <ul>{items.map((e) => <li key={e.key}>{e.source}</li>)}</ul>
          </section>
        )
      })}
    </details>
  )
}
