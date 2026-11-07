import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { fetchNews, ordToIso, byId, type NewsEvent } from '../lib/data'

const TYPES = ['all', 'policy', 'weather', 'market', 'export_import', 'other']

export default function NewsView() {
  const { commodity, ord } = useStore()
  const [days, setDays] = useState(60)
  const [onlyCommodity, setOnlyCommodity] = useState(true)
  const [type, setType] = useState('all')
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [news, setNews] = useState<NewsEvent[]>([])

  useEffect(() => {
    let live = true
    setState('loading')
    fetchNews(onlyCommodity ? commodity.id : null, ordToIso(ord - days), ordToIso(ord), 400)
      .then((n) => {
        if (!live) return
        setNews(n)
        setState('ok')
      })
      .catch(() => live && setState('error'))
    return () => {
      live = false
    }
  }, [commodity.id, ord, days, onlyCommodity])

  const filtered = useMemo(() => news.filter((n) => type === 'all' || n.event_type === type), [news, type])
  const byDay = useMemo(() => {
    const m = new Map<string, NewsEvent[]>()
    for (const n of filtered) {
      const k = n.published_at.slice(0, 10)
      m.set(k, [...(m.get(k) ?? []), n])
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [filtered])

  return (
    <div className="view">
      <div className="toolbar">
        <h2>Agricultural news & notices · {ordToIso(ord - days)} → {ordToIso(ord)}</h2>
        <label className="tl-field">
          <span>Window</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[14, 30, 60, 180, 365].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
        <label className="tl-field">
          <span>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="chip">
          <input type="checkbox" checked={onlyCommodity} onChange={(e) => setOnlyCommodity(e.target.checked)} /> only {commodity.name}
        </label>
      </div>
      <p className="muted small">
        Items are collected from permitted public feeds (PIB, government notices, agricultural news RSS). Commodity, place and event type are extracted by rule-based matching; each item keeps its source link.
        <strong> Verified event</strong> = official notice; <strong>statistical</strong> = co-occurs with a detected shock nearby; <strong>speculative</strong> = same commodity/region, no shock match.
      </p>
      {state === 'loading' && <div className="loading">Loading news…</div>}
      {state === 'error' && <div className="error">Could not reach the news API.</div>}
      {state === 'ok' && !filtered.length && (
        <div className="empty">No news items stored for this period{onlyCommodity ? ` mentioning ${commodity.name}` : ''}. The news pipeline only covers dates after it started collecting; historical periods have no items.</div>
      )}
      <div className="news-timeline">
        {byDay.map(([day, items]) => (
          <section key={day}>
            <h3 className="mono">{day}</h3>
            <ul className="list">
              {items.map((n) => (
                <li key={n.id} className="news-item">
                  <a href={n.url} target="_blank" rel="noopener noreferrer">
                    {n.title}
                  </a>
                  <div className="muted small">
                    {n.source} · <span className={`etype ${n.event_type}`}>{n.event_type}</span>
                    {n.commodity_ids.length > 0 && ` · ${n.commodity_ids.map((c) => byId(c).name).join(', ')}`}
                    {n.state && ` · ${n.district ? n.district + ', ' : ''}${n.state}`}
                    {n.impact_hint && n.impact_hint !== 'none' && ` · price hint: ${n.impact_hint}`}
                  </div>
                  {n.evidence && <blockquote className="evidence">“{n.evidence}”</blockquote>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
