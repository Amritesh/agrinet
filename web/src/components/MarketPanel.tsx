import { useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { useStore } from '../store'
import { COMMODITIES, loadSeries, fetchNearby, fetchMarketShocks, fetchMarketNews, fetchStats, ordToIso, isoToOrd, type MarketSeries, type NearbyMarket, type Shock, type NewsEvent, type NewsLink, type Stats } from '../lib/data'
import { volatility, seasonalProfile, percentileRank, robustZ, seasonalBaseline } from '../lib/analytics'
import { SEVERITY_COLORS } from '../lib/color'
import { chartTheme, MONTHS } from '../lib/chart'

const WEATHER = 'https://api.open-meteo.com/v1/forecast'

export default function MarketPanel() {
  const { selectedMarket: m, commodity, ord, selectedShock, selectMarket, selectShock, seasonalOverlay, setSeasonalOverlay } = useStore()
  const [series, setSeries] = useState<MarketSeries | null | undefined>(undefined)
  const [nearby, setNearby] = useState<NearbyMarket[] | null>(null)
  const [shocks, setShocks] = useState<Shock[] | null>(null)
  const [news, setNews] = useState<(NewsLink & { news: NewsEvent })[] | null>(null)
  const [stats, setStats] = useState<Stats[] | null>(null)
  const [weather, setWeather] = useState<{ tmax: number[]; rain: number[]; days: string[] } | null | 'err'>(null)
  const [err, setErr] = useState<string | null>(null)
  const [range, setRange] = useState<'1y' | '5y' | 'all'>('5y')

  useEffect(() => {
    if (!m) return
    setSeries(undefined)
    setNearby(null)
    setShocks(null)
    setNews(null)
    setStats(null)
    setWeather(null)
    setErr(null)
    let live = true
    loadSeries(m.id).then((s) => live && setSeries(s)).catch((e) => live && setErr(String(e)))
    fetchNearby(m.id, commodity.id).then((n) => live && setNearby(n)).catch(() => live && setNearby([]))
    fetchMarketShocks(m.id, commodity.id).then((s) => live && setShocks(s)).catch(() => live && setShocks([]))
    fetchMarketNews(m.id, commodity.id).then((n) => live && setNews(n)).catch(() => live && setNews([]))
    fetchStats(m.id).then((s) => live && setStats(s)).catch(() => live && setStats([]))
    if (m.lat != null)
      fetch(`${WEATHER}?latitude=${m.lat}&longitude=${m.lon}&daily=temperature_2m_max,precipitation_sum&past_days=7&forecast_days=7&timezone=Asia%2FKolkata`)
        .then((r) => r.json())
        .then((w) => live && setWeather({ tmax: w.daily.temperature_2m_max, rain: w.daily.precipitation_sum, days: w.daily.time }))
        .catch(() => live && setWeather('err'))
    return () => {
      live = false
    }
  }, [m, commodity.id])

  const pts = useMemo(() => series?.get(commodity.id) ?? [], [series, commodity.id])
  const available = useMemo(() => COMMODITIES.filter((c) => series?.has(c.id)), [series])
  const idxAt = useMemo(() => {
    let best = -1
    for (let i = 0; i < pts.length; i++) if (pts[i].d <= ord) best = i
    return best
  }, [pts, ord])
  const vol = useMemo(() => volatility(pts.slice(0, idxAt + 1)), [pts, idxAt])
  const season = useMemo(() => seasonalProfile(pts), [pts])
  const st = stats?.find((s) => s.commodity_id === commodity.id)

  if (!m) return null
  const cur = idxAt >= 0 ? pts[idxAt] : null
  const minOrd = range === 'all' ? 0 : ord - (range === '1y' ? 365 : 5 * 365)
  const visible = pts.filter((p) => p.d >= minOrd && p.d <= ord + 365)
  const shockAt = selectedShock && selectedShock.market_id === m.id ? selectedShock : null

  const chartOpt = {
    ...chartTheme,
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => (v == null ? '—' : `₹${Math.round(v)}/q`) },
    legend: { data: ['Modal', 'Min–Max', 'Seasonal baseline'], textStyle: { color: '#94a3b8' }, top: 0 },
    grid: { left: 48, right: 12, top: 30, bottom: 28 },
    xAxis: { type: 'time', axisLabel: { color: '#64748b' } },
    yAxis: { type: 'value', name: '₹/quintal', axisLabel: { color: '#64748b' }, splitLine: { lineStyle: { color: '#1e293b' } } },
    dataZoom: [{ type: 'inside' }],
    series: [
      {
        name: 'Min–Max',
        type: 'line',
        data: visible.map((p) => [ordToIso(p.d), p.mn]),
        lineStyle: { opacity: 0 },
        stack: 'band',
        symbol: 'none',
        areaStyle: { opacity: 0 },
      },
      {
        name: 'Min–Max',
        type: 'line',
        data: visible.map((p) => [ordToIso(p.d), p.mx - p.mn]),
        lineStyle: { opacity: 0 },
        stack: 'band',
        symbol: 'none',
        areaStyle: { color: commodity.color, opacity: 0.12 },
      },
      { name: 'Modal', type: 'line', data: visible.map((p) => [ordToIso(p.d), p.md]), showSymbol: false, lineStyle: { color: commodity.color, width: 1.5 }, sampling: 'lttb' },
      ...(seasonalOverlay
        ? [
            {
              name: 'Seasonal baseline',
              type: 'line',
              data: visible.map((p) => {
                const mo = new Date(Date.UTC(2001, 0, 1) + p.d * 86400000).getUTCMonth()
                return [ordToIso(p.d), season[mo].median]
              }),
              showSymbol: false,
              lineStyle: { color: '#94a3b8', type: 'dashed', width: 1 },
            },
          ]
        : []),
      {
        name: 'Shocks',
        type: 'scatter',
        data: (shocks ?? []).filter((s) => isoToOrd(s.obs_date) >= minOrd).map((s) => ({ value: [s.obs_date, s.observed], itemStyle: { color: SEVERITY_COLORS[s.severity] }, shock: s })),
        symbolSize: (_: unknown, p: { data: { shock: Shock } }) => 4 + p.data.shock.severity * 2,
      },
    ],
    ...(cur ? { markLine: undefined } : {}),
  }

  const seasonOpt = {
    ...chartTheme,
    tooltip: { trigger: 'axis' },
    grid: { left: 48, right: 12, top: 10, bottom: 24 },
    xAxis: { type: 'category', data: MONTHS, axisLabel: { color: '#64748b' } },
    yAxis: { type: 'value', axisLabel: { color: '#64748b' }, splitLine: { lineStyle: { color: '#1e293b' } } },
    series: [
      { name: 'P25–P75', type: 'bar', data: season.map((s) => [s.p25, s.p75]), itemStyle: { color: commodity.color, opacity: 0.25 }, barWidth: '60%' },
      { name: 'Median', type: 'line', data: season.map((s) => s.median), lineStyle: { color: commodity.color }, symbolSize: 5 },
    ],
  }

  return (
    <aside className="panel" aria-label="Market investigation panel">
      <header className="panel-head">
        <div>
          <h2>{m.n}</h2>
          <div className="muted">
            {m.d}, {m.s} · {m.lat != null ? `${m.lat.toFixed(3)}, ${m.lon!.toFixed(3)}` : 'no coordinates'}
          </div>
          <div className="quality">
            <span className={`chip ${m.c >= 70 ? 'ok' : m.c >= 40 ? 'warn' : 'bad'}`} title={`Geocode source: ${m.src}`}>
              location {m.c >= 70 ? 'verified' : m.c >= 40 ? 'approx. (district)' : m.c > 0 ? 'approx. (state)' : 'unknown'} · {m.c}%
            </span>
            {st && (
              <span className="chip" title="Observations in series">
                {st.n_obs} obs · {st.first_date} → {st.last_date}
              </span>
            )}
          </div>
        </div>
        <button className="btn tiny" aria-label="Close panel" onClick={() => { selectMarket(null); selectShock(null) }}>
          ✕
        </button>
      </header>

      {err && <div className="error">Failed to load series: {err}</div>}
      {series === undefined && !err && <div className="loading">Loading history…</div>}
      {series === null && <div className="empty">No price history file for this market.</div>}

      {series && (
        <>
          <section>
            <h3>Commodities reported here</h3>
            <div className="row wrap">
              {available.length ? (
                available.map((c) => (
                  <button key={c.id} className={`chip clickable ${c.id === commodity.id ? 'active' : ''}`} onClick={() => useStore.getState().setCommodity(c.slug)}>
                    {c.name} · {series.get(c.id)!.length} days
                  </button>
                ))
              ) : (
                <span className="muted">none of the pilot commodities</span>
              )}
            </div>
          </section>

          {!pts.length ? (
            <div className="empty">No {commodity.name} observations at this market.</div>
          ) : (
            <>
              <section className="kpis">
                <Kpi label={`Modal ${cur ? ordToIso(cur.d) : ''}`} value={cur ? `₹${cur.md}` : '—'} sub={cur ? `min ₹${cur.mn} · max ₹${cur.mx} · ${cur.nv} variety rows` : `no report on/before ${ordToIso(ord)}`} />
                <Kpi label="Volatility (90 obs)" value={vol == null ? '—' : `${vol.toFixed(1)}%`} sub="stdev of daily log returns" />
                <Kpi label="Historical percentile" value={cur ? `${percentileRank(pts, cur.md)!.toFixed(0)}th` : '—'} sub={`of ${pts.length} daily obs`} />
                <Kpi label="Latest in DB" value={st?.latest_modal ? `₹${st.latest_modal}` : '—'} sub={st?.latest_date ?? ''} />
              </section>

              {shockAt && <ShockInvestigation shock={shockAt} pts={pts} />}

              <section>
                <div className="row between">
                  <h3>Price history</h3>
                  <div className="row">
                    {(['1y', '5y', 'all'] as const).map((r) => (
                      <button key={r} className={`chip clickable ${range === r ? 'active' : ''}`} onClick={() => setRange(r)}>
                        {r}
                      </button>
                    ))}
                    <label className="chip">
                      <input type="checkbox" checked={seasonalOverlay} onChange={(e) => setSeasonalOverlay(e.target.checked)} /> seasonal
                    </label>
                  </div>
                </div>
                <ReactECharts option={chartOpt} style={{ height: 240 }} notMerge onEvents={{ click: (p: { data?: { shock?: Shock } }) => p.data?.shock && selectShock(p.data.shock) }} />
              </section>

              <section>
                <h3>Seasonal pattern (all years, by month)</h3>
                <ReactECharts option={seasonOpt} style={{ height: 160 }} notMerge />
              </section>

              <section>
                <h3>Detected shocks ({shocks ? shocks.length : '…'})</h3>
                {shocks && !shocks.length && <div className="empty">No shocks detected for {commodity.name} at this market (series may be too sparse: needs ≥60 observations).</div>}
                <ul className="list">
                  {(shocks ?? []).slice(0, 12).map((s) => (
                    <li key={s.id}>
                      <button className="list-item" onClick={() => selectShock(s)} aria-label={`Open shock ${s.obs_date}`}>
                        <span className="sev" style={{ background: SEVERITY_COLORS[s.severity] }} />
                        <span className="mono">{s.obs_date}</span>
                        <span>
                          {s.method} {s.direction === 'up' ? '▲' : '▼'} z={s.score.toFixed(1)}
                        </span>
                        <span className="muted">{s.pct_change != null ? `${s.pct_change > 0 ? '+' : ''}${s.pct_change.toFixed(0)}%` : ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </>
      )}

      <section>
        <h3>Nearby markets (≤150 km)</h3>
        {nearby === null && <div className="loading">…</div>}
        {nearby && !nearby.length && <div className="empty">No geocoded markets reporting {commodity.name} within 150 km.</div>}
        <ul className="list">
          {(nearby ?? []).map((n) => (
            <li key={n.id}>
              <button className="list-item" onClick={() => selectMarket(useStore.getState().marketById.get(n.id) ?? null)}>
                <span>
                  {n.name} <span className="muted">({n.district})</span>
                </span>
                <span className="mono">{n.distance_km.toFixed(0)} km</span>
                <span className="mono">{n.latest_modal ? `₹${n.latest_modal}` : '—'}</span>
                <span className="muted small">{n.latest_date ?? ''}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Related news</h3>
        {news === null && <div className="loading">…</div>}
        {news && !news.length && <div className="empty">No news items linked to this market for {commodity.name}.</div>}
        <ul className="list">
          {(news ?? []).map((l) => (
            <li key={l.news_id} className="news-item">
              <a href={l.news.url} target="_blank" rel="noopener noreferrer">
                {l.news.title}
              </a>
              <div className="muted small">
                {l.news.source} · {l.news.published_at.slice(0, 10)} · <span className={`assoc ${l.association}`}>{l.association.replace('_', ' ')}</span>
                {l.distance_km != null && ` · ${l.distance_km.toFixed(0)} km`}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Weather (Open-Meteo, past 7 + next 7 days)</h3>
        {weather === 'err' && <div className="empty">Weather unavailable.</div>}
        {weather && weather !== 'err' && (
          <ReactECharts
            option={{
              ...chartTheme,
              tooltip: { trigger: 'axis' },
              grid: { left: 36, right: 36, top: 10, bottom: 24 },
              xAxis: { type: 'category', data: weather.days.map((d) => d.slice(5)), axisLabel: { color: '#64748b' } },
              yAxis: [
                { type: 'value', name: '°C', axisLabel: { color: '#64748b' }, splitLine: { show: false } },
                { type: 'value', name: 'mm', axisLabel: { color: '#64748b' }, splitLine: { show: false } },
              ],
              series: [
                { name: 'Max temp', type: 'line', data: weather.tmax, lineStyle: { color: '#fb923c' } },
                { name: 'Rain', type: 'bar', yAxisIndex: 1, data: weather.rain, itemStyle: { color: '#38bdf8' } },
              ],
            }}
            style={{ height: 140 }}
            notMerge
          />
        )}
        {m.lat == null && <div className="empty">No coordinates → no weather.</div>}
      </section>
      <footer className="muted small">
        Source: AGMARKNET via data.gov.in (GODL-India), mirror refreshed 2026-11-04. Prices in ₹ per quintal as reported; nothing interpolated.
      </footer>
    </aside>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}

export function ShockInvestigation({ shock, pts }: { shock: Shock; pts: { d: number; md: number; mn: number; mx: number; nv: number }[] }) {
  const o = isoToOrd(shock.obs_date)
  const i = pts.findIndex((p) => p.d === o)
  const rz = i >= 0 ? robustZ(pts, i) : { z: null, median: null, mad: null }
  const sb = seasonalBaseline(pts, o)
  const prev = i > 0 ? pts[i - 1] : null
  const support = pts.filter((p) => p.d >= o - 14 && p.d <= o + 7)
  return (
    <section className="investigation" aria-label="Shock investigation">
      <h3>
        <span className="sev" style={{ background: SEVERITY_COLORS[shock.severity] }} /> Shock · {shock.obs_date} · {shock.method} · severity {shock.severity}
      </h3>
      <dl className="facts">
        <dt>Observed</dt>
        <dd>₹{shock.observed}/q{prev && ` (previous report ₹${prev.md} on ${ordToIso(prev.d)})`}</dd>
        <dt>Baseline</dt>
        <dd>{shock.baseline != null ? `₹${Math.round(shock.baseline)}` : '—'} ({baselineLabel(shock.method)})</dd>
        <dt>Change</dt>
        <dd>{shock.pct_change != null ? `${shock.pct_change > 0 ? '+' : ''}${shock.pct_change.toFixed(1)}%` : '—'}</dd>
        <dt>Anomaly score</dt>
        <dd>
          z = {shock.score.toFixed(2)} ({shock.direction}) · window {shock.window_start} → {shock.window_end}
        </dd>
        <dt>Recomputed in browser</dt>
        <dd>
          robust-z (60-obs median/MAD) = {rz.z == null ? 'n/a (sparse)' : rz.z.toFixed(2)} · rolling median ₹{rz.median ? Math.round(rz.median) : '—'}
          <br />
          same-week prior-years baseline ₹{sb.baseline ? Math.round(sb.baseline) : '—'} from {sb.years} years
        </dd>
        <dt>Supporting observations</dt>
        <dd className="mono small">{support.length ? support.map((p) => `${ordToIso(p.d).slice(5)}:${p.md}`).join('  ') : 'none in ±2 weeks'}</dd>
        <dt>Confidence</dt>
        <dd>
          {support.length >= 8 ? 'good' : support.length >= 4 ? 'moderate' : 'low'} — {support.length} reports within ±2 weeks; {pts.length} total observations.
          {shock.observed > 0 && prev && support.length < 4 ? ' Isolated reports can reflect data-entry or grade changes rather than market moves.' : ''}
        </dd>
      </dl>
      <div className="muted small">Statistical detection only. Any news shown below is an association by place, time and commodity — not a verified cause.</div>
    </section>
  )
}

function baselineLabel(m: string) {
  return { return_1d: 'previous observation', return_7d: 'observation ~7 days earlier', mad_z: 'rolling 60-obs median', seasonal_dev: 'same-week median of prior years', regional_div: 'expected price at prior 30-observation market/state spread' }[m] ?? m
}
