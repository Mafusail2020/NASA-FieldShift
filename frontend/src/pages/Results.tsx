import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { HttpError, useBackend } from '../backend'
import { ClimateTab } from '../components/ClimateTab'
import { CriteriaTable } from '../components/CriteriaTable'
import { MoneyTab } from '../components/MoneyTab'
import { Strip } from '../components/Strip'
import { critKey, critText } from '../format'
import { useI18n } from '../i18n'
import type { EvaluateResponse, Region } from '../types'

type Tab = 'climate' | 'rotations' | 'money'

export default function Results() {
  const { t, lang } = useI18n()
  const backend = useBackend()
  const { region = '' } = useParams()
  const [q] = useSearchParams()
  const soil = q.get('soil') ?? 'medium'
  const area = Number(q.get('area')) || 100
  const rotation = (q.get('rot') ?? 'winter_wheat,maize').split(',')
  const [tab, setTab] = useState<Tab>('rotations')
  const [name, setName] = useState(region)
  const [res, setRes] = useState<EvaluateResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { backend.regions().then((rs: Region[]) => { const r = rs.find((x) => x.id === region); if (r) setName(lang === 'uk' ? r.name_uk : r.name_en) }).catch(() => {}) }, [region, lang]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setErr(null)
    backend.evaluate(region, rotation, soil).then(setRes).catch((e) => setErr(e instanceof HttpError && e.message === 'offline-limit' ? t('offline.limit') : t('error')))
  }, [region, soil, rotation.join(','), backend.offline]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main>
      <Link to="/">{t('res.back')}</Link>
      <h1>{t('res.title', { region: name })}</h1>
      <div className="tabs" role="tablist">
        {(['climate', 'rotations', 'money'] as Tab[]).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{t('tab.' + k)}</button>))}
      </div>
      {tab === 'climate' && <ClimateTab region={region} soil={soil} />}
      {tab === 'rotations' && (err ? <p className="err">{err}</p> : !res ? <p>{t('loading')}</p> : (
        <div>
          <h2>{t('rot.strip')}</h2>
          <Strip ev={res.farmer} />
          <p className="legend">{t('res.years', { a: res.farmer.years[0], b: res.farmer.years[1] })}</p>
          <CriteriaTable res={res} />
          <ul>{res.farmer.criteria.map((c) => <li key={critKey(c)}>{critText(c, t)}</li>)}</ul>
        </div>))}
      {tab === 'money' && <MoneyTab region={region} rotation={rotation} area={area} />}
    </main>
  )
}
