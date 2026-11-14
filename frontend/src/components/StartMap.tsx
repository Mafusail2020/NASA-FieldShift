import 'leaflet/dist/leaflet.css'
import type { Feature, FeatureCollection } from 'geojson'
import type { Layer, PathOptions } from 'leaflet'
import { useEffect, useState } from 'react'
import { GeoJSON, MapContainer } from 'react-leaflet'
import { useI18n } from '../i18n'

interface Props { value: string; onPick(id: string): void }
type P = { iso: string; name: string; demo: string | null; occupied: boolean }

export function StartMap({ value, onPick }: Props) {
  const { t } = useI18n()
  const [geo, setGeo] = useState<FeatureCollection | null>(null)
  useEffect(() => { fetch('/data/ua_oblasts.geojson').then((r) => r.json()).then(setGeo).catch(() => {}) }, [])
  if (!geo) return <p>{t('loading')}</p>
  const style = (f?: Feature): PathOptions => {
    const p = f!.properties as P
    if (p.demo) return { color: '#1b5e20', weight: p.demo === value ? 3 : 1, fillColor: p.demo === value ? '#43a047' : '#a5d6a7', fillOpacity: 0.85 }
    if (p.occupied) return { color: '#616161', weight: 1, className: 'occupied', fillOpacity: 1 }
    return { color: '#9e9e9e', weight: 1, fillColor: '#eeeeee', fillOpacity: 0.8 }
  }
  const each = (f: Feature, layer: Layer) => {
    const p = f.properties as P
    layer.bindTooltip(p.name)
    if (p.demo) layer.on('click', () => onPick(p.demo!))
  }
  return (
    <div>
      <svg width="0" height="0" aria-hidden="true">
        <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#eeeeee" /><line x1="0" y1="0" x2="0" y2="6" stroke="#757575" strokeWidth="2" /></pattern></defs>
      </svg>
      <MapContainer bounds={[[44.2, 22.1], [52.4, 40.3]]} style={{ height: 380, background: '#f5f9fc' }} scrollWheelZoom={false} attributionControl={false}>
        <GeoJSON key={value} data={geo} style={style} onEachFeature={each} />
      </MapContainer>
      <ul className="legend-list">
        <li><span className="sw demo" /> {t('start.legend.demo')}</li>
        <li><span className="sw hatch" /> {t('start.legend.occupied')}</li>
        <li><span className="sw other" /> {t('start.legend.other')}</li>
      </ul>
      <p className="legend">{t('map.attribution')}</p>
    </div>
  )
}
