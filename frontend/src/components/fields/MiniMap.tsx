import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import './CoordPicker.css'

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const UKRAINE: [number, number] = [49.0, 31.5]
const round = (v: number) => +v.toFixed(5)
const EPS = 1e-5 // about 1 m: smaller differences are rounding, not a move

interface Props { lat: number | null; lon: number | null; onMove(lat: number, lon: number): void }

// Keeps the map and the coordinate boxes in step. Typing moves the map; moving the map (drag, zoom, keys) writes the new centre back.
// A map move that lands on the current coordinates is ignored, so a programmatic setView never overwrites what the user typed.
function Sync({ lat, lon, onMove }: Props) {
  const map = useMap()
  const cur = useRef({ lat, lon })
  const dragged = useRef(false)
  useEffect(() => { cur.current = { lat, lon } }, [lat, lon])

  useMapEvents({
    dragstart: () => { dragged.current = true },
    moveend: () => {
      const c = map.getCenter()
      const user = dragged.current
      dragged.current = false
      const { lat: la, lon: lo } = cur.current
      if (la == null || lo == null) { if (user) onMove(round(c.lat), round(c.lng)); return } // no coordinates yet: only a drag sets them
      if (Math.abs(c.lat - la) > EPS || Math.abs(c.lng - lo) > EPS) onMove(round(c.lat), round(c.lng))
    },
  })

  useEffect(() => {
    if (lat == null || lon == null) return
    const c = map.getCenter()
    if (Math.abs(c.lat - lat) > EPS || Math.abs(c.lng - lon) > EPS) map.setView([lat, lon], Math.max(map.getZoom(), 13))
  }, [lat, lon, map])
  return null
}

export default function MiniMap({ lat, lon, onMove }: Props) {
  const [tileError, setTileError] = useState(false)
  const [initial] = useState(() => (lat != null && lon != null ? { c: [lat, lon] as [number, number], z: 14 } : { c: UKRAINE, z: 6 }))
  return (
    <div className="cp-map cp-mini" role="region" aria-label="Satellite map. Drag it so the pin sits on your field; the coordinates follow. Arrow keys move the map, plus and minus zoom.">
      <MapContainer center={initial.c} zoom={initial.z} minZoom={4} maxZoom={18} zoomControl attributionControl={false} className="cp-canvas">
        <Sync lat={lat} lon={lon} onMove={onMove} />
        <TileLayer url={ESRI} maxZoom={18} eventHandlers={{ tileerror: () => setTileError(true), tileload: () => setTileError(false) }} />
      </MapContainer>
      <div className="cp-pin" aria-hidden="true"><i /><i /><b /></div>
      <div className="cp-attrib">Imagery: Esri, Maxar, Earthstar Geographics</div>
      {tileError && <div className="cp-tile-error" role="status">Satellite imagery could not be loaded. Check your connection.</div>}
    </div>
  )
}
