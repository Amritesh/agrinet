import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import StoryBoard from './StoryBoard'
import { availableMonths, defaultStoryId, inr, loadCatalog, loadStory, monthLabel, pickForMonth, productList, sharePageUrl, storyUrl, tradeEvidence, type Catalog, type Scene, type Story, type Waterfall } from '../lib/stories'
import '../styles/stories.css'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const BASE = import.meta.env.BASE_URL
const KIND_LABEL: Record<string, string> = { shock: 'Price shock', corridor: 'Modeled trade', storage: 'Storage decision' }
const LEVEL_LABEL: Record<string, string> = { strong: 'Strong evidence', moderate: 'Moderate evidence', limited: 'Limited evidence' }

function sceneMs(s: Scene) {
  return Math.min(12000, 4200 + s.caption.length * 38)
}

export default function StoryHome() {
  const reducedMotion = useMemo(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [story, setStory] = useState<Story | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [shareMsg, setShareMsg] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const latest = useRef(0)
  const [want, setWant] = useState<{ c: string; ym: string } | null>(null)

  const open = useCallback(async (id: string, note: string | null = null, keepErr = false) => {
    const token = ++latest.current
    setLoading(true)
    const s = await loadStory(id)
    if (token !== latest.current) return true // a newer choice superseded this load
    setLoading(false)
    if (!s) { setErr(`Story “${id}” was not found. Showing another available story, if there is one.`); return false }
    setWant({ c: s.commodity, ym: s.period })
    setStory(s); setIdx(0); setPlaying(false); setNotice(note); if (!keepErr) setErr(null)
    history.replaceState(null, '', storyUrl(BASE, id))
    document.title = `${s.title} · ${monthLabel(s.period)} · AGRINET`
    return true
  }, [])

  useEffect(() => {
    let cancelled = false
    loadCatalog().then(async (c) => {
      if (cancelled) return
      setCatalog(c)
      const linked = new URLSearchParams(location.search).get('story')
      if (linked && (await open(linked))) return
      // Keep the "link not found" message visible while falling back to the featured story.
      const first = defaultStoryId(c)
      if (first) await open(first, null, Boolean(linked))
      else setLoading(false)
    }).catch((e) => { setLoading(false); setErr(`Stories failed to load (${e}).`) })
    return () => { cancelled = true }
  }, [open])

  useEffect(() => {
    document.body.classList.add('stories-body')
    return () => document.body.classList.remove('stories-body')
  }, [])

  const scene = story?.scenes[idx] ?? null
  const last = story ? idx >= story.scenes.length - 1 : true

  // Phones: the map is pinned at the top, so after a scene change bring the new caption
  // up to just below the map instead of leaving the reader mid-way through the old chart.
  const sceneRef = useRef<HTMLDivElement | null>(null)
  const seen = useRef<{ id: string; idx: number } | null>(null)
  useEffect(() => {
    if (!story) return
    const prev = seen.current
    seen.current = { id: story.id, idx }
    if (!prev || prev.id !== story.id || prev.idx === idx) return
    if (!matchMedia('(max-width: 900px) and (orientation: portrait)').matches) return
    const el = sceneRef.current, stage = document.querySelector('.st-stage')
    if (!el || !stage) return
    const top = el.getBoundingClientRect().top, below = stage.getBoundingClientRect().bottom
    if (top < below || top > innerHeight * 0.75) {
      window.scrollBy({ top: top - below - 8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    }
  }, [story, idx])

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current)
    if (!playing || !scene) return
    if (last) { setPlaying(false); return }
    timer.current = window.setTimeout(() => setIdx((i) => i + 1), sceneMs(scene))
    return () => { if (timer.current) window.clearTimeout(timer.current) }
  }, [playing, scene, last])

  const products = useMemo(() => (catalog ? productList(catalog) : []), [catalog])
  const commodity = want?.c ?? story?.commodity ?? products[0]?.slug ?? ''
  const month = want?.ym ?? story?.period ?? (catalog && commodity ? availableMonths(catalog, commodity).at(-1) : null) ?? '2023-02'
  const productName = (slug: string) => products.find((p) => p.slug === slug)?.name ?? slug
  const years = useMemo(() => {
    const ms = catalog ? availableMonths(catalog, commodity).length ? availableMonths(catalog, commodity) : Object.values(catalog.commodities).flatMap((v) => Object.keys(v.months)) : []
    return [...new Set(ms.map((m) => m.slice(0, 4)))].sort()
  }, [catalog, commodity])
  const evidence = story ? tradeEvidence(story) : null

  const choose = (c: string, ym: string) => {
    if (!catalog) return
    const pick = pickForMonth(catalog, c, ym)
    setWant({ c, ym })
    const n = productName(c)
    if (!pick) {
      ++latest.current
      setStory(null); setPlaying(false); setNotice(null); setErr(null); setLoading(false)
      history.replaceState(null, '', BASE)
      document.title = `${n} trade stories · AGRINET`
      return
    }
    open(pick.id, pick.substituted ? `No ${n} trade story for ${monthLabel(ym)}. Showing the nearest available month: ${monthLabel(pick.month)}.` : null)
  }

  const share = async () => {
    if (!story) return
    const hasPage = !!catalog?.featured.some((f) => f.id === story.id) || !!catalog?.pages?.includes(story.id)
    const url = sharePageUrl(location.origin, BASE, story.id, !!hasPage)
    const text = `${story.title} — ${monthLabel(story.period)} (historical data, AGRINET)`
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ title: story.title, text, url }); return }
      await navigator.clipboard.writeText(url)
      setShareMsg('Link copied')
    } catch { setShareMsg(url) }
    window.setTimeout(() => setShareMsg(null), 4000)
  }

  return (
    <div className="stories-app">
      <a href="#story-panel" className="skip">Skip to story</a>
      <header className="st-top">
        <div className="st-brand">
          <span className="st-mark" aria-hidden="true">◈</span>
          <div><div className="st-name">AGRINET</div><div className="st-tag">India’s agricultural economy, brought to life</div></div>
        </div>
        <nav className="st-pick" aria-label="Choose a story">
          <a className="st-lab-link" href={`${BASE}?mode=lab&product=${encodeURIComponent(commodity)}&month=${encodeURIComponent(month)}`}>✦ Open Month Lab</a>
          <label className="st-sel st-prod"><span className="sr">Product</span>
            <select aria-label="Product" value={commodity} onChange={(e) => choose(e.target.value, month)}>
              {products.map((p) => <option key={p.slug} value={p.slug}>{p.name} ({p.stories})</option>)}
            </select>
          </label>
          <label className="st-sel"><span className="sr">Month</span>
            <select aria-label="Month" value={month.slice(5, 7)} onChange={(e) => choose(commodity, `${month.slice(0, 4)}-${e.target.value}`)}>
              {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
            </select>
          </label>
          <label className="st-sel"><span className="sr">Year</span>
            <select aria-label="Year" value={month.slice(0, 4)} onChange={(e) => choose(commodity, `${e.target.value}-${month.slice(5, 7)}`)}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
        </nav>
      </header>
      <div className="st-overview">
        <div><strong>Trade stories, not trade tips.</strong> Historical routes screened for positive modeled margins after costs.</div>
        {catalog && <div className="st-coverage"><strong>{catalog.story_count.toLocaleString('en-IN')}</strong> qualifying stories · <strong>{products.length.toLocaleString('en-IN')}</strong> products indexed{commodity && <> · {productName(commodity)}: <strong>{products.find((p) => p.slug === commodity)?.stories ?? 0}</strong></>}</div>}
      </div>
      <div className="st-age" role="note">Historical modeled margin, not verified profit · mandi modal prices are not offers · no shipments or freight quotes verified{catalog?.latest_observation ? ` · latest observation ${new Date(catalog.latest_observation + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</div>

      <main className="st-main">
        <section className="st-stage" aria-label="Story map">
          <StoryBoard story={story} scene={scene} reducedMotion={reducedMotion} />
        </section>
        <aside id="story-panel" className="st-panel" aria-live="polite">
          {err && <div className="st-note bad">{err}</div>}
          {notice && <div className="st-note">{notice}</div>}
          {!story && !err && loading && <div className="st-loading">Loading trade stories…</div>}
          {!story && !loading && catalog && <div className="st-empty"><h1>No trade story available</h1><p>{commodity ? `No candidate for ${productName(commodity)} cleared the available-data checks and modeled costs within this run's route budget.` : 'No qualifying historical trades are in this catalog yet.'} This does not mean a trade cannot be profitable.</p><p>Choose another product to see available stories.</p></div>}
          {story && scene && (
            <>
              <div className="st-meta">
                <span className={`st-chip k-${story.kind}`}>{story.verdict === 'positive_modeled_surplus' || story.verdict === 'profitable' ? 'Modeled positive margin' : KIND_LABEL[story.kind]}</span>
                <span className="st-chip st-when">{monthLabel(story.period)}</span>
                <span className={`st-chip lvl-${story.evidence.level}`}>{LEVEL_LABEL[story.evidence.level] ?? story.evidence.level}</span>
              </div>
              <h1 className="st-title">{story.title}</h1>
              {evidence && <div className="st-evidence" aria-label="Historical trade evidence">
                <div><span>Typical day after costs</span><strong>{inr(evidence.typicalMargin)}/qtl</strong></div>
                <div><span>Under adverse costs</span><strong>{inr(evidence.stressMargin)}/qtl</strong></div>
                <div><span>Informed-rule average</span><strong>{inr(evidence.informedMargin)}/qtl</strong></div>
                <p>{evidence.matchedDays} matched days · {evidence.payingPct}% of days positive · {evidence.informedShipDays} days selected by the historical rule · {evidence.checkedPairs.toLocaleString('en-IN')} same-variety pairs screened. Modeled outcomes, not realized trades.</p>
              </div>}
              {idx === 0 && <p className="st-why">{story.why_selected}</p>}
              <ol className="st-dots" aria-label="Scenes">
                {story.scenes.map((s, i) => (
                  <li key={i}><button aria-label={`Scene ${i + 1}: ${s.headline}`} aria-current={i === idx ? 'step' : undefined} className={i <= idx ? 'on' : ''} onClick={() => { setIdx(i); setPlaying(false) }} /></li>
                ))}
              </ol>
              <div className="st-scene" key={`${story.id}-${idx}`} ref={sceneRef}>
                <div className="st-step">Scene {idx + 1} of {story.scenes.length}</div>
                <h2 className="st-headline">{scene.headline}</h2>
                <p className="st-caption">{scene.caption}</p>
                {scene.chart && <Chart story={story} scene={scene} />}
                {scene.kind === 'conclusion' && <Caveats story={story} />}
              </div>
              <div className="st-controls" role="group" aria-label="Story controls">
                {idx === 0 && !playing ? (
                  <button className="st-play" aria-label="Watch the story" onClick={() => setPlaying(true)}>▶ Watch<span className="st-long"> the story</span></button>
                ) : last && !playing ? (
                  <button className="st-play" aria-label="Replay" onClick={() => { setIdx(0); setPlaying(true) }}>↺ Replay</button>
                ) : (
                  <button className="st-play" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
                )}
                <button aria-label="Previous scene" onClick={() => { setIdx((i) => Math.max(0, i - 1)); setPlaying(false) }} disabled={idx === 0}>‹</button>
                <button aria-label="Next scene" onClick={() => { setIdx((i) => Math.min(story.scenes.length - 1, i + 1)); setPlaying(false) }} disabled={last}>›</button>
                <button aria-label="Skip to conclusion" onClick={() => { setIdx(story.scenes.length - 1); setPlaying(false) }} disabled={last}><span className="st-long">Skip </span>⇥</button>
                <button aria-label="Share this story" onClick={share}>Share</button>
              </div>
              {shareMsg && <div className="st-share-msg" role="status">{shareMsg}</div>}
              <details className="st-prov">
                <summary>Sources, assumptions and limits</summary>
                <Provenance story={story} />
              </details>
              {catalog && (
                <div className="st-more">
                  <div className="st-more-h">More stories</div>
                  {catalog.featured.filter((f) => f.id !== story.id).map((f) => (
                    <button key={f.id} onClick={() => open(f.id)}><span className="sm-k">{productName(f.commodity)} · {monthLabel(f.period)}</span>{f.title}</button>
                  ))}
                </div>
              )}
            </>
          )}
        </aside>
      </main>
      <footer className="st-foot">
        <span>AGRINET · independent research prototype · historical models, not verified profit</span>
        <nav aria-label="Other AGRINET pages"><a href={`${BASE}?mode=explore`}>Explore map</a><a href={`${BASE}?mode=research`}>Research tools</a><a href={`${BASE}?mode=research#collaborate`}>Collaborate</a></nav>
      </footer>
    </div>
  )
}

function Caveats({ story }: { story: Story }) {
  return <ul className="st-caveats">{story.evidence.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
}

function Provenance({ story }: { story: Story }) {
  return (
    <div className="prov">
      <p><b>Observations:</b> {story.evidence.observations}.</p>
      <p><b>Market locations:</b> {story.markets.slice(0, 4).map((m) => `${m.name} — ${m.precision}`).join('; ')}{story.markets.length > 4 ? `; plus ${story.markets.length - 4} more` : ''}.</p>
      {story.routes.map((r) => <p key={r.slug}><b>Route:</b> {r.km.toLocaleString('en-IN')} km, {r.provider} ({r.profile}), retrieved {r.requested.slice(0, 10)}. Car routing; not a verified truck route.</p>)}
      {story.assumptions.length > 0 && (
        <table className="prov-t"><tbody>
          {story.assumptions.map((a) => <tr key={a.item}><td>{a.item}</td><td>{a.value}</td><td className={`pk-${a.kind}`}>{a.kind === 'sourced' ? 'cited' : a.kind === 'missing' ? 'missing' : 'assumption'}</td></tr>)}
        </tbody></table>
      )}
      <p><b>Always true here:</b> historical, not current; modal prices are reported aggregates, not offers you could have traded; no freight quotes or buyer/seller confirmations exist in this data; some market identities combine sub-yards.</p>
      <ul className="prov-src">{story.sources.map((s) => <li key={s.id}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title ?? s.id}</a> : s.title ?? s.id}{s.reference_period ? ` — ${s.reference_period}` : ''}</li>)}</ul>
      <p className="muted">Story {story.id} · engine {story.engine}</p>
    </div>
  )
}

function Chart({ story, scene }: { story: Story; scene: Scene }) {
  if (scene.chart === 'gap' && story.trades) return <GapChart story={story} />
  if (scene.chart === 'waterfall') return <WaterfallChart wf={(scene.kind === 'stress' ? story.facts.wf_adverse : story.facts.wf_base) as Waterfall} label={scene.kind === 'stress' ? 'Stress test' : 'Baseline'} />
  if (scene.chart === 'strategy' && story.trades) return <StrategyChart story={story} />
  if (scene.chart === 'storage') return <StorageChart story={story} scene={scene} />
  return null
}

function GapChart({ story }: { story: Story }) {
  const t = story.trades!
  const W = 320, H = 120, P = 22
  const ps = t.flatMap((x) => [x.buy_price, x.sell_price])
  const lo = Math.min(...ps) * 0.95, hi = Math.max(...ps) * 1.05
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(1, t.length - 1)
  const y = (v: number) => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P)
  const line = (k: 'buy_price' | 'sell_price') => t.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join('')
  const [o, d] = story.markets
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Daily prices: ${o.name} buy versus ${d.name} sale`}>
        <path d={`${line('sell_price')}${[...t].reverse().map((dd, i) => `L${x(t.length - 1 - i).toFixed(1)},${y(dd.buy_price).toFixed(1)}`).join('')}Z`} className="gap-fill" />
        <path d={line('buy_price')} className="ln-buy" /><path d={line('sell_price')} className="ln-sell" />
        <text x={P} y={12} className="ax">{inr(hi)}</text><text x={P} y={H - 4} className="ax">{t[0].buy.slice(5)} → {t[t.length - 1].buy.slice(5)}</text>
      </svg>
      <figcaption><span className="key buy" />{o.name} (buy day) <span className="key sell" />{d.name} (sale, after transit) · ₹ per quintal</figcaption>
    </figure>
  )
}

function WaterfallChart({ wf, label }: { wf: Waterfall; label: string }) {
  const rows: [string, number, string][] = [
    ['Sale price', wf.sell, 'pos'], ['Purchase', -wf.buy, 'neg'], ['Freight', -wf.freight, 'neg'], ['Fees + commission', -wf.fees, 'neg'],
    ['Loading', -wf.loading, 'neg'], ['Loss in transit', -wf.loss, 'neg'], ['Interest', -wf.interest, 'neg'],
  ]
  const max = wf.sell
  let run = wf.sell
  return (
    <figure className="chart wf">
      <div className="wf-h">{label} · typical day, bought {wf.buy_date}, sold {wf.sell_date} · per quintal</div>
      {rows.map(([k, v, cls], i) => {
        const start = i === 0 ? 0 : run + v, width = Math.abs(v)
        if (i > 0) run += v
        return (
          <div className="wf-row" key={k}>
            <span className="wf-k">{k}</span>
            <span className="wf-track"><span className={`wf-bar ${cls}`} style={{ left: `${(Math.max(0, start) / max) * 100}%`, width: `${(width / max) * 100}%` }} /></span>
            <span className="wf-v">{i === 0 ? inr(v) : `−${inr(Math.abs(v)).replace('−', '')}`}</span>
          </div>
        )
      })}
      <div className={`wf-row wf-net ${wf.net >= 0 ? 'good' : 'bad'}`}><span className="wf-k">Left after costs</span><span className="wf-track" /><span className="wf-v">{inr(wf.net)}</span></div>
    </figure>
  )
}

function StrategyChart({ story }: { story: Story }) {
  const t = story.trades!.filter((x) => x.net_baseline != null)
  const W = 320, H = 130, P = 10
  const m = Math.max(...t.map((x) => Math.abs(x.net_baseline!)), 1)
  const bw = (W - 2 * P) / t.length
  const y0 = H / 2
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Modeled net per day, with days a historically informed trader would have shipped marked">
        <line x1={P} x2={W - P} y1={y0} y2={y0} className="zero" />
        {t.map((d, i) => {
          const h = (Math.abs(d.net_baseline!) / m) * (H / 2 - 14)
          return (
            <g key={d.buy}>
              <rect x={P + i * bw + 1} width={Math.max(1, bw - 2)} y={d.net_baseline! >= 0 ? y0 - h : y0} height={h} className={d.net_baseline! >= 0 ? 'b-pos' : 'b-neg'} />
              {d.informed_ship && <circle cx={P + i * bw + bw / 2} cy={H - 5} r={3} className="ship" />}
            </g>
          )
        })}
      </svg>
      <figcaption><span className="key pos" />day paid after costs <span className="key neg" />day lost <span className="key ship" />shipped on the morning's report</figcaption>
    </figure>
  )
}

function StorageChart({ story, scene }: { story: Story; scene: Scene }) {
  const f = story.facts
  const showSell = scene.kind !== 'decision'
  const showBudget = scene.kind === 'costs'
  const max = Math.max(f.buy, f.sell)
  const bar = (label: string, v: number, cls: string) => (
    <div className="wf-row" key={label}><span className="wf-k">{label}</span><span className="wf-track"><span className={`wf-bar ${cls}`} style={{ left: 0, width: `${(Math.abs(v) / max) * 100}%` }} /></span><span className="wf-v">{inr(v)}</span></div>
  )
  return (
    <figure className="chart wf">
      <div className="wf-h">Agra monthly median · per quintal</div>
      {bar(`March ${f.year}`, f.buy, 'neg')}
      {showSell && bar(`October ${f.year}`, f.sell, 'pos')}
      {scene.kind === 'decision' && bar(`Past avg. change (${f.prior_years} yrs)`, f.prior_mean, f.prior_mean >= 0 ? 'pos' : 'neg')}
      {showBudget && <div className={`wf-row wf-net ${f.budget >= 0 ? 'good' : 'bad'}`}><span className="wf-k">Storage budget left</span><span className="wf-track" /><span className="wf-v">{inr(f.budget)}</span></div>}
    </figure>
  )
}
