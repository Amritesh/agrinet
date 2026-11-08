import { describe, expect, it, vi } from 'vitest'
import { archiveMonths, loadLabDataset, loadMonthArchive, sortFindings } from '../src/lib/monthLabData'
import type { Catalog } from '../src/lib/stories'

const catalog = { products: { wheat: { name: 'Wheat', stories: 0, best: 0 }, tomato: { name: 'Tomato', stories: 1, best: 1 } }, commodities: { tomato: { months: { '2024-08': [{ id: 'x', kind: 'corridor', title: '', score: 1 }] } } } } as unknown as Catalog
const archive = { products: { wheat: { name: 'Wheat', months: ['2024-08', '2025-01'], supported_product: true } } }
const candidate = { origin: 'a', destination: 'b', buy: '2024-08-03', sell: '2024-08-04', known_destination_date: '2024-08-02', origin_market: { name: 'A', state: 'X' }, destination_market: { name: 'B', state: 'Y' }, buy_price: 100, sell_price: 150, gross: 50, net_baseline: 30, net_adverse: 5, variety: 'Local', grade: 'FAQ', route: { km: 40 }, verdict: 'positive_retrospective_modeled_surplus_not_verified_profit' }
const payload = (opportunities: unknown[]) => ({ schema: 'agrinet-month-1', product: 'wheat', month: '2024-08', status: 'modeled_scenarios_only', coverage: { routed_pairs_considered: 2 }, opportunities, chains: [{ variety: 'Local', grade: 'FAQ', legs: opportunities, modeled_net_per_initial_qtl: 30 }] })
const response = (body: unknown) => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body }) as Response

describe('Month Lab static screen contract', () => {
  it('offers product-specific observed months when month archive exists', () => {
    expect(archiveMonths(catalog, archive, 'wheat')).toEqual(['2025-01', '2024-08'])
  })
  it('loads exact-month screen and its backend-selected sequential chain', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(payload([candidate]))))
    const result = await loadLabDataset(catalog, 'wheat', '2024-08', archive)
    expect(result.source).toBe('screen')
    expect(result.findings[0]).toMatchObject({ source: { name: 'A' }, net: 30, stress: 5 })
    expect(result.chains[0].legs).toHaveLength(1)
    expect(sortFindings(result.findings, 'surprise')).toHaveLength(1)
    vi.unstubAllGlobals()
  })
  it('distinguishes missing screen from explicit zero-result screen', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    expect((await loadLabDataset(catalog, 'wheat', '2024-08', archive)).covered).toBe(false)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...payload([]), chains: [], status: 'no_supported_opportunity' })))
    expect(await loadLabDataset(catalog, 'wheat', '2024-08', archive)).toMatchObject({ covered: true, corridors: 2, findings: [] })
    vi.unstubAllGlobals()
  })
  it('validates economics and schema, not merely HTTP success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(payload([{ ...candidate, net_baseline: 300 }]))))
    await expect(loadLabDataset(catalog, 'wheat', '2024-08', archive)).rejects.toThrow('Invalid monthly candidate')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ schema: 'wrong', products: {} })))
    await expect(loadMonthArchive()).rejects.toThrow('Invalid month archive catalog')
    vi.unstubAllGlobals()
  })
  it('rejects an impossible or disconnected hindsight chain rather than displaying its claimed total', async () => {
    const later = { ...candidate, origin: 'b', destination: 'c', buy: '2024-08-15', sell: '2024-08-16', known_destination_date: '2024-08-14' }
    const twoLegs = { ...payload([candidate, later]), chains: [{ variety: 'Local', grade: 'FAQ', legs: [candidate, later], modeled_net_per_initial_qtl: 60 }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(twoLegs)))
    expect((await loadLabDataset(catalog, 'wheat', '2024-08', archive)).chains[0].legs).toHaveLength(2)
    for (const invalid of [
      { ...twoLegs, chains: [{ ...twoLegs.chains[0], modeled_net_per_initial_qtl: 100 }] },
      { ...twoLegs, chains: [{ ...twoLegs.chains[0], legs: [candidate, { ...later, origin: 'z' }] }] },
      { ...twoLegs, chains: [{ ...twoLegs.chains[0], legs: [candidate, { ...later, buy: '2024-08-10' }] }] },
      { ...twoLegs, opportunities: [{ ...candidate, known_destination_date: '2024-08-04' }] },
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(invalid)))
      await expect(loadLabDataset(catalog, 'wheat', '2024-08', archive)).rejects.toThrow('Invalid monthly')
    }
    vi.unstubAllGlobals()
  })
})
