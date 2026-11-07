import { describe, expect, it } from 'vitest'
import { marketPrecision, routePointFor, parseManualPoint } from '../src/lib/corridor'
import type { Market } from '../src/lib/data'

const m = (src: string, c: number, lat: number | null = 20.2, lon: number | null = 74.1): Market => ({ id: 1, n: 'Lasalgaon', d: 'Nashik', s: 'Maharashtra', lat, lon, c, src })

describe('market geolocation precision', () => {
  it('classifies centroids as non-routable', () => {
    expect(marketPrecision(m('district_centroid', 40))).toMatchObject({ level: 'district', routable: false })
    expect(marketPrecision(m('state_centroid', 20))).toMatchObject({ level: 'state', routable: false })
    expect(marketPrecision(m('nominatim_state', 50))).toMatchObject({ level: 'state', routable: false })
    expect(marketPrecision(m('nominatim_near', 70)).routable).toBe(false)
    expect(marketPrecision(m('nominatim', 90, null, null))).toMatchObject({ level: 'unknown', routable: false })
  })
  it('treats a name geocode as a representative point with evidence, never verified', () => {
    const p = marketPrecision(m('nominatim', 90))
    expect(p).toMatchObject({ level: 'representative', routable: true })
    const rp = routePointFor(m('nominatim', 90))
    expect(rp?.precision).toBe('representative')
    expect(rp?.evidence).toMatch(/nominatim/i)
  })
  it('never converts a centroid into a route point', () => {
    expect(routePointFor(m('district_centroid', 40))).toBeNull()
    expect(routePointFor(m('state_centroid', 20))).toBeNull()
  })
})

describe('manual representative point', () => {
  it('requires lat, lon in India and evidence text', () => {
    expect(parseManualPoint('Lasalgaon', '', '74.2', 'gate').ok).toBe(false)
    expect(parseManualPoint('Lasalgaon', '20.1', '74.2', '  ').ok).toBe(false)
    expect(parseManualPoint('Lasalgaon', '51.5', '-0.1', 'London').ok).toBe(false)
    const ok = parseManualPoint('Lasalgaon', '20.15', '74.23', 'APMC yard gate from OSM')
    expect(ok).toEqual({ ok: true, point: { lat: 20.15, lon: 74.23, label: 'Lasalgaon', precision: 'representative', evidence: 'APMC yard gate from OSM' } })
  })
})
