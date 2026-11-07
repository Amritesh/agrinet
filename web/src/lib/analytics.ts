// Pure analytics helpers shared by panels and tests (mirror of pipeline/shocks.py semantics).
import type { SeriesPoint } from './data'

export function logReturns(pts: SeriesPoint[], maxGapDays = 7): number[] {
  const out: number[] = []
  for (let i = 1; i < pts.length; i++) {
    const gap = pts[i].d - pts[i - 1].d
    if (gap > 0 && gap <= maxGapDays) out.push(Math.log(pts[i].md / pts[i - 1].md))
  }
  return out
}

export function stdev(xs: number[]): number | null {
  if (xs.length < 2) return null
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const h = s.length >> 1
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
}

/** Volatility (stdev of daily log returns) over the last n observations, as a percent. */
export function volatility(pts: SeriesPoint[], n = 90): number | null {
  const r = logReturns(pts.slice(-n))
  const s = stdev(r)
  return s == null ? null : s * 100
}

/** Seasonal profile: median modal price by month across all years, plus year counts. */
export function seasonalProfile(pts: SeriesPoint[], epochMs = Date.UTC(2001, 0, 1)) {
  const buckets: number[][] = Array.from({ length: 12 }, () => [])
  const years: Set<number>[] = Array.from({ length: 12 }, () => new Set())
  for (const p of pts) {
    const dt = new Date(epochMs + p.d * 86400000)
    buckets[dt.getUTCMonth()].push(p.md)
    years[dt.getUTCMonth()].add(dt.getUTCFullYear())
  }
  return buckets.map((b, i) => ({ month: i, median: median(b), n: b.length, years: years[i].size, p25: quantile(b, 0.25), p75: quantile(b, 0.75) }))
}

export function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

/** Same-ISO-week-of-year baseline from prior years (median), used to explain seasonal_dev shocks. */
export function seasonalBaseline(pts: SeriesPoint[], atOrd: number, epochMs = Date.UTC(2001, 0, 1)): { baseline: number | null; years: number } {
  const week = (d: number) => Math.floor(((d + 0) % 365.25) / 7)
  const yearOf = (d: number) => new Date(epochMs + d * 86400000).getUTCFullYear()
  const wk = week(atOrd)
  const y = yearOf(atOrd)
  const vals: number[] = []
  const ys = new Set<number>()
  for (const p of pts) {
    if (yearOf(p.d) < y && week(p.d) === wk) {
      vals.push(Math.log(p.md))
      ys.add(yearOf(p.d))
    }
  }
  const m = median(vals)
  return { baseline: m == null ? null : Math.exp(m), years: ys.size }
}

/** Historical percentile of a price within the series (0-100). */
export function percentileRank(pts: SeriesPoint[], price: number): number | null {
  if (!pts.length) return null
  let below = 0
  for (const p of pts) if (p.md < price) below++
  return (100 * below) / pts.length
}

/** Rolling 60-obs median & MAD immediately before index i (excluding i). */
export function robustZ(pts: SeriesPoint[], i: number, win = 60): { z: number | null; median: number | null; mad: number | null } {
  const lo = Math.max(0, i - win)
  if (i - lo < 30) return { z: null, median: null, mad: null }
  const w = pts.slice(lo, i).map((p) => Math.log(p.md))
  const m = median(w)!
  const mad = median(w.map((x) => Math.abs(x - m)))!
  if (mad <= 0.01) return { z: null, median: Math.exp(m), mad }
  return { z: (Math.log(pts[i].md) - m) / (1.4826 * mad), median: Math.exp(m), mad }
}
