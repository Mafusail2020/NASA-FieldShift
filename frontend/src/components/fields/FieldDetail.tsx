import { useEffect, useId, useRef, useState } from 'react'
import { findCell } from '../../lib/grid'
import type { CropId, FieldItem } from '../../lib/field'
import type { GridCell, GridDoc } from '../../types'
import { FieldFinanceSummary } from '../finance/FieldFinanceSummary'
import { FieldClimate } from './FieldClimate'
import { FieldRotation } from './FieldRotation'
import { LAT_RANGE, LON_RANGE, num, parsePair } from './coords'

const CROPS: { id: CropId; label: string }[] = [
  { id: 'winter_wheat', label: 'Winter wheat' },
  { id: 'maize', label: 'Maize' },
  { id: 'sunflower', label: 'Sunflower' },
  { id: 'pea', label: 'Pea' },
  { id: 'black_fallow', label: 'Black fallow' },
]
const fmt = (v: number | null) => (v == null ? '' : String(v))

interface Props {
  field: FieldItem
  grid: GridDoc | null
  open: boolean
  onToggle(): void
  onUpdate(patch: Partial<Omit<FieldItem, 'id'>>): void
  onDelete(): void
}

export default function FieldRow({ field, grid, open, onToggle, onUpdate, onDelete }: Props) {
  const uid = useId()
  const [lat, setLat] = useState(fmt(field.lat))
  const [lon, setLon] = useState(fmt(field.lon))
  const [area, setArea] = useState(fmt(field.areaHa))
  const [confirm, setConfirm] = useState(false)
  const [geo, setGeo] = useState<string | null>(null)

  // Coordinates set from outside (the picker map) replace the typed text; a typed out-of-range value stays as typed.
  useEffect(() => {
    if (field.lat != null && field.lat !== num(lat)) setLat(String(field.lat))
    if (field.lon != null && field.lon !== num(lon)) setLon(String(field.lon))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.lat, field.lon])

  // Body slides open and closed; its heavy children exist only while open or sliding shut.
  const [sliding, setSliding] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) { setSliding(true); return }
    if (!sliding) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setSliding(false); return }
    const t = setTimeout(() => setSliding(false), 600) // fallback if transitionend never fires
    return () => clearTimeout(t)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const mounted = open || sliding

  const latV = num(lat), lonV = num(lon), areaV = num(area)
  const latErr = lat.trim() && (latV == null ? 'Enter a number, for example 49.84.' : latV < LAT_RANGE[0] || latV > LAT_RANGE[1] ? `Latitude should be between ${LAT_RANGE[0]} and ${LAT_RANGE[1]} (Ukraine).` : null)
  const lonErr = lon.trim() && (lonV == null ? 'Enter a number, for example 24.03.' : lonV < LON_RANGE[0] || lonV > LON_RANGE[1] ? `Longitude should be between ${LON_RANGE[0]} and ${LON_RANGE[1]} (Ukraine).` : null)
  const areaErr = area.trim() && (areaV == null || areaV <= 0 ? 'Area must be a number above 0.' : null)
  const areaWarn = !areaErr && areaV != null ? (areaV > 5000 ? 'Over 5,000 ha is larger than most farms. Check the number.' : areaV < 0.1 ? 'Under 0.1 ha. Check the number.' : null) : null

  const setCoords = (la: string, lo: string) => {
    setLat(la); setLon(lo)
    const a = num(la), o = num(lo)
    const ok = (v: number | null, r: number[]) => (v != null && v >= r[0] && v <= r[1] ? v : null)
    onUpdate({ lat: ok(a, LAT_RANGE), lon: ok(o, LON_RANGE) })
  }
  const onCoord = (which: 'lat' | 'lon', v: string) => {
    const pair = parsePair(v)
    if (pair) { setCoords(pair[0], pair[1]); return }
    which === 'lat' ? setCoords(v, lon) : setCoords(lat, v)
  }
  const onArea = (v: string) => {
    setArea(v)
    const a = num(v)
    onUpdate({ areaHa: a != null && a > 0 ? a : null })
  }
  const locate = () => {
    if (!navigator.geolocation) { setGeo('Location is not available in this browser. Enter the coordinates by hand.'); return }
    setGeo('Looking for your location…')
    navigator.geolocation.getCurrentPosition(
      (p) => { setCoords(p.coords.latitude.toFixed(4), p.coords.longitude.toFixed(4)); setGeo('Location set. It is where you are now, so check it is the field.') },
      (e) => setGeo(e.code === e.PERMISSION_DENIED ? 'Location was denied. Allow it in the browser settings or enter the coordinates by hand.' : 'Could not get your location. Enter the coordinates by hand.'),
      { timeout: 10000 },
    )
  }

  const cell: GridCell | null = grid && field.lat != null && field.lon != null ? findCell(grid, field.lat, field.lon) : null
  let chip: { cls: string; text: string }
  if (field.lat == null || field.lon == null) chip = { cls: 'idle', text: 'Enter coordinates' }
  else if (!grid) chip = { cls: 'idle', text: 'Looking up cell…' }
  else if (cell) chip = { cls: 'ok', text: `Cell ${cell.lat.toFixed(1)}N ${cell.lon.toFixed(1)}E` }
  else chip = { cls: 'out', text: 'Outside the analysed area' }

  const id = (s: string) => `${uid}${s}`
  return (
    <article className={`fr${open ? ' fr-open' : ''}`} aria-label={field.name}>
      <div className="fr-head">
        <button type="button" className="fr-toggle" aria-expanded={open} aria-controls={id('body')} onClick={onToggle}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4" /></svg>
          <span className="sr-only">{open ? 'Collapse' : 'Expand'} {field.name}</span>
        </button>
        <label className="fr-name">
          <span className="sr-only">Field name</span>
          <input type="text" maxLength={40} value={field.name} onChange={(e) => onUpdate({ name: e.target.value.slice(0, 40) })} />
        </label>
        <span className={`fr-chip fr-chip-${chip.cls}`} role="status">{chip.text}</span>
        <div className="fr-del">
          {!confirm
            ? <button type="button" className="fr-btn" onClick={() => setConfirm(true)}>Delete</button>
            : <>
                <button type="button" className="fr-btn fr-danger" onClick={onDelete}>Confirm delete</button>
                <button type="button" className="fr-btn" onClick={() => setConfirm(false)}>Keep</button>
              </>}
        </div>
      </div>

      <div className="fr-inputs">
        <div className="fr-f">
          <label htmlFor={id('lat')}>Latitude (°N)</label>
          <input id={id('lat')} inputMode="decimal" autoComplete="off" placeholder="49.84" value={lat} onChange={(e) => onCoord('lat', e.target.value)}
            aria-invalid={!!latErr} aria-describedby={latErr ? id('lat-e') : undefined} />
          {latErr && <p className="fr-err" id={id('lat-e')}>{latErr}</p>}
        </div>
        <div className="fr-f">
          <label htmlFor={id('lon')}>Longitude (°E)</label>
          <input id={id('lon')} inputMode="decimal" autoComplete="off" placeholder="24.03" value={lon} onChange={(e) => onCoord('lon', e.target.value)}
            aria-invalid={!!lonErr} aria-describedby={lonErr ? id('lon-e') : undefined} />
          {lonErr && <p className="fr-err" id={id('lon-e')}>{lonErr}</p>}
        </div>
        <div className="fr-f">
          <label htmlFor={id('area')}>Area (ha)</label>
          <input id={id('area')} inputMode="decimal" autoComplete="off" placeholder="120" value={area} onChange={(e) => onArea(e.target.value)}
            aria-invalid={!!areaErr} aria-describedby={areaErr || areaWarn ? id('area-e') : undefined} />
          {(areaErr || areaWarn) && <p className={areaErr ? 'fr-err' : 'fr-warn'} id={id('area-e')}>{areaErr || areaWarn}</p>}
        </div>
        <div className="fr-f">
          <label htmlFor={id('crop')}>Crop this season</label>
          <select id={id('crop')} value={field.crop ?? ''} onChange={(e) => onUpdate({ crop: (e.target.value || null) as CropId | null })}>
            <option value="">Not set</option>
            {CROPS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
      </div>

      <div className="fr-tools">
        <button type="button" className="fr-btn" onClick={locate}>Use my location</button>
        <span className="fr-geo" role="status" aria-live="polite">{geo}</span>
      </div>
      <div className="fr-fin"><FieldFinanceSummary field={field} /></div>

      <div
        ref={wrap} className={`fr-collapse${open ? ' fr-collapse-open' : ''}`} id={id('body')} inert={!open} aria-hidden={!open}
        onTransitionEnd={(e) => { if (e.target === wrap.current && !open) setSliding(false) }}
      >
        <div className="fr-collapse-in">
          {mounted && (
            <div className="fr-body">
              <section className="fr-sec" aria-label="Climate and risks"><FieldClimate cell={cell} /></section>
              <section className="fr-sec" aria-label="Rotation"><FieldRotation field={field} cell={cell} /></section>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
