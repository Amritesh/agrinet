import { useMemo, useState } from 'react'
import type { Market } from '../lib/data'
import { searchMarkets } from '../lib/useSearch'
import { marketPrecision, parseManualPoint, routePointFor } from '../lib/corridor'
import { estimateRoute, type RoadRoute, type RoutePoint } from '../lib/routing'
import type { ScenarioRoute } from '../lib/scenario'
import RouteMap from './RouteMap'

interface Props {
  markets: Market[]
  onUseDistance: (route: ScenarioRoute) => void
}

interface Endpoint {
  market: Market | null
  lat: string
  lon: string
  evidence: string
  confirmed: boolean
}

const EMPTY: Endpoint = { market: null, lat: '', lon: '', evidence: '', confirmed: false }

function resolvePoint(e: Endpoint): { point: RoutePoint | null; error: string | null } {
  if (!e.market) return { point: null, error: null }
  const auto = routePointFor(e.market)
  if (auto) return { point: auto, error: null }
  const parsed = parseManualPoint(e.market.n, e.lat, e.lon, e.evidence)
  if (!parsed.ok) return { point: null, error: parsed.error }
  if (!e.confirmed) return { point: null, error: 'Tick the confirmation to use this representative point.' }
  return { point: parsed.point, error: null }
}

const fmtDuration = (h: number) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} h ${m % 60} min` }

export default function CorridorInspector({ markets, onUseDistance }: Props) {
  const [origin, setOrigin] = useState<Endpoint>(EMPTY)
  const [dest, setDest] = useState<Endpoint>(EMPTY)
  const [route, setRoute] = useState<RoadRoute | null>(null)
  const [routed, setRouted] = useState<{ o: RoutePoint; d: RoutePoint; om: Market; dm: Market } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const o = resolvePoint(origin), d = resolvePoint(dest)
  const ready = !!o.point && !!d.point && !busy

  const run = async () => {
    if (!o.point || !d.point || !origin.market || !dest.market) return
    setBusy(true); setError(null); setRoute(null); setRouted(null)
    try {
      const r = await estimateRoute(o.point, d.point)
      setRoute(r); setRouted({ o: o.point, d: d.point, om: origin.market, dm: dest.market })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setBusy(false) }
  }

  const use = () => {
    if (!route || !routed) return
    const pt = (p: RoutePoint, m: Market) => ({ marketId: m.id, label: p.label, lat: p.lat, lon: p.lon, precision: p.precision, evidence: p.evidence })
    onUseDistance({
      origin: pt(routed.o, routed.om), destination: pt(routed.d, routed.dm),
      distanceKm: Math.round(route.distanceKm * 10) / 10, durationHours: route.durationHours,
      provider: route.provider, profile: route.profile, requestedAt: route.requestedAt, warnings: route.warnings,
    })
  }

  return (
    <main id="main" className="workspace-page">
      <div className="eyebrow">ROAD CORRIDOR · ONE LEG</div>
      <h1>Network Optimizer</h1>
      <div className="workspace-card solver-notice" role="note">
        <strong>Solver not connected.</strong> No optimized allocation is available. Multi-node optimization will need the backend solver, which is still being built. Below you can inspect a single road corridor.
      </div>
      <section className="workspace-card corridor" aria-labelledby="corridor-h">
        <h2 id="corridor-h">Corridor inspector</h2>
        <div className="corridor-ends">
          <EndpointPicker role="Origin" markets={markets} value={origin} onChange={(v) => { setOrigin(v); setRoute(null); setError(null) }} error={o.error} />
          <EndpointPicker role="Destination" markets={markets} value={dest} onChange={(v) => { setDest(v); setRoute(null); setError(null) }} error={d.error} />
        </div>
        <button type="button" className="primary-action" disabled={!ready} onClick={run}>{busy ? 'Routing…' : 'Estimate road route'}</button>
        {error && <p className="route-error" role="alert">{error} No substitute distance has been generated.</p>}
        {route && routed && (
          <div className="route-result">
            <div className="route-flags">
              <span className="badge modeled">Driving profile, not truck-certified</span>
              <span className="badge modeled">Not a freight quote</span>
            </div>
            <dl className="metrics">
              <div className="metric"><dt>Road distance</dt><dd data-testid="route-distance">{route.distanceKm.toFixed(1)} km</dd></div>
              <div className="metric"><dt>Driving duration</dt><dd data-testid="route-duration">{fmtDuration(route.durationHours)}</dd></div>
              <div className="metric wide"><dt>Provider</dt><dd className="provider">{route.provider} · {route.profile} profile · requested {route.requestedAt}</dd></div>
            </dl>
            <RouteMap route={route} />
            <ul className="warnings">{route.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            <button type="button" className="primary-action" onClick={use}>Use this distance in Simulation Studio</button>
          </div>
        )}
      </section>
    </main>
  )
}

function EndpointPicker({ role, markets, value, onChange, error }: { role: 'Origin' | 'Destination'; markets: Market[]; value: Endpoint; onChange: (v: Endpoint) => void; error: string | null }) {
  const [q, setQ] = useState('')
  const results = useMemo(() => searchMarkets(markets, q), [markets, q])
  const m = value.market
  const p = m ? marketPrecision(m) : null
  const id = role.toLowerCase()
  return (
    <fieldset className="endpoint">
      <legend>{role}</legend>
      <label htmlFor={`${id}-q`} className="sr-only">{role} market search</label>
      <input id={`${id}-q`} type="search" placeholder="Search a market…" aria-label={`${role} market search`} value={q} onChange={(e) => setQ(e.target.value)} />
      {q && results.length > 0 && (
        <div role="listbox" aria-label={`${role} matches`} className="endpoint-results">
          {results.map((r) => (
            <button key={r.id} role="option" aria-selected={false} type="button" onClick={() => { onChange({ ...EMPTY, market: r }); setQ('') }}>
              {r.n} <span className="muted">· {r.d}, {r.s}</span>
            </button>
          ))}
        </div>
      )}
      {q && markets.length > 0 && !results.length && <p className="field-hint">No market matches.</p>}
      {m && p && (
        <div className="endpoint-detail">
          <p className="endpoint-name">{m.n} <span className="muted">· {m.d}, {m.s}</span></p>
          <p><span className={`badge precision ${p.routable ? 'ok' : 'warn'}`}>{p.label}</span></p>
          <p className="field-hint">{p.detail}</p>
          {!p.routable && (
            <div className="manual-point">
              <p className="field-hint"><strong>A centroid is not a route point.</strong> Enter a representative point you can justify, such as the market yard gate. AGRINET does not move the centroid for you.</p>
              <div className="field-row">
                <div className="field"><label htmlFor={`${id}-lat`}>Latitude</label><input id={`${id}-lat`} inputMode="decimal" value={value.lat} onChange={(e) => onChange({ ...value, lat: e.target.value, confirmed: false })} /></div>
                <div className="field"><label htmlFor={`${id}-lon`}>Longitude</label><input id={`${id}-lon`} inputMode="decimal" value={value.lon} onChange={(e) => onChange({ ...value, lon: e.target.value, confirmed: false })} /></div>
              </div>
              <div className="field"><label htmlFor={`${id}-ev`}>Evidence</label><textarea id={`${id}-ev`} rows={2} value={value.evidence} placeholder="e.g. APMC yard gate identified on OpenStreetMap way 123" onChange={(e) => onChange({ ...value, evidence: e.target.value, confirmed: false })} /></div>
              <label className="check"><input type="checkbox" checked={value.confirmed} onChange={(e) => onChange({ ...value, confirmed: e.target.checked })} /> I confirm this representative point is my own assumption and not a verified loading address</label>
            </div>
          )}
          {error && (value.lat || value.lon || value.evidence || value.confirmed) && <p className="field-error">{error}</p>}
        </div>
      )}
    </fieldset>
  )
}
