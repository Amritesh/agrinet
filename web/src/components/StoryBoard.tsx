import { useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScatterplotLayer, PathLayer, IconLayer, TextLayer } from '@deck.gl/layers'
import type { Layer } from '@deck.gl/core'
import type { Scene, Story, StoryMarket } from '../lib/stories'
import { inr } from '../lib/stories'
maplibregl.setWorkerUrl(maplibreWorkerUrl)

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
const INDIA: [[number, number], [number, number]] = [[68.0, 6.5], [97.5, 35.6]]
type RGBA = [number, number, number, number]
const NAVY: RGBA = [27, 46, 64, 255]
const COPPER: RGBA = [184, 115, 51, 255]
const IVORY: RGBA = [250, 244, 230, 255]

// Original board-game pieces (inline SVG): a copper mandi token and a small lorry.
const svg = (s: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`
const TOKEN = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="76" viewBox="0 0 64 76"><ellipse cx="32" cy="70" rx="15" ry="4" fill="#1b2e40" opacity=".35"/><path d="M32 72 18 50a20 20 0 1 1 28 0Z" fill="#b87333" stroke="#1b2e40" stroke-width="3"/><circle cx="32" cy="34" r="13" fill="#faf4e6"/><path d="M23 36h18l-9-9z" fill="#1b2e40"/><rect x="26" y="36" width="12" height="7" fill="#1b2e40"/></svg>`)
const TRUCK = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="72" height="48" viewBox="0 0 72 48"><ellipse cx="36" cy="44" rx="30" ry="3" fill="#1b2e40" opacity=".3"/><rect x="4" y="8" width="40" height="26" rx="3" fill="#faf4e6" stroke="#1b2e40" stroke-width="3"/><path d="M44 16h13l9 10v8H44z" fill="#b87333" stroke="#1b2e40" stroke-width="3"/><circle cx="16" cy="36" r="6" fill="#1b2e40"/><circle cx="54" cy="36" r="6" fill="#1b2e40"/><path d="M10 18h28M10 25h28" stroke="#b87333" stroke-width="3"/></svg>`)

function pctColor(p: number | undefined): RGBA {
  if (p == null) return [210, 200, 180, 230]
  const t = Math.min(1, Math.abs(p) / 80)
  const from = [238, 230, 212]
  const to = p >= 0 ? [176, 64, 44] : [44, 92, 138]
  return [0, 1, 2].map((i) => Math.round(from[i] + (to[i] - from[i]) * (0.25 + 0.75 * t))).concat(240) as RGBA
}
const approx = (m: StoryMarket) => m.precision.startsWith('approximate')

function bounds(pts: [number, number][]): [[number, number], [number, number]] {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]]
}

function cumulative(path: [number, number][]) {
  const d = [0]
  for (let i = 1; i < path.length; i++) d.push(d[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]))
  return d
}
function slicePath(path: [number, number][], cum: number[], f: number): { part: [number, number][]; head: [number, number]; angle: number } {
  const total = cum[cum.length - 1], target = total * Math.max(0, Math.min(1, f))
  let i = 1
  while (i < cum.length - 1 && cum[i] < target) i++
  const a = path[i - 1], b = path[i], seg = cum[i] - cum[i - 1] || 1, t = (target - cum[i - 1]) / seg
  const head: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  return { part: [...path.slice(0, i), head], head, angle: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI }
}

export default function StoryBoard({ story, scene, reducedMotion }: { story: Story | null; scene: Scene | null; reducedMotion: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [progress, setProgress] = useState(1)
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!ref.current || mapRef.current) return
    let map: maplibregl.Map
    try {
      map = new maplibregl.Map({
        container: ref.current,
        style: { version: 8, sources: {}, layers: [{ id: 'sea', type: 'background', paint: { 'background-color': '#d5ddd6' } }] },
        bounds: INDIA, fitBoundsOptions: { padding: 24 }, pitch: 0, maxPitch: 50, attributionControl: false, dragRotate: false,
      })
    } catch {
      setFailed(true)
      return
    }
    mapRef.current = map
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Boundaries: AGRINET geo layer · Routes © OpenStreetMap contributors, OSRM' }))
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] })
    map.addControl(overlay as unknown as maplibregl.IControl)
    overlayRef.current = overlay
    map.on('load', async () => {
      try {
        const states = await fetch(`${BASE}/geo/india_states.geojson`).then((r) => r.json())
        map.addSource('states', { type: 'geojson', data: states })
        map.addLayer({ id: 'board-shadow', type: 'fill', source: 'states', paint: { 'fill-color': '#1b2e40', 'fill-opacity': 0.28, 'fill-translate': [3, 5] } })
        map.addLayer({ id: 'board', type: 'fill', source: 'states', paint: { 'fill-color': '#f3ead4' } })
        map.addLayer({ id: 'board-lines', type: 'line', source: 'states', paint: { 'line-color': '#3b4f60', 'line-opacity': 0.45, 'line-width': 0.7 } })
      } catch { /* board stays plain; markets and routes still render */ }
      // Keep attribution collapsed on small screens so it never covers the board.
      if ((ref.current?.clientWidth ?? 800) < 640) ref.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
      setReady(true)
    })
    map.on('move', () => setTick((t) => t + 1))
    map.on('error', () => undefined)
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // Highlight the scene's state tile (story state names match the boundary layer's ST_NM).
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map?.getLayer('board')) return
    map.setPaintProperty('board', 'fill-color', scene?.state ? ['match', ['get', 'ST_NM'], scene.state, '#ecd3b1', '#f3ead4'] : '#f3ead4')
  }, [ready, scene])

  const route = useMemo(() => (scene?.route ? story?.routes.find((r) => r.slug === scene.route) ?? null : null), [story, scene])
  const cum = useMemo(() => (route ? cumulative(route.path) : null), [route])

  // Camera choreography.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !story || !scene) return
    const byId = new Map(story.markets.map((m) => [m.id, m]))
    const pts = scene.focus.map((id) => byId.get(id)).filter(Boolean).map((m) => [m!.lon, m!.lat] as [number, number])
    const dur = reducedMotion ? 0 : 1800
    const narrow = (ref.current?.clientWidth ?? 800) < 640
    const pad = narrow ? 36 : 80
    if (scene.camera === 'india' || !pts.length) map.fitBounds(INDIA, { padding: narrow ? 8 : 24, pitch: 0, bearing: 0, duration: dur })
    else if (scene.camera === 'focus' && pts.length === 1) map.flyTo({ center: pts[0], zoom: narrow ? 6 : 6.6, pitch: 40, bearing: -10, duration: dur, essential: true })
    else {
      const all = route ? [...pts, ...route.path] : pts
      map.fitBounds(bounds(all), { padding: pad, pitch: 35, bearing: -8, duration: dur, maxZoom: 7.5 })
    }
  }, [ready, story, scene, route, reducedMotion])

  // Route reveal + lorry.
  useEffect(() => {
    if (!route || !scene?.truck || reducedMotion) { setProgress(1); return }
    setProgress(0)
    let raf = 0
    const t0 = performance.now(), dur = 5200
    const step = (t: number) => { const f = Math.min(1, (t - t0) / dur); setProgress(f); if (f < 1) raf = requestAnimationFrame(step) }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [route, scene, reducedMotion])

  const layers = useMemo(() => {
    if (!story || !scene) return []
    const L: Layer[] = []
    const focus = new Set(scene.focus)
    const colorBy = scene.colorBy === 'pct'
    if (story.kind === 'shock') {
      L.push(new ScatterplotLayer<StoryMarket>({
        id: 'mkts', data: story.markets, getPosition: (m) => [m.lon, m.lat], radiusUnits: 'pixels', billboard: true,
        getRadius: (m) => (colorBy ? 4 + Math.min(9, Math.abs(m.pct ?? 0) / 12) : 4), stroked: true, lineWidthUnits: 'pixels',
        getLineWidth: (m) => (focus.has(m.id) ? 2.5 : 1), getLineColor: (m) => (focus.has(m.id) ? COPPER : [27, 46, 64, 180]),
        getFillColor: (m) => { const c = colorBy ? pctColor(m.pct) : ([214, 204, 182, 220] as RGBA); return approx(m) ? [c[0], c[1], c[2], 140] as RGBA : c },
        updateTriggers: { getRadius: colorBy, getFillColor: colorBy, getLineWidth: scene.focus.join(), getLineColor: scene.focus.join() },
        transitions: reducedMotion ? undefined : { getRadius: 600, getFillColor: 600 },
      }))
    }
    if (route && cum) {
      const { part, head, angle } = slicePath(route.path, cum, progress)
      L.push(new PathLayer({ id: 'route-ghost', data: [{ p: route.path }], getPath: (d: { p: [number, number][] }) => d.p, getColor: [27, 46, 64, 60], getWidth: 3, widthUnits: 'pixels', capRounded: true, jointRounded: true }))
      L.push(new PathLayer({ id: 'route-casing', data: [{ p: part }], getPath: (d: { p: [number, number][] }) => d.p, getColor: NAVY, getWidth: 7, widthUnits: 'pixels', capRounded: true, jointRounded: true, updateTriggers: { getPath: progress } }))
      L.push(new PathLayer({ id: 'route', data: [{ p: part }], getPath: (d: { p: [number, number][] }) => d.p, getColor: COPPER, getWidth: 3.5, widthUnits: 'pixels', capRounded: true, jointRounded: true, updateTriggers: { getPath: progress } }))
      if (scene.truck && progress < 1) L.push(new IconLayer({ id: 'lorry', data: [{ head, angle }], getPosition: (d: { head: [number, number] }) => d.head, getIcon: () => ({ url: TRUCK, width: 72, height: 48, anchorY: 40 }), getSize: 30, sizeUnits: 'pixels', billboard: true, updateTriggers: { getPosition: progress } }))
    }
    const pins = story.markets.filter((m) => focus.has(m.id) && (story.kind !== 'shock' || scene.kind === 'market' || scene.kind === 'conclusion'))
    const pinData = story.kind === 'shock' ? pins : story.markets
    L.push(new IconLayer<StoryMarket>({ id: 'pins', data: pinData, getPosition: (m) => [m.lon, m.lat], getIcon: () => ({ url: TOKEN, width: 64, height: 76, anchorY: 72 }), getSize: 34, sizeUnits: 'pixels', billboard: true, parameters: { depthCompare: 'always' } }))
    L.push(new TextLayer<StoryMarket>({
      id: 'labels', data: pinData, getPosition: (m) => [m.lon, m.lat], getText: (m) => m.name + (approx(m) ? ' (approx.)' : ''), getSize: 13, getColor: NAVY,
      getPixelOffset: [16, -14], getTextAnchor: 'start', getAlignmentBaseline: 'center', parameters: { depthCompare: 'always' }, background: true, getBackgroundColor: IVORY, backgroundPadding: [5, 2], fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 600, billboard: true,
      characterSet: 'auto',
    }))
    return L
  }, [story, scene, route, cum, progress, reducedMotion])

  useEffect(() => { overlayRef.current?.setProps({ layers }) }, [layers])

  // Price cards anchored to map tokens.
  const map = mapRef.current
  const cards = ready && map && story && scene?.cards ? scene.cards.map((id) => {
    const m = story.markets.find((x) => x.id === id)
    if (!m) return null
    const p = map.project([m.lon, m.lat])
    let line = ''
    if (story.kind === 'shock' && m.prev != null && m.price != null) line = `${inr(m.prev)} → ${inr(m.price)}`
    else if (story.kind === 'corridor') line = inr(id === story.markets[0].id ? story.facts.buy_median : story.facts.sell_median)
    else if (story.kind === 'storage') line = scene.kind === 'prices' ? `March ${inr(story.facts.buy)}` : `Oct ${inr(story.facts.sell)}`
    return { id, x: p.x, y: p.y, name: m.name, line }
  }).filter(Boolean) as { id: number; x: number; y: number; name: string; line: string }[] : []

  return (
    <div className="board-wrap">
      <div ref={ref} className="board-map" role="img" aria-label={story ? `Map of India focused on ${story.markets.slice(0, 3).map((m) => m.name).join(', ')}` : 'Map of India'} />
      {failed && <div className="board-fallback">The interactive map needs WebGL, which this browser has turned off. The story below still works.</div>}
      {cards.map((c) => (
        <div key={c.id} className="price-card" style={{ transform: `translate(${Math.round(c.x)}px, ${Math.round(c.y)}px)` }}>
          <span className="pc-name">{c.name}</span>
          <span className="pc-price">{c.line}<small>/qtl</small></span>
        </div>
      ))}
      {story?.kind === 'shock' && scene?.colorBy === 'pct' && (
        <div className="board-legend" aria-label="Legend">
          <span className="lg-bar" /> <span>fell · month-on-month change · rose</span>
          <span className="lg-ring" /> <span>pale = approximate (district centre)</span>
        </div>
      )}
    </div>
  )
}
