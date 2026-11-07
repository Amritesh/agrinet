import { useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { useStore } from '../store'
import { COMMODITIES, loadSnapshot, loadCoverage, ordYear, ordToIso, supabase, type YearSnapshot, type CoverageRow } from '../lib/data'
import { nearestDay } from './MapView'
import { median, quantile } from '../lib/analytics'
import { chartTheme, MONTHS } from '../lib/chart'

interface ShockFreq {
  year: number
  severity: number
  n: number
}

export default function Analytics() {
  const { commodity, ord, marketById, setCommodity } = useStore()
  const [snaps, setSnaps] = useState<Record<number, YearSnapshot | null>>({})
  const [coverage, setCoverage] = useState<CoverageRow[]>([])
  const [freq, setFreq] = useState<ShockFreq[] | null>(null)
  const year = ordYear(ord)

  useEffect(() => {
    let live = true
    Promise.all(COMMODITIES.map((c) => loadSnapshot(c.slug, year))).then((arr) => live && setSnaps(Object.fromEntries(COMMODITIES.map((c, i) => [c.id, arr[i]]))))
    loadCoverage().then((c) => live && setCoverage(c))
    return () => {
      live = false
    }
  }, [year])

  useEffect(() => {
    let live = true
    supabase
      .rpc('shock_frequency', { p_commodity_id: commodity.id })
      .then(({ data }) => live && setFreq((data as ShockFreq[]) ?? []))
    return () => {
      live = false
    }
  }, [commodity.id])

  // per-commodity day snapshot → state medians, national stats
  const today = useMemo(() => {
    const out: Record<number, { day: number | null; national: number | null; n: number; states: Map<string, number[]>; p10: number | null; p90: number | null }> = {}
    for (const c of COMMODITIES) {
      const s = snaps[c.id]
      const d = nearestDay(s, ord)
      const states = new Map<string, number[]>()
      const all: number[] = []
      if (s && d != null) {
        const ds = s.days.get(d)!
        for (let i = 0; i < ds.ids.length; i++) {
          const m = marketById.get(ds.ids[i])
          if (!m) continue
          all.push(ds.modal[i])
          states.set(m.s, [...(states.get(m.s) ?? []), ds.modal[i]])
        }
      }
      out[c.id] = { day: d, national: median(all), n: all.length, states, p10: quantile(all, 0.1), p90: quantile(all, 0.9) }
    }
    return out
  }, [snaps, ord, marketById])

  // national monthly median for selected commodity over the year (seasonal chart) + volatility proxy
  const monthly = useMemo(() => {
    const s = snaps[commodity.id]
    if (!s) return []
    const byMonth: number[][] = Array.from({ length: 12 }, () => [])
    for (const d of s.ordinals) {
      const mo = new Date(Date.UTC(2001, 0, 1) + d * 86400000).getUTCMonth()
      const ds = s.days.get(d)!
      const med = median(Array.from(ds.modal))
      if (med != null) byMonth[mo].push(med)
    }
    return byMonth.map((b) => ({ median: median(b), p25: quantile(b, 0.25), p75: quantile(b, 0.75), n: b.length }))
  }, [snaps, commodity.id])

  const dailyNational = useMemo(() => {
    const s = snaps[commodity.id]
    if (!s) return []
    return s.ordinals.map((d) => [ordToIso(d), median(Array.from(s.days.get(d)!.modal)), s.days.get(d)!.ids.length] as [string, number | null, number])
  }, [snaps, commodity.id])

  const regional = useMemo(() => {
    const t = today[commodity.id]
    if (!t) return []
    return [...t.states.entries()].map(([s, v]) => ({ state: s, median: median(v)!, n: v.length })).sort((a, b) => b.median - a.median)
  }, [today, commodity.id])

  const divergence = useMemo(() => {
    if (regional.length < 2) return null
    const vals = regional.map((r) => r.median)
    return { max: regional[0], min: regional[regional.length - 1], ratio: regional[0].median / regional[regional.length - 1].median, spread: (quantile(vals, 0.9)! - quantile(vals, 0.1)!) / median(vals)! }
  }, [regional])

  const cov = coverage.filter((c) => c.commodity_id === commodity.id)

  return (
    <div className="view">
      <div className="toolbar">
        <h2>Analytics · {ordToIso(ord)}</h2>
        <span className="muted">All figures computed from stored observations for the selected date/year; no interpolation.</span>
      </div>
      <div className="grid3">
        {COMMODITIES.map((c) => {
          const t = today[c.id]
          return (
            <button key={c.id} className={`card kpi-card ${c.id === commodity.id ? 'active' : ''}`} onClick={() => setCommodity(c.slug)} style={{ borderColor: c.color }}>
              <div className="kpi-label">{c.name} · national median modal</div>
              <div className="kpi-value">{t?.national != null ? `₹${Math.round(t.national)}/q` : '—'}</div>
              <div className="kpi-sub">
                {t?.day != null ? `${t.n} mandis on ${ordToIso(t.day)} · P10–P90 ₹${Math.round(t.p10!)}–₹${Math.round(t.p90!)}` : 'no observations within 7 days'}
              </div>
            </button>
          )
        })}
      </div>
      <div className="grid2">
        <div className="card">
          <h3>Regional price comparison — {commodity.name} by state (median modal)</h3>
          {!regional.length && <div className="empty">No data for this day.</div>}
          {regional.length > 0 && (
            <ReactECharts
              option={{
                ...chartTheme,
                tooltip: { formatter: (p: { name: string; value: number; dataIndex: number }) => `${p.name}: ₹${p.value} (${regional[regional.length - 1 - p.dataIndex].n} mandis)` },
                grid: { left: 130, right: 24, top: 8, bottom: 24 },
                xAxis: { type: 'value', axisLabel: { color: '#64748b' }, splitLine: { lineStyle: { color: '#1e293b' } } },
                yAxis: { type: 'category', data: regional.map((r) => r.state).reverse(), axisLabel: { color: '#94a3b8', fontSize: 10 } },
                series: [{ type: 'bar', data: regional.map((r) => Math.round(r.median)).reverse(), itemStyle: { color: commodity.color } }],
              }}
              style={{ height: Math.max(260, regional.length * 16) }}
              notMerge
            />
          )}
          {divergence && (
            <div className="muted small">
              Divergence: {divergence.max.state} ₹{Math.round(divergence.max.median)} vs {divergence.min.state} ₹{Math.round(divergence.min.median)} — ratio {divergence.ratio.toFixed(1)}×, P90–P10 spread {(divergence.spread * 100).toFixed(0)}% of median.
            </div>
          )}
        </div>
        <div className="card">
          <h3>National daily median & reporting mandis — {year}</h3>
          <ReactECharts
            option={{
              ...chartTheme,
              tooltip: { trigger: 'axis' },
              legend: { textStyle: { color: '#94a3b8' }, top: 0 },
              grid: { left: 48, right: 48, top: 28, bottom: 28 },
              xAxis: { type: 'time', axisLabel: { color: '#64748b' } },
              yAxis: [
                { type: 'value', name: '₹/q', axisLabel: { color: '#64748b' }, splitLine: { lineStyle: { color: '#1e293b' } } },
                { type: 'value', name: 'mandis', axisLabel: { color: '#64748b' }, splitLine: { show: false } },
              ],
              series: [
                { name: 'median modal', type: 'line', data: dailyNational.map((d) => [d[0], d[1]]), showSymbol: false, lineStyle: { color: commodity.color } },
                { name: 'mandis reporting', type: 'bar', yAxisIndex: 1, data: dailyNational.map((d) => [d[0], d[2]]), itemStyle: { color: '#334155' } },
              ],
            }}
            style={{ height: 300 }}
            notMerge
          />
          <h3>Seasonal pattern — monthly national median, {year}</h3>
          <ReactECharts
            option={{
              ...chartTheme,
              tooltip: { trigger: 'axis' },
              grid: { left: 48, right: 12, top: 10, bottom: 24 },
              xAxis: { type: 'category', data: MONTHS, axisLabel: { color: '#64748b' } },
              yAxis: { type: 'value', axisLabel: { color: '#64748b' }, splitLine: { lineStyle: { color: '#1e293b' } } },
              series: [
                { name: 'P25–P75', type: 'bar', data: monthly.map((m) => [m.p25, m.p75]), itemStyle: { color: commodity.color, opacity: 0.25 } },
                { name: 'median', type: 'line', data: monthly.map((m) => m.median), lineStyle: { color: commodity.color } },
              ],
            }}
            style={{ height: 180 }}
            notMerge
          />
        </div>
        <div className="card">
          <h3>Shock frequency by year — {commodity.name}</h3>
          {freq === null && <div className="loading">…</div>}
          {freq && !freq.length && <div className="empty">No shocks stored yet.</div>}
          {freq && freq.length > 0 && (
            <ReactECharts
              option={{
                ...chartTheme,
                tooltip: { trigger: 'axis' },
                legend: { textStyle: { color: '#94a3b8' }, top: 0 },
                grid: { left: 48, right: 12, top: 28, bottom: 24 },
                xAxis: { type: 'category', data: [...new Set(freq.map((f) => f.year))].sort(), axisLabel: { color: '#64748b' } },
                yAxis: { type: 'value', axisLabel: { color: '#64748b' }, splitLine: { lineStyle: { color: '#1e293b' } } },
                series: [1, 2, 3, 4].map((sev) => ({
                  name: `severity ${sev}`,
                  type: 'bar',
                  stack: 's',
                  itemStyle: { color: ['', '#facc15', '#fb923c', '#f87171', '#e11d48'][sev] },
                  data: [...new Set(freq.map((f) => f.year))].sort().map((y) => freq.find((f) => f.year === y && f.severity === sev)?.n ?? 0),
                })),
              }}
              style={{ height: 240 }}
              notMerge
            />
          )}
        </div>
        <div className="card">
          <h3>Data completeness — {commodity.name}</h3>
          <ReactECharts
            option={{
              ...chartTheme,
              tooltip: { trigger: 'axis' },
              legend: { textStyle: { color: '#94a3b8' }, top: 0 },
              grid: { left: 48, right: 48, top: 28, bottom: 24 },
              xAxis: { type: 'category', data: cov.map((c) => c.year), axisLabel: { color: '#64748b' } },
              yAxis: [
                { type: 'value', name: 'mandis', axisLabel: { color: '#64748b' }, splitLine: { lineStyle: { color: '#1e293b' } } },
                { type: 'value', name: 'days', max: 366, axisLabel: { color: '#64748b' }, splitLine: { show: false } },
              ],
              series: [
                { name: 'mandis reporting', type: 'bar', data: cov.map((c) => c.n_markets), itemStyle: { color: commodity.color } },
                { name: 'days with data', type: 'line', yAxisIndex: 1, data: cov.map((c) => c.n_days), lineStyle: { color: '#94a3b8' } },
              ],
            }}
            style={{ height: 240 }}
            notMerge
          />
          <div className="muted small">
            Total {cov.reduce((a, c) => a + c.n_rows, 0).toLocaleString()} market-days, {cov[0]?.year}–{cov[cov.length - 1]?.year}. Arrival quantities are not present in the AGMARKNET price feed and are therefore not shown.
          </div>
        </div>
      </div>
    </div>
  )
}
