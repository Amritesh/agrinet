import { useEffect, useMemo, useState } from 'react'
import { archiveMonths, loadLabDataset, loadMonthArchive, sortFindings, type LabDataset, type LabFinding, type MonthArchive } from '../lib/monthLabData'
import { loadCatalog, monthLabel, productList, storyUrl, inr, type Catalog } from '../lib/stories'
import './MonthLab.css'

const BASE = import.meta.env.BASE_URL
const params = new URLSearchParams(location.search)
const initialProduct = params.get('product') ?? ''
const initialMonth = params.get('month') ?? ''
const money = (n: number) => inr(n)
type Sort = 'surprise' | 'margin' | 'resilience'

export default function MonthLab() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [archive, setArchive] = useState<MonthArchive | null>(null)
  const [product, setProduct] = useState(initialProduct)
  const [month, setMonth] = useState(initialMonth)
  const [query, setQuery] = useState('')
  const [dataset, setDataset] = useState<LabDataset | null>(null)
  const [loadedFor, setLoadedFor] = useState('')
  const [retry, setRetry] = useState(0)
  const [selected, setSelected] = useState('')
  const [sort, setSort] = useState<Sort>('surprise')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { Promise.all([loadCatalog(), loadMonthArchive()]).then(([c, a]) => { setArchive(a); setCatalog(c) }).catch((e) => { setError(String(e)); setLoading(false) }) }, [])
  const products = useMemo(() => catalog ? [...new Map([...productList(catalog), ...Object.entries(archive?.products ?? {}).map(([slug, p]) => ({ slug, name: p.name, stories: catalog.products?.[slug]?.stories ?? 0 }))].map((p) => [p.slug, p] as const)).values()].sort((a, b) => a.name.localeCompare(b.name)) : [], [catalog, archive])
  const months = useMemo(() => catalog ? archiveMonths(catalog, archive, product) : [], [catalog, archive, product])
  const filtered = useMemo(() => products.filter((p) => `${p.name} ${p.slug}`.toLowerCase().includes(query.trim().toLowerCase())), [products, query])
  useEffect(() => {
    if (!catalog || !products.length) return
    if (!products.some((p) => p.slug === product)) { setProduct(products.find((p) => p.stories > 0)?.slug ?? products[0].slug); return }
    if (!months.includes(month)) setMonth(Object.keys(catalog.commodities[product]?.months ?? {}).sort().reverse()[0] ?? months[0] ?? '')
  }, [catalog, products, product, months, month])
  useEffect(() => {
    if (!catalog || !product || !month || !months.includes(month)) return
    let active = true
    setLoading(true); setError(''); setSelected(''); setDataset(null); setLoadedFor('')
    loadLabDataset(catalog, product, month, archive).then((result) => { if (active) { setDataset(result); setLoadedFor(`${product}:${month}`); setLoading(false) } }).catch((e) => { if (active) { setError(String(e)); setLoading(false) } })
    return () => { active = false }
  }, [catalog, archive, product, month, months, retry])
  useEffect(() => {
    if (!catalog || !product || !month) return
    const u = new URL(location.href); u.searchParams.set('mode', 'lab'); u.searchParams.set('product', product); u.searchParams.set('month', month)
    history.replaceState(null, '', u)
  }, [catalog, product, month])
  const current = loadedFor === `${product}:${month}` ? dataset : null
  const findings = useMemo(() => sortFindings(current?.findings ?? [], sort), [current, sort])
  const active = findings.find((o) => o.key === selected) ?? findings[0]
  const name = products.find((p) => p.slug === product)?.name ?? product.replaceAll('_', ' ')
  const indexed = products.find((p) => p.slug === product)?.stories ?? 0
  const observedMonths = archive?.products[product]?.months ?? Object.keys(catalog?.commodities[product]?.months ?? {})
  const zeroReason = current?.status === 'unsupported_product' ? 'This product has retained observations but no calibrated cost model for this screen.' : current?.status === 'unsupported_cost_period' ? 'Observed prices exist, but this period has no supported cost model.' : current?.status === 'no_source_observations' ? 'No source observations were available for this month.' : `Among ${current?.corridors ?? 0} ${current?.source === 'retained' ? 'retained story corridors' : 'cached road pairs'}, none qualified as a positive modeled buy-day result.`
  return <main className="ml">
    <header className="ml-head"><a href={BASE} className="ml-brand">AGRINET <span>/ PAST MARKET GAPS</span></a><a href={BASE} className="ml-back">← More market stories</a></header>
    <section className="ml-hero">
      <div className="ml-eyebrow">A LOOK BACK AT INDIA'S MANDI PRICES</div>
      <h1>Where was it cheaper? <em>Where was it dearer?</em></h1>
      <p>Pick a crop and a month. See where someone might have bought it, where they might have sold it later, and what the price gap looked like after estimated costs. These are past price records, <strong>not proven trades or profits.</strong></p>
      <div className="ml-how" aria-label="How to use this page"><span><b>1</b> Choose a crop</span><span><b>2</b> Choose a month</span><span><b>3</b> Follow the buy → travel → sell story</span></div>
      <div className="ml-controls">
        <div className="ml-product-control"><label htmlFor="ml-search">1 / WHICH CROP? <span>{products.length} crops</span></label><input id="ml-search" type="search" placeholder="Type a crop name, e.g. tomato" value={query} onChange={(e) => setQuery(e.target.value)} /><select aria-label="Crop" size={Math.min(5, Math.max(2, filtered.length))} value={filtered.some((p) => p.slug === product) ? product : ''} onChange={(e) => { setProduct(e.target.value); setQuery('') }}>{filtered.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select>{!filtered.length && <small>No matching crops. Try a different name.</small>}</div>
        <label className="ml-month-control" htmlFor="ml-month">2 / WHEN?<select id="ml-month" aria-label="Historical month" value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}{observedMonths.includes(m) ? '' : ' · no product observations indexed'}</option>)}</select><small>{observedMonths.length ? `${observedMonths.length} month${observedMonths.length === 1 ? '' : 's'} of price records for ${name}` : `No recorded months for ${name}`}. {indexed ? `${indexed} detailed stories` : 'No detailed stories yet'}.</small></label>
      </div>
      {catalog && <div className="ml-provenance">Past mandi prices from the AGMARKNET-backed archive · Latest observation {archive?.latest_observation ?? catalog.latest_observation} · Static archive, not live quotes</div>}
    </section>
    {error ? <div className="ml-empty" role="alert">Could not load this selection: {error} <button onClick={() => setRetry((n) => n + 1)}>Retry</button></div> : loading || !catalog || !current ? <div className="ml-empty" role="status">Looking through the archive…</div> : <>
      <section className="ml-overview" aria-label="Month results"><div><strong>{name}</strong><span>{monthLabel(month)}</span></div><div><strong>{current.covered ? findings.length : '—'}</strong><span>past price-gap examples</span></div><div><strong>{current.covered ? current.corridors : '—'}</strong><span>market routes checked</span></div></section>
      {!current.covered ? <div className="ml-empty"><strong>No month screening available for {name}.</strong><p>{monthLabel(month)} has no retained Month Lab screen or story corridor in this archive. This is a coverage gap, not evidence that no trade existed or could have worked. Try another month or product.</p></div> : findings.length ? <><div className="ml-workspace">
        <section className="ml-results" aria-label="Detected opportunities"><div className="ml-section-head"><div><div className="ml-eyebrow">3 / EXPLORE THE PAST · {monthLabel(month)}</div><h2>Buy here, sell there?</h2></div><label className="ml-sort">SORT BY<select aria-label="Rank opportunities" value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="surprise">Most unusual gap</option><option value="margin">Biggest estimated leftover</option><option value="resilience">With higher costs</option></select></label></div><p className="ml-hint">Tap a route to see the dates, prices and estimated travel costs. These are selected historical examples, not every possible market pair. “Unusual” compares only similar examples in this archive; it cannot predict future prices.</p><div className="ml-list">{findings.map((o, i) => <button key={o.key} className={`ml-result ${o.key === active?.key ? 'is-active' : ''}`} onClick={() => setSelected(o.key)} aria-pressed={o.key === active?.key}><span className="ml-rank">{String(i + 1).padStart(2, '0')}</span><span className="ml-result-main"><strong>{o.source.name}, {o.source.state} → {o.destination.name}, {o.destination.state}</strong><small>{name} · Buy {o.day} → later price {o.sellDay}</small></span><span className="ml-result-value">{money(o.net)}<small>estimated left / quintal</small></span></button>)}</div></section>
        {active && <TradeJourney opportunity={active} />}
      </div>{current.chains.length > 0 && <section className="ml-chains" aria-label="Sequential scenario"><div className="ml-eyebrow">EXTRA: CONNECTED ROUTES · SELECTED WITH HINDSIGHT</div><h2>What if you repeated the trip?</h2><p>For the same variety and grade, this model joins routes when the next purchase is at the previous destination at least seven days after the sale. It picks the best sequence after seeing the past prices. It does not check starting cash, truck capacity or whether anyone could complete these trades; totals are not real earnings.</p>{current.chains.map((chain) => <div className="ml-chain-card" key={chain.key}><strong>{chain.variety} · {chain.grade} · {chain.legs.length} {chain.legs.length === 1 ? 'step' : 'steps'}</strong><ol>{chain.legs.map((leg) => <li key={leg.key}>{leg.day} {leg.source.name} → {leg.sellDay} {leg.destination.name} <span>{money(leg.net)} estimated/100 kg</span></li>)}</ol><small>Hindsight sum: {money(chain.modeledNet)} per initial quintal · neither realized profit nor an executable return. No repositioning, overlapping trades or compounding; initial capital and cash feasibility are not modeled.</small></div>)}</section>}</> : <div className="ml-empty"><strong>No qualifying modeled {current.source === 'screen' ? 'candidate' : 'trade day'} in this screen.</strong><p>{zeroReason} This does not mean no real-world trade was possible.</p></div>}
    </>}
    <footer className="ml-foot">Historical exploration, not trading advice. Mandi prices, modeled costs and later sale observations are not synchronized executable bids. Actual capacity, spoilage, brokerage and trade execution are unverified. <a href={BASE}>Explore stories →</a></footer>
  </main>
}

function TradeJourney({ opportunity: o }: { opportunity: LabFinding }) {
  return <section className="ml-detail" aria-label="Trade chain"><div className="ml-eyebrow">THE {o.day} EXAMPLE</div><h2>Buy. Move.<br/><em>Sell later?</em></h2><p className="ml-detail-intro">Imagine buying one quintal (100 kg). Here is what the old price records and estimated costs suggest. Nobody knew the later selling price at the time.</p>
    <div className="ml-chain"><div className="ml-step"><span>01 / OBSERVED BUY</span><strong>{o.source.name}, {o.source.state}</strong><small>{o.day} · {money(o.buy)} / quintal</small><p>Recorded source mandi price; not a guaranteed offer.</p></div><div className="ml-connector">↓</div><div className="ml-step"><span>02 / MODELED MOVE & COSTS</span><strong>{o.routeKm != null ? `${Math.round(o.routeKm)} km modeled route` : 'Modeled transfer'}</strong><small>{money(o.costs)} / quintal estimated deduction</small><p>Freight, handling, fees, loss and other modeled charges. No shipment is verified.</p></div><div className="ml-connector">↓</div><div className="ml-step"><span>03 / LATER OBSERVED PRICE</span><strong>{o.destination.name}, {o.destination.state}</strong><small>{o.sellDay} · {money(o.sell)} / quintal</small><p>Later observed destination price, not a locked-in sale.</p></div></div>
    <div className="ml-math"><div><span>DIFFERENCE IN OLD PRICES</span><strong>{money(o.gross)}</strong></div><span className="ml-minus">−</span><div><span>ESTIMATED COSTS</span><strong>{money(o.costs)}</strong></div><span className="ml-minus">=</span><div className="ml-total"><span>ESTIMATED LEFT / 100 KG</span><strong>{money(o.net)}</strong></div></div>
    <p className="ml-warning">This is a model, not money anyone is known to have earned. Truck access, real offers and a completed sale were not verified.</p>
    <div className="ml-stress">Adverse-cost scenario: <strong>{money(o.stress)} / quintal</strong>{o.stress <= 0 ? ' · the modeled margin disappears under stress.' : ' · still positive in the model.'}</div>
    <details className="ml-method"><summary>What went into this estimate?</summary><p>{o.observations} {o.caveats.join(' ')}</p><ul>{o.assumptions.map((a, i) => <li key={i}><strong>{a.item}</strong>: {a.value}{a.source ? ` · ${a.source}` : ''}</li>)}</ul><p>Difference from the corridor-month median modeled margin: {money(o.surprise)} / quintal. This does not imply an executable opportunity.</p></details>
    {o.storyId && <a className="ml-story-link" href={storyUrl(BASE, o.storyId)}>Open the full evidence story ↗</a>}
  </section>
}
