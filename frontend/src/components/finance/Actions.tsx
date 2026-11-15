import type { Tone } from './Kpi'
import './FinanceReport.css'

export interface Action { tone: Tone; text: string; href?: string }

/** Up to three rule-based chips under the verdict. Each is one short sentence from the numbers on the page. */
export function Actions({ items }: { items: Action[] }) {
  if (items.length === 0) return null
  return (
    <ul className="fin-actions reveal" style={{ '--i': 2 } as React.CSSProperties} aria-label="Suggestions">
      {items.slice(0, 3).map((a) => (
        <li key={a.text} className={`fin-tone-${a.tone}`}>{a.href ? <a href={a.href}>{a.text}</a> : a.text}</li>
      ))}
    </ul>
  )
}
