// Routing metrics are not freight offers or certified heavy-vehicle access.
export interface RoutePoint {
  lat: number
  lon: number
  label: string
  precision: 'verified' | 'representative' | 'district' | 'state' | 'unknown'
  evidence: string
}
export interface RoadRoute {
  distanceKm: number
  durationHours: number
  geometry: { type: 'LineString'; coordinates: number[][] }
  provider: string
  profile: string
  truckSuitable: false
  requestedAt: string
  warnings: string[]
}
const indiaCoordinate = (lon: number, lat: number) => Number.isFinite(lon) && Number.isFinite(lat) && lon >= 68 && lon <= 98 && lat >= 6 && lat <= 38
function validatePoint(p: RoutePoint) {
  if (!['verified', 'representative'].includes(p.precision)) throw new Error('Location precision is insufficient. Explicitly choose a representative point or supply a verified loading address.')
  if (!p.evidence.trim() || !p.label.trim()) throw new Error('Location evidence and label are required.')
  if (!indiaCoordinate(p.lon, p.lat)) throw new Error('Invalid India-range coordinates.')
}
export async function estimateRoute(origin: RoutePoint, destination: RoutePoint): Promise<RoadRoute> {
  validatePoint(origin); validatePoint(destination)
  if (origin.lat === destination.lat && origin.lon === destination.lon) throw new Error('Origin and destination must differ.')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  try {
    const coordinates = `${origin.lon},${origin.lat};${destination.lon},${destination.lat}`
    const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&alternatives=false&steps=false`, { signal: controller.signal })
    if (!response.ok) throw new Error(`Road routing unavailable (${response.status}).`)
    const body = await response.json()
    const route = body.routes?.[0]
    if (body.code !== 'Ok' || !route) throw new Error('No road route returned. No substitute distance has been generated.')
    if (!Number.isFinite(route.distance) || route.distance <= 0 || !Number.isFinite(route.duration) || route.duration <= 0) throw new Error('Provider returned invalid road metrics.')
    const geometry = route.geometry
    if (geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2 || !geometry.coordinates.every((p: number[]) => Array.isArray(p) && p.length >= 2 && indiaCoordinate(p[0], p[1]))) throw new Error('Provider returned invalid route geometry.')
    if (body.waypoints?.some((p: {distance: number}) => !Number.isFinite(p.distance) || p.distance > 1000)) throw new Error('Road snapping exceeds the 1 km endpoint tolerance. Select a road-accessible point.')
    return {
      distanceKm: route.distance / 1000,
      durationHours: route.duration / 3600,
      geometry,
      provider: 'OSRM public demonstration service · OpenStreetMap contributors',
      profile: 'driving', truckSuitable: false,
      requestedAt: new Date().toISOString(),
      warnings: [
        'Driving route only: truck restrictions, tolls and loading access are not verified.',
        'Distance and driving duration are not a freight quotation or delivery-time commitment.',
        'Public routing service has no availability guarantee. No automated bulk requests.',
        ...(origin.precision === 'representative' || destination.precision === 'representative' ? ['Explicit representative route points, not verified market loading addresses.'] : []),
      ],
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Road routing timed out. No substitute route generated.')
    throw error
  } finally { clearTimeout(timeout) }
}
