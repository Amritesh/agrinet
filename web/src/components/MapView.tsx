import { useEffect, useMemo, useRef, useState } from 'react'
import { collapseAttributionOnSmallMap } from '../lib/mapUi'
import * as maplibregl from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
maplibregl.setWorkerUrl(maplibreWorkerUrl)
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScatterplotLayer, GeoJsonLayer, ColumnLayer, IconLayer } from '@deck.gl/layers'
import { HeatmapLayer } from '@deck.gl/aggregation-layers'
import type { Layer, PickingInfo } from '@deck.gl/core'
import { useStore } from '../store'
import { loadSnapshot, ordYear, ordToIso, isoToOrd, fetchShocks, fetchNews, type YearSnapshot, type Shock, type NewsEvent, type Market } from '../lib/data'
import { priceColor } from '../lib/color'

const STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

interface Pt {
  m: Market
  price: number
  cmpPrice: number | null
}

export interface HoverInfo {
  x: number
  y: number
  text: string[]
}

/** Find the snapshot day at or before `ord` within `maxBack` days. */
export function nearestDay(snap: YearSnapshot | null, ord: number, maxBack = 7): number | null {
  if (!snap) return null
  for (let k = 0; k <= maxBack; k++) if (snap.days.has(ord - k)) return ord - k
  return null
}

export default function MapView({ onHover, onStatus }: { onHover: (h: HoverInfo | null) => void; onStatus: (s: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const [ready, setReady] = useState(false)
  const [states, setStates] = useState<unknown>(null)
  const [districts, setDistricts] = useState<unknown>(null)
  const [snap, setSnap] = useState<YearSnapshot | null>(null)
  const [cmpSnap, setCmpSnap] = useState<YearSnapshot | null>(null)
  const [shocks, setShocks] = useState<Shock[]>([])
  const [news, setNews] = useState<NewsEvent[]>([])
  const [pulse, setPulse] = useState(0)

  const { commodity, ord, compareOrd, layers, markets, marketById, selectMarket, selectShock, selectedMarket, minSeverity, reducedMotion, playing } = useStore()

  // base map
  useEffect(() => {
    if (!ref.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: ref.current,
      style: STYLE,
      center: [79.5, 22.5],
      zoom: 4.3,
      minZoom: 3,
      maxZoom: 12,
      pitch: 30,
      attributionControl: false,
    })
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Prices: AGMARKNET/data.gov.in (GODL) · Boundaries: DataMeet' }), 'bottom-right')
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right')
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] })
    map.addControl(overlay as unknown as maplibregl.IControl)
    mapRef.current = map
    overlayRef.current = overlay
    map.on('load', () => { collapseAttributionOnSmallMap(ref.current); setReady(true) })
    fetch(`${BASE}/geo/india_states.geojson`).then((r) => r.json()).then(setStates)
    fetch(`${BASE}/geo/india_districts.geojson`).then((r) => r.json()).then(setDistricts)
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // snapshot for selected year (+ prefetch neighbours)
  useEffect(() => {
    const y = ordYear(ord)
    let live = true
    loadSnapshot(commodity.slug, y).then((s) => live && setSnap(s))
    loadSnapshot(commodity.slug, y + 1)
    loadSnapshot(commodity.slug, y - 1)
    return () => {
      live = false
    }
  }, [commodity, ord])

  useEffect(() => {
    if (compareOrd == null) return setCmpSnap(null)
    let live = true
    loadSnapshot(commodity.slug, ordYear(compareOrd)).then((s) => live && setCmpSnap(s))
    return () => {
      live = false
    }
  }, [commodity, compareOrd])

  // shocks + news in a 30-day window ending at the selected date (refetch on coarse change)
  const windowKey = `${commodity.id}:${Math.floor(ord / 7)}:${minSeverity}`
  useEffect(() => {
    let live = true
    const to = ordToIso(ord)
    const from = ordToIso(ord - 30)
    fetchShocks(commodity.id, from, to, minSeverity, 1500).then((s) => live && setShocks(s)).catch(() => live && setShocks([]))
    fetchNews(commodity.id, from, to, 200).then((n) => live && setNews(n)).catch(() => live && setNews([]))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowKey])

  // pulse animation for shocks (disabled with reduced motion or while playing fast)
  useEffect(() => {
    if (reducedMotion || !layers.shocks) return
    let raf = 0
    const start = performance.now()
    const loop = (t: number) => {
      setPulse(((t - start) / 1400) % 1)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [reducedMotion, layers.shocks])

  const day = nearestDay(snap, ord)
  const cmpDay = compareOrd != null ? nearestDay(cmpSnap, compareOrd) : null

  const points = useMemo<Pt[]>(() => {
    if (!snap || day == null) return []
    const ds = snap.days.get(day)!
    const cmp = cmpSnap && cmpDay != null ? cmpSnap.days.get(cmpDay) : null
    const cmpMap = new Map<number, number>()
    if (cmp) for (let i = 0; i < cmp.ids.length; i++) cmpMap.set(cmp.ids[i], cmp.modal[i])
    const out: Pt[] = []
    for (let i = 0; i < ds.ids.length; i++) {
      const m = marketById.get(ds.ids[i])
      if (!m || m.lat == null || m.lon == null) continue
      out.push({ m, price: ds.modal[i], cmpPrice: cmpMap.get(ds.ids[i]) ?? null })
    }
    return out
  }, [snap, day, cmpSnap, cmpDay, marketById])

  useEffect(() => {
    if (!snap) return onStatus(`No ${commodity.name} snapshot file for ${ordYear(ord)}`)
    if (day == null) return onStatus(`No ${commodity.name} observations reported within 7 days before ${ordToIso(ord)}`)
    const txt = day === ord ? `${points.length} mandis reporting ${commodity.name} on ${ordToIso(ord)}` : `${points.length} mandis · latest report ${ordToIso(day)} (none on ${ordToIso(ord)})`
    onStatus(txt)
  }, [snap, day, ord, points.length, commodity.name, onStatus])

  // shocks on the selected day (±3 days) get pulses; all window shocks get columns
  const dayShocks = useMemo(() => shocks.filter((s) => Math.abs(isoToOrd(s.obs_date) - ord) <= 3 && s.lat != null), [shocks, ord])
  const bestByMarket = useMemo(() => {
    const m = new Map<number, Shock>()
    for (const s of shocks) {
      if (s.lat == null) continue
      const cur = m.get(s.market_id)
      if (!cur || Math.abs(s.score) > Math.abs(cur.score)) m.set(s.market_id, s)
    }
    return [...m.values()]
  }, [shocks])

  useEffect(() => {
    if (!ready || !overlayRef.current) return
    const scale = snap ? { lo: snap.p5, mid: snap.p50, hi: snap.p95 } : { lo: 0, mid: 1000, hi: 3000 }
    const trans = reducedMotion || playing ? undefined : { getFillColor: 350, getRadius: 350 }
    const L: Layer[] = []
    if (layers.states && states)
      L.push(
        new GeoJsonLayer({ id: 'states', data: states as never, stroked: true, filled: false, getLineColor: [140, 160, 190, 110], lineWidthMinPixels: 1, pickable: false }),
      )
    if (layers.districts && districts)
      L.push(
        new GeoJsonLayer({
          id: 'districts',
          data: districts as never,
          stroked: true,
          filled: true,
          getFillColor: [30, 41, 59, 25],
          getLineColor: [100, 116, 139, 70],
          lineWidthMinPixels: 0.5,
          pickable: true,
        }),
      )
    if (layers.heat && points.length)
      L.push(
        new HeatmapLayer<Pt>({
          id: 'heat',
          data: points,
          getPosition: (p) => [p.m.lon!, p.m.lat!],
          getWeight: (p) => Math.max(0.1, (p.price - scale.lo) / Math.max(1, scale.hi - scale.lo)),
          radiusPixels: 50,
          intensity: 1.2,
          threshold: 0.08,
          colorRange: [
            [37, 99, 235, 40],
            [34, 197, 94, 120],
            [250, 204, 21, 170],
            [249, 115, 22, 210],
            [220, 38, 38, 240],
          ],
          opacity: 0.55,
        }),
      )
    if (layers.points && points.length)
      L.push(
        new ScatterplotLayer<Pt>({
          id: 'markets',
          data: points,
          getPosition: (p) => [p.m.lon!, p.m.lat!],
          getFillColor: (p) => (p.cmpPrice != null ? diffColor(p.price, p.cmpPrice) : priceColor(p.price, scale)),
          getRadius: (p) => (p.m.id === selectedMarket?.id ? 9000 : 4500),
          radiusMinPixels: 2.5,
          radiusMaxPixels: 14,
          getLineColor: (p) => (p.m.c >= 70 ? [255, 255, 255, 90] : [251, 191, 36, 140]),
          getLineWidth: (p) => (p.m.c >= 70 ? 1 : 2),
          lineWidthUnits: 'pixels',
          stroked: true,
          pickable: true,
          autoHighlight: true,
          highlightColor: [255, 255, 255, 120],
          transitions: trans,
          updateTriggers: { getFillColor: [scale.lo, scale.hi, cmpDay], getRadius: [selectedMarket?.id] },
          onClick: (info: PickingInfo<Pt>) => {
            if (info.object) selectMarket(info.object.m)
          },
          onHover: (info: PickingInfo<Pt>) => {
            if (!info.object) return onHover(null)
            const p = info.object
            onHover({
              x: info.x,
              y: info.y,
              text: [
                `${p.m.n} · ${p.m.d}, ${p.m.s}`,
                `${commodity.name} modal ₹${p.price}/q on ${ordToIso(day!)}`,
                p.cmpPrice != null ? `vs ₹${p.cmpPrice} on ${ordToIso(cmpDay!)} (${(((p.price - p.cmpPrice) / p.cmpPrice) * 100).toFixed(0)}%)` : `geocode confidence ${p.m.c}% (${p.m.src})`,
              ],
            })
          },
        }),
      )
    if (layers.columns && bestByMarket.length)
      L.push(
        new ColumnLayer<Shock>({
          id: 'anomaly-columns',
          data: bestByMarket,
          diskResolution: 12,
          radius: 7000,
          extruded: true,
          elevationScale: 1,
          getPosition: (s) => [s.lon!, s.lat!],
          getElevation: (s) => Math.min(6, Math.abs(s.score)) * 40000,
          getFillColor: (s) => (s.direction === 'up' ? [248, 113, 113, 170] : [96, 165, 250, 170]),
          pickable: true,
          material: { ambient: 0.6, diffuse: 0.6, shininess: 20, specularColor: [40, 40, 40] },
          onClick: (info: PickingInfo<Shock>) => info.object && selectShock(info.object),
          onHover: (info: PickingInfo<Shock>) =>
            onHover(
              info.object
                ? { x: info.x, y: info.y, text: [`${info.object.market_name}: ${info.object.method} ${info.object.direction} z=${info.object.score.toFixed(1)} on ${info.object.obs_date}`, `severity ${info.object.severity} · observed ₹${info.object.observed}`] }
                : null,
            ),
        }),
      )
    if (layers.shocks && dayShocks.length)
      L.push(
        new ScatterplotLayer<Shock>({
          id: 'shock-pulse',
          data: dayShocks,
          getPosition: (s) => [s.lon!, s.lat!],
          getRadius: (s) => 12000 + (reducedMotion ? 10000 : pulse * 45000) * (s.severity / 2),
          getFillColor: (s) => [s.direction === 'up' ? 248 : 96, s.direction === 'up' ? 113 : 165, s.direction === 'up' ? 113 : 250, reducedMotion ? 60 : Math.round(120 * (1 - pulse))],
          getLineColor: (s) => (s.direction === 'up' ? [248, 113, 113, 200] : [96, 165, 250, 200]),
          lineWidthMinPixels: 1.5,
          stroked: true,
          filled: true,
          pickable: true,
          radiusMinPixels: 6,
          radiusMaxPixels: 80,
          updateTriggers: { getRadius: [pulse], getFillColor: [pulse] },
          onClick: (info: PickingInfo<Shock>) => info.object && selectShock(info.object),
        }),
      )
    if (layers.news && news.length)
      L.push(
        new IconLayer<NewsEvent>({
          id: 'news',
          data: news.filter((n) => n.lat != null),
          getPosition: (n) => [n.lon!, n.lat!],
          getIcon: () => 'marker',
          iconAtlas: `${BASE}/icons/news.png`,
          iconMapping: { marker: { x: 0, y: 0, width: 64, height: 64, mask: true } },
          getColor: [94, 234, 212, 220],
          getSize: 22,
          pickable: true,
          onHover: (info: PickingInfo<NewsEvent>) => onHover(info.object ? { x: info.x, y: info.y, text: [info.object.title, `${info.object.source} · ${info.object.published_at.slice(0, 10)} · ${info.object.event_type}`] } : null),
          onClick: (info: PickingInfo<NewsEvent>) => {
            if (info.object) window.open(info.object.url, '_blank', 'noopener')
          },
        }),
      )
    overlayRef.current.setProps({ layers: L })
  }, [ready, points, layers, states, districts, snap, bestByMarket, dayShocks, news, pulse, selectedMarket, reducedMotion, playing, cmpDay, commodity.name, day, onHover, selectMarket, selectShock])

  // fly to selected market
  useEffect(() => {
    if (!selectedMarket || selectedMarket.lat == null || !mapRef.current) return
    const map = mapRef.current
    const z = Math.max(map.getZoom(), 6)
    map.easeTo({ center: [selectedMarket.lon!, selectedMarket.lat], zoom: z, duration: reducedMotion ? 0 : 800 })
  }, [selectedMarket, reducedMotion])

  return (
    <div ref={ref} className="map" role="application" aria-label="India agricultural intelligence map">
      {!markets.length && <div className="map-loading">Loading markets…</div>}
    </div>
  )
}

function diffColor(a: number, b: number): [number, number, number, number] {
  const r = Math.max(-0.6, Math.min(0.6, Math.log(a / b)))
  if (r > 0) return [248, Math.round(113 + (1 - r / 0.6) * 100), 113, 220]
  return [Math.round(96 + (1 + r / 0.6) * 100), 165, 250, 220]
}
