import { Fragment, useId, useMemo, useState } from 'react'
import { cropSoil, useSoilDoc, type SoilAnalysis } from '../../../lib/soil'
import Collapsible from '../../Collapsible'
import StatusChip from '../../StatusChip'
import '../soil/soil.css'
import {
  CRITERIA, PRIORITIES, cropName, evaluate, evaluateAll, oneChange, pickTop, type CellRot, type Criterion, type Evaluation,
  type Priority, type RotIndex, type Soil, type Suggestion,
} from './model'
import { evidence, f, gaps, label, range, risks, rulesText, why, type Origin } from './texts'

interface Row { id: string; title: string; origin: Origin; baseline: boolean; ev: Evaluation | null; reasons: string[]; rot: string[]; group: 'yours' | 'closest' | 'best' }
const GROUP_TITLE = { closest: 'One change from your rotation', best: 'Best of all rotations that follow the rules' } as const

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

  // every rotation that follows the rules, evaluated once per cell and soil (the priority only re-sorts them)
  const poolAll = useMemo(() => evaluateAll(index, cell, soil), [index, cell, soil])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pool = useMemo(() => (saltOn ? poolAll.filter((x) => !blocked(x.rot)) : poolAll), [poolAll, saltOn, analysis?.ece, analysis?.gypsum])
  const prioInfo = PRIORITIES.find((p) => p.id === prio)!

  const { base, closest, best } = useMemo(() => {
    const baseRes = current.length ? evaluate(current, index, cell, soil) : null
    const base: Row | null = baseRes
      ? { id: 'current', title: 'Your rotation', origin: { kind: 'yours' }, baseline: true, group: 'yours', rot: current, ev: baseRes.ok ? baseRes.ev : null, reasons: baseRes.ok ? [] : baseRes.reasons }
      : null
    // Ks is only counted in crop years, so a fallow year would lift it for free: black fallow is not offered for the two Ks priorities
    const allowed = (rot: string[]) => prio === 'cover' || !rot.includes('black_fallow')
    const near: Suggestion[] = []
    for (const o of oneChange(current, index)) {
      if (!allowed(o.rot)) continue
      const r = evaluate(o.rot, index, cell, soil)
      if (r.ok && !blocked(o.rot)) near.push({ rot: o.rot, ev: r.ev, change: o.change })
    }
    const nearTop = pickTop(near, prio, 3, [], 0)
    const bestTop = pickTop(pool.filter((x) => allowed(x.rot)), prio, 3, [...(current.length ? [current] : []), ...nearTop.map((n) => n.rot)])
    const row = (s: Suggestion, group: 'closest' | 'best', i: number): Row => ({
      id: `${group}${i}`, title: group === 'closest' ? s.change! : `Option ${i + 1}`, baseline: false, group, rot: s.rot, ev: s.ev, reasons: [],
      origin: group === 'closest' ? { kind: 'closest', change: s.change! } : { kind: 'best', priority: prioInfo.label.toLowerCase(), of: pool.length },
    })
    return { base, closest: nearTop.map((s, i) => row(s, 'closest', i)), best: bestTop.map((s, i) => row(s, 'best', i)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, cell, soil, current, pool, prio, prioInfo.label, saltOn, analysis?.ece, analysis?.gypsum])

  const baseEv = base?.ev ?? null
  const tableRows = [...(base?.ev ? [base] : []), ...closest, ...best]
  const all = [...(base ? [base] : []), ...closest, ...best]
  const primary = prio === 'cover' ? 'bare' : 'ks'   // the criterion the current priority sorts by

  // one scale per criterion, shared by all rows, so the small range bars can be compared down a column
  const scale = (c: Criterion): [number, number] => {
    if (c.key === 'ks') return [0, 1]
    const hi = Math.max(0, ...tableRows.flatMap((r) => (r.ev?.stats[c.key] ? [r.ev.stats[c.key]!.p90] : [])))
    return [0, hi || 1]
  }
  const scales = Object.fromEntries(CRITERIA.map((c) => [c.key, scale(c)])) as Record<Criterion['key'], [number, number]>

  // change against the baseline, in display units; good = moved in the better direction; 0 = no visible change
  const change = (ev: Evaluation, c: Criterion) => {
    const s = ev.stats[c.key], b = baseEv?.stats[c.key]
    if (!s || !b) return null
    const d = Number(((s.med - b.med) * (c.mult ?? 1)).toFixed(c.digits))
    // heat days follow the sowing date of winter wheat, which follows the previous crop in the model's calendar: shown, not judged
    return { d, good: d === 0 || c.key === 'heat' ? null : (d < 0) === (c.better === 'low') }
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
          ? <span className="rot-d rot-d-same">{ch.d === 0 ? 'same' : `${sg(ch.d, c.digits, '')} (not judged)`}</span>
          : <span className={`rot-d ${ch.good ? 'rot-d-good' : 'rot-d-bad'}`}>{sg(ch.d, c.digits, c.key === 'ks' ? ' pts' : '')} {ch.good ? '✓' : '✗'}<span className="sr-only">{ch.good ? ' better' : ' worse'} than yours</span></span>)}
        <span className={`rot-rng${ch?.good === true ? ' rot-rng-good' : ch?.good === false ? ' rot-rng-bad' : ''}`} aria-hidden="true">
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
    if (r.baseline || !r.ev) return []
    const ev = r.ev
    return CRITERIA.flatMap((c) => {
      const ch = change(ev, c)
      return ch && ch.good === false ? [`${WORSE[c.key]} (${sg(ch.d, c.digits, c.key === 'ks' ? ' pts' : '')})`] : []
    })
  }

  return (
    <>
      <section className="rot-sec" aria-labelledby={`${uid}s`}>
        <h3 id={`${uid}s`}>Suggested options</h3>
        <details className="rot-more">
          <summary>Rules the options follow</summary>
          <ul className="rot-nm">{rulesText(index).map((t) => <li key={t}>{t}</li>)}</ul>
          <p className="rot-help">Return intervals are law <StatusChip status="literature" source="KMU Resolution No. 164, see the return interval lines below" quiet />; the other rules are project choices <StatusChip status={index.suggest.rules.status} source={index.suggest.rules.source} quiet />.</p>
        </details>
        <div role="group" aria-label="Priority" className="rot-seg">
          {PRIORITIES.map((p) => (
            <button key={p.id} type="button" aria-pressed={prio === p.id} onClick={() => setPrio(p.id)}>{p.label}</button>
          ))}
        </div>
        {!base && <p className="rot-warn">Enter your rotation above to see it as the baseline.</p>}
        {base && !base.ev && <p className="rot-warn">Your rotation: {base.reasons.join('; ')}.</p>}
        {base?.ev && closest.length === 0 && <p className="rot-help">No rotation one change away from yours follows the rules and has data.</p>}

        <div className="rot-tablewrap" tabIndex={0} role="region" aria-label="Trade-offs table">
          <table className="rot-table">
            <caption className="sr-only">Trade-offs between rotations, sorted by the chosen priority</caption>
            <thead><tr><th scope="col">Option</th>{CRITERIA.map((c) => <th scope="col" key={c.key} title={c.label} className={c.key === primary ? 'rot-prio' : undefined}>{HEAD[c.key]}<small>{c.better === 'high' ? 'higher is better' : 'lower is better'}</small></th>)}{saltOn && <th scope="col" title="Share of normal yield left after salinity, for the weakest crop of the rotation (FAO-61 salt tolerance, ECe entered in the soil analysis)">Salt<small>weakest crop, higher is better</small></th>}</tr></thead>
            <tbody>
              {tableRows.map((r, i) => {
                const t = tradeoffs(r)
                const head = r.group !== 'yours' && tableRows[i - 1]?.group !== r.group
                return (
                  <Fragment key={r.id}>
                    {head && <tr className="rot-grp"><th scope="colgroup" colSpan={CRITERIA.length + 1 + (saltOn ? 1 : 0)}>{GROUP_TITLE[r.group as 'closest' | 'best']}</th></tr>}
                    <tr className={r.baseline ? 'rot-base' : ''}>
                      <th scope="row">
                        {r.baseline ? <span className="rot-tag">Yours</span> : null} <b>{r.baseline ? 'Your rotation' : r.title}</b>
                        <span className="rot-seq">{label(r.rot)}</span>
                        {t.length > 0 && <span className="rot-trade">Trade-off: {t.join(', ')}</span>}
                      </th>
                      {CRITERIA.map((c) => <td key={c.key} className={c.key === primary ? 'rot-prio' : undefined}>{r.ev ? cell2(r.ev, c, r.baseline) : <span className="rot-na">n/a</span>}</td>)}
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
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        {saltOn && poolAll.length > pool.length && <p className="rot-help" role="status">Salinity (ECe {f(analysis!.ece!, 1)} dS/m) rules out a crop in {(poolAll.length - pool.length).toLocaleString('en')} rotations, so they are not offered here. The Salt column is the share of normal yield left for the weakest crop; it does not change the weather numbers or the sorting.</p>}
        <p className="rot-help">
          Water need met is the share of the crop&rsquo;s water need that the soil could supply (100 % = no water stress). Heat days exist for winter wheat only and are shown without a better or worse mark: they depend on when the wheat is sown, which in the model&rsquo;s calendar follows the previous crop (wheat after maize is sown late, so its heat window falls later).
        </p>
      </section>

      <section className="rot-sec">
        <Collapsible title="Comparison, rotation by rotation" hint="Full numbers, evidence, gaps and risks for each option">
        <p className="rot-help">Each rotation is evaluated for every harvest year and every starting phase. Text below is a fixed template filled from the computed values.</p>
        {all.map((r, i) => {
          const ev = r.ev
          return (
          <details key={r.id} className="rot-card" open={i === 0}>
            <summary><b>{r.baseline ? 'Your rotation' : `${r.group === 'closest' ? 'One change' : 'Best'}: ${r.title}`}</b> <span className="rot-seq">{label(r.rot)}</span></summary>
            {!ev ? (
              <>
                <p className="rot-warn"><b>Not available yet.</b></p>
                <ul>{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
                <p className="rot-help">No value is estimated for these crops until their data is added.</p>
              </>
            ) : (
              <>
                <dl className="rot-crit">
                  {CRITERIA.map((c) => {
                    const s = ev.stats[c.key]
                    return (
                      <div key={c.key}>
                        <dt>{c.label}</dt>
                        <dd>{s ? <>{range(s, c.digits, c.mult)}{c.unit ? ` ${c.unit}` : ''}</> : <span className="rot-na">not available yet for this rotation</span>}
                          {s && <>{' '}<StatusChip status={c.status} source={c.source} quiet /></>}</dd>
                      </div>
                    )
                  })}
                  {ev.returns.filter((x) => x.norm != null).map((x) => (
                    <div key={x.crop}>
                      <dt>KMU No. 164, return interval</dt>
                      <dd>{cropName(x.crop)} returns after {x.gap} years (norm: {x.norm}){' '}
                        <StatusChip status="literature" source={index.kmu_164.find((k) => k.crop === x.crop)!.source} /></dd>
                    </div>
                  ))}
                  {!ev.returns.some((x) => x.norm != null) && (
                    <div>
                      <dt>KMU No. 164, return interval</dt>
                      <dd><span className="rot-na">No national norm is available yet for these crops (only sunflower has one)</span></dd>
                    </div>
                  )}
                </dl>
                <Block title="Why proposed" items={why(ev, r.origin, r.baseline ? null : baseEv)} />
                <details className="rot-more">
                  <summary>Show details</summary>
                  <Block title="Evidence" items={evidence(ev, soilName)} />
                </details>
                <Block title="Information gaps" items={gaps(ev, index)} />
                <Block title="Risks a local agronomist must check" items={risks(ev)} />
              </>
            )}
          </details>
          )
        })}
        </Collapsible>
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
