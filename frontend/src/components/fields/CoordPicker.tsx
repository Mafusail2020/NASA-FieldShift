import 'leaflet/dist/leaflet.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import type { Map as LMap } from 'leaflet'
import type { FieldItem } from '../../lib/field'
import { findCell } from '../../lib/grid'
import type { GridDoc } from '../../types'
import './CoordPicker.css'

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const UKRAINE: [number, number] = [49.0, 31.5]
const touchOnly = () => window.matchMedia('(pointer: coarse)').matches

function Track({ onMove, onMap }: { onMove(lat: number, lon: number): void; onMap(m: LMap): void }) {
  const map = useMap()
  useEffect(() => { onMap(map); const c = map.getCenter(); onMove(c.lat, c.lng) }, [map, onMap, onMove])
  useMapEvents({ move: () => { const c = map.getCenter(); onMove(c.lat, c.lng) } })
  return null
}

interface Props {
  fields: FieldItem[]
  activeId: string
  grid: GridDoc | null
  onUse(id: string, lat: number, lon: number): void
}

export default function CoordPicker({ fields, activeId, grid, onUse }: Props) {
  const [targetId, setTargetId] = useState(activeId)
  useEffect(() => setTargetId(activeId), [activeId])
  const target = fields.find((f) => f.id === targetId) ?? fields[0]
  const mapRef = useRef<LMap | null>(null)
  const [centre, setCentre] = useState<[number, number]>([0, 0])
  const [announce, setAnnounce] = useState('')
  const [tileError, setTileError] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [initial] = useState(() => (target.lat != null && target.lon != null ? { c: [target.lat, target.lon] as [number, number], z: 14 } : { c: UKRAINE, z: 6 }))
  const coarse = touchOnly()

  const onMove = useCallback((lat: number, lon: number) => setCentre([lat, lon]), [])
  const onMap = useCallback((m: LMap) => {
    mapRef.current = m
    m.on('moveend', () => { const c = m.getCenter(); setAnnounce(`Pin at ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`) })
  }, [])

  const pickTarget = (id: string) => {
    setTargetId(id)
    const f = fields.find((x) => x.id === id)
    if (f && f.lat != null && f.lon != null) mapRef.current?.setView([f.lat, f.lon], 14)
  }

  const [lat, lon] = centre
  const text = `${lat.toFixed(5)}, ${lon.toFixed(5)}`
  const cell = grid ? findCell(grid, lat, lon) : null
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setMsg('Copied.') } catch { setMsg('Copy is not available here. Select the numbers and copy them by hand.') }
  }
  const locate = () => {
    if (!navigator.geolocation) { setMsg('Location is not available in this browser.'); return }
    setMsg('Looking for your location…')
    navigator.geolocation.getCurrentPosition(
      (p) => { mapRef.current?.setView([p.coords.latitude, p.coords.longitude], 15); setMsg(null) },
      (e) => setMsg(e.code === e.PERMISSION_DENIED ? 'Location was denied. Allow it in the browser settings, or move the map by hand.' : 'Could not get your location. Move the map by hand.'),
      { timeout: 10000 },
    )
  }

  return (
    <div className="cp">
      <div className="cp-map" role="region" aria-label="Satellite map for choosing coordinates. Arrow keys move the map, plus and minus zoom.">
        <MapContainer
          center={initial.c} zoom={initial.z} minZoom={4} maxZoom={18} zoomControl attributionControl={false}
          dragging={!coarse} className="cp-canvas"
        >
          <Track onMove={onMove} onMap={onMap} />
          <TileLayer url={ESRI} maxZoom={18} eventHandlers={{ tileerror: () => setTileError(true), tileload: () => setTileError(false) }} />
        </MapContainer>
        <div className="cp-pin" aria-hidden="true"><i /><i /><b /></div>
        <div className="cp-attrib">Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community</div>
        {tileError && <div className="cp-tile-error" role="status">Satellite imagery could not be loaded. Check your connection.</div>}
        {coarse && <div className="cp-touch">Use two fingers to move the map</div>}
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>

      <div className="cp-read">
        <output className="cp-coords" aria-hidden="true">{text}</output>
        <span className={`cp-chip ${cell ? 'cp-in' : 'cp-out'}`}>
          {!grid ? 'Looking up cell…' : cell ? `Inside cell ${cell.lat.toFixed(1)}N ${cell.lon.toFixed(1)}E` : 'Outside the analysed area'}
        </span>
      </div>
      <div className="cp-actions">
        <button type="button" className="fr-btn" onClick={copy}>Copy</button>
        <button type="button" className="fr-btn" onClick={locate}>Use my location</button>
      </div>
      <div className="cp-use">
        {fields.length > 1 && (
          <label className="cp-target">
            <span>Field</span>
            <select value={target.id} onChange={(e) => pickTarget(e.target.value)}>
              {fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="fp-add" onClick={() => { onUse(target.id, +lat.toFixed(5), +lon.toFixed(5)); setMsg(`Coordinates set for ${target.name}.`) }}>
          Use these coordinates for {target.name}
        </button>
      </div>
      <p className="cp-msg" role="status" aria-live="polite">{msg}</p>
    </div>
  )
}
