// Optional soil analysis of one field (inside its row on the Fields page): ECe, pH, humus, manure, green manure, normal yields.
// Shows the salt and pH factors per crop and the humus balance of the rotation. Tables: public/data/soil_params.json,
// formulas in src/lib/soil.ts (same as backend/core). Every number is a model result for the field as entered, not an agronomic advice.
import { useId, useMemo, useState } from 'react'
import { CROP_LABEL, type CropId, type FieldItem } from '../../lib/field'
import { fmt } from '../../lib/format'
import { lastN, median, useFinanceInputs, YIELD_DEFAULT_YEARS } from '../../lib/finance'
import { cropSoil, EMPTY_ANALYSIS, rotationHumus, useCellProps, useSoilDoc, type SoilAnalysis, type SoilDoc } from '../../lib/soil'
import StatusChip from '../StatusChip'
import { useRotIndex, type Candidate } from './rotation/model'
import './soil/soil.css'

const parse = (s: string) => { const v = Number(s.replace(',', '.')); return s.trim() === '' || !Number.isFinite(v) ? null : v }
const sgn = (v: number, d = 2) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), d)}`

function Num({ id, label, unit, value, min, max, hint, onChange }: {
  id: string; label: string; unit: string; value: number | null; min: number; max: number; hint?: string; onChange(v: number | null): void
}) {
  const [text, setText] = useState(value == null ? '' : String(value))
  const v = parse(text)
  const err = text.trim() !== '' && (v == null ? 'Enter a number.' : v < min || v > max ? `Use a value from ${min} to ${max}.` : null)
  return (
    <div className="fr-f">
      <label htmlFor={id}>{label} ({unit})</label>
      <input id={id} inputMode="decimal" autoComplete="off" value={text} aria-invalid={!!err} aria-describedby={err ? `${id}-e` : hint ? `${id}-h` : undefined}
        onChange={(e) => { setText(e.target.value); const n = parse(e.target.value); onChange(n != null && n >= min && n <= max ? n : null) }} />
      {err ? <p className="fr-err" id={`${id}-e`}>{err}</p> : hint && <p className="fs-hint" id={`${id}-h`}>{hint}</p>}
    </div>
  )
}

export function FieldSoil({ field, cellId, onUpdate }: { field: FieldItem; cellId: string | null; onUpdate(patch: Partial<Omit<FieldItem, 'id'>>): void }) {
  const uid = useId()
  const cp = useCellProps(cellId)
  const doc = useSoilDoc()
  const fin = useFinanceInputs()
  const a = field.analysis
  const set = (p: Partial<SoilAnalysis>) => onUpdate({ analysis: { ...a, ...p } })
  const rotation = (field.rotation.length ? field.rotation : field.crop ? [field.crop] : []) as CropId[]
  const crops = [...new Set(rotation)].filter((c) => c !== 'black_fallow')
  const [resetKey, setResetKey] = useState(0)

  // Normal yield per crop (c/ha): the farmer's number, else the FAOSTAT median of the last 10 years (t/ha x 10).
  const dflt = (c: string) => (fin.state === 'ready' && fin.data.crops[c] ? median(lastN(fin.data.crops[c].yields, YIELD_DEFAULT_YEARS).map((p) => p.value)) * 10 : null)
  const eff: SoilAnalysis = { ...a, yields: Object.fromEntries(crops.flatMap((c) => { const v = a.yields[c] ?? dflt(c); return v != null && Number.isFinite(v) ? [[c, v]] : [] })) }
  const entered = [a.ece, a.ph, a.humusPct, a.manure, a.greenT].some((x) => x != null) || a.gypsum
  const id = (s: string) => `${uid}${s}`

  return (
    <details className="fs" open={entered || undefined}>
      <summary>Soil analysis <small>optional: salinity, pH, humus</small></summary>
      <div className="fs-body">
        <p className="fs-help">
          Enter values from a lab analysis to see which crops the soil allows and how the rotation changes humus. Nothing here changes the weather analysis.
          Leave a box empty if you do not know the value: the site then shows &ldquo;not entered&rdquo; and does not guess.
        </p>
        {cellId && cp.state === 'ready' && (
          <p className="fs-suggest" role="status">
            {cp.props ? (
              <>
                SoilGrids suggests <b>pH {fmt(cp.props.ph, 1)}</b> and <b>humus {fmt(cp.props.humusPct, 1)}%</b> for this cell{cp.props.sampledAt ? ' (read near the centre)' : ''}{' '}
                <StatusChip status={cp.props.status} source={cp.props.source} />{' '}
                <button type="button" className="fr-btn" onClick={() => { set({ ph: cp.props!.ph, humusPct: cp.props!.humusPct }); setResetKey((k) => k + 1) }}>Use these values</button>
                <span className="fs-hint"> A global model at 250 m, not a lab analysis; it does not predict salinity. Your own analysis is better.</span>
              </>
            ) : <span className="fs-hint">No SoilGrids pH or humus is stored for this cell yet. Enter your own values; salinity always has to be entered.</span>}
          </p>
        )}
        <div className="fs-grid" key={resetKey}>
          <Num id={id('ece')} label="Soil salinity ECe" unit="dS/m" value={a.ece} min={0} max={60} hint="Saturated-paste extract. A 1:5 water extract or salt % needs conversion first." onChange={(v) => set({ ece: v })} />
          <Num id={id('ph')} label="Soil pH" unit="water" value={a.ph} min={2} max={12} hint="Water pH, not salt (KCl) pH, which reads lower." onChange={(v) => set({ ph: v })} />
          <Num id={id('hum')} label="Humus" unit="%" value={a.humusPct} min={0} max={15} hint="Current content in the top layer." onChange={(v) => set({ humusPct: v })} />
          <Num id={id('man')} label="Manure" unit="t/ha per rotation" value={a.manure} min={0} max={500} hint="0 if you do not apply it." onChange={(v) => set({ manure: v })} />
          <Num id={id('grn')} label="Green manure mass" unit="t/ha" value={a.greenT} min={0} max={100} hint="Per ploughing. In the dry south it is usually lower than in the forest-steppe." onChange={(v) => set({ greenT: v })} />
        </div>
        <div className="fs-row">
          <button type="button" className="fs-tog" aria-pressed={a.gypsum} onClick={() => set({ gypsum: !a.gypsum })}>Gypsum-rich soil</button>
          <span className="fs-hint">On gypsum soils crops tolerate about 2 dS/m more salt than the FAO table.</span>
          <button type="button" className="fr-btn" disabled={!entered && !Object.keys(a.yields).length && !a.greenAfter.length}
            onClick={() => { onUpdate({ analysis: EMPTY_ANALYSIS }); setResetKey((k) => k + 1) }}>Clear soil analysis</button>
        </div>

        {crops.length === 0 && <p className="fs-msg">Choose a crop or a rotation for this field to see the results.</p>}
        {crops.length > 0 && (
          <>
            <fieldset className="fs-yields" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="fs-sub"><b>Normal yield and green manure per crop</b></legend>
              <div className="fs-grid" key={`y${resetKey}`}>
                {crops.map((c) => (
                  <div className="fr-f" key={c}>
                    <label htmlFor={id(`y-${c}`)}>{CROP_LABEL[c]}: yield (c/ha)</label>
                    <input id={id(`y-${c}`)} inputMode="decimal" autoComplete="off" placeholder={dflt(c) != null ? `${fmt(dflt(c)!, 0)} (national)` : 'c/ha'} defaultValue={a.yields[c] ?? ''}
                      onChange={(e) => { const n = parse(e.target.value); const y = { ...a.yields }; if (n != null && n >= 0 && n <= 2000) y[c] = n; else delete y[c]; set({ yields: y }) }} />
                  </div>
                ))}
              </div>
              <div className="fs-checks" role="group" aria-label="Green manure ploughed in after">
                <span className="fs-hint">Intermediate green manure after:</span>
                {crops.map((c) => (
                  <label key={c}><input type="checkbox" checked={a.greenAfter.includes(c)}
                    onChange={(e) => set({ greenAfter: e.target.checked ? [...a.greenAfter, c] : a.greenAfter.filter((x) => x !== c) })} />{CROP_LABEL[c]}</label>
                ))}
              </div>
              <p className="fs-hint">Empty yield boxes use the national FAOSTAT median of the last 10 years. That is not your field&rsquo;s yield.</p>
            </fieldset>

            {doc.state === 'loading' && <p className="fs-msg" role="status">Loading soil tables…</p>}
            {doc.state === 'error' && <p className="fs-msg fs-err" role="alert">Soil tables could not be loaded (data/soil_params.json). Run pipeline.export_soil.</p>}
            {doc.state === 'ready' && <Results doc={doc.data} crops={crops} rotation={rotation} a={eff} dflt={dflt} />}
          </>
        )}
      </div>
    </details>
  )
}

function Results({ doc, crops, rotation, a, dflt }: { doc: SoilDoc; crops: string[]; rotation: string[]; a: SoilAnalysis; dflt(c: string): number | null }) {
  const rows = useMemo(() => crops.map((c) => cropSoil(c, a, doc)), [crops, a, doc])
  const h = useMemo(() => rotationHumus(rotation, a, doc), [rotation, a, doc])
  const bad = rows.filter((r) => r.excluded)
  return (
    <>
      <section aria-label="Salt and pH factors">
        <h3 className="fs-sub">Salt and pH by crop <StatusChip status={doc.status} source={doc.source} /></h3>
        <div className="fs-tablewrap" role="region" aria-label="Salt and pH factors by crop" tabIndex={0}>
          <table>
            <thead><tr><th>Crop</th><th className="n">Salt factor</th><th className="n">pH factor</th><th className="n">Yield from salt</th><th>Notes</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.crop} className={r.excluded ? 'fs-red' : undefined}>
                  <td><b>{r.label}</b></td>
                  <td className="n">{r.fSalt == null ? '–' : fmt(r.fSalt, 2)} {r.salt && <StatusChip status={r.salt.status} source={r.salt.source} quiet />}</td>
                  <td className="n">{r.fPh == null ? '–' : fmt(r.fPh, 2)} {r.ph && <StatusChip status={r.ph.status} source={r.ph.source} quiet />}</td>
                  <td className="n"><b>{r.fSalt == null ? '–' : `${fmt(r.factor * 100, 0)}%`}</b></td>
                  <td>
                    {r.excluded && <span className="fs-tag fs-tag-bad">Not recommended: salt</span>}
                    {r.phWarning && <span className="fs-tag fs-tag-warn">pH warning</span>}
                    {r.lowConfidence && <span className="fs-tag fs-tag-low">Low confidence</span>}
                    {r.notes.length > 0 && <span className="fs-note">{r.notes.join(', ')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {bad.length > 0 && <p className="fs-hint" role="status">Below {fmt(doc.model.salt_exclude_below * 100, 0)}% of normal yield from salt: {bad.map((r) => r.label).join(', ')}. These crops should not be chosen as the best options.</p>}
        <p className="fs-hint">&ldquo;Yield from salt&rdquo; is the share of normal yield left after salinity; the Finance summaries use it. pH only warns and is not applied: the global limits are probably too narrow for alkaline southern soils, so a pH factor below 1 is a prompt to check with an agronomist.</p>
      </section>

      <section aria-label="Humus balance">
        <h3 className="fs-sub">Humus balance of the rotation</h3>
        {h.years.length === 0 ? (
          <p className="fs-msg">{h.missing.length ? `No humus data or yield for: ${h.missing.map((c) => doc.species[c]?.label ?? c).join(', ')}.` : 'Add a rotation to see the balance.'}</p>
        ) : (
          <>
            <div className="fs-cards">
              <div className={`fs-card ${h.meanBalance! < 0 ? 'fs-neg' : 'fs-pos'}`}><span>Mean balance per year</span><b>{sgn(h.meanBalance!)} t/ha</b><small>{h.meanBalance! < 0 ? 'humus is lost' : 'humus is kept or built'}</small></div>
              <div className="fs-card"><span>Per rotation ({h.years.length} yr)</span><b>{sgn(h.perRotation!)} t/ha</b></div>
              <div className="fs-card"><span>Manure for a zero balance</span><b>{fmt(h.manureNorm!, 1)} t/ha/yr</b><small>{h.meanBalance! < 0 ? 'per year, as in the source formula' : 'no extra manure needed'}</small></div>
              {h.humusAfter10y != null && a.humusPct != null && <div className="fs-card"><span>Humus after 10 years</span><b>{fmt(h.humusAfter10y, 2)}%</b><small>from {fmt(a.humusPct, 2)}% now, rough: layer mass is an assumption <StatusChip status="estimate" source="params/model.csv plough_layer_mass_t_ha: 0-30 cm x 1.3 t/m3" /></small></div>}
            </div>
            <div className="fs-tablewrap" role="region" aria-label="Humus balance by year" tabIndex={0}>
              <table>
                <thead><tr><th>Year</th><th>Crop</th><th className="n">From residues</th><th className="n">Manure</th><th className="n">Green manure</th><th className="n">Mineralisation</th><th className="n">Balance</th></tr></thead>
                <tbody>
                  {h.years.map((y) => (
                    <tr key={y.year}>
                      <td>{y.year}</td><td>{y.label} <StatusChip status={y.status} source={y.source} quiet /></td>
                      <td className="n">{fmt(y.p1, 2)}</td><td className="n">{fmt(y.p2, 2)}</td><td className="n">{fmt(y.p3, 2)}</td><td className="n">−{fmt(y.p, 2)}</td><td className="n"><b>{sgn(y.balance)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="fs-hint">t of humus per ha. Chesnul method with national yields where you left the boxes empty. {a.greenAfter.length === 0 && 'Tick a crop above to test green manure after it.'}</p>
            {h.missing.length > 0 && <p className="fs-hint">Left out (no humus data or yield): {h.missing.map((c) => doc.species[c]?.label ?? c).join(', ')}.</p>}
          </>
        )}
      </section>

      <Alternatives doc={doc} a={a} dflt={dflt} />

      <details>
        <summary className="fs-hint">What these numbers assume</summary>
        <ul className="fs-ul fs-hint">{doc.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      </details>
    </>
  )
}

// Soil check of the alternative rotations (the candidates of rotations_grid.json): which crops the salt rules out and the humus balance.
// Same manure and green-manure inputs as above; yields are the farmer's own where entered, otherwise the national median.
function Alternatives({ doc, a, dflt }: { doc: SoilDoc; a: SoilAnalysis; dflt(c: string): number | null }) {
  const idx = useRotIndex()
  if (idx.state !== 'ready' || idx.data.candidates.length === 0) return null
  const rows = idx.data.candidates.map((c: Candidate) => {
    const uniq = [...new Set(c.crops)].filter((x) => x !== 'black_fallow')
    const yields = { ...Object.fromEntries(uniq.flatMap((x) => { const v = dflt(x); return v != null && Number.isFinite(v) ? [[x, v]] : [] })), ...a.yields }
    const cs = uniq.map((x) => cropSoil(x, a, doc))
    return { c, lost: cs.filter((x) => x.excluded).map((x) => x.label), noData: cs.filter((x) => x.fSalt == null && a.ece != null).length,
      h: rotationHumus(c.crops, { ...a, yields }, doc) }
  })
  return (
    <section aria-label="Soil check of alternative rotations">
      <h3 className="fs-sub">Alternative rotations on this soil</h3>
      <div className="fs-tablewrap" role="region" aria-label="Alternative rotations on this soil" tabIndex={0}>
        <table>
          <thead><tr><th>Rotation</th><th>Salt</th><th className="n">Humus per year</th></tr></thead>
          <tbody>
            {rows.map(({ c, lost, noData, h }) => (
              <tr key={c.id} className={lost.length ? 'fs-red' : undefined}>
                <td><b>{c.name}</b><br /><span className="fs-note">{c.crops.map((x) => doc.species[x]?.label ?? x).join(' → ')}</span></td>
                <td>
                  {a.ece == null ? <span className="fs-note">ECe not entered</span>
                    : lost.length ? <span className="fs-tag fs-tag-bad">Not recommended: {lost.join(', ')}</span> : <span className="fs-note">No crop ruled out</span>}
                  {noData > 0 && a.ece != null && <span className="fs-tag fs-tag-low">{noData} crop{noData > 1 ? 's' : ''} without salt data</span>}
                </td>
                <td className="n">{h.meanBalance == null ? <span className="fs-note">no data</span> : <b>{sgn(h.meanBalance)} t/ha</b>}
                  {h.missing.length > 0 && h.meanBalance != null && <><br /><span className="fs-note">without {h.missing.map((x) => doc.species[x]?.label ?? x).join(', ')}</span></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fs-hint">Drafts from rotations.yaml <StatusChip status="estimate" source="data/params/rotations.yaml" />. Only salt and humus are checked here; the weather comparison is in the rotation analysis above.</p>
    </section>
  )
}
