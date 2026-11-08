/** AGRINET 4.0 stories: data contracts, URL routing and story selection. Pure functions, unit-tested. */

export type Mode = 'stories' | 'explore' | 'research' | 'lab'

export interface CatalogEntry { id: string; kind: string; title: string; score: number }
export interface Featured { id: string; title: string; commodity: string; period: string; kind: string; teaser: string }
export interface Catalog {
  engine: string
  data_snapshot: string
  latest_observation: string
  story_count: number
  featured: Featured[]
  commodities: Record<string, { months: Record<string, CatalogEntry[]> }>
  /** Display name and story count per product slug (engine 2+). */
  products?: Record<string, { name: string; stories: number; best: number }>
  coverage?: { source_products?: number; eligible_products?: number; screened_pairs?: number; evaluated_pairs?: number; tested_pairs?: number; routed_pairs?: number; route_budget_hit?: boolean }
  pages?: string[]
}

export interface StoryMarket { id: number; name: string; state: string; district?: string; lat: number; lon: number; precision: string; pct?: number; price?: number; prev?: number }
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
  commodity_name?: string
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
  if (p.get('mode') === 'lab') return 'lab'
  if (p.get('story')) return 'stories'
  const mode = p.get('mode')
  if (mode === 'research' || mode === 'explore' || mode === 'stories') return mode
  if (hash === '#collaborate' || p.has('s')) return 'research'
  if (RESEARCH_VIEWS.has(p.get('v') ?? '')) return 'research'
  if (p.has('c') || p.has('d') || p.has('m') || p.has('v')) return 'explore'
  return 'stories'
}

// <product slug>-<YYYY>-<MM>[-<kind and route>]; product slugs use underscores, never hyphens.
const ID_RE = /^([a-z0-9]+(?:_[a-z0-9]+)*)-(\d{4})-(\d{2})(-[a-z0-9-]+)?$/

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

/** Load one product-year from the retained snapshot; never substitute a nearby month. */
export async function loadMonthStories(product: string, month: string): Promise<Story[]> {
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(product) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return []
  const f = `stories/${product}/${month.slice(0, 4)}.json`
  if (!cache.has(f)) cache.set(f, fetch(`${BASE}${f}`).then((r) => {
    if (!r.ok) throw new Error(`Historical data ${r.status}`)
    return r.json()
  }).then((x) => { if (!Array.isArray(x)) throw new Error('Historical data was not a story list'); return x as Story[] }).catch((error) => { cache.delete(f); throw error }))
  return (await cache.get(f)!).filter((s) => s.period === month)
}

export const inr = (v: number) => (v < 0 ? `−₹${Math.abs(Math.round(v)).toLocaleString('en-IN')}` : `₹${Math.round(v).toLocaleString('en-IN')}`)

/** Products for the picker: most stories first, then name. */
export function productList(cat: Catalog): { slug: string; name: string; stories: number }[] {
  const p = cat.products ?? Object.fromEntries(Object.keys(cat.commodities).map((k) => [k, { name: k[0].toUpperCase() + k.slice(1).replace(/_/g, ' '), stories: Object.values(cat.commodities[k].months).flat().length, best: 0 }]))
  return Object.entries(p).map(([slug, v]) => ({ slug, name: v.name, stories: v.stories })).sort((a, b) => b.stories - a.stories || a.name.localeCompare(b.name))
}

/** Months with a real story, not gaps in the calendar. */
export function availableMonths(cat: Catalog, product: string): string[] {
  return Object.entries(cat.commodities[product]?.months ?? {}).filter(([, entries]) => entries.length > 0).map(([month]) => month).sort()
}

export function defaultStoryId(cat: Catalog): string | null {
  if (cat.featured[0]) return cat.featured[0].id
  const entries = Object.values(cat.commodities).flatMap((c) => Object.values(c.months).flat())
  return entries.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))[0]?.id ?? null
}

/** Snapshot of the modeled, historical trade evidence; never an actual profit claim. */
export function tradeEvidence(story: Story) {
  if (story.verdict !== 'positive_modeled_surplus' && story.verdict !== 'profitable') return null
  const f = story.facts
  const keys = ['n', 'n_checked', 'net_baseline', 'net_adverse', 'inf_mean', 'paying_pct', 'inf_shipped']
  if (!keys.every((key) => typeof f[key] === 'number' && Number.isFinite(f[key]))) return null
  return {
    matchedDays: f.n as number, checkedPairs: f.n_checked as number,
    typicalMargin: f.net_baseline as number, stressMargin: f.net_adverse as number,
    informedMargin: f.inf_mean as number, payingPct: f.paying_pct as number,
    informedShipDays: f.inf_shipped as number,
  }
}
