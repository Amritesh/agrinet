import { create } from 'zustand'
import { COMMODITIES, dateToOrd, isoToOrd, type Market, type Shock } from './lib/data'

export type Step = 'day' | 'week' | 'month'
export type View = 'map' | 'shocks' | 'news' | 'analytics'
export type Layer = 'points' | 'heat' | 'columns' | 'states' | 'districts' | 'shocks' | 'news'

const LATEST_ORD = isoToOrd('2026-04-20') // updated by coverage at runtime

interface State {
  commodity: (typeof COMMODITIES)[number]
  ord: number // selected day ordinal (days since 2001-01-01)
  minOrd: number
  maxOrd: number
  playing: boolean
  speed: number // steps per second
  step: Step
  view: View
  layers: Record<Layer, boolean>
  compareOrd: number | null // before/after comparison date
  seasonalOverlay: boolean
  selectedMarket: Market | null
  selectedShock: Shock | null
  minSeverity: number
  reducedMotion: boolean
  markets: Market[]
  marketById: Map<number, Market>
  setCommodity: (slug: string) => void
  setOrd: (o: number) => void
  setRange: (min: number, max: number) => void
  setPlaying: (p: boolean) => void
  setSpeed: (s: number) => void
  setStep: (s: Step) => void
  setView: (v: View) => void
  toggleLayer: (l: Layer) => void
  setCompareOrd: (o: number | null) => void
  setSeasonalOverlay: (b: boolean) => void
  selectMarket: (m: Market | null) => void
  selectShock: (s: Shock | null) => void
  setMinSeverity: (n: number) => void
  setMarkets: (m: Market[]) => void
  tick: () => void
}

export const useStore = create<State>((set, get) => ({
  commodity: COMMODITIES[0],
  ord: LATEST_ORD,
  minOrd: 0,
  maxOrd: LATEST_ORD,
  playing: false,
  speed: 4,
  step: 'day',
  view: 'map',
  layers: { points: true, heat: false, columns: true, states: true, districts: false, shocks: true, news: true },
  compareOrd: null,
  seasonalOverlay: true,
  selectedMarket: null,
  selectedShock: null,
  minSeverity: 2,
  reducedMotion: typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  markets: [],
  marketById: new Map(),
  setCommodity: (slug) => set({ commodity: COMMODITIES.find((c) => c.slug === slug) ?? COMMODITIES[0], selectedShock: null }),
  setOrd: (o) => set((s) => ({ ord: Math.max(s.minOrd, Math.min(s.maxOrd, o)) })),
  setRange: (min, max) => set((s) => ({ minOrd: min, maxOrd: max, ord: Math.max(min, Math.min(max, s.ord)) })),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setStep: (step) => set({ step }),
  setView: (view) => set({ view }),
  toggleLayer: (l) => set((s) => ({ layers: { ...s.layers, [l]: !s.layers[l] } })),
  setCompareOrd: (compareOrd) => set({ compareOrd }),
  setSeasonalOverlay: (seasonalOverlay) => set({ seasonalOverlay }),
  selectMarket: (selectedMarket) => set({ selectedMarket }),
  selectShock: (selectedShock) =>
    set((s) => ({
      selectedShock,
      selectedMarket: selectedShock ? (s.marketById.get(selectedShock.market_id) ?? s.selectedMarket) : s.selectedMarket,
      ord: selectedShock ? isoToOrd(selectedShock.obs_date) : s.ord,
    })),
  setMinSeverity: (minSeverity) => set({ minSeverity }),
  setMarkets: (markets) => set({ markets, marketById: new Map(markets.map((m) => [m.id, m])) }),
  tick: () => {
    const { ord, maxOrd, step } = get()
    const inc = step === 'day' ? 1 : step === 'week' ? 7 : 30
    if (ord + inc > maxOrd) set({ playing: false, ord: maxOrd })
    else set({ ord: ord + inc })
  },
}))

export const todayOrd = () => dateToOrd(new Date())
