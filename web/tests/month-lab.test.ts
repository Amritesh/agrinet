import { describe, expect, it } from 'vitest'
import { analyzeMonth, rankOpportunities, type Opportunity } from '../src/lib/monthLab'
import type { Story } from '../src/lib/stories'

const story = (id: string, period: string, net: number[], adverse: number[]): Story => ({
  id, period, commodity: 'tomato', commodity_name: 'Tomato', kind: 'corridor', engine: 'test',
  title: 'Test route', summary: '', why_selected: '', score: 5, conclusion: '',
  evidence: { level: 'moderate', observations: '', caveats: [] }, facts: { variety: 'Local', grade: 'FAQ', truck_qtl: 100 },
  markets: [{ id: 1, name: 'A', state: 'X', lat: 1, lon: 1, precision: 'town' }, { id: 2, name: 'B', state: 'X', lat: 2, lon: 2, precision: 'town' }],
  routes: [{ slug: 'a-b', path: [], km: 40, hours: 1, provider: 'test', profile: 'car', truck_suitable: false, requested: '' }],
  trades: net.map((n, i) => ({ buy: `2024-08-${String(i + 1).padStart(2, '0')}`, sell: `2024-08-${String(i + 2).padStart(2, '0')}`, buy_price: 100, sell_price: 150 + n, gross: 50 + n, net_baseline: n, net_adverse: adverse[i], informed_ship: i !== 1 })),
  scenes: [], assumptions: [], sources: [],
})

describe('historical month lab', () => {
  it('screens exact-month trade rows, shows costs, and does not mislabel ex-post observations as informed decisions', () => {
    const s = story('tomato-2024-08-trade-a-b', '2024-08', [10, -20, 80, 10], [1, -30, 30, -5])
    const result = analyzeMonth([s, story('tomato-2024-09-trade-a-b', '2024-09', [900], [800])], '2024-08')
    expect(result).toHaveLength(3)
    expect(result[0].day).toBe('2024-08-03')
    expect(result[0].net).toBe(80)
    expect(result[0].costs).toBe(50) // gross 130 less net 80
    expect(result[0].surprise).toBe(70) // median includes the losing, uninformed day
    expect(result[0].informed).toBe(true)
    expect(result[0].sellDay).toBe('2024-08-04')
    expect(result.every((r) => r.day.startsWith('2024-08') && r.net > 0)).toBe(true)
    expect(result.find((r) => r.day === '2024-08-04')?.informed).toBe(true)
  })
  it('ignores unscreened, missing or malformed prices and never joins unrelated markets into a synthetic multi-hop trade', () => {
    const s = story('tomato-2024-08-trade-a-b', '2024-08', [5], [1])
    const invalid = { ...s, id: 'tomato-2024-08-shock', kind: 'shock' as const }
    const bad = { ...s, id: 'tomato-2024-08-trade-b-c', trades: [{ ...s.trades![0], net_baseline: Number.NaN }] }
    expect(analyzeMonth([invalid, bad], '2024-08')).toEqual([])
    expect(analyzeMonth([s], '2024-07')).toEqual([])
    expect(analyzeMonth([s], '2024-08')).toHaveLength(1)
  })
  it('re-ranks by margin, stress, and anomaly with stable tie breaking', () => {
    const s = story('tomato-2024-08-trade-a-b', '2024-08', [10, 10, 100], [8, 8, -40])
    const opportunities = analyzeMonth([s], '2024-08')
    expect(rankOpportunities(opportunities, 'surprise')[0].net).toBe(100)
    expect(rankOpportunities(opportunities, 'margin')[0].net).toBe(100)
    expect(rankOpportunities(opportunities, 'resilience')[0].stress).toBe(8)
    expect(rankOpportunities([] as Opportunity[], 'margin')).toEqual([])
  })
})
