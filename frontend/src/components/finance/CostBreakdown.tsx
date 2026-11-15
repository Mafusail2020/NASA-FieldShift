import { fmtMoney, type CostItem } from '../../lib/finance'
import StatusChip from '../StatusChip'
import Info from './Info'
import './FinanceReport.css'

const LABEL: Record<string, string> = { seed: 'Seed', fertilizer: 'Fertilizer', protection: 'Protection', fuel: 'Fuel', labour: 'Labour', rent: 'Rent', overhead: 'Overhead' }

/** Sample cost items as one stacked bar: variable (darker) then fixed (lighter), with a legend and the two subtotals. */
export function CostBreakdown({ items, cur, rate, source }: { items: CostItem[]; cur: string; rate: number; source: string }) {
  const conv = (usd: number) => (cur === 'USD' ? usd : usd * rate)
  const total = items.reduce((t, i) => t + i.usd_per_ha, 0) || 1
  const sum = (k: CostItem['kind']) => items.filter((i) => i.kind === k).reduce((t, i) => t + conv(i.usd_per_ha), 0)
  const ordered = [...items.filter((i) => i.kind === 'variable'), ...items.filter((i) => i.kind === 'fixed')]
  return (
    <section className="fin-card reveal" style={{ '--i': 4 } as React.CSSProperties} aria-labelledby="fin-cost-h">
      <div className="fin-head-row">
        <h2 id="fin-cost-h">Cost, {cur}/ha</h2><StatusChip status="sample" source={source} />
        <Info text="Illustrative sample items, not a real source. Type your own cost below to replace the total. Gross margin = revenue minus variable cost; net margin also subtracts fixed cost." />
      </div>
      <div className="fin-stack" role="img" aria-label={ordered.map((i) => `${LABEL[i.item] ?? i.item} ${fmtMoney(conv(i.usd_per_ha))}`).join(', ')}>
        {ordered.map((i) => <span key={i.item} className={`fin-seg-${i.kind}`} style={{ width: `${(i.usd_per_ha / total) * 100}%` }} title={`${LABEL[i.item] ?? i.item}: ${fmtMoney(conv(i.usd_per_ha))} ${cur}`} />)}
      </div>
      <ul className="fin-legend">
        {ordered.map((i) => <li key={i.item}><i className={`fin-dot-${i.kind}`} aria-hidden="true" />{LABEL[i.item] ?? i.item} <b>{fmtMoney(conv(i.usd_per_ha))}</b></li>)}
      </ul>
      <p className="fin-muted">Variable <b>{fmtMoney(sum('variable'))}</b> · Fixed <b>{fmtMoney(sum('fixed'))}</b> · Total <b>{fmtMoney(sum('variable') + sum('fixed'))}</b></p>
    </section>
  )
}
