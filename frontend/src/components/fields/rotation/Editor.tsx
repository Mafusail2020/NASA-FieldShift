import { useId } from 'react'
import type { CropId } from '../../../lib/field'
import { ALL_CROPS, cropName, type RotIndex } from './model'

const MAX_YEARS = 6

export function Editor({ index, rotation, isDefault, onChange }: {
  index: RotIndex | null; rotation: CropId[]; isDefault: boolean; onChange(r: CropId[]): void
}) {
  const uid = useId()
  const reason = (c: string) => {
    const s = index?.crops[c]
    return s && !s.computable ? `not computable: missing ${s.missing.join(', ')}` : ''
  }
  const set = (i: number, c: CropId) => onChange(rotation.map((x, k) => (k === i ? c : x)))
  return (
    <div className="rot-editor">
      <p className="rot-help" id={`${uid}-h`}>
        One crop per year, in order; the list repeats. {isDefault && rotation.length > 0 && 'Started from this season’s crop.'}
      </p>
      <ol className="rot-years" aria-describedby={`${uid}-h`}>
        {rotation.map((c, i) => (
          <li key={i}>
            <label htmlFor={`${uid}-${i}`}>Year {i + 1}</label>
            <select id={`${uid}-${i}`} value={c} onChange={(e) => set(i, e.target.value as CropId)}>
              {ALL_CROPS.map((k) => (
                <option key={k} value={k} disabled={!!reason(k) && k !== c}>
                  {cropName(k)}{reason(k) ? ` (${reason(k)})` : ''}
                </option>
              ))}
            </select>
            <button type="button" className="rot-btn" aria-label={`Remove year ${i + 1}`} onClick={() => onChange(rotation.filter((_, k) => k !== i))}>×</button>
          </li>
        ))}
      </ol>
      <button type="button" className="rot-btn rot-add" disabled={rotation.length >= MAX_YEARS}
        onClick={() => onChange([...rotation, (rotation[rotation.length - 1] === 'winter_wheat' ? 'maize' : 'winter_wheat') as CropId])}>
        + Add a year
      </button>
      {rotation.some((c) => reason(c)) && <p className="rot-warn">A crop in your rotation cannot be computed yet. See the comparison for the missing parameters.</p>}
    </div>
  )
}
