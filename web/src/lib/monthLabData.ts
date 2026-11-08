import { analyzeMonth, type Opportunity } from './monthLab'
import { loadMonthStories, type Catalog } from './stories'

export interface LabFinding {
  key: string; corridorKey: string; day: string; sellDay: string
  source: { name: string; state: string }; destination: { name: string; state: string }
  buy: number; sell: number; gross: number; costs: number; net: number; stress: number; surprise: number
  routeKm?: number; storyId?: string; observations: string; caveats: string[]
  assumptions: { item: string; value: string; source: string | null }[]
}
export interface LabChain { key: string; variety: string; grade: string; legs: LabFinding[]; modeledNet: number; selection: string }
export interface LabDataset {
  findings: LabFinding[]; chains: LabChain[]; corridors: number; covered: boolean
  source: 'screen' | 'retained' | 'none'; scope: string; status?: string
}
export interface MonthArchive {
  products: Record<string, { name: string; months: string[]; supported_product: boolean }>
  latest_observation?: string
}
const BASE = import.meta.env.BASE_URL
const slugPattern = /^[a-z0-9]+(?:_[a-z0-9]+)*$/
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/
const dayPattern = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/
const validDay = (value: unknown): value is string => typeof value === 'string' && dayPattern.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const market = (v: unknown): v is { name: string; state: string } => !!v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string' && typeof (v as { state?: unknown }).state === 'string'
const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); return s.length % 2 ? s[Math.floor(s.length / 2)] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 }

/** A missing static screen is normal until the backend export is copied into public/. */
async function staticJson(path: string): Promise<unknown | null> {
  const response = await fetch(`${BASE}${path}`)
  if (response.ok && response.headers.get('content-type')?.includes('application/json')) return response.json()
  if (response.status === 404 || response.ok) return null // SPA HTML fallback is not data.
  throw new Error(`Monthly archive ${response.status}`)
}
export async function loadMonthArchive(): Promise<MonthArchive | null> {
  const raw = await staticJson('month-api/catalog.json')
  if (raw === null) return null
  if (!raw || typeof raw !== 'object' || (raw as Record<string, unknown>).schema !== 'agrinet-month-1' || typeof (raw as Record<string, unknown>).products !== 'object') throw new Error('Invalid month archive catalog')
  return raw as MonthArchive
}

function parseScreen(raw: unknown, product: string, month: string): LabDataset {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid monthly screen')
  const data = raw as Record<string, unknown>
  const coverage = data.coverage as Record<string, unknown> | undefined
  if (data.schema !== 'agrinet-month-1' || data.product !== product || data.month !== month || !coverage || !number(coverage.routed_pairs_considered) || !Array.isArray(data.opportunities) || !Array.isArray(data.chains) || typeof data.status !== 'string') throw new Error('Invalid monthly screen metadata')
  const parseLeg = (item: unknown): LabFinding => {
    if (!item || typeof item !== 'object') throw new Error('Invalid monthly candidate')
    const o = item as Record<string, unknown>
    const route = o.route as Record<string, unknown> | undefined
    if (!validDay(o.buy) || !validDay(o.sell) || !validDay(o.known_destination_date) || !o.buy.startsWith(`${month}-`) || o.sell <= o.buy || o.known_destination_date >= o.buy || !market(o.origin_market) || !market(o.destination_market) || ![o.buy_price, o.sell_price, o.gross, o.net_baseline, o.net_adverse].every(number) || (o.buy_price as number) <= 0 || (o.sell_price as number) <= 0 || (o.net_baseline as number) <= 0 || (o.net_adverse as number) <= 0 || Math.abs((o.sell_price as number) - (o.buy_price as number) - (o.gross as number)) > .01 || (o.gross as number) < (o.net_baseline as number) || o.verdict !== 'positive_retrospective_modeled_surplus_not_verified_profit') throw new Error('Invalid monthly candidate values')
    return {
      key: `${o.origin}:${o.destination}:${o.buy}:${o.sell}`, corridorKey: `${o.origin}:${o.destination}:${o.variety}:${o.grade}`, day: o.buy as string, sellDay: o.sell as string,
      source: o.origin_market, destination: o.destination_market,
      buy: o.buy_price as number, sell: o.sell_price as number, gross: o.gross as number,
      costs: (o.gross as number) - (o.net_baseline as number), net: o.net_baseline as number,
      stress: o.net_adverse as number, surprise: 0, routeKm: number(route?.km) ? route.km : undefined,
      observations: `Same variety and grade: ${o.variety ?? 'unspecified'} / ${o.grade ?? 'unspecified'}. Previous destination quote dated ${o.known_destination_date ?? 'unknown'} informed the modeled buy-day decision; later sale was not known.`,
      caveats: Array.isArray(data.caveats) ? data.caveats.filter((v): v is string => typeof v === 'string') : ['No actual shipment, executable offer or realized profit verified.'],
      assumptions: Array.isArray(o.assumptions) ? o.assumptions.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && typeof (v as Record<string, unknown>).item === 'string').map((v) => ({ item: String(v.item), value: String(v.value ?? ''), source: typeof v.source === 'string' ? v.source : null })) : [],
    }
  }
  const findings = data.opportunities.map(parseLeg)
  const grouped = new Map<string, number[]>()
  for (const f of findings) grouped.set(f.corridorKey, [...(grouped.get(f.corridorKey) ?? []), f.net])
  // Candidate-only anomaly, not all buy-days. Do not describe this as market-wide or predictive.
  for (const f of findings) f.surprise = f.net - median(grouped.get(f.corridorKey)!)
  const chains = data.chains.map((item, index): LabChain => {
    if (!item || typeof item !== 'object') throw new Error('Invalid monthly chain')
    const c = item as Record<string, unknown>
    if (!Array.isArray(c.legs) || !c.legs.length || !number(c.modeled_net_per_initial_qtl)) throw new Error('Invalid monthly chain')
    const first = c.legs[0] as Record<string, unknown> | undefined
    let previous: Record<string, unknown> | undefined
    let total = 0
    for (const leg of c.legs) {
      const entry = leg as Record<string, unknown>
      parseLeg(leg)
      if (entry.variety !== c.variety || entry.grade !== c.grade || (previous && (entry.origin !== previous.destination || Date.parse(`${entry.buy}T00:00:00Z`) < Date.parse(`${previous.sell}T00:00:00Z`) + 7 * 86400_000))) throw new Error('Invalid monthly chain continuity')
      total += entry.net_baseline as number
      previous = entry
    }
    if (Math.abs(total - c.modeled_net_per_initial_qtl) > .01) throw new Error('Invalid monthly chain total')
    return { key: `${index}`, variety: String(c.variety ?? first?.variety ?? 'Unknown variety'), grade: String(c.grade ?? first?.grade ?? 'Unknown grade'), legs: c.legs.map(parseLeg), modeledNet: c.modeled_net_per_initial_qtl, selection: String(c.selection ?? '') }
  })
  return { findings, chains, corridors: coverage.routed_pairs_considered, covered: true, source: 'screen', scope: 'Only cached named-place road pairs screened; not all market pairs.', status: data.status }
}
function fromStory(o: Opportunity): LabFinding {
  return {
    key: o.key, corridorKey: o.story.id, day: o.day, sellDay: o.sellDay,
    source: o.story.markets[0], destination: o.story.markets[1],
    buy: o.buy, sell: o.sell, gross: o.gross, costs: o.costs, net: o.net, stress: o.stress,
    surprise: o.surprise, routeKm: o.story.routes[0]?.km, storyId: o.story.id,
    observations: o.story.evidence.observations, caveats: o.story.evidence.caveats,
    assumptions: o.story.assumptions,
  }
}
export async function loadLabDataset(catalog: Catalog, product: string, month: string, archive: MonthArchive | null = null): Promise<LabDataset> {
  const empty: LabDataset = { findings: [], chains: [], corridors: 0, covered: false, source: 'none', scope: '' }
  if (!slugPattern.test(product) || !monthPattern.test(month) || !archive?.products[product] && !catalog.products?.[product] && !catalog.commodities[product]) return empty
  if (archive?.products[product]?.months.includes(month)) {
    const raw = await staticJson(`month-api/${product}/${month}.json`)
    if (raw !== null) return parseScreen(raw, product, month)
  }
  if (!catalog.commodities[product]?.months[month]?.length) return empty
  const stories = await loadMonthStories(product, month)
  return {
    findings: analyzeMonth(stories, month).map(fromStory), chains: [],
    corridors: stories.filter((s) => s.kind === 'corridor').length,
    covered: true, source: 'retained', scope: 'Retained pre-screened story corridors only; not all historical market pairs.',
  }
}
export function sortFindings(items: LabFinding[], sort: 'surprise' | 'margin' | 'resilience'): LabFinding[] {
  const metric = (o: LabFinding) => sort === 'margin' ? o.net : sort === 'resilience' ? o.stress : o.surprise
  return [...items].sort((a, b) => metric(b) - metric(a) || b.net - a.net || a.day.localeCompare(b.day) || a.key.localeCompare(b.key))
}
export function archiveMonths(catalog: Catalog, archive: MonthArchive | null = null, product = ''): string[] {
  const observed = archive?.products[product]?.months ?? []
  const retained = Object.keys(catalog.commodities[product]?.months ?? {})
  const all = observed.length || retained.length ? [...observed, ...retained] : Object.values(catalog.commodities).flatMap((v) => Object.keys(v.months))
  return [...new Set(all)].filter((m) => monthPattern.test(m)).sort().reverse()
}
