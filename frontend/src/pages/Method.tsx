import { useEffect, useState } from 'react'
import { useBackend } from '../backend'
import { useI18n } from '../i18n'
import type { Meta, ParamRow, Status } from '../types'

function Badge({ status }: { status: Status }) {
  const { t } = useI18n()
  return <span className={`badge st-${status}`}>{t('status.' + status)}</span>
}

function ParamTable({ rows, keyCol }: { rows: ParamRow[]; keyCol: 'crop' | 'soil' | null }) {
  const { t } = useI18n()
  return (
    <div className="scroll">
      <table>
        <thead><tr>{keyCol && <th>{keyCol}</th>}<th>{t('method.col.param')}</th><th>{t('method.col.value')}</th><th>{t('method.col.unit')}</th><th>{t('method.col.source')}</th><th>{t('method.col.status')}</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`st-${r.status}`}>
              {keyCol && <td>{r.soil ? t('soil.' + r.soil) : t('crop.' + (r.crop ?? ''))}</td>}
              <td>{r.parameter}</td>
              <td>{r.value === '' ? <em>{t('method.empty')}</em> : r.value}</td>
              <td>{r.unit}</td>
              <td className="srccell">{r.source || '—'}</td>
              <td><Badge status={r.status} /></td>
            </tr>))}
        </tbody>
      </table>
    </div>
  )
}

export default function Method() {
  const { t, lang } = useI18n()
  const backend = useBackend()
  const [m, setM] = useState<Meta | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => { backend.meta().then(setM).catch(() => setErr(true)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <main><p className="err">{t('error')}</p></main>
  if (!m) return <main><p>{t('loading')}</p></main>
  const todo = m.crops.filter((r) => r.status === 'todo').length
  const byCrop = Array.from(new Set(m.crops.map((r) => r.crop as string)))
  const val = m.validation
  return (
    <main className="method">
      <h1>{t('method.title')}</h1>
      <p>{t('method.intro')}</p>

      <h2>{t('method.datasets')}</h2>
      <ul>{m.datasets.map((d) => (
        <li key={d.name}><strong>{d.name}</strong> <Badge status={d.status} /><br />{lang === 'uk' ? d.detail_uk : d.detail_en}<br /><span className="legend">{t('source')}: {d.source}</span></li>))}</ul>

      <h2>{t('method.formulas')}</h2>
      <ul>{m.formulas.map((f) => <li key={f.name}><strong>{f.name}.</strong> {lang === 'uk' ? f.text_uk : f.text_en} <span className="legend">({f.source})</span></li>)}</ul>

      <h2>{t('method.crops')}</h2>
      <p className="legend">{t('method.todocount', { n: todo, N: m.crops.length })} {t('status.legend')}</p>
      {byCrop.map((c) => (
        <details key={c}><summary>{t('crop.' + c)} ({m.crops.filter((r) => r.crop === c && r.status === 'todo').length} todo)</summary>
          <ParamTable rows={m.crops.filter((r) => r.crop === c)} keyCol={null} /></details>))}

      <h2>{t('method.soils')}</h2>
      <ParamTable rows={m.soils} keyCol="soil" />
      <h2>{t('method.model')}</h2>
      <ParamTable rows={m.model} keyCol={null} />

      <h2>{t('method.validation')}</h2>
      <p>{t('method.val.pred')}</p>
      {val.crops
        ? Object.entries(val.crops).map(([crop, v]) => (
          <div key={crop} className="card">
            <h3>{t('crop.' + crop)} <Badge status={v.status} /></h3>
            {v.status === 'todo' ? <p className="todo">{v.note}</p> : (
              <ul>
                <li>{t('method.val.n')}: {v.n} ({v.years?.join('–')})</li>
                <li>{t('method.val.coef')}: {v.coef_ks?.toFixed(3)}; {t('method.val.se')}: {v.se_clustered?.toFixed(3)}; {t('method.val.p')}: {v.p_value?.toFixed(3)}; {t('method.val.r2')}: {v.r2?.toFixed(3)}</li>
                <li>{t('method.val.loyo')}: {v.loyo_coef_min?.toFixed(3)} … {v.loyo_coef_max?.toFixed(3)}</li>
              </ul>)}
          </div>))
        : <p className="todo">{t('method.val.todo')} <Badge status="todo" /></p>}

      <h2>{t('method.notmodelled')}</h2>
      <ul>{m.not_modelled.map((x) => <li key={x.en}>{lang === 'uk' ? x.uk : x.en}</li>)}</ul>
      <h2>{t('method.limitations')}</h2>
      <ul>{(lang === 'uk' ? m.limitations_uk : m.limitations).map((x) => <li key={x}>{x}</li>)}</ul>
      <h2>{t('method.ai')}</h2>
      <p>{lang === 'uk' ? m.ai_disclosure.uk : m.ai_disclosure.en}</p>
    </main>
  )
}
