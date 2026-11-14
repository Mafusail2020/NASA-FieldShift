import { useEffect, useId, useState } from 'react'
import { findCell } from '../../lib/grid'
import type { CropId, FieldItem } from '../../lib/field'
import type { GridCell, GridDoc } from '../../types'
import { FieldFinanceSummary } from '../finance/FieldFinanceSummary'
import { FieldClimate } from './FieldClimate'
import { FieldRotation } from './FieldRotation'
import MiniMap from './MiniMap'
import { LAT_RANGE, LON_RANGE, num, parsePair } from './coords'

const CROPS: { id: CropId; label: string }[] = [
  { id: 'winter_wheat', label: 'Winter wheat' },
  { id: 'maize', label: 'Maize' },
  { id: 'sunflower', label: 'Sunflower' },
  { id: 'pea', label: 'Pea' },
  { id: 'soybean', label: 'Soybean' },
  { id: 'sugar_beet', label: 'Sugar beet' },
  { id: 'spring_barley', label: 'Spring barley' },
  { id: 'millet', label: 'Millet' },
  { id: 'black_fallow', label: 'Black fallow' },
]
const fmt = (v: number | null) => (v == null ? '' : String(v))

interface Props {
  field: FieldItem
  grid: GridDoc | null
  onUpdate(patch: Partial<Omit<FieldItem, 'id'>>): void
}

export default function FieldDetail({ field, grid, onUpdate }: Props) {
  const uid = useId()
  const [lat, setLat] = useState(fmt(field.lat))
  const [lon, setLon] = useState(fmt(field.lon))
  const [area, setArea] = useState(fmt(field.areaHa))
  const [geo, setGeo] = useState<string | null>(null)

  // Coordinates set from outside (the picker map) replace the typed text; a typed out-of-range value stays as typed.
  useEffect(() => {
    if (field.lat != null && field.lat !== num(lat)) setLat(String(field.lat))
    if (field.lon != null && field.lon !== num(lon)) setLon(String(field.lon))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.lat, field.lon])

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
  const missing = [
    field.lat == null || field.lon == null ? 'No coordinates' : null,
    field.areaHa == null ? 'No area' : null,
    field.crop == null ? 'No crop' : null,
    field.rotation.length === 0 ? 'No rotation' : null,
  ].filter((m): m is string => m != null)

  const id = (s: string) => `${uid}${s}`
  return (
    <article className="fd" aria-label={field.name}>
      <div className="fd-head">
        <label className="fd-name">
          <span className="sr-only">Field name</span>
          <input type="text" maxLength={40} value={field.name} onChange={(e) => onUpdate({ name: e.target.value.slice(0, 40) })} />
        </label>
      </div>

      <div className="fd-top">
        <MiniMap lat={field.lat} lon={field.lon} locked={field.locked} onMove={(la, lo) => setCoords(String(la), String(lo))} />
        <div className="fd-form">
      <div className="fr-inputs">
        <div className="fr-f">
          <label htmlFor={id('lat')}>Latitude (°N)</label>
          <input id={id('lat')} inputMode="decimal" autoComplete="off" placeholder="49.84" value={lat} onChange={(e) => onCoord('lat', e.target.value)} readOnly={field.locked}
            aria-invalid={!!latErr} aria-describedby={latErr ? id('lat-e') : undefined} />
          {latErr && <p className="fr-err" id={id('lat-e')}>{latErr}</p>}
        </div>
        <div className="fr-f">
          <label htmlFor={id('lon')}>Longitude (°E)</label>
          <input id={id('lon')} inputMode="decimal" autoComplete="off" placeholder="24.03" value={lon} onChange={(e) => onCoord('lon', e.target.value)} readOnly={field.locked}
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

      <div className="fr-meta">
        <button type="button" className="fr-btn" onClick={locate} disabled={field.locked}>Use my location</button>
        <button type="button" className={`fr-btn fr-lock${field.locked ? ' fr-lock-on' : ''}`} aria-pressed={field.locked} onClick={() => onUpdate({ locked: !field.locked })}>
          <svg viewBox="0 0 24 24" aria-hidden="true">{field.locked ? <path d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z" /> : <path d="M7 11V8a5 5 0 0 1 9.6-2M5 11h14v10H5z" />}</svg>
          {field.locked ? 'Location locked' : 'Lock location'}
        </button>
        <span className="fr-geo" role="status" aria-live="polite">{geo}</span>
      </div>
      {cell && <p className="fr-geo">Elevation {Math.round(cell.elevation_m)} m at the centre of the climate cell.</p>}
      {missing.length > 0 && (
        <ul className="fr-missing" aria-label="Missing information">
          {missing.map((m) => <li key={m}><i aria-hidden="true">!</i>{m}</li>)}
        </ul>
      )}
        </div>
      </div>
      <div className="fr-fin"><FieldFinanceSummary field={field} /></div>

      <div className="fr-body">
        <section className="fr-sec" aria-label="Climate and risks"><FieldClimate cell={cell} /></section>
        <section className="fr-sec" aria-label="Rotation"><FieldRotation field={field} cell={cell} /></section>
      </div>
    </article>
  )
}
