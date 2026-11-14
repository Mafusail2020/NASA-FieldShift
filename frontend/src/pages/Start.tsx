import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBackend } from '../backend'
import { StartMap } from '../components/StartMap'
import { useI18n } from '../i18n'
import type { Region } from '../types'

export const CROPS = ['winter_wheat', 'maize', 'black_fallow']

export default function Start() {
  const { t, lang } = useI18n()
  const backend = useBackend()
  const nav = useNavigate()
  const [regions, setRegions] = useState<Region[]>([])
  const [region, setRegion] = useState('')
  const [soil, setSoil] = useState('medium')
  const [area, setArea] = useState(100)
  const [rotation, setRotation] = useState<string[]>(['winter_wheat', 'maize'])
  useEffect(() => { backend.regions().then(setRegions).catch(() => {}) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const maxYears = backend.offline ? 3 : 6
  const go = () => nav(`/results/${region}?soil=${soil}&area=${area}&rot=${rotation.join(',')}`)
  return (
    <main>
      <h1>{t('start.title')}</h1>
      <p className="notice">{t('start.notice')}</p>
      <StartMap value={region} onPick={setRegion} />
      <p className="legend">{t('start.map')}</p>
      <div className="form">
        <label className="field">{t('start.region')}
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">{t('start.pick')}</option>
            {regions.map((r) => <option key={r.id} value={r.id}>{lang === 'uk' ? r.name_uk : r.name_en}</option>)}
          </select></label>
        <label className="field">{t('start.soil')}
          <select value={soil} onChange={(e) => setSoil(e.target.value)}>
            {['light', 'medium', 'heavy'].map((s) => <option key={s} value={s}>{t('soil.' + s)}</option>)}</select></label>
        <label className="field">{t('start.area')}
          <input type="number" min="1" value={area} onChange={(e) => setArea(Math.max(1, Number(e.target.value) || 1))} /></label>
        <div>
          <div>{t('start.rotation')}</div>
          {rotation.map((c, i) => (
            <span key={i} className="pick">
              <select value={c} onChange={(e) => setRotation(rotation.map((x, j) => (j === i ? e.target.value : x)))}>
                {CROPS.map((x) => <option key={x} value={x}>{t('crop.' + x)}</option>)}</select>
              {rotation.length > 1 && <button type="button" onClick={() => setRotation(rotation.filter((_, j) => j !== i))} aria-label="remove">×</button>}
            </span>
          ))}
          {rotation.length < maxYears && <button type="button" onClick={() => setRotation([...rotation, 'maize'])}>{t('start.addyear')}</button>}
        </div>
        <button className="primary" disabled={!region} onClick={go}>{t('start.go')}</button>
      </div>
    </main>
  )
}
