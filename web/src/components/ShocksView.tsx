import { useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { useStore } from '../store'
import { fetchShocks, ordToIso, type Shock } from '../lib/data'
import { SEVERITY_COLORS } from '../lib/color'
import { chartTheme } from '../lib/chart'

export default function ShocksView() {
  const { commodity, ord, minSeverity, setMinSeverity, selectShock, selectedShock } = useStore()
  const [days, setDays] = useState(90)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [shocks, setShocks] = useState<Shock[]>([])
  const [method, setMethod] = useState<string>('all')
  const [q, setQ] = useState('')

  useEffect(() => {
    let live = true
    setState('loading')
    fetchShocks(commodity.id, ordToIso(ord - days), ordToIso(ord), minSeverity, 2000)
      .then((s) => {
        if (!live) return
        setShocks(s)
        setState('ok')
      })
      .catch(() => live && setState('error'))
    return () => {
      live = false
    }
  }, [commodity.id, ord, days, minSeverity])

  const filtered = useMemo(
    () => shocks.filter((s) => (method === 'all' || s.method === method) && (!q || `${s.market_name} ${s.district} ${s.state}`.toLowerCase().includes(q.toLowerCase()))),
    [shocks, method, q],
  )
  const timeline = useMemo(() => {
    const m = new Map<string, { up: number; down: number }>()
    for (const s of filtered) {
      const e = m.get(s.obs_date) ?? { up: 0, down: 0 }
      e[s.direction]++
      m.set(s.obs_date, e)
    }
    return [...m.entries()].sort()
  }, [filtered])
  const byState = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of filtered) m.set(s.state, (m.get(s.state) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  }, [filtered])

  return (
    <div className="view">
      <div className="toolbar">
        <h2>
          {commodity.name} price shocks · {ordToIso(ord - days)} → {ordToIso(ord)}
        </h2>
        <label className="tl-field">
          <span>Window</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[30, 90, 180, 365].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
        <label className="tl-field">
          <span>Min severity</span>
          <select value={minSeverity} onChange={(e) => setMinSeverity(Number(e.target.value))}>
            {[1, 2, 3, 4].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="tl-field">
          <span>Method</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {['all', 'return_1d', 'return_7d', 'mad_z', 'seasonal_dev', 'regional_div'].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <input className="search" placeholder="Filter market / district / state" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter shocks" />
      </div>

      {state === 'loading' && <div className="loading">Loading shocks…</div>}
      {state === 'error' && <div className="error">Could not reach the shocks API. Retry later.</div>}
      {state === 'ok' && !filtered.length && <div className="empty">No {commodity.name} shocks with severity ≥ {minSeverity} in this window. Try a longer window or lower severity.</div>}

      {state === 'ok' && filtered.length > 0 && (
        <div className="grid2">
          <div className="card">
            <h3>Shock timeline (count per day)</h3>
            <ReactECharts
              option={{
                ...chartTheme,
                tooltip: { trigger: 'axis' },
                grid: { left: 36, right: 12, top: 24, bottom: 28 },
                legend: { textStyle: { color: '#94a3b8' }, top: 0 },
                xAxis: { type: 'category', data: timeline.map((t) => t[0]), axisLabel: { color: '#64748b' } },
                yAxis: { type: 'value', axisLabel: { color: '#64748b' }, splitLine: { lineStyle: { color: '#1e293b' } } },
                series: [
                  { name: 'up', type: 'bar', stack: 'a', data: timeline.map((t) => t[1].up), itemStyle: { color: '#f87171' } },
                  { name: 'down', type: 'bar', stack: 'a', data: timeline.map((t) => t[1].down), itemStyle: { color: '#60a5fa' } },
                ],
              }}
              style={{ height: 200 }}
              notMerge
              onEvents={{ click: (p: { name: string }) => useStore.getState().setOrd(Math.round((Date.parse(p.name) - Date.UTC(2001, 0, 1)) / 86400000)) }}
            />
          </div>
          <div className="card">
            <h3>Regional distribution</h3>
            <ReactECharts
              option={{
                ...chartTheme,
                tooltip: {},
                grid: { left: 110, right: 12, top: 8, bottom: 24 },
                xAxis: { type: 'value', axisLabel: { color: '#64748b' }, splitLine: { lineStyle: { color: '#1e293b' } } },
                yAxis: { type: 'category', data: byState.map((s) => s[0]).reverse(), axisLabel: { color: '#94a3b8' } },
                series: [{ type: 'bar', data: byState.map((s) => s[1]).reverse(), itemStyle: { color: commodity.color } }],
              }}
              style={{ height: 200 }}
              notMerge
            />
          </div>
          <div className="card span2">
            <h3>
              {filtered.length} shocks (sorted by severity) — click to open investigation
            </h3>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Sev</th>
                    <th>Date</th>
                    <th>Market</th>
                    <th>State</th>
                    <th>Method</th>
                    <th>Dir</th>
                    <th>z</th>
                    <th>Change</th>
                    <th>Observed</th>
                    <th>Baseline</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 400).map((s) => (
                    <tr key={s.id} className={selectedShock?.id === s.id ? 'active' : ''} onClick={() => selectShock(s)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && selectShock(s)}>
                      <td>
                        <span className="sev" style={{ background: SEVERITY_COLORS[s.severity] }} /> {s.severity}
                      </td>
                      <td className="mono">{s.obs_date}</td>
                      <td>
                        {s.market_name} <span className="muted">({s.district})</span>
                      </td>
                      <td>{s.state}</td>
                      <td className="mono">{s.method}</td>
                      <td>{s.direction === 'up' ? '▲' : '▼'}</td>
                      <td className="mono">{s.score.toFixed(1)}</td>
                      <td className="mono">{s.pct_change != null ? `${s.pct_change > 0 ? '+' : ''}${s.pct_change.toFixed(0)}%` : '—'}</td>
                      <td className="mono">₹{s.observed}</td>
                      <td className="mono">{s.baseline != null ? `₹${Math.round(s.baseline)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
