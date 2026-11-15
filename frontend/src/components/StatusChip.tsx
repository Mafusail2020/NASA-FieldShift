import type { Status } from '../types'
import './StatusChip.css'

const LABEL: Record<Status, string> = { data: 'Data', literature: 'Literature', estimate: 'Estimate', sample: 'Sample', todo: 'To do' }

// quiet: a section that says "all numbers here are estimates" once shows chips only for the exceptions (data, literature).
export default function StatusChip({ status, source, quiet }: { status: Status; source?: string; quiet?: boolean }) {
  if (quiet && (status === 'estimate' || status === 'sample' || status === 'todo')) return null
  return <span className={`status status-${status}`} title={source}>{LABEL[status]}</span>
}
