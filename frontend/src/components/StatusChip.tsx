import { useEffect } from 'react'
import { registerSource } from '../lib/sources'
import type { Status } from '../types'
import './StatusChip.css'

const LABEL: Record<Status, string> = { data: 'Data', literature: 'Literature', estimate: 'Estimate', sample: 'Sample', todo: 'To do', web: 'Web' }

export const STATUS_LABEL = LABEL

// Source and status labels do not sit next to the numbers: the chip registers (status, source) and the "Sources and status" block at the
// bottom of the page (SourcesFold) lists them. The one exception is "Sample": sample data must always be marked where it is shown.
// `quiet` is kept for the callers that pass it; it no longer matters because nothing but "Sample" is drawn.
export default function StatusChip({ status, source }: { status: Status; source?: string; quiet?: boolean }) {
  useEffect(() => (source ? registerSource(status, source) : undefined), [status, source])
  if (status !== 'sample') return null
  return <span className={`status status-${status}`} title={source}>{LABEL[status]}</span>
}
