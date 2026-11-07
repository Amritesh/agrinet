import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'
maplibregl.setWorkerUrl(maplibreWorkerUrl)
import type { RoadRoute } from '../lib/routing'

const STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

/** Draws only the provider's road geometry. It never connects the endpoints with a straight line. */
export default function RouteMap({ route }: { route: RoadRoute }) {
  const ref = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const coords = route.geometry.coordinates

  useEffect(() => {
    if (!ref.current) return
    let map: maplibregl.Map | null = null
    try {
      const lons = coords.map((c) => c[0]), lats = coords.map((c) => c[1])
      map = new maplibregl.Map({
        container: ref.current,
        style: STYLE,
        bounds: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
        fitBoundsOptions: { padding: 28 },
        attributionControl: false,
        interactive: true,
      })
      map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Route: OSRM · © OpenStreetMap contributors' }), 'bottom-right')
      map.on('load', () => {
        if (!map) return
        map.addSource('road', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: route.geometry } })
        map.addLayer({ id: 'road-casing', type: 'line', source: 'road', paint: { 'line-color': '#111315', 'line-width': 6 }, layout: { 'line-join': 'round', 'line-cap': 'round' } })
        map.addLayer({ id: 'road-line', type: 'line', source: 'road', paint: { 'line-color': '#c4e69a', 'line-width': 3 }, layout: { 'line-join': 'round', 'line-cap': 'round' } })
      })
      map.on('error', () => undefined)
    } catch {
      setFailed(true)
    }
    return () => { map?.remove() }
  }, [route, coords])

  return (
    <div className="route-map" data-testid="route-map" data-route-vertices={coords.length}>
      <div ref={ref} className="route-map-canvas" role="img" aria-label={`Road route geometry with ${coords.length} vertices`} />
      {failed && <p className="field-hint route-map-fallback">The map could not start in this browser. The road geometry is kept in the export, and no straight line is drawn.</p>}
      <p className="route-map-attr">Road geometry © OpenStreetMap contributors via OSRM · Basemap © CARTO</p>
    </div>
  )
}
