import type { Status } from '../types'
import './StatusChip.css'

const LABEL: Record<Status, string> = { data: 'Data', literature: 'Literature', estimate: 'Estimate', todo: 'To do' }

export default function StatusChip({ status, source }: { status: Status; source?: string }) {
  return <span className={`status status-${status}`} title={source}>{LABEL[status]}</span>
}
