// Data access: static CDN tiles (markets, snapshots, series) + Supabase (shocks, news, stats).
import { createClient } from '@supabase/supabase-js'

export const COMMODITIES = [
  { id: 23, slug: 'onion', name: 'Onion', color: '#c084fc' },
  { id: 24, slug: 'potato', name: 'Potato', color: '#fbbf24' },
  { id: 78, slug: 'tomato', name: 'Tomato', color: '#f87171' },
] as const
export type CommodityId = (typeof COMMODITIES)[number]['id']
export const bySlug = (slug: string) => COMMODITIES.find((c) => c.slug === slug) ?? COMMODITIES[0]
export const byId = (id: number) => COMMODITIES.find((c) => c.id === id) ?? COMMODITIES[0]

export const EPOCH = Date.UTC(2001, 0, 1)
export const DAY_MS = 86400000
export const ordToDate = (d: number) => new Date(EPOCH + d * DAY_MS)
export const dateToOrd = (dt: Date) => Math.round((Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()) - EPOCH) / DAY_MS)
export const isoToOrd = (iso: string) => dateToOrd(new Date(iso + 'T00:00:00Z'))
export const ordToIso = (d: number) => ordToDate(d).toISOString().slice(0, 10)
export const ordYear = (d: number) => ordToDate(d).getUTCFullYear()

export interface Market {
  id: number
  n: string
  d: string
  s: string
  lat: number | null
  lon: number | null
  c: number
  src: string
}

export interface DaySnapshot {
  ids: Uint16Array
  modal: Uint16Array
}
export interface YearSnapshot {
  days: Map<number, DaySnapshot>
  ordinals: number[] // sorted
  p5: number
  p50: number
  p95: number
}

export interface SeriesPoint {
  d: number
  mn: number
  mx: number
  md: number
  nv: number
}
export type MarketSeries = Map<number, SeriesPoint[]> // commodity_id -> points

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '') + '/data'

let marketsPromise: Promise<Market[]> | null = null
export function loadMarkets(): Promise<Market[]> {
  if (!marketsPromise) marketsPromise = fetch(`${BASE}/markets.json`).then((r) => r.json())
  return marketsPromise
}

export interface CoverageRow {
  commodity_id: number
  year: number
  n_rows: number
  n_markets: number
  n_days: number
  n_states: number
}
export const loadCoverage = (): Promise<CoverageRow[]> => fetch(`${BASE}/coverage.json`).then((r) => r.json())

export function decodeSnapshot(buf: ArrayBuffer): YearSnapshot {
  const dv = new DataView(buf)
  if (dv.getUint32(0, true) !== 0x41475231) throw new Error('bad snapshot magic')
  const nDays = dv.getUint32(4, true)
  let off = 8
  const days = new Map<number, DaySnapshot>()
  const ordinals: number[] = []
  const all: number[] = []
  for (let i = 0; i < nDays; i++) {
    const d = dv.getUint32(off, true)
    const n = dv.getUint32(off + 4, true)
    off += 8
    const arr = new Uint16Array(buf.slice(off, off + n * 4))
    off += n * 4
    const ids = new Uint16Array(n)
    const modal = new Uint16Array(n)
    for (let k = 0; k < n; k++) {
      ids[k] = arr[k * 2]
      modal[k] = arr[k * 2 + 1]
      all.push(modal[k])
    }
    days.set(d, { ids, modal })
    ordinals.push(d)
  }
  all.sort((a, b) => a - b)
  const q = (p: number) => all[Math.min(all.length - 1, Math.floor(p * all.length))] ?? 0
  return { days, ordinals, p5: q(0.05), p50: q(0.5), p95: q(0.95) }
}

const snapCache = new Map<string, Promise<YearSnapshot | null>>()
export function loadSnapshot(slug: string, year: number): Promise<YearSnapshot | null> {
  const key = `${slug}/${year}`
  if (!snapCache.has(key)) {
    snapCache.set(
      key,
      fetch(`${BASE}/snap/${slug}/${year}.bin`)
        .then(async (r) => {
          if (!r.ok || !(r.headers.get('content-type') ?? '').includes('octet-stream')) return null
          return decodeSnapshot(await r.arrayBuffer())
        })
        .catch(() => null),
    )
  }
  return snapCache.get(key)!
}

export function decodeSeries(buf: ArrayBuffer): MarketSeries {
  const dv = new DataView(buf)
  if (dv.getUint32(0, true) !== 0x41475332) throw new Error('bad series magic')
  const nComm = dv.getUint8(4)
  let off = 5
  const out: MarketSeries = new Map()
  for (let c = 0; c < nComm; c++) {
    const cid = dv.getUint8(off)
    const n = dv.getUint32(off + 1, true)
    off += 5
    const pts: SeriesPoint[] = new Array(n)
    for (let k = 0; k < n; k++) {
      pts[k] = {
        d: dv.getUint16(off, true),
        mn: dv.getUint16(off + 2, true),
        mx: dv.getUint16(off + 4, true),
        md: dv.getUint16(off + 6, true),
        nv: dv.getUint8(off + 8),
      }
      off += 9
    }
    out.set(cid, pts)
  }
  return out
}

const seriesCache = new Map<number, Promise<MarketSeries | null>>()
export function loadSeries(marketId: number): Promise<MarketSeries | null> {
  if (!seriesCache.has(marketId)) {
    seriesCache.set(
      marketId,
      fetch(`${BASE}/series/${marketId}.bin`)
        .then(async (r) => (r.ok && (r.headers.get('content-type') ?? '').includes('octet-stream') ? decodeSeries(await r.arrayBuffer()) : null))
        .catch(() => null),
    )
  }
  return seriesCache.get(marketId)!
}

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY, {
  auth: { persistSession: false },
})

export interface Shock {
  id: number
  market_id: number
  commodity_id: number
  obs_date: string
  method: string
  direction: 'up' | 'down'
  score: number
  pct_change: number | null
  baseline: number | null
  observed: number
  severity: number
  window_start: string | null
  window_end: string | null
  market_name: string
  district: string
  state: string
  lat: number | null
  lon: number | null
}

export async function fetchShocks(commodityId: number, fromIso: string, toIso: string, minSeverity = 1, limit = 2000): Promise<Shock[]> {
  const { data, error } = await supabase
    .from('shocks')
    .select('*')
    .eq('commodity_id', commodityId)
    .gte('obs_date', fromIso)
    .lte('obs_date', toIso)
    .gte('severity', minSeverity)
    .order('severity', { ascending: false })
    .order('obs_date', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as Shock[]
}

export async function fetchMarketShocks(marketId: number, commodityId: number): Promise<Shock[]> {
  const { data, error } = await supabase
    .from('shocks')
    .select('*')
    .eq('market_id', marketId)
    .eq('commodity_id', commodityId)
    .order('obs_date', { ascending: false })
    .limit(200)
  if (error) throw error
  return data as Shock[]
}

export interface NearbyMarket {
  id: number
  name: string
  district: string
  state: string
  lat: number
  lon: number
  distance_km: number
  latest_modal: number | null
  latest_date: string | null
  volatility_90d: number | null
}
export async function fetchNearby(marketId: number, commodityId: number): Promise<NearbyMarket[]> {
  const { data, error } = await supabase.rpc('nearby_markets', { p_market_id: marketId, p_commodity_id: commodityId })
  if (error) throw error
  return data as NearbyMarket[]
}

export interface NewsEvent {
  id: number
  title: string
  url: string
  source: string
  published_at: string
  event_date: string | null
  event_type: string
  commodity_ids: number[]
  state: string | null
  district: string | null
  lat: number | null
  lon: number | null
  summary: string | null
  evidence: string | null
  impact_hint: string | null
}
export async function fetchNews(commodityId: number | null, fromIso: string, toIso: string, limit = 300): Promise<NewsEvent[]> {
  let q = supabase.from('news_events').select('*').gte('published_at', fromIso).lte('published_at', toIso + 'T23:59:59Z').order('published_at', { ascending: false }).limit(limit)
  if (commodityId) q = q.contains('commodity_ids', [commodityId])
  const { data, error } = await q
  if (error) throw error
  return data as NewsEvent[]
}

export interface NewsLink {
  news_id: number
  market_id: number
  commodity_id: number
  distance_km: number | null
  association: 'verified_event' | 'statistical' | 'speculative'
  shock_id: number | null
}
export async function fetchMarketNews(marketId: number, commodityId: number): Promise<(NewsLink & { news: NewsEvent })[]> {
  const { data, error } = await supabase.from('news_market_links').select('*').eq('market_id', marketId).eq('commodity_id', commodityId).limit(50)
  if (error) throw error
  const links = data as NewsLink[]
  if (!links.length) return []
  const { data: news, error: e2 } = await supabase.from('news_events').select('*').in('id', links.map((l) => l.news_id))
  if (e2) throw e2
  const m = new Map((news as NewsEvent[]).map((n) => [n.id, n]))
  return links.filter((l) => m.has(l.news_id)).map((l) => ({ ...l, news: m.get(l.news_id)! })).sort((a, b) => (a.news.published_at < b.news.published_at ? 1 : -1))
}

export interface Stats {
  market_id: number
  commodity_id: number
  first_date: string
  last_date: string
  n_obs: number
  latest_modal: number | null
  latest_date: string | null
  volatility_90d: number | null
}
export async function fetchStats(marketId: number): Promise<Stats[]> {
  const { data, error } = await supabase.from('market_commodity_stats').select('*').eq('market_id', marketId)
  if (error) throw error
  return data as Stats[]
}

export async function fetchHealth(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('health')
  if (error) throw error
  return data as Record<string, unknown>
}
