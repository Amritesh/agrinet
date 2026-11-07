import { describe, expect, it } from 'vitest'
import { calculateEconomics } from '../src/lib/economics'

export const fixture = { purchasePrice: 18, salePrice: 26, quantityKg: 10000, lossPercent: 5, freight: 18000, handling: 8000, storage: 0, fees: 0, annualInterestPercent: 0, financingDays: 0, capacityKg: 10000 }

describe('scenario economics', () => {
  it.each([
    ['freight', undefined], ['freight', NaN], ['purchasePrice', Infinity], ['salePrice', -1],
    ['quantityKg', 0], ['lossPercent', 100], ['lossPercent', -1], ['capacityKg', 9999],
    ['handling', -1], ['annualInterestPercent', -1], ['financingDays', -1],
  ])('rejects invalid %s = %s', (field, value) => {
    expect(() => calculateEconomics({ ...fixture, [field]: value })).toThrow()
  })
  it('itemizes simple financing on purchase and operating costs ACT/365', () => {
    const result = calculateEconomics({ ...fixture, annualInterestPercent: 12, financingDays: 30 })
    expect(result.financingCost).toBeCloseTo(206000 * 0.12 * 30 / 365)
    expect(result.totalCost).toBeCloseTo(206000 + result.financingCost)
  })
  it('calculates the reproducible INR/kg fixture without rounding intermediate values', () => {
    const result = calculateEconomics(fixture)
    expect(result.margin).toBe(41000)
    expect(result.totalCost).toBe(206000)
    expect(result.saleableKg).toBe(9500)
    expect(result.breakEvenPrice).toBeCloseTo(21.6842, 4)
  })
})

describe('break-even and return metrics', () => {
  it('reproduces fixture break-even freight, loss and ROI', () => {
    const r = calculateEconomics(fixture)
    // revenue 247,000 − purchase 180,000 − other 8,000 = freight that zeroes margin
    expect(r.breakEvenFreight).toBeCloseTo(59000, 6)
    expect(r.breakEvenLossPercent).toBeCloseTo((1 - 206000 / 260000) * 100, 6)
    expect(r.roiPercent).toBeCloseTo(41000 / 206000 * 100, 6)
    expect(r.marginPerKg).toBeCloseTo(4.1, 6)
    expect(r.marginPerTonne).toBeCloseTo(4100, 6)
    expect(r.breakEvenPricePerQuintal).toBeCloseTo(2168.42, 2)
  })
  it('break-even freight accounts for financing and yields zero margin when applied', () => {
    const base = { ...fixture, annualInterestPercent: 12, financingDays: 30 }
    const r = calculateEconomics(base)
    const atBreakEven = calculateEconomics({ ...base, freight: r.breakEvenFreight })
    expect(atBreakEven.margin).toBeCloseTo(0, 6)
  })
  it('break-even loss zeroes margin when applied', () => {
    const r = calculateEconomics(fixture)
    expect(calculateEconomics({ ...fixture, lossPercent: r.breakEvenLossPercent }).margin).toBeCloseTo(0, 6)
  })
  it('reports negative break-even freight instead of hiding a loss-making scenario', () => {
    const r = calculateEconomics({ ...fixture, salePrice: 18 })
    expect(r.breakEvenFreight).toBeLessThan(0)
    expect(r.breakEvenLossPercent).toBeLessThan(0)
  })
  it('returns null break-even loss when sale price is zero', () => {
    expect(calculateEconomics({ ...fixture, salePrice: 0 }).breakEvenLossPercent).toBeNull()
  })
})
