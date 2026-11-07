// Sequential price scale (blue → green → yellow → orange → red) anchored on year percentiles.
export interface Scale {
  lo: number
  mid: number
  hi: number
}
const STOPS: [number, number, number][] = [
  [37, 99, 235],
  [34, 197, 94],
  [250, 204, 21],
  [249, 115, 22],
  [220, 38, 38],
]
export function priceT(price: number, s: Scale): number {
  if (s.hi <= s.lo) return 0.5
  // piecewise: lo..mid → 0..0.5, mid..hi → 0.5..1 (log-ish robustness)
  if (price <= s.mid) return Math.max(0, 0.5 * ((price - s.lo) / Math.max(1, s.mid - s.lo)))
  return Math.min(1, 0.5 + 0.5 * ((price - s.mid) / Math.max(1, s.hi - s.mid)))
}
export function priceColor(price: number, s: Scale, alpha = 230): [number, number, number, number] {
  const t = priceT(price, s) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(t))
  const f = t - i
  const a = STOPS[i]
  const b = STOPS[i + 1]
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f), alpha]
}
export const cssColor = (c: [number, number, number, number]) => `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`
export const SEVERITY_COLORS = ['', '#facc15', '#fb923c', '#f87171', '#e11d48']
