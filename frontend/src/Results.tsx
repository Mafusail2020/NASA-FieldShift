import { useEffect, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { evaluate, health, regions } from './api'
import type { Criterion, EvaluateResponse, Evaluation, Region } from './types'

const CROPS = ['winter_wheat', 'maize', 'black_fallow']
const COLOR: Record<string, string> = { winter_wheat: '#d9b44a', maize: '#7cb342', black_fallow: '#9e9e9e', bare: '#cfcfcf' }
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

function Strip({ ev }: { ev: Evaluation }) {
  const data = ev.strip.flatMap((s, i) =>
    s.months.map((m) => ({ x: `${i + 1}${MONTHS[m.month - 1]}`, water: m.frac == null ? null : Math.round(m.frac * 100) })))
  return (
    <div className="strip">
      {ev.strip.map((s) => (
        <div key={s.slot} className="year">
          <div className="yl">Year {s.slot + 1}: {s.crop}</div>
          <div className="months">
            {s.months.map((m) => (
              <div key={m.month} className="cell" title={`${m.label ?? '?'}`}
                style={{ background: COLOR[m.label ?? 'bare'] ?? COLOR.bare, opacity: m.label === 'bare' || m.label === 'black_fallow' ? 0.55 : 1 }}>
                {MONTHS[m.month - 1]}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div style={{ height: 160 }}>
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="x" interval={0} tick={{ fontSize: 9 }} />
            <YAxis domain={[0, 100]} unit="%" width={44} />
            <Tooltip />
            <Line dataKey="water" name="Soil water, % of TAW (median year)" stroke="#1976d2" dot={false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="legend">Grey = bare soil (incl. black fallow). Blue line = median soil water as a share of plant-available water.</div>
    </div>
  )
}

const rowKey = (c: Criterion) => c.id + (c.crop ? `:${c.crop}` : '')
const fmt = (c: Criterion | undefined) =>
  !c ? '—' : c.value == null ? 'n/a' : `${Math.round(c.value * 100) / 100}${c.unit ? ' ' + c.unit : ''}`

function Table({ res }: { res: EvaluateResponse }) {
  const cols = [{ id: 'You', ev: res.farmer, name: res.farmer.rotation.join(' → ') }, ...res.alternatives.map((a) => ({ id: a.id, ev: a.evaluation, name: a.name }))]
  const keys = Array.from(new Set(cols.flatMap((c) => c.ev.criteria.map(rowKey))))
  const label = (k: string) => cols.flatMap((c) => c.ev.criteria).find((c) => rowKey(c) === k)!
  return (
    <table>
      <thead>
        <tr><th>Criterion</th>{cols.map((c) => <th key={c.id} title={c.name}>{c.id}<div className="sub">{c.name}</div></th>)}</tr>
      </thead>
      <tbody>
        {keys.map((k) => {
          const l = label(k)
          return (
            <tr key={k}>
              <td title={l.source}>{l.label}{l.crop ? ` (${l.crop})` : ''} <span className="info" title={`${l.source} [${l.status}]`}>ℹ</span></td>
              {cols.map((c) => {
                const x = c.ev.criteria.find((y) => rowKey(y) === k)
                return <td key={c.id} className={x ? `st-${x.status}` : ''} title={x ? `${x.text}\n${x.source} [${x.status}]` : ''}>
                  {fmt(x)}{x && (x.status === 'estimate' || x.status === 'todo') ? <sup> {x.status}</sup> : null}
                </td>
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default function Results() {
  const [regs, setRegs] = useState<Region[]>([])
  const [region, setRegion] = useState('poltavska')
  const [soil, setSoil] = useState('medium')
  const [rotation, setRotation] = useState<string[]>(['winter_wheat', 'maize'])
  const [res, setRes] = useState<EvaluateResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [api, setApi] = useState('…')

  useEffect(() => { health().then((h) => setApi(h.status)).catch(() => setApi('unreachable')); regions().then(setRegs).catch(() => {}) }, [])
  useEffect(() => {
    setErr(null)
    evaluate(region, rotation, soil).then(setRes).catch((e) => setErr(String(e)))
  }, [region, soil, rotation])

  const setCrop = (i: number, c: string) => setRotation(rotation.map((x, j) => (j === i ? c : x)))
  return (
    <main>
      <h1>Field Shift <small>API: {api}</small></h1>
      <p className="note">Analysis for the oblast, not your specific field. Rough prototype; <sup>estimate</sup> marks values without a firm source.</p>
      <div className="controls">
        <label>Oblast <select value={region} onChange={(e) => setRegion(e.target.value)}>
          {regs.map((r) => <option key={r.id} value={r.id}>{r.name_en}</option>)}</select></label>
        <label>Soil <select value={soil} onChange={(e) => setSoil(e.target.value)}>
          {['light', 'medium', 'heavy'].map((s) => <option key={s}>{s}</option>)}</select></label>
        <div>Your rotation (one crop per year, repeating):
          {rotation.map((c, i) => (
            <span key={i} className="pick">
              <select value={c} onChange={(e) => setCrop(i, e.target.value)}>{CROPS.map((x) => <option key={x}>{x}</option>)}</select>
              {rotation.length > 1 && <button onClick={() => setRotation(rotation.filter((_, j) => j !== i))}>×</button>}
            </span>
          ))}
          {rotation.length < 6 && <button onClick={() => setRotation([...rotation, 'maize'])}>+ year</button>}
        </div>
      </div>
      {err && <p className="err">{err}</p>}
      {res && (<>
        <h2>Your rotation by month</h2>
        <Strip ev={res.farmer} />
        <h2>Criteria: you vs alternatives A–E</h2>
        <p className="note">{res.farmer.note} Years {res.farmer.years.join('–')}. No single score.</p>
        <Table res={res} />
        <ul>{res.farmer.criteria.map((c) => <li key={rowKey(c)}>{c.text}</li>)}</ul>
      </>)}
    </main>
  )
}
