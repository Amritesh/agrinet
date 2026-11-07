import type { Market } from './data'
import type { RoutePoint } from './routing'

export type PrecisionLevel = 'representative' | 'district' | 'state' | 'unknown'

export interface MarketPrecision {
  level: PrecisionLevel
  routable: boolean
  label: string
  detail: string
}

/** Describes how a market location was geocoded. Centroids are never routable. */
export function marketPrecision(m: Market): MarketPrecision {
  if (m.lat == null || m.lon == null) return { level: 'unknown', routable: false, label: 'No coordinates', detail: 'This market has no geolocation in the dataset.' }
  switch (m.src) {
    case 'district_centroid':
      return { level: 'district', routable: false, label: 'District centroid', detail: `Placed at the ${m.d} district centroid (confidence ${m.c}). This is not the market's location.` }
    case 'state_centroid':
      return { level: 'state', routable: false, label: 'State centroid', detail: `Placed at the ${m.s} state centroid (confidence ${m.c}). This is not the market's location.` }
    case 'nominatim_state':
      return { level: 'state', routable: false, label: 'State-level geocode', detail: `Geocoder only matched at state level (confidence ${m.c}).` }
    case 'nominatim_near':
      return { level: 'district', routable: false, label: 'Nearby-place geocode', detail: `Geocoded to a nearby place, not the market itself (confidence ${m.c}).` }
    case 'nominatim':
      return { level: 'representative', routable: true, label: 'Name geocode (representative)', detail: `OpenStreetMap Nominatim match on the market name (confidence ${m.c}). Not a verified loading address.` }
    default:
      return { level: 'unknown', routable: false, label: 'Unknown source', detail: `Unrecognised geocode source "${m.src}".` }
  }
}

/** Route point for a market only when its own geocode is representative. Returns null for centroids. */
export function routePointFor(m: Market): RoutePoint | null {
  const p = marketPrecision(m)
  if (!p.routable || m.lat == null || m.lon == null) return null
  return { lat: m.lat, lon: m.lon, label: m.n, precision: 'representative', evidence: `OpenStreetMap Nominatim geocode of market name "${m.n}" (dataset confidence ${m.c})` }
}

export type ManualPointResult = { ok: true; point: RoutePoint } | { ok: false; error: string }

/** Parses a point the user entered and confirmed. It is labelled representative and needs evidence text. */
export function parseManualPoint(label: string, latText: string, lonText: string, evidence: string): ManualPointResult {
  if (!latText.trim() || !lonText.trim()) return { ok: false, error: 'Enter both latitude and longitude.' }
  const lat = Number(latText), lon = Number(lonText)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { ok: false, error: 'Latitude and longitude must be numbers.' }
  if (lat < 6 || lat > 38 || lon < 68 || lon > 98) return { ok: false, error: 'Coordinates must be inside India (lat 6–38, lon 68–98).' }
  if (!evidence.trim()) return { ok: false, error: 'Describe the evidence for this point (e.g. APMC yard gate located on OpenStreetMap).' }
  return { ok: true, point: { lat, lon, label, precision: 'representative', evidence: evidence.trim() } }
}
