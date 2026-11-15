// Rotation analysis of one field (props), in an expanded row of the Fields page. Data: public/data/rotations_grid.json (index) and
// public/data/rotations/<cell id>.json, built by backend/pipeline/build_grid_rotations.py.
import { useId } from 'react'
import type { GridCell } from '../../types'
import { useField, type CropId, type FieldItem } from '../../lib/field'
import StatusChip from '../StatusChip'
import { Compare } from './rotation/Compare'
import { Editor } from './rotation/Editor'
import { useCellRot, useGridSoil, useRotIndex, type Soil } from './rotation/model'
import { FoldNote } from '../SourcesFold'
import { NOT_MODELLED } from './rotation/texts'

const NOT_MODELLED_FOOTER = 'Modelled: daily soil water bucket (FAO-56), water-stress days and Ks, heat days where a threshold exists, bare-soil months, KMU No. 164 return interval. Snow comes from a temperature-based degree-day store, not measured snow depth. Predecessor yield coefficients (k) affect money only, on the Finance page, never this panel.'
import './rotation/rotation.css'

const SOILS: Soil[] = ['light', 'medium', 'heavy']

export function FieldRotation({ field, cell }: { field: FieldItem; cell: GridCell | null }) {
  // keyed by field: nothing carries over from another row
  return <Inner key={field.id} field={field} cell={cell} />
}

function Inner({ field, cell }: { field: FieldItem; cell: GridCell | null }) {
  const uid = useId()
  const { updateField } = useField()
  const setField = (patch: Partial<Pick<FieldItem, 'rotation' | 'soil'>>) => updateField(field.id, patch)
  const gs = useGridSoil()
  const sc = cell && gs.state === 'ready' ? gs.data.cells.find((c) => c.id === cell.id) : undefined
  const auto: Soil | null = sc?.preset ?? null
  const soil: Soil = field.soil ?? auto ?? 'medium'
  const idx = useRotIndex()
  const index = idx.state === 'ready' ? idx.data : null
  const missing = !!(cell && index && !index.cells.includes(cell.id))
  const data = useCellRot(cell?.id ?? null, !index || missing)

  const isDefault = field.rotation.length === 0 && !!field.crop
  const current: CropId[] = field.rotation.length ? field.rotation : field.crop ? [field.crop] : []
  const soilRow = (s: Soil, p: string) => index?.soil_params.find((r) => r.soil === s && r.parameter === p)

  return (
    <section className="rot" aria-labelledby={`${uid}h`}>
      <h2 id={`${uid}h`}>Rotation analysis</h2>
      <p className="rot-help">
        Compares rotations on this cell&rsquo;s 35-year NASA POWER weather. All rotations here are drafts <StatusChip status="estimate" source="data/params/rotations.yaml" /> and
        every number is a model result for a ~50 km cell, not for your field.
      </p>

      {!cell && (
        <div className="rot-empty"><b>No weather data for this field yet</b><p>Enter the field&rsquo;s coordinates (latitude and longitude) inside the analysed area of Ukraine, so the site can find its ~50 km NASA POWER cell.</p></div>
      )}
      {cell && idx.state === 'loading' && <div className="rot-skel" role="status" aria-label="Loading rotation data" />}
      {idx.state === 'error' && <p className="rot-err" role="alert">Rotation data could not be loaded (data/rotations_grid.json). Run the build_grid_rotations pipeline.</p>}

      {cell && index && (
        <div className="rot-grid">
          <div className="rot-left">
          <div className="rot-sec">
            <h3>Your current rotation</h3>
            <Editor index={index} rotation={current} isDefault={isDefault} onChange={(r) => setField({ rotation: r })} />
            <fieldset className="rot-soil">
              <legend>Soil</legend>
              <p className="rot-soilline">
                {field.soil
                  ? <>Your choice: <b>{soil}</b> ({soilRow(soil, 'texture')?.value}).</>
                  : sc?.preset
                    ? <>Automatic: <b>{soil}</b> ({sc.texture}, clay {sc.clay_pct}%, sand {sc.sand_pct}%) from SoilGrids at or near the cell centre, {gs.state === 'ready' ? gs.data.depth ?? '0-30 cm' : ''}.</>
                    : <>Automatic soil is not available{gs.state === 'loading' ? ' (loading)' : gs.state === 'error' ? ' (grid_soil.json could not be loaded)' : sc?.reason ? ` (${sc.reason})` : ' for this cell'}; using <b>medium</b>.</>}
                {' '}<StatusChip status={field.soil || !sc?.preset ? 'estimate' : gs.state === 'ready' ? gs.data.status : 'estimate'} quiet
                  source={field.soil ? 'Chosen by the user' : gs.state === 'ready' ? gs.data.source : 'Fallback preset, not from data'} />
              </p>
              <div role="group" aria-label="Overwrite soil preset" className="rot-seg">
                {SOILS.map((s) => (
                  <button key={s} type="button" aria-pressed={field.soil === s} onClick={() => setField({ soil: s })}>{s[0].toUpperCase() + s.slice(1)}</button>
                ))}
              </div>
              <button type="button" className="rot-btn rot-auto" disabled={field.soil === null} onClick={() => setField({ soil: null })}>
                Use automatic{auto ? ` (${auto})` : ''}
              </button>
            </fieldset>
          </div>

          </div>
          <div className="rot-right">
          {missing && (
            <div className="rot-empty" role="status">
              <b>No rotation data for this cell yet</b>
              <p>The NASA POWER download for the grid is still running; this cell has not been processed. Choose another cell or try again later.</p>
            </div>
          )}
          {!missing && data.state === 'loading' && <div className="rot-skel" role="status" aria-label="Loading cell rotation data" />}
          {!missing && data.state === 'error' && <p className="rot-err" role="alert">Could not load rotation data for cell {cell.id}.</p>}
          {!missing && data.state === 'ready' && <Compare index={index} cell={data.data} soil={soil} current={current} analysis={field.analysis} />}

          </div>
          {/* the list of what is not modelled lives in the "Sources and status" block at the bottom of the page */}
          <FoldNote id="rotation-not-modelled" title="What the rotation analysis does not model" items={NOT_MODELLED} footer={NOT_MODELLED_FOOTER} />
        </div>
      )}
    </section>
  )
}
