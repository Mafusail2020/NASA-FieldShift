import { Children, type ReactNode } from 'react'
import Info from './Info'
import './FinanceReport.css'

export type Tone = 'ok' | 'warn' | 'loss' | 'todo'
const GLYPH: Record<Tone, string> = { ok: '✓', warn: '!', loss: '✕', todo: '–' }
const WORD: Record<Tone, string> = { ok: 'OK', warn: 'Watch', loss: 'Loss', todo: 'No data' }

/** One KPI tile: label, value, flag (glyph + hidden word, never colour alone) and a short sub-line. */
export function Kpi({ label, value, tone, sub, info }: { label: string; value: ReactNode; tone: Tone; sub?: ReactNode; info?: string }) {
  return (
    <div className={`fin-kpi fin-tone-${tone}`}>
      <span className="fin-kpi-label">{label}{info && <Info text={info} />}</span>
      <span className="fin-kpi-value">{value}</span>
      <span className="fin-kpi-sub"><b aria-hidden="true">{GLYPH[tone]}</b><span className="sr-only">{WORD[tone]}</span>{sub != null && <> {sub}</>}</span>
    </div>
  )
}

export const Kpis = ({ children }: { children: ReactNode }) => <div className={`fin-kpis fin-kpis-${Children.count(children)} reveal`} style={{ '--i': 2 } as React.CSSProperties}>{children}</div>
