import { useMemo, useState } from 'react'
import type { Market } from './data'

export function searchMarkets(markets: Market[], q: string, limit = 8): Market[] {
  const s = q.trim().toLowerCase()
  if (s.length < 2) return []
  const starts: Market[] = []
  const contains: Market[] = []
  for (const m of markets) {
    const n = m.n.toLowerCase()
    if (n.startsWith(s)) starts.push(m)
    else if (n.includes(s) || m.d.toLowerCase().includes(s)) contains.push(m)
    if (starts.length >= limit) break
  }
  return [...starts, ...contains].slice(0, limit)
}

export function useSearch(markets: Market[]) {
  const [q, setQ] = useState('')
  const results = useMemo(() => searchMarkets(markets, q), [markets, q])
  return { q, setQ, results }
}
