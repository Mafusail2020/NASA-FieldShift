import { critKey, critLabel, critText } from '../format'
import { useI18n } from '../i18n'
import type { EvaluateResponse } from '../types'
import { Info, Num } from './Num'

export function CriteriaTable({ res }: { res: EvaluateResponse }) {
  const { t } = useI18n()
  const cols = [{ id: t('rot.you'), ev: res.farmer, name: res.farmer.rotation.map((c) => t('crop.' + c)).join(' → ') },
    ...res.alternatives.map((a) => ({ id: a.id, ev: a.evaluation, name: a.evaluation.rotation.map((c) => t('crop.' + c)).join(' → ') }))]
  const all = cols.flatMap((c) => c.ev.criteria)
  const keys = Array.from(new Set(all.map(critKey)))
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr><th>{t('rot.table')}</th>{cols.map((c) => <th key={c.id} title={c.name}>{c.id}<div className="sub">{c.name}</div></th>)}</tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const row = all.find((c) => critKey(c) === k)!
            return (
              <tr key={k}>
                <td>{critLabel(row, t)} <Info source={row.source} status={row.status} /></td>
                {cols.map((c) => {
                  const x = c.ev.criteria.find((y) => critKey(y) === k)
                  return <td key={c.id} title={x ? critText(x, t) : ''}>{x ? <Num value={x.value} unit={x.unit} status={x.status} source={x.source} /> : '—'}</td>
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="legend">{t('rot.alt.note')} {t('status.legend')}</p>
    </div>
  )
}
