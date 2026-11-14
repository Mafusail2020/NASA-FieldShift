import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import { HttpError, useBackend } from '../backend'
import { num } from '../format'
import { useI18n } from '../i18n'
import type { DefaultRow, EconomicsResponse } from '../types'
import { Info, Num } from './Num'

const PRICE_CROPS = ['winter_wheat', 'maize']
const COST_CROPS = ['winter_wheat', 'maize', 'black_fallow']

export function MoneyTab({ region, rotation, area }: { region: string; rotation: string[]; area: number }) {
  const { t } = useI18n()
  const backend = useBackend()
  const [defaults, setDefaults] = useState<DefaultRow[]>([])
  const [price, setPrice] = useState<Record<string, string>>({})
  const [cost, setCost] = useState<Record<string, string>>({})
  const [useK, setUseK] = useState(true)
  const [res, setRes] = useState<EconomicsResponse | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    backend.defaults().then((d) => {
      setDefaults(d.prices_costs)
      const fill = (param: string, crops: string[]) => Object.fromEntries(crops.map((c) => {
        const r = d.prices_costs.find((x) => x.crop === c && x.parameter === param)
        return [c, r && r.value !== null ? String(r.value) : '']
      }))
      setPrice(fill('price_uah_per_t', PRICE_CROPS))
      setCost(fill('cost_uah_per_ha', COST_CROPS))
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 300 ms debounce before calling /api/economics
  useEffect(() => {
    const parse = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && !isNaN(Number(v))).map(([k, v]) => [k, Number(v)]))
    const timer = setTimeout(() => {
      backend.economics({ region, rotation, use_k: useK, price: parse(price), cost: parse(cost) })
        .then((r) => { setRes(r); setMsg(null) })
        .catch((e) => {
          setRes(null)
          if (e instanceof HttpError && e.status === 0) setMsg(t('offline.money'))
          else if (e instanceof HttpError && e.status === 503) setMsg(t('money.noyields'))
          else if (e instanceof HttpError && e.status === 422) setMsg(t('money.missing', { detail: e.message }))
          else setMsg(t('error'))
        })
    }, 300)
    return () => clearTimeout(timer)
  }, [region, rotation.join(','), useK, price, cost, backend.offline]) // eslint-disable-line react-hooks/exhaustive-deps

  const row = (c: string, param: string) => defaults.find((d) => d.crop === c && d.parameter === param)
  const input = (kind: 'price' | 'cost', c: string) => {
    const state = kind === 'price' ? price : cost
    const set = kind === 'price' ? setPrice : setCost
    const d = row(c, kind === 'price' ? 'price_uah_per_t' : 'cost_uah_per_ha')
    const yr = kind === 'price' ? row(c, 'price_year') : undefined
    return (
      <label key={kind + c} className="field">
        {t('crop.' + c)}, {t(kind === 'price' ? 'money.price' : 'money.cost')}
        <input type="number" min="0" value={state[c] ?? ''} disabled={backend.offline} onChange={(e) => set({ ...state, [c]: e.target.value })} />
        {d && <Info source={`${d.source || '—'}${yr && yr.value ? `, ${yr.value}` : ''}`} status={d.status} />}
        {d && d.status === 'todo' && state[c] === '' && <sup>{t('status.todo')}</sup>}
      </label>
    )
  }

  const farmer = res?.farmer
  const points = farmer ? Object.entries(farmer.margins).map(([y, v]) => ({ year: Number(y), margin: Math.round(v) })) : []
  const median = farmer?.summary.median
  const alts = res ? Object.entries(res.alternatives).map(([id, m]) => ({ id, median: Math.round(m.summary.median) })) : []
  return (
    <div>
      <h2>{t('money.title')}</h2>
      <section className="card">
        <h3>{t('money.inputs')}</h3>
        <div className="fields">{PRICE_CROPS.map((c) => input('price', c))}{COST_CROPS.map((c) => input('cost', c))}</div>
        <label className="field inline"><input type="checkbox" checked={useK} onChange={(e) => setUseK(e.target.checked)} /> {t('money.k')}</label>
        <p className="legend">{t('money.k.hint')}</p>
      </section>
      {msg && <p className="todo">{msg}</p>}
      {farmer && median !== undefined && (<>
        <ul>
          <li>{t('money.median')}: <Num value={median} unit="UAH/ha" digits={0} status="estimate" source={res!.note} /></li>
          <li>{t('money.total', { area })}: <Num value={median * area} unit="UAH" digits={0} status="estimate" source={res!.note} /></li>
          <li>{t('money.loss', { n: farmer.summary.loss_years, N: farmer.summary.n_years })}</li>
          {farmer.break_even.map((b) => (
            <li key={b.crop}>{t('money.be', { crop: t('crop.' + b.crop), y: num(b.yield_t_ha), p: num(b.price_uah_t, 0), k: num(b.k) })}</li>))}
          <li>{t('money.best', { a: res!.best_alternative_with_k, b: res!.best_alternative_without_k })} {res!.best_alternative_with_k === res!.best_alternative_without_k ? t('money.same') : t('money.diff')}</li>
        </ul>
        <section className="card">
          <h3>{t('money.chart')}</h3>
          <ResponsiveContainer width="100%" height={240}>
            <ScatterChart><CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 10 }} />
              <YAxis dataKey="margin" type="number" width={64} />
              <Tooltip />
              <ReferenceLine y={0} stroke="#b00020" />
              <ReferenceLine y={median} stroke="#1976d2" strokeDasharray="4 2" label={t('money.median')} />
              <Scatter data={points} fill="#2e7d32" isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
        </section>
        <section className="card">
          <h3>{t('money.alts')}</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={alts}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="id" /><YAxis width={64} /><Tooltip />
              <ReferenceLine y={0} stroke="#b00020" /><Bar dataKey="median" fill="#7cb342" isAnimationActive={false} /></BarChart>
          </ResponsiveContainer>
        </section>
      </>)}
    </div>
  )
}
