// "What you can sow on this field": every crop of the model against this field's cell (NASA POWER weather, water balance of the cell) and
// the soil analysis the farmer entered (salt and pH). A prompt for the talk with an agronomist, not a ban and not advice.
import { useId, useMemo } from 'react'
import type { GridCell } from '../../../types'
import type { FieldItem } from '../../../lib/field'
import { cropSoil, useSoilDoc } from '../../../lib/soil'
import { fmt } from '../../../lib/format'
import StatusChip from '../../StatusChip'
import { CRITERIA, cropName, useCellRot, useGridSoil, useRotIndex, type Soil } from '../rotation/model'
import { cropRows, type Fit } from './model'
import './cropfit.css'

const FIT_LABEL: Record<Fit, string> = { suits: '✓ Suits', check: '! Check', no: '✗ Not advised' }
const pc = (v: number) => `${fmt(v * 100, 0)} %`

export function CropFit({ field, cell }: { field: FieldItem; cell: GridCell | null }) {
  const uid = useId()
  const idx = useRotIndex()
  const gs = useGridSoil()
  const sd = useSoilDoc()
  const index = idx.state === 'ready' ? idx.data : null
  const missing = !!(cell && index && !index.cells.includes(cell.id))
  const data = useCellRot(cell?.id ?? null, !index || missing)
  const sc = cell && gs.state === 'ready' ? gs.data.cells.find((c) => c.id === cell.id) : undefined
  const soil: Soil = field.soil ?? sc?.preset ?? 'medium'
  const a = field.analysis
  const entered = { ece: a.ece != null, ph: a.ph != null }
  const inRotation = useMemo(() => new Set<string>([...(field.crop ? [field.crop] : []), ...field.rotation]), [field.crop, field.rotation])

  const rows = useMemo(() => {
    if (!index || data.state !== 'ready') return []
    return cropRows(data.data, soil, index, (c) => (sd.state === 'ready' ? cropSoil(c, a, sd.data) : null), entered, cropName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, data, soil, sd, a.ece, a.ph, a.gypsum])

  const by = (f: Fit) => rows.filter((r) => r.fit === f)
  const counts = rows.length ? [['suits', 'suits'], ['check', 'check'], ['no', 'not advised']].flatMap(([f, w]) => (by(f as Fit).length ? [`${by(f as Fit).length} ${w}`] : [])).join(' · ') : ''
  const wrap = (body: React.ReactNode, busy = false) => (
    <details className="cf" aria-busy={busy || undefined}>
      <summary><span className="cf-title" id={`${uid}h`}>What you can sow on this field</span>{counts && <small>{counts}</small>}</summary>
      <div className="cf-body">{body}</div>
    </details>
  )
  if (!cell) return wrap(<p className="cf-state">Enter the field&rsquo;s coordinates to see which crops its climate cell and soil allow.</p>)
  if (idx.state === 'error') return wrap(<p className="cf-state" role="alert">Crop data could not be loaded (data/rotations_grid.json).</p>)
  if (missing) return wrap(<p className="cf-state">No crop data for this cell yet: its weather download has not been processed.</p>)
  if (idx.state === 'loading' || data.state === 'loading') return wrap(<p className="cf-state">Loading…</p>, true)
  if (data.state === 'error') return wrap(<p className="cf-state" role="alert">Could not load the weather results for cell {cell.id}.</p>)

  const waterSrc = CRITERIA.find((c) => c.key === 'ks')!

  return wrap(
    <>
      <p className="cf-sum">
        {by('suits').length > 0 ? `${by('suits').map((r) => cropName(r.crop)).join(', ')} ${by('suits').length > 1 ? 'fit' : 'fits'} this field on the checks made here.` : 'No crop passes every check made here: see the reasons in the table.'}
        {by('no').length > 0 && <> {by('no').map((r) => cropName(r.crop)).join(', ')} {by('no').length > 1 ? 'are' : 'is'} not advised.</>}
      </p>
      <div className="cf-wrap" role="region" aria-label="Crop fit table" tabIndex={0}>
        <table>
          <caption className="sr-only">How well each crop fits this field, best fit first</caption>
          <thead>
            <tr>
              <th scope="col">Crop</th>
              <th scope="col">Verdict</th>
              <th scope="col">Water need met<span className="cf-sub">typical · dry year</span></th>
              <th scope="col">Yield from salt</th>
              <th scope="col">pH</th>
              <th scope="col">Return interval<span className="cf-sub">KMU No. 164</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.crop} className={r.fit ? `cf-${r.fit}-row` : undefined}>
                <th scope="row">
                  <b>{cropName(r.crop)}</b>
                  {inRotation.has(r.crop) && <span className="cf-tag">{r.crop === field.crop ? 'This season' : 'In your rotation'}</span>}
                </th>
                <td className="cf-vc">
                  <span className={`cf-fit cf-${r.fit ?? 'none'}`}>{r.fit ? FIT_LABEL[r.fit] : 'No data'}</span>
                  {r.reasons.length > 0 && <ul className="cf-why">{r.reasons.map((t) => <li key={t}>{t}</li>)}</ul>}
                  {r.unchecked.length > 0 && <p className="cf-miss">Not checked: {r.unchecked.join('; ')}.</p>}
                </td>
                <td>
                  {r.water ? <><b>{pc(r.water.med)}</b> · {pc(r.water.p10)}<span className="cf-sub">{fmt(r.water.wsd, 0)} stress days a season</span><StatusChip status={waterSrc.status} source={waterSrc.source} quiet /></> : <span className="cf-sub">no data</span>}
                </td>
                <td>
                  {!entered.ece ? <span className="cf-sub">not entered</span> : r.soil?.fSalt == null ? <span className="cf-sub">no data</span> : <b>{pc(r.soil.fSalt)}</b>}
                  {r.soil?.salt && entered.ece && <StatusChip status={r.soil.salt.status} source={r.soil.salt.source} quiet />}
                </td>
                <td>
                  {!entered.ph ? <span className="cf-sub">not entered</span> : r.soil?.fPh == null ? <span className="cf-sub">no data</span> : r.soil.fPh >= 1 ? <b>comfortable</b> : <b>outside comfort zone</b>}
                  {r.soil?.ph && entered.ph && <StatusChip status={r.soil.ph.status} source={r.soil.ph.source} quiet />}
                </td>
                <td>
                  {r.kmu != null ? <>{r.kmu} {r.kmu === 1 ? 'year' : 'years'}</> : <span className="cf-sub">{r.crop === 'maize' ? '2–3 years in a row allowed' : 'not set'}</span>}
                  {r.kmu != null && <StatusChip status="literature" source="KMU Resolution No. 164 of 11.02.2010, note under the table of norms" quiet />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="cf-note">
        Not checked at all: frost and sowing dates, heat tolerance (modelled for winter wheat only), diseases, markets, machinery, and what grew on the field before (the return interval is
        the shortest legal gap between two crops of the same kind). The cell is ~50 km across and the soil texture is a preset, so the field itself can differ.
      </p>
    </>,
  )
}
