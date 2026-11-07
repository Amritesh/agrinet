/** AGRINET 4.0 stories: data contracts, URL routing and story selection. Pure functions, unit-tested. */

export type Mode = 'stories' | 'explore' | 'research'

export interface CatalogEntry { id: string; kind: string; title: string; score: number }
export interface Featured { id: string; title: string; commodity: string; period: string; kind: string; teaser: string }
export interface Catalog {
  engine: string
  data_snapshot: string
  latest_observation: string
  story_count: number
  featured: Featured[]
  commodities: Record<string, { months: Record<string, CatalogEntry[]> }>
}

export interface StoryMarket { id: number; name: string; state: string; lat: number; lon: number; precision: string; pct?: number; price?: number; prev?: number }
export interface StoryRoute { slug: string; path: [number, number][]; km: number; hours: number; provider: string; profile: string; truck_suitable: boolean; requested: string }
export interface Scene {
  kind: string
  headline: string
  caption: string
  camera: 'india' | 'corridor' | 'state' | 'focus'
  focus: number[]
  cards?: number[]
  route?: string
  truck?: boolean
  chart?: 'gap' | 'waterfall' | 'strategy' | 'storage'
  colorBy?: 'pct'
  state?: string
}
export interface Waterfall { buy: number; freight: number; fees: number; loading: number; loss: number; interest: number; sell: number; net: number; buy_date: string; sell_date: string }
export interface Trade { buy: string; sell: string; buy_price: number; sell_price: number; gross: number; net_baseline?: number; net_adverse?: number; informed_ship?: boolean }
export interface Story {
  id: string
  kind: 'shock' | 'corridor' | 'storage'
  verdict?: string
  commodity: string
  period: string
  engine: string
  title: string
  summary: string
  why_selected: string
  evidence: { level: string; observations: string; caveats: string[] }
  facts: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  markets: StoryMarket[]
  routes: StoryRoute[]
  scenes: Scene[]
  assumptions: { kind: string; item: string; value: string; source: string | null }[]
  trades?: Trade[]
  conclusion: string
  sources: { id: string; title?: string; url?: string; reference_period?: string }[]
  score: number
}

const RESEARCH_VIEWS = new Set(['shocks', 'news', 'analytics'])

export function resolveMode(search: string, hash: string): Mode {
  const p = new URLSearchParams(search)
  if (p.get('story')) return 'stories'
  const mode = p.get('mode')
  if (mode === 'research' || mode === 'explore' || mode === 'stories') return mode
  if (hash === '#collaborate' || p.has('s')) return 'research'
  if (RESEARCH_VIEWS.has(p.get('v') ?? '')) return 'research'
  if (p.has('c') || p.has('d') || p.has('m') || p.has('v')) return 'explore'
  return 'stories'
}

const ID_RE = /^(onion|potato|tomato)-(\d{4})-(\d{2})(-[a-z0-9-]+)?$/

export function storyFile(id: string): string | null {
  const m = ID_RE.exec(id)
  return m ? `stories/${m[1]}/${m[2]}.json` : null
}

export function storyUrl(base: string, id: string): string {
  return `${base.replace(/\/?$/, '/')}?story=${encodeURIComponent(id)}`
}

/** Featured stories get a static page with Open Graph tags; others fall back to the in-app link. */
export function sharePageUrl(origin: string, base: string, id: string, hasStaticPage: boolean): string {
  const b = base.replace(/\/?$/, '/')
  return hasStaticPage ? `${origin}${b}s/${id}/` : `${origin}${storyUrl(b, id)}`
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export function monthLabel(ym: string): string {
  return `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`
}

const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1

/** Best story for a commodity-month; if the month has none, the nearest month that does, flagged. */
export function pickForMonth(cat: Catalog, commodity: string, month: string): { id: string; month: string; substituted: boolean } | null {
  const months = cat.commodities[commodity]?.months
  if (!months) return null
  const best = (m: string) => [...months[m]].sort((a, b) => b.score - a.score)[0]
  if (months[month]?.length) return { id: best(month).id, month, substituted: false }
  const keys = Object.keys(months).filter((k) => months[k].length)
  if (!keys.length) return null
  const t = monthIndex(month)
  keys.sort((a, b) => Math.abs(monthIndex(a) - t) - Math.abs(monthIndex(b) - t) || monthIndex(b) - monthIndex(a))
  return { id: best(keys[0]).id, month: keys[0], substituted: true }
}

const BASE = import.meta.env?.BASE_URL ?? '/'
const cache = new Map<string, Promise<Story[]>>()

export async function loadCatalog(): Promise<Catalog> {
  const r = await fetch(`${BASE}stories/catalog.json`)
  if (!r.ok) throw new Error(`catalog ${r.status}`)
  return r.json()
}

export async function loadStory(id: string): Promise<Story | null> {
  const f = storyFile(id)
  if (!f) return null
  // Missing years may come back as 404 or as an HTML fallback page; both mean "no such story".
  if (!cache.has(f)) cache.set(f, fetch(`${BASE}${f}`).then((r) => (r.ok ? r.json() : [])).then((x) => (Array.isArray(x) ? x : [])).catch(() => []))
  const all = await cache.get(f)!
  return all.find((s) => s.id === id) ?? null
}

export const inr = (v: number) => (v < 0 ? `−₹${Math.abs(Math.round(v)).toLocaleString('en-IN')}` : `₹${Math.round(v).toLocaleString('en-IN')}`)
