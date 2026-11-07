import { useCallback, useEffect, useState } from 'react'
import { useStore, type View, type Layer } from './store'
import { COMMODITIES, loadMarkets, loadCoverage, isoToOrd, ordToIso, fetchHealth } from './lib/data'
import MapView, { type HoverInfo } from './components/MapView'
import TimeMachine from './components/TimeMachine'
import MarketPanel from './components/MarketPanel'
import ShocksView from './components/ShocksView'
import NewsView from './components/NewsView'
import Analytics from './components/Analytics'
import { useSearch } from './lib/useSearch'

const VIEWS: { id: View; label: string; icon: string }[] = [
  { id: 'map', label: 'Map', icon: '◉' },
  { id: 'shocks', label: 'Shocks', icon: '⚡' },
  { id: 'news', label: 'News', icon: '▤' },
  { id: 'analytics', label: 'Analytics', icon: '▥' },
]
const LAYERS: { id: Layer; label: string }[] = [
  { id: 'points', label: 'Mandi prices' },
  { id: 'heat', label: 'Price heatmap' },
  { id: 'columns', label: '3D anomaly columns' },
  { id: 'shocks', label: 'Shock pulses' },
  { id: 'news', label: 'News markers' },
  { id: 'states', label: 'State borders' },
  { id: 'districts', label: 'District borders' },
]

export default function App() {
  const { commodity, setCommodity, view, setView, layers, toggleLayer, setMarkets, setRange, selectedMarket, selectMarket, markets, ord } = useStore()
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const [status, setStatus] = useState('')
  const [health, setHealth] = useState<Record<string, unknown> | null | 'err'>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const search = useSearch(markets)
  // Capture once before URL synchronization; StrictMode replays effects and
  // asynchronous market loading must not replace the original deep link.
  const [initialSearch] = useState(() => location.search)

  useEffect(() => {
    let cancelled = false
    const initial = useStore.getState()
    const linkedDate = new URLSearchParams(initialSearch).get('d')
    const linkedOrd = linkedDate && /^\d{4}-\d{2}-\d{2}$/.test(linkedDate) && Number.isFinite(isoToOrd(linkedDate))
      ? isoToOrd(linkedDate) : null
    // The URL effect initially clamps deep links to the store's default range.
    const initialOrd = linkedOrd == null ? initial.ord : Math.max(initial.minOrd, Math.min(initial.maxOrd, linkedOrd))
    loadMarkets()
      .then((m) => { if (!cancelled) setMarkets(m) })
      .catch((e) => { if (!cancelled) setLoadErr(`Market list failed to load: ${e}`) })
    // Resolve one range from both sources, never let a late coverage response
    // extend health's observed last date to the end of its calendar year.
    Promise.allSettled([loadCoverage(), fetchHealth()]).then(([coverage, healthResult]) => {
      if (cancelled) return
      const h = healthResult.status === 'fulfilled' ? healthResult.value : null
      setHealth(h ?? 'err')
      const years = coverage.status === 'fulfilled'
        ? coverage.value.map((r) => r.year).filter((y) => Number.isInteger(y) && y >= 1000 && y <= 9999)
        : []
      const min = years.length ? isoToOrd(`${Math.min(...years)}-01-01`) : isoToOrd('2001-01-01')
      const latest = typeof h?.latest_price_date === 'string' ? isoToOrd(h.latest_price_date) : NaN
      const hasLatest = Number.isFinite(latest) && ordToIso(latest) === h?.latest_price_date
      const max = hasLatest ? latest : years.length ? isoToOrd(`${Math.max(...years)}-12-31`) : null
      // Empty/failed sources must not poison the store with Infinity/NaN.
      if (max == null) return
      const selectionUnchanged = useStore.getState().ord === initialOrd
      setRange(min, max)
      // Never reset a date the user chose while these requests were pending.
      if (selectionUnchanged && linkedOrd != null) {
        useStore.getState().setOrd(linkedOrd)
      } else if (selectionUnchanged && hasLatest) {
        useStore.getState().setOrd(latest)
      }
    })
    // StrictMode replays this effect: stale completions must not update state.
    return () => { cancelled = true }
  }, [initialSearch, setMarkets, setRange])

  // URL state (deep links): ?c=onion&d=2024-01-15&m=123&v=map
  useEffect(() => {
    const p = new URLSearchParams(initialSearch)
    const c = p.get('c')
    const d = p.get('d')
    const v = p.get('v') as View | null
    if (c) setCommodity(c)
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) useStore.getState().setOrd(isoToOrd(d))
    if (v && VIEWS.some((x) => x.id === v)) setView(v)
    const m = p.get('m')
    if (m && markets.length) selectMarket(useStore.getState().marketById.get(Number(m)) ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets.length])
  useEffect(() => {
    const p = new URLSearchParams()
    p.set('c', commodity.slug)
    p.set('d', ordToIso(ord))
    p.set('v', view)
    if (selectedMarket) p.set('m', String(selectedMarket.id))
    history.replaceState(null, '', `?${p}`)
  }, [commodity.slug, ord, view, selectedMarket])

  const onHover = useCallback((h: HoverInfo | null) => setHover(h), [])
  const onStatus = useCallback((s: string) => setStatus(s), [])

  return (
    <div className="app">
      <a href="#main" className="skip">
        Skip to content
      </a>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            ◈
          </span>
          <span>AGRINET</span>
          <span className="muted small hide-sm">India agricultural market intelligence</span>
        </div>
        <nav className="commodities" aria-label="Commodity">
          {COMMODITIES.map((c) => (
            <button key={c.id} className={`tab ${c.id === commodity.id ? 'active' : ''}`} style={{ '--c': c.color } as React.CSSProperties} aria-pressed={c.id === commodity.id} onClick={() => setCommodity(c.slug)}>
              {c.name}
            </button>
          ))}
        </nav>
        <div className="search-box">
          <input
            type="search"
            placeholder="Find a mandi…"
            aria-label="Search mandi"
            value={search.q}
            onChange={(e) => search.setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && search.results[0]) {
                selectMarket(search.results[0])
                search.setQ('')
                setView('map')
              }
            }}
          />
          {search.q && search.results.length > 0 && (
            <ul className="search-results" role="listbox">
              {search.results.map((m) => (
                <li key={m.id} role="option" aria-selected={false}>
                  <button
                    onClick={() => {
                      selectMarket(m)
                      search.setQ('')
                      setView('map')
                    }}
                  >
                    {m.n}{' '}
                    <span className="muted">
                      · {m.d}, {m.s}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {search.q && !search.results.length && <div className="search-results muted small">No mandi matches</div>}
        </div>
        <nav className="views" aria-label="Views">
          {VIEWS.map((v) => (
            <button key={v.id} className={`tab ${view === v.id ? 'active' : ''}`} aria-label={v.label} aria-pressed={view === v.id} onClick={() => setView(v.id)}>
              <span aria-hidden="true">{v.icon}</span> <span className="hide-sm">{v.label}</span>
            </button>
          ))}
        </nav>
        <div
          className={`health ${health === 'err' ? 'bad' : health ? 'ok' : ''}`}
          title={health && health !== 'err' ? `markets ${health.markets} · shocks ${health.shocks} · news ${health.news} · last ingest ${health.last_ingest}` : 'API status'}
        >
          ● {health === 'err' ? 'API down' : health ? `data to ${String(health.latest_price_date)}` : 'checking…'}
        </div>
      </header>

      {loadErr && <div className="error banner">{loadErr}</div>}

      <main id="main" className={`main ${selectedMarket ? 'with-panel' : ''}`}>
        <div className="stage">
          {view === 'map' && (
            <>
              <MapView onHover={onHover} onStatus={onStatus} />
              <div className="map-overlay-top">
                <div className="status" role="status" aria-live="polite">
                  {status}
                </div>
                <details className="layers">
                  <summary>Layers</summary>
                  {LAYERS.map((l) => (
                    <label key={l.id}>
                      <input type="checkbox" checked={layers[l.id]} onChange={() => toggleLayer(l.id)} /> {l.label}
                    </label>
                  ))}
                </details>
                <Legend />
              </div>
              {hover && (
                <div className="tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }} role="tooltip">
                  {hover.text.map((t, i) => (
                    <div key={i} className={i === 0 ? 'strong' : ''}>
                      {t}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {view === 'shocks' && <ShocksView />}
          {view === 'news' && <NewsView />}
          {view === 'analytics' && <Analytics />}
        </div>
        {selectedMarket && <MarketPanel />}
      </main>
      <TimeMachine />
    </div>
  )
}

function Legend() {
  const { compareOrd } = useStore()
  return (
    <div className="legend" aria-label="Legend">
      {compareOrd == null ? (
        <>
          <span className="legend-bar" />
          <span className="small muted">low ← modal price (year P5–P95) → high</span>
        </>
      ) : (
        <>
          <span className="legend-bar diff" />
          <span className="small muted">cheaper ← vs comparison date → dearer</span>
        </>
      )}
      <span className="small muted">
        <span className="dot amber" /> approx. location
      </span>
      <span className="small muted">
        <span className="dot red" /> up-shock <span className="dot blue" /> down-shock
      </span>
    </div>
  )
}
