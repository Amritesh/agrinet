import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCENARIO, SCHEMA_VERSION, DATA_CUTOFF, VEHICLE_PRESETS,
  toEconomicsInputs, runScenario, sensitivityCases, buildExport, encodeShare, decodeShare,
  freightEstimate, type ScenarioState, type ScenarioRoute,
} from '../src/lib/scenario'

const fixture: ScenarioState = {
  ...DEFAULT_SCENARIO,
  priceUnit: 'kg', purchasePrice: 18, salePrice: 26,
  quantity: 10, quantityUnit: 't', vehicle: 'custom', customCapacityKg: 10000,
  lossPercent: 5, freight: 18000, handling: 8000, storage: 0, fees: 0,
  annualInterestPercent: 0, financingDays: 0,
}

const route: ScenarioRoute = {
  origin: { marketId: 1512, label: 'Lasalgaon', lat: 20.15, lon: 74.23, precision: 'representative', evidence: 'User-confirmed yard gate' },
  destination: { marketId: 1485, label: 'Vashi New Mumbai', lat: 19.07, lon: 73.0, precision: 'representative', evidence: 'User-confirmed APMC gate' },
  distanceKm: 212.4, durationHours: 4.6, provider: 'OSRM public demo', profile: 'driving',
  requestedAt: '2026-11-07T10:00:00.000Z', warnings: ['Driving profile, not truck-certified'],
}

describe('scenario inputs', () => {
  it('converts tonnes and INR/quintal explicitly to kg and INR/kg', () => {
    const e = toEconomicsInputs({ ...fixture, priceUnit: 'quintal', purchasePrice: 1800, salePrice: 2600 })
    expect(e.purchasePrice).toBe(18)
    expect(e.salePrice).toBe(26)
    expect(e.quantityKg).toBe(10000)
  })
  it('uses vehicle presets as nominal capacity', () => {
    expect(VEHICLE_PRESETS.map(v => v.capacityKg)).toEqual([9000, 16000, 25000])
    expect(toEconomicsInputs({ ...fixture, vehicle: '16t' }).capacityKg).toBe(16000)
  })
  it('reproduces the fixture end-to-end', () => {
    const r = runScenario(fixture)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.result.margin).toBe(41000)
    expect(r.result.totalCost).toBe(206000)
    expect(r.result.breakEvenPrice).toBeCloseTo(21.6842, 4)
    expect(r.result.breakEvenPricePerQuintal).toBeCloseTo(2168.42, 2)
  })
  it('returns field errors instead of throwing', () => {
    const r = runScenario({ ...fixture, freight: null, lossPercent: 120, quantity: 30 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.freight).toMatch(/manual assumption/i)
    expect(r.errors.lossPercent).toMatch(/100/)
    expect(r.errors.quantity).toMatch(/capacity/i)
  })
  it('estimates freight from a user rate × routed distance only when both exist', () => {
    expect(freightEstimate(85, 212.4)).toBeCloseTo(18054)
    expect(freightEstimate(null, 212.4)).toBeNull()
    expect(freightEstimate(85, null)).toBeNull()
  })
})

describe('sensitivity', () => {
  it('builds optimistic / baseline / adverse cases from user deltas', () => {
    const cases = sensitivityCases({ ...fixture, sensitivity: { salePricePercent: 10, lossPoints: 2, freightPercent: 20 } })
    expect(cases.map(c => c.id)).toEqual(['optimistic', 'baseline', 'adverse'])
    const [opt, base, adv] = cases
    expect(base.result?.margin).toBe(41000)
    // optimistic: sale +10% (28.6), loss 3%, freight 14,400
    expect(opt.result?.margin).toBeCloseTo(9700 * 28.6 - (180000 + 14400 + 8000), 6)
    // adverse: sale −10% (23.4), loss 7%, freight 21,600
    expect(adv.result?.margin).toBeCloseTo(9300 * 23.4 - (180000 + 21600 + 8000), 6)
  })
  it('clamps loss at zero and reports invalid cases without crashing', () => {
    const cases = sensitivityCases({ ...fixture, lossPercent: 1, sensitivity: { salePricePercent: 0, lossPoints: 5, freightPercent: 0 } })
    expect(cases[0].inputs.lossPercent).toBe(0)
    const bad = sensitivityCases({ ...fixture, freight: null })
    expect(bad.every(c => c.result === null)).toBe(true)
  })
})

describe('reproducible export and share', () => {
  it('builds a versioned export with route metadata, outputs and data cutoff', () => {
    const doc = buildExport(fixture, route, '2026-11-07T11:00:00.000Z')
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION)
    expect(doc.dataCutoff).toBe(DATA_CUTOFF)
    expect(DATA_CUTOFF).toBe('2026-04-20')
    expect(doc.disclaimer).toMatch(/not a verified trade/i)
    expect(doc.route?.requestedAt).toBe(route.requestedAt)
    expect(doc.route?.provider).toBe(route.provider)
    expect(doc.outputs?.margin).toBe(41000)
    expect(doc.inputs).toEqual(fixture)
  })
  it('round-trips through the share encoding, including non-ASCII evidence', () => {
    const r2 = { ...route, origin: { ...route.origin, evidence: 'Gate — लासलगाव APMC' } }
    const token = encodeShare(fixture, r2)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    const back = decodeShare(token)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.state).toEqual(fixture)
    expect(back.route).toEqual(r2)
  })
  it('rejects malformed, foreign-version or non-numeric payloads', () => {
    expect(decodeShare('!!!').ok).toBe(false)
    const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(decodeShare(enc({ schemaVersion: 'other/9', inputs: fixture })).ok).toBe(false)
    expect(decodeShare(enc({ schemaVersion: SCHEMA_VERSION, inputs: { ...fixture, salePrice: 'x' } })).ok).toBe(false)
  })
})
