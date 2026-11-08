import { describe, expect, it } from 'vitest'
import { resolveMode, storyFile, pickForMonth, storyUrl, sharePageUrl, monthLabel, productList, availableMonths, defaultStoryId, tradeEvidence, type Catalog, type Story } from '../src/lib/stories'

describe('resolveMode', () => {
  it('opens Stories by default and for ?story=', () => {
    expect(resolveMode('', '')).toBe('stories')
    expect(resolveMode('?story=onion-2023-02-gap-lasalgaon-azadpur', '')).toBe('stories')
  })
  it('keeps old deep links working in Explore / Research', () => {
    expect(resolveMode('?c=onion&d=2024-01-15&v=map', '')).toBe('explore')
    expect(resolveMode('?mode=explore', '')).toBe('explore')
    expect(resolveMode('?v=news', '')).toBe('research')
    expect(resolveMode('?c=tomato&d=2024-01-15&v=analytics', '')).toBe('research')
    expect(resolveMode('?s=abc', '')).toBe('research')
    expect(resolveMode('?mode=research', '')).toBe('research')
    expect(resolveMode('?c=tomato', '#collaborate')).toBe('research')
    expect(resolveMode('', '#collaborate')).toBe('research')
  })
})

describe('story ids', () => {
  it('maps a story id to its per-commodity yearly file', () => {
    expect(storyFile('onion-2023-02-gap-lasalgaon-azadpur')).toBe('stories/onion/2023.json')
    expect(storyFile('potato-2020-10-storage-agra')).toBe('stories/potato/2020.json')
    expect(storyFile('../../etc-2020-01')).toBeNull()
    expect(storyFile('onion-20x3-02-shock')).toBeNull()
  })
  it('builds share urls under the real base path', () => {
    expect(storyUrl('/agrinet/', 'onion-2013-08-shock')).toBe('/agrinet/?story=onion-2013-08-shock')
    expect(sharePageUrl('https://amritesh.github.io', '/agrinet/', 'onion-2013-08-shock', true)).toBe('https://amritesh.github.io/agrinet/s/onion-2013-08-shock/')
    expect(sharePageUrl('https://amritesh.github.io', '/agrinet/', 'onion-2013-08-shock', false)).toBe('https://amritesh.github.io/agrinet/?story=onion-2013-08-shock')
  })
  it('labels months in plain words', () => {
    expect(monthLabel('2013-08')).toBe('August 2013')
  })
})

const cat: Catalog = {
  engine: 't', data_snapshot: 'x', latest_observation: '2026-04-20', story_count: 3, featured: [],
  commodities: {
    onion: { months: { '2013-08': [{ id: 'onion-2013-08-shock', kind: 'shock', title: 'a', score: 80 }], '2023-02': [{ id: 'onion-2023-02-gap-x', kind: 'corridor', title: 'b', score: 56 }, { id: 'onion-2023-02-shock', kind: 'shock', title: 'c', score: 40 }] } },
  },
}

describe('pickForMonth', () => {
  it('returns the best story of the chosen month', () => {
    expect(pickForMonth(cat, 'onion', '2023-02')).toEqual({ id: 'onion-2023-02-gap-x', month: '2023-02', substituted: false })
  })
  it('never fabricates: falls back to the nearest month that has a story and says so', () => {
    expect(pickForMonth(cat, 'onion', '2014-01')).toEqual({ id: 'onion-2013-08-shock', month: '2013-08', substituted: true })
    expect(pickForMonth(cat, 'onion', '2026-04')).toEqual({ id: 'onion-2023-02-gap-x', month: '2023-02', substituted: true })
    expect(pickForMonth(cat, 'tomato', '2023-02')).toBeNull()
  })
})

describe('trade dashboard selection', () => {
  it('includes catalog products with no stories while keeping best-covered products first', () => {
    const products: Catalog = { ...cat, products: {
      lentil: { name: 'Lentil', stories: 0, best: 0 },
      onion: { name: 'Onion', stories: 2, best: 70 },
      potato: { name: 'Potato', stories: 1, best: 60 },
    } }
    expect(productList(products)).toEqual([
      { slug: 'onion', name: 'Onion', stories: 2 },
      { slug: 'potato', name: 'Potato', stories: 1 },
      { slug: 'lentil', name: 'Lentil', stories: 0 },
    ])
    expect(availableMonths(products, 'lentil')).toEqual([])
    expect(availableMonths(products, 'onion')).toEqual(['2013-08', '2023-02'])
  })

  it('derives only reported modeled outcomes and counts from a profitable story', () => {
    const story = { verdict: 'profitable', facts: { n: 22, n_checked: 410, net_baseline: 350, net_adverse: 120, inf_mean: 270, paying_pct: 82, inf_shipped: 12 } } as unknown as Story
    expect(tradeEvidence(story)).toEqual({ matchedDays: 22, checkedPairs: 410, typicalMargin: 350, stressMargin: 120, informedMargin: 270, payingPct: 82, informedShipDays: 12 })
    expect(tradeEvidence({ ...story, verdict: 'positive_modeled_surplus' })).toEqual(tradeEvidence(story))
    expect(tradeEvidence({ ...story, verdict: 'gross_only', facts: { net_baseline: 100 } })).toBeNull()
    expect(tradeEvidence({ ...story, facts: { n: 20, net_baseline: Number.NaN } })).toBeNull()
  })
  it('opens a real catalog story when no featured story passes the feature threshold', () => {
    expect(defaultStoryId(cat)).toBe('onion-2013-08-shock')
    expect(defaultStoryId({ ...cat, commodities: {}, featured: [] })).toBeNull()
    expect(defaultStoryId({ ...cat, featured: [{ id: 'featured-2023-02-trade', title: 'Featured', commodity: 'onion', period: '2023-02', kind: 'corridor', teaser: '' }] })).toBe('featured-2023-02-trade')
  })
})
