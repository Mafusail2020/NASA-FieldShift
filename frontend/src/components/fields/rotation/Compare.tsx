import { useId, useMemo, useState } from 'react'
import { cropSoil, useSoilDoc, type SoilAnalysis } from '../../../lib/soil'
import StatusChip from '../../StatusChip'
import '../soil/soil.css'
import {
  CRITERIA, PRIORITIES, canonical, cropName, evaluate, sortKey, type Candidate, type CellRot, type Criterion, type EvalResult, type Evaluation,
  type Priority, type RotIndex, type Soil,
} from './model'
import { evidence, f, gaps, label, range, risks, why } from './texts'

interface Row { id: string; title: string; cand: Candidate | null; baseline: boolean; res: EvalResult; rot: string[] }

const HEAD: Record<Criterion['key'], string> = { ks: 'Water need met', wsd: 'Stress days', heat: 'Heat days', bare: 'Bare months' }
// what "worse" means in words, for the trade-off flag of a row
const WORSE: Record<Criterion['key'], string> = { ks: 'less of the water need met', wsd: 'more water-stress days', heat: 'more heat days', bare: 'more bare soil' }
const sg = (d: number, digits: number, unit: string) => `${d > 0 ? '+' : '−'}${f(Math.abs(d), digits)}${unit}`

export function Compare({ index, cell, soil, current, analysis }: { index: RotIndex; cell: CellRot; soil: Soil; current: string[]; analysis?: SoilAnalysis }) {
  const uid = useId()
  // Salt column: only when the farmer entered ECe. A crop below the salt-exclusion share is not offered as an option (the farmer's own rotation stays, flagged).
  const sd = useSoilDoc()
  const doc = sd.state === 'ready' ? sd.data : null
  const saltOn = analysis?.ece != null && !!doc
  const salt = (rot: string[]) => {
    if (!saltOn) return null
    const cs = [...new Set(rot)].filter((c) => c !== 'black_fallow').map((c) => cropSoil(c, analysis!, doc!))
    const have = cs.filter((c) => c.fSalt != null)
    return { lost: cs.filter((c) => c.excluded), noData: cs.filter((c) => c.fSalt == null), worst: have.length ? have.reduce((a, b) => (b.fSalt! < a.fSalt! ? b : a)) : null }
  }
  const blocked = (rot: string[]) => (salt(rot)?.lost.length ?? 0) > 0
  const [prio, setPrio] = useState<Priority>('water')
  const soilName = index.soil_params.find((r) => r.soil === soil && r.parameter === 'texture')?.value ?? soil

  const { base, alts, dropped } = useMemo(() => {
    const base: Row | null = current.length
      ? { id: 'current', title: 'Your rotation', cand: null, baseline: true, rot: current, res: evaluate(current, index, cell, soil) } : null
    const seen = new Set(base ? [canonical(current)] : [])
    const alts: Row[] = []
    let dropped = 0
    for (const c of index.candidates) {
      if (blocked(c.crops)) { dropped++; continue }
      const key = canonical(c.crops)
      const dupe = seen.has(key)
      seen.add(key)
      alts.push({ id: c.id, title: `${c.name}${dupe && base && canonical(current) === key ? ' (same as yours)' : ''}`, cand: c, baseline: false, rot: c.crops, res: evaluate(c.crops, index, cell, soil) })
    }
    return { base, dropped, alts: alts.filter((a) => !(base && canonical(a.rot) === canonical(base.rot))) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, cell, soil, current, saltOn, analysis?.ece, analysis?.gypsum])

  const baseEv = base?.res.ok ? base.res.ev : null
  const computable = alts.filter((a) => a.res.ok) as (Row & { res: { ok: true; ev: Evaluation } })[]
  const ranked = [...computable].sort((a, b) => {
    const ka = sortKey(a.res.ev, prio), kb = sortKey(b.res.ev, prio)
    return ka == null ? 1 : kb == null ? -1 : ka - kb
  })
  const prioInfo = PRIORITIES.find((p) => p.id === prio)!
  const all = base ? [base, ...alts] : alts
  const tableRows = base?.res.ok ? [base, ...ranked] : ranked
  const primary = prio === 'cover' ? 'bare' : 'ks'   // the criterion the current priority sorts by

  // one scale per criterion, shared by all rows, so the small range bars can be compared down a column
  const scale = (c: Criterion): [number, number] => {
    if (c.key === 'ks') return [0, 1]
    const hi = Math.max(0, ...tableRows.flatMap((r) => (r.res.ok && r.res.ev.stats[c.key] ? [r.res.ev.stats[c.key]!.p90] : [])))
    return [0, hi || 1]
  }
  const scales = Object.fromEntries(CRITERIA.map((c) => [c.key, scale(c)])) as Record<Criterion['key'], [number, number]>

  // change against the baseline, in display units; good = moved in the better direction; 0 = no visible change
  const change = (ev: Evaluation, c: Criterion) => {
    const s = ev.stats[c.key], b = baseEv?.stats[c.key]
    if (!s || !b) return null
    const d = Number(((s.med - b.med) * (c.mult ?? 1)).toFixed(c.digits))
    return { d, good: d === 0 ? null : (d < 0) === (c.better === 'low') }
  }
  const cell2 = (ev: Evaluation, c: Criterion, isBase: boolean) => {
    const s = ev.stats[c.key]
    if (!s) return <span className="rot-na">n/a</span>
    const ch = !isBase ? change(ev, c) : null
    const mult = c.mult ?? 1, [lo, hi] = scales[c.key]
    const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo || 1)) * 100))}%`
    const bm = baseEv?.stats[c.key]?.med
    const unit = c.key === 'ks' ? ' %' : ''
    return (
      <>
        <b>{f(s.med * mult, c.digits)}{unit}</b>
        {ch && (ch.good == null
          ? <span className="rot-d rot-d-same">same</span>
          : <span className={`rot-d ${ch.good ? 'rot-d-good' : 'rot-d-bad'}`}>{sg(ch.d, c.digits, c.key === 'ks' ? ' pts' : '')} {ch.good ? '✓' : '✗'}<span className="sr-only">{ch.good ? ' better' : ' worse'} than yours</span></span>)}
        <span className="rot-rng" aria-hidden="true">
          <i style={{ left: pos(s.p10), width: `calc(${pos(s.p90)} - ${pos(s.p10)})` }} />
          <b style={{ left: pos(s.med) }} />
          {bm != null && <u style={{ left: pos(bm) }} />}
        </span>
        <span className="sr-only"> range of 80 % of years: {f(s.p10 * mult, c.digits)} to {f(s.p90 * mult, c.digits)}</span>
      </>
    )
  }
  // trade-offs hidden by sorting on one criterion: everything where this option is worse than yours
  const tradeoffs = (r: Row) => {
    if (r.baseline || !r.res.ok) return []
    const ev = r.res.ev
    return CRITERIA.flatMap((c) => {
      const ch = change(ev, c)
      return ch && ch.good === false ? [`${WORSE[c.key]} (${sg(ch.d, c.digits, c.key === 'ks' ? ' pts' : '')})`] : []
    })
  }

  return (
    <>
      <section className="rot-sec" aria-labelledby={`${uid}s`}>
        <h3 id={`${uid}s`}>Suggested options</h3>
        <p className="rot-help">
          Options to compare, not advice. They are draft rotations written by the project team and not yet approved, built from the crops that can be computed.
          Every number here is a model estimate (see the note at the top of this panel) unless a chip says otherwise.
          Choose what matters most; the list is sorted by that one criterion only. There is no overall score.
        </p>
        <div role="group" aria-label="Priority" className="rot-seg">
          {PRIORITIES.map((p) => (
            <button key={p.id} type="button" aria-pressed={prio === p.id} onClick={() => setPrio(p.id)}>{p.label}</button>
          ))}
        </div>
        <p className="rot-help">{prioInfo.hint}</p>
        {!base && <p className="rot-warn">Enter your rotation above to see it as the baseline.</p>}
        {base && !base.res.ok && <p className="rot-warn">Your rotation: {base.res.reasons.join('; ')}.</p>}

        <p className="rot-help">
          Sorted by the priority above. Each cell: the median (bold), the change against your rotation (&#10003; better, &#10007; worse) and a bar for the range of 80 % of years
          (dark mark: median, dotted line: your rotation).
        </p>
        <div className="rot-tablewrap" tabIndex={0} role="region" aria-label="Trade-offs table">
          <table className="rot-table">
            <caption className="sr-only">Trade-offs between rotations, sorted by the chosen priority</caption>
            <thead><tr><th scope="col">Option</th>{CRITERIA.map((c) => <th scope="col" key={c.key} title={c.label} className={c.key === primary ? 'rot-prio' : undefined}>{HEAD[c.key]}<small>{c.better === 'high' ? 'higher is better' : 'lower is better'}</small></th>)}{saltOn && <th scope="col" title="Share of normal yield left after salinity, for the weakest crop of the rotation (FAO-61 salt tolerance, ECe entered in the soil analysis)">Salt<small>weakest crop, higher is better</small></th>}</tr></thead>
            <tbody>
              {tableRows.map((r, i) => {
                const n = base?.res.ok ? i : i + 1   // rank among options; the baseline has no number
                const t = tradeoffs(r)
                return (
                  <tr key={r.id} className={r.baseline ? 'rot-base' : ''}>
                    <th scope="row">
                      {r.baseline ? <span className="rot-tag">Yours</span> : <span className="rot-num">{n}.</span>} <b>{r.baseline ? 'Your rotation' : r.cand!.name}</b>
                      <span className="rot-seq">{label(r.rot)}</span>
                      {t.length > 0 && <span className="rot-trade">Trade-off: {t.join(', ')}</span>}
                    </th>
                    {CRITERIA.map((c) => <td key={c.key} className={c.key === primary ? 'rot-prio' : undefined}>{r.res.ok ? cell2(r.res.ev, c, r.baseline) : <span className="rot-na">n/a</span>}</td>)}
                    {saltOn && (() => {
                      const sl = salt(r.rot)!
                      return (
                        <td>
                          {sl.worst ? <><b>{f(sl.worst.fSalt! * 100, 0)} %</b> <span className="fs-note">{sl.worst.label}</span></> : <span className="rot-na">n/a</span>}
                          {sl.lost.length > 0 && <span className="fs-tag fs-tag-bad">Not recommended: {sl.lost.map((c) => c.label).join(', ')}</span>}
                          {sl.noData.length > 0 && <span className="fs-tag fs-tag-low">No salt data: {sl.noData.map((c) => c.label).join(', ')}</span>}
                        </td>
                      )
                    })()}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {saltOn && dropped > 0 && <p className="rot-help" role="status">Salinity (ECe {f(analysis!.ece!, 1)} dS/m) rules out a crop in {dropped} of the draft rotations, so they are not offered here. The Salt column is the share of normal yield left for the weakest crop; it does not change the weather numbers or the sorting.</p>}
        <p className="rot-help">
          Water need met is the share of the crop&rsquo;s water need that the soil could supply (100 % = no water stress). Heat days exist for winter wheat only.
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
            {r.cand && <p className="rot-help">Draft by the project team, not yet approved.</p>}
            {!res.ok ? (
              <>
                <p className="rot-warn"><b>Not available yet.</b></p>
                <ul>{res.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
                <p className="rot-help">No value is estimated for these crops until their data is added.</p>
              </>
            ) : (
              <>
                <dl className="rot-crit">
                  {CRITERIA.map((c) => {
                    const s = res.ev.stats[c.key]
                    return (
                      <div key={c.key}>
                        <dt>{c.label}</dt>
                        <dd>{s ? <>{range(s, c.digits, c.mult)}{c.unit ? ` ${c.unit}` : ''}</> : <span className="rot-na">not available yet for this rotation</span>}
                          {s && <>{' '}<StatusChip status={c.status} source={c.source} quiet /></>}</dd>
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
                      <dd><span className="rot-na">No national norm is available yet for these crops (only sunflower has one)</span></dd>
                    </div>
                  )}
                </dl>
                <Block title="Why proposed" items={why(res.ev, r.cand, r.baseline ? null : baseEv)} />
                <details className="rot-more">
                  <summary>Show details</summary>
                  <Block title="Evidence" items={evidence(res.ev, soilName)} />
                </details>
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
