import { useI18n } from '../i18n'
import { num } from '../format'
import type { Status } from '../types'

// Every number: a source tooltip (ℹ) and a visible marker when the value is an estimate or still todo.
export function Info({ source, status }: { source: string; status: Status }) {
  const { t } = useI18n()
  return <span className="info" title={`${t('source')}: ${source} [${t('status.' + status)}]`}>ℹ</span>
}

export function Num({ value, unit = '', digits = 2, status, source }: { value: number | null; unit?: string; digits?: number; status: Status; source: string }) {
  const { t } = useI18n()
  const ut = unit ? t('unit.' + unit) : ''
  const u = ut === 'unit.' + unit ? unit : ut
  return (
    <span className={`num st-${status}`}>
      {value === null ? 'n/a' : `${num(value, digits)}${u ? ' ' + u : ''}`}
      {(status === 'estimate' || status === 'todo') && <sup>{t('status.' + status)}</sup>}
      <Info source={source} status={status} />
    </span>
  )
}
