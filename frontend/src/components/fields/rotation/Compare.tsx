import { useId, useMemo, useState } from 'react'
import StatusChip from '../../StatusChip'
import {
  CRITERIA, PRIORITIES, canonical, cropName, evaluate, sortKey, type Candidate, type CellRot, type EvalResult, type Evaluation,
  type Priority, type RotIndex, type Soil,
} from './model'
import { evidence, f, gaps, label, range, risks, why } from './texts'

interface Row { id: string; title: string; cand: Candidate | null; baseline: boolean; res: EvalResult; rot: string[] }

export function Compare({ index, cell, soil, current }: { index: RotIndex; cell: CellRot; soil: Soil; current: string[] }) {
  const uid = useId()
  const [prio, setPrio] = useState<Priority>('water')
  const soilName = index.soil_params.find((r) => r.soil === soil && r.parameter === 'texture')?.value ?? soil

  const { base, alts } = useMemo(() => {
    const base: Row | null = current.length
      ? { id: 'current', title: 'Your rotation', cand: null, baseline: true, rot: current, res: evaluate(current, index, cell, soil) } : null
    const seen = new Set(base ? [canonical(current)] : [])
    const alts: Row[] = []
    for (const c of index.candidates) {
      const key = canonical(c.crops)
      const dupe = seen.has(key)
      seen.add(key)
      alts.push({ id: c.id, title: `${c.id}. ${c.name}${dupe && base && canonical(current) === key ? ' (same as yours)' : ''}`, cand: c, baseline: false, rot: c.crops, res: evaluate(c.crops, index, cell, soil) })
    }
    return { base, alts: alts.filter((a) => !(base && canonical(a.rot) === canonical(base.rot))) }
  }, [index, cell, soil, current])

  const baseEv = base?.res.ok ? base.res.ev : null
  const computable = alts.filter((a) => a.res.ok) as (Row & { res: { ok: true; ev: Evaluation } })[]
  const ranked = [...computable].sort((a, b) => {
    const ka = sortKey(a.res.ev, prio), kb = sortKey(b.res.ev, prio)
    return ka == null ? 1 : kb == null ? -1 : ka - kb
  })
  const prioInfo = PRIORITIES.find((p) => p.id === prio)!
  const all = base ? [base, ...alts] : alts
  const cell2 = (ev: Evaluation, k: 'ks' | 'wsd' | 'heat' | 'bare', d: number) => {
    const s = ev.stats[k]
    return s ? <><b>{f(s.med, d)}</b><small> {f(s.p10, d)}&ndash;{f(s.p90, d)}</small></> : <span className="rot-na">n/a</span>
  }

  return (
    <>
      <section className="rot-sec" aria-labelledby={`${uid}s`}>
        <h3 id={`${uid}s`}>Suggested options</h3>
        <p className="rot-help">
          Options to compare, not advice. They are draft rotations (status <StatusChip status="estimate" source="data/params/rotations.yaml: written by the project team, to be approved" />)
          built from the crops that can be computed. Choose what matters most; the list is sorted by that one criterion only. There is no overall score.
        </p>
        <div role="group" aria-label="Priority" className="rot-seg">
          {PRIORITIES.map((p) => (
            <button key={p.id} type="button" aria-pressed={prio === p.id} onClick={() => setPrio(p.id)}>{p.label}</button>
          ))}
        </div>
        <p className="rot-help">{prioInfo.hint}</p>
        {!base && <p className="rot-warn">Enter your rotation above to see it as the baseline.</p>}
        {base && !base.res.ok && <p className="rot-warn">Your rotation: {base.res.reasons.join('; ')}.</p>}
        <ol className="rot-rank">
          {base?.res.ok && (
            <li className="rot-base"><span className="rot-tag">Baseline</span> <b>Your rotation</b> <span className="rot-seq">{label(base.rot)}</span></li>
          )}
          {ranked.map((r, i) => (
            <li key={r.id}><span className="rot-num">{i + 1}</span> <b>{r.cand!.id}. {r.cand!.name}</b>
              <span className="rot-seq">{label(r.rot)}</span></li>
          ))}
        </ol>

        <div className="rot-tablewrap" tabIndex={0} role="region" aria-label="Trade-offs table">
          <table className="rot-table">
            <caption>Trade-offs: median and p10&ndash;p90 over the historical years</caption>
            <thead><tr><th scope="col">Option</th>{CRITERIA.map((c) => <th scope="col" key={c.key} title={c.label}>{c.key === 'ks' ? 'Mean Ks' : c.key === 'wsd' ? 'Stress days' : c.key === 'heat' ? 'Heat days' : 'Bare months'}</th>)}</tr></thead>
            <tbody>
              {(base?.res.ok ? [base, ...ranked] : ranked).map((r) => (
                <tr key={r.id} className={r.baseline ? 'rot-base' : ''}>
                  <th scope="row">{r.baseline ? 'Yours' : r.cand!.id}</th>
                  {CRITERIA.map((c) => <td key={c.key}>{r.res.ok ? cell2(r.res.ev, c.key, c.digits) : <span className="rot-na">n/a</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="rot-help">
          Higher Ks is better; fewer stress days, heat days and bare months are better. Heat days exist for winter wheat only.
          Source and status of each number: see the chips in the cards below.
        </p>
      </section>

      <section className="rot-sec" aria-labelledby={`${uid}c`}>
        <h3 id={`${uid}c`}>Comparison, rotation by rotation</h3>
        <p className="rot-help">Each rotation is evaluated for every harvest year and every starting phase. Text below is a fixed template filled from the computed values.</p>
        {all.map((r, i) => {
          const res = r.res
          return (
          <details key={r.id} className="rot-card" open={i === 0}>
            <summary><b>{r.title}</b> <span className="rot-seq">{label(r.rot)}</span></summary>
            {r.cand && <p className="rot-help">Source: draft by the project team, not yet approved <StatusChip status={r.cand.status} source="data/params/rotations.yaml, status estimate" /></p>}
            {!res.ok ? (
              <>
                <p className="rot-warn"><b>Not computable.</b></p>
                <ul>{res.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
                <p className="rot-help">No value is estimated for these crops. The project owner must supply the listed parameters in data/params/crops.csv.</p>
              </>
            ) : (
              <>
                <dl className="rot-crit">
                  {CRITERIA.map((c) => {
                    const s = res.ev.stats[c.key]
                    return (
                      <div key={c.key}>
                        <dt>{c.label}</dt>
                        <dd>{s ? <>{range(s, c.digits)}{c.unit ? ` ${c.unit}` : ''}</> : <span className="rot-na">not computed for this rotation</span>}
                          {' '}<StatusChip status={s ? c.status : 'todo'} source={s ? c.source : 'Heat window or threshold is todo in crops.csv for this crop'} /></dd>
                      </div>
                    )
                  })}
                  {res.ev.returns.filter((x) => x.norm != null).map((x) => (
                    <div key={x.crop}>
                      <dt>KMU No. 164, return interval</dt>
                      <dd>{cropName(x.crop)} returns after {x.gap} years (norm: {x.norm}){' '}
                        <StatusChip status="literature" source={index.kmu_164.find((k) => k.crop === x.crop)!.source} /></dd>
                    </div>
                  ))}
                  {!res.ev.returns.some((x) => x.norm != null) && (
                    <div>
                      <dt>KMU No. 164, return interval</dt>
                      <dd><span className="rot-na">No norm is entered for these crops (only sunflower has one)</span>{' '}
                        <StatusChip status="todo" source="KMU No. 164 norms for other crops are not entered in data/params/rotations.yaml" /></dd>
                    </div>
                  )}
                </dl>
                <Block title="Why proposed" items={why(res.ev, r.cand, r.baseline ? null : baseEv)} />
                <Block title="Evidence" items={evidence(res.ev, soilName)} />
                <Block title="Information gaps" items={gaps(res.ev, index)} />
                <Block title="Risks a local agronomist must check" items={risks(res.ev)} />
              </>
            )}
          </details>
          )
        })}
      </section>
    </>
  )
}

function Block({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rot-block">
      <h4>{title}</h4>
      <ul>{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  )
}
