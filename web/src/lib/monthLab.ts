import type { Story } from './stories'

/** One observed buy row and its already-matched, modeled later sale. No synthetic hops. */
export interface Opportunity {
  key: string
  story: Story
  day: string
  sellDay: string
  buy: number
  sell: number
  gross: number
  costs: number
  net: number
  stress: number
  surprise: number
  informed: boolean
}
export type LabSort = 'surprise' | 'margin' | 'resilience'
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b)
  return s.length % 2 ? s[Math.floor(s.length / 2)] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

/** Compare each eligible day to the median margin of all valid days on its own corridor-month.
 * This is an ex-post anomaly detector, not a causal forecast or a guarantee of executable quotes.
 */
export function analyzeMonth(stories: Story[], month: string): Opportunity[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return []
  const result: Opportunity[] = []
  for (const story of stories) {
    if (story.period !== month || story.kind !== 'corridor' || !story.trades?.length || story.markets.length < 2 || !story.routes.length) continue
    const rows = story.trades.filter((t) => t.buy.startsWith(`${month}-`) && /^\d{4}-\d{2}-\d{2}$/.test(t.buy) && /^\d{4}-\d{2}-\d{2}$/.test(t.sell) && t.sell > t.buy && finite(t.buy_price) && finite(t.sell_price) && finite(t.gross) && finite(t.net_baseline) && finite(t.net_adverse) && t.buy_price > 0 && t.sell_price > 0 && t.gross >= t.net_baseline)
    if (!rows.length) continue
    const center = median(rows.map((t) => t.net_baseline!))
    for (const [index, t] of rows.entries()) {
      if (t.informed_ship !== true || t.net_baseline! <= 0 || t.gross < 0) continue
      result.push({
      key: `${story.id}:${t.buy}:${index}`, story, day: t.buy, sellDay: t.sell,
      buy: t.buy_price, sell: t.sell_price, gross: t.gross,
      costs: t.gross - t.net_baseline!, net: t.net_baseline!, stress: t.net_adverse!,
      surprise: t.net_baseline! - center, informed: true,
      })
    }
  }
  return rankOpportunities(result, 'surprise')
}

export function rankOpportunities(items: Opportunity[], sort: LabSort): Opportunity[] {
  const metric = (o: Opportunity) => sort === 'margin' ? o.net : sort === 'resilience' ? o.stress : o.surprise
  return [...items].sort((a, b) => metric(b) - metric(a) || b.net - a.net || a.day.localeCompare(b.day) || a.key.localeCompare(b.key))
}
