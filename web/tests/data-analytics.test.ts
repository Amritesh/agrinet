import { describe, it, expect } from 'vitest'
import { decodeSnapshot, decodeSeries, isoToOrd, ordToIso } from '../src/lib/data'
import { median, quantile, logReturns, stdev, volatility } from '../src/lib/analytics'

describe('lossless binary prices', () => {
  it('decodes AGR2 uint32 prices above 65535 without truncation', () => {
    const b = new ArrayBuffer(28), v = new DataView(b)
    v.setUint32(0, 0x41475232, true); v.setUint32(4, 1, true)
    v.setUint32(8, 9240, true); v.setUint32(12, 2, true)
    v.setUint16(16, 123, true); v.setUint32(18, 82000, true)
    v.setUint16(22, 456, true); v.setUint32(24, 1000, true)
    const s = decodeSnapshot(b)
    expect(Array.from(s.days.get(9240)!.ids)).toEqual([123, 456])
    expect(Array.from(s.days.get(9240)!.modal)).toEqual([82000, 1000])
    expect(s.p95).toBe(82000)
  })
  it('decodes AGS3 uint32 minimum, maximum and modal prices', () => {
    const b = new ArrayBuffer(25), v = new DataView(b)
    v.setUint32(0, 0x41475333, true); v.setUint8(4, 1)
    v.setUint8(5, 23); v.setUint32(6, 1, true)
    v.setUint16(10, 9240, true); v.setUint32(12, 70000, true)
    v.setUint32(16, 90000, true); v.setUint32(20, 82000, true); v.setUint8(24, 3)
    expect(decodeSeries(b).get(23)).toEqual([{ d: 9240, mn: 70000, mx: 90000, md: 82000, nv: 3 }])
  })
  it('retains AGR1/AGS2 backwards compatibility', () => {
    const b = new ArrayBuffer(20), v = new DataView(b)
    v.setUint32(0, 0x41475231, true); v.setUint32(4, 1, true)
    v.setUint32(8, 1, true); v.setUint32(12, 1, true)
    v.setUint16(16, 3, true); v.setUint16(18, 500, true)
    expect(decodeSnapshot(b).days.get(1)!.modal[0]).toBe(500)
    const s = new ArrayBuffer(19), w = new DataView(s)
    w.setUint32(0, 0x41475332, true); w.setUint8(4, 1); w.setUint8(5, 23); w.setUint32(6, 1, true)
    w.setUint16(10, 1, true); w.setUint16(12, 400, true); w.setUint16(14, 600, true); w.setUint16(16, 500, true); w.setUint8(18, 1)
    expect(decodeSeries(s).get(23)![0].md).toBe(500)
  })
})

describe('critical analytics', () => {
  it('computes medians and interpolated quantiles without mutating observations', () => {
    const x = [4, 1, 3, 2]
    expect(median(x)).toBe(2.5)
    expect(quantile(x, 0.25)).toBe(1.75)
    expect(x).toEqual([4, 1, 3, 2])
    expect(median([])).toBeNull()
    expect(quantile([], 0.5)).toBeNull()
  })
  it('uses sample standard deviation and excludes long-gap returns', () => {
    const points = [100, 200, 400, 800].map((md, i) => ({ d: [0, 1, 9, 10][i], md, mn: md, mx: md, nv: 1 }))
    expect(logReturns(points)).toEqual([Math.log(2), Math.log(2)])
    expect(volatility(points)).toBe(0)
    expect(stdev([1, 2, 3])).toBe(1)
    expect(stdev([1])).toBeNull()
  })
  it('round-trips leap-day ordinals in UTC', () => {
    expect(ordToIso(isoToOrd('2024-02-29'))).toBe('2024-02-29')
    expect(isoToOrd('2024-03-01') - isoToOrd('2024-02-28')).toBe(2)
  })
})
