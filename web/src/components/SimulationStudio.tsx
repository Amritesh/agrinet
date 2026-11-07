import { useMemo, useState } from 'react'
import {
  DATA_CUTOFF, VEHICLE_PRESETS, buildExport, encodeShare, freightEstimate, pricePerKg, runScenario, sensitivityCases,
  type FieldErrors, type ScenarioRoute, type ScenarioState,
} from '../lib/scenario'

const inr0 = (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const inrN = (v: number, d: number) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })}`
const pct = (v: number) => `${v.toFixed(2)}%`

interface Props {
  state: ScenarioState
  onChange: (s: ScenarioState) => void
  route: ScenarioRoute | null
  onClearRoute: () => void
  notice: string | null
}

type NumKey = { [K in keyof ScenarioState]: ScenarioState[K] extends number | null ? K : never }[keyof ScenarioState]

export default function SimulationStudio({ state, onChange, route, onClearRoute, notice }: Props) {
  const run = useMemo(() => runScenario(state), [state])
  const cases = useMemo(() => sensitivityCases(state), [state])
  const errors: FieldErrors = run.ok ? {} : run.errors
  const [shareUrl, setShareUrl] = useState('')
  const [freightFromRoute, setFreightFromRoute] = useState(false)

  const set = <K extends keyof ScenarioState>(k: K, v: ScenarioState[K]) => onChange({ ...state, [k]: v })
  const numOf = (raw: string) => (raw.trim() === '' ? null : Number(raw))

  const field = (k: NumKey, label: string, hint?: string, extra?: React.ReactNode) => {
    const id = `sc-${k}`
    const err = errors[k]
    return (
      <div className={`field ${err ? 'has-error' : ''}`}>
        <label htmlFor={id}>{label}</label>
        <input id={id} type="number" inputMode="decimal" min={0} step="any" value={state[k] ?? ''}
          aria-invalid={!!err} aria-describedby={err ? `${id}-err` : hint ? `${id}-hint` : undefined}
          onChange={(e) => { if (k === 'freight') setFreightFromRoute(false); set(k, numOf(e.target.value) as never) }} />
        {hint && <span id={`${id}-hint`} className="field-hint">{hint}</span>}
        {extra}
        {err && <span id={`${id}-err`} className="field-error">{err}</span>}
      </div>
    )
  }

  const conv = (v: number | null) => (state.priceUnit === 'quintal' && v !== null && Number.isFinite(v)
    ? <span className="field-hint conversion">{`= ${inrN(pricePerKg(v, 'quintal') as number, 2)}/kg`}</span> : null)

  const estimate = freightEstimate(state.freightRatePerKm, route?.distanceKm ?? null)
  const r = run.ok ? run.result : null
  const out = (id: string, label: string, value: string | null, note?: string) => (
    <div className="metric"><dt>{label}</dt><dd data-testid={id}>{value ?? '—'}</dd>{note && <span className="field-hint">{note}</span>}</div>
  )

  const download = () => {
    const doc = buildExport(state, route)
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `agrinet-scenario-${doc.exportedAt.slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <main id="main" className="workspace-page">
      <div className="eyebrow">HYPOTHETICAL LANDED COST</div>
      <h1>Simulation Studio</h1>
      <p className="workspace-lead">Every number here is your own assumption. Historical prices end on {DATA_CUTOFF}, and nothing on this page is a live price, bid or freight quotation.</p>
      <p><span className="badge modeled">Modeled scenario — not a verified trade</span></p>
      {notice && <p className="notice" role="status">{notice}</p>}

      <div className="studio-grid">
        <section className="workspace-card studio-inputs" aria-labelledby="inputs-h">
          <h2 id="inputs-h">Assumptions</h2>
          <div className="field">
            <label htmlFor="sc-priceUnit">Price unit</label>
            <select id="sc-priceUnit" value={state.priceUnit} onChange={(e) => set('priceUnit', e.target.value as ScenarioState['priceUnit'])}>
              <option value="kg">INR per kg</option>
              <option value="quintal">INR per quintal (100 kg)</option>
            </select>
          </div>
          <div className="field-row">
            {field('purchasePrice', 'Purchase price', `INR/${state.priceUnit === 'kg' ? 'kg' : 'quintal'}`, conv(state.purchasePrice))}
            {field('salePrice', 'Expected sale price', `INR/${state.priceUnit === 'kg' ? 'kg' : 'quintal'}`, conv(state.salePrice))}
          </div>
          <div className="field-row">
            {field('quantity', 'Quantity')}
            <div className="field">
              <label htmlFor="sc-quantityUnit">Quantity unit</label>
              <select id="sc-quantityUnit" value={state.quantityUnit} onChange={(e) => set('quantityUnit', e.target.value as ScenarioState['quantityUnit'])}>
                <option value="t">tonnes</option>
                <option value="kg">kg</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="sc-vehicle">Vehicle preset</label>
            <select id="sc-vehicle" value={state.vehicle} onChange={(e) => set('vehicle', e.target.value as ScenarioState['vehicle'])} aria-describedby="sc-vehicle-hint">
              {VEHICLE_PRESETS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              <option value="custom">Custom payload</option>
            </select>
            <span id="sc-vehicle-hint" className="field-hint">Assumed nominal payload, verify with operator.</span>
          </div>
          {state.vehicle === 'custom' && field('customCapacityKg', 'Custom payload (kg)')}
          {field('lossPercent', 'Loss %', 'Shrinkage, spoilage and grading loss.')}

          <fieldset className="freight-box">
            <legend>Freight</legend>
            {field('freight', 'Freight (INR)', 'Mandatory manual assumption for the whole load.')}
            {freightFromRoute && <p className="badge estimate">Estimate — not a quotation (rate × routed distance)</p>}
            {route ? (
              <div className="route-ref">
                <p>Route: {route.origin.label} → {route.destination.label} · <strong>{route.distanceKm.toFixed(1)} km road distance</strong> ({route.profile} profile, {route.provider}, requested {route.requestedAt.slice(0, 16).replace('T', ' ')} UTC)</p>
                <div className="field-row">
                  {field('freightRatePerKm', 'Freight rate (INR/km)', 'Your own rate assumption.')}
                  <button type="button" className="secondary-action" disabled={estimate === null} onClick={() => { set('freight', estimate); setFreightFromRoute(true) }}>
                    Pre-fill freight (rate × distance)
                  </button>
                </div>
                <p className="field-hint">Any pre-filled figure is an estimate — not a quotation. Confirm with a transporter.</p>
                <button type="button" className="link-action" onClick={onClearRoute}>Detach route</button>
              </div>
            ) : <p className="field-hint">Use the Network Optimizer corridor inspector to attach a routed road distance.</p>}
          </fieldset>

          <div className="field-row three">
            {field('handling', 'Handling (INR)')}
            {field('storage', 'Storage (INR)')}
            {field('fees', 'Market fees (INR)')}
          </div>
          <div className="field-row">
            {field('annualInterestPercent', 'Annual interest %', 'Simple interest, ACT/365.')}
            {field('financingDays', 'Financing days')}
          </div>
        </section>

        <section className="workspace-card studio-outputs" aria-labelledby="outputs-h">
          <h2 id="outputs-h">Modeled outputs <span className="badge modeled small-badge">Modeled</span></h2>
          {!run.ok && <p className="field-error" role="status">Fix the highlighted assumptions to see results.</p>}
          <dl className="metrics">
            {out('out-saleable', 'Saleable quantity', r ? `${r.saleableKg.toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg` : null)}
            {out('out-purchase', 'Purchase cost', r ? inr0(r.purchaseCost) : null)}
            {out('out-total', 'Total cost', r ? inr0(r.totalCost) : null, r && r.financingCost > 0 ? `incl. ${inr0(r.financingCost)} financing` : undefined)}
            {out('out-margin', 'Margin', r ? inr0(r.margin) : null)}
            {out('out-margin-kg', 'Margin per kg', r ? `${inrN(r.marginPerKg, 2)}/kg` : null, 'per kg purchased')}
            {out('out-margin-tonne', 'Margin per tonne', r ? `${inr0(r.marginPerTonne)}/t` : null)}
            {out('out-breakeven-kg', 'Break-even sale price', r ? `${inrN(r.breakEvenPrice, 4)}/kg` : null)}
            {out('out-breakeven-qtl', 'Break-even per quintal', r ? `${inrN(r.breakEvenPricePerQuintal, 2)}/qtl` : null)}
            {out('out-breakeven-freight', 'Break-even freight', r ? inr0(r.breakEvenFreight) : null, 'freight that zeroes margin')}
            {out('out-breakeven-loss', 'Break-even loss', r ? (r.breakEvenLossPercent === null ? 'n/a' : pct(r.breakEvenLossPercent)) : null)}
            {out('out-roi', 'Return on capital', r ? pct(r.roiPercent) : null, 'margin ÷ total cost')}
          </dl>

          <h3>Sensitivity</h3>
          <p className="field-hint">Three what-if cases from the deltas you set. They are not probabilities or forecasts.</p>
          <div className="field-row three">
            <DeltaInput label="Sale price ± %" value={state.sensitivity.salePricePercent} onChange={(v) => set('sensitivity', { ...state.sensitivity, salePricePercent: v })} />
            <DeltaInput label="Loss ± points" value={state.sensitivity.lossPoints} onChange={(v) => set('sensitivity', { ...state.sensitivity, lossPoints: v })} />
            <DeltaInput label="Freight ± %" value={state.sensitivity.freightPercent} onChange={(v) => set('sensitivity', { ...state.sensitivity, freightPercent: v })} />
          </div>
          <div className="table-scroll">
            <table className="sensitivity" aria-label="Sensitivity cases (not probabilities)">
              <thead><tr><th scope="col">Case</th><th scope="col">Sale ₹/kg</th><th scope="col">Loss %</th><th scope="col">Freight</th><th scope="col">Margin</th></tr></thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id} className={c.id}>
                    <th scope="row">{c.label}</th>
                    <td>{Number.isFinite(c.inputs.salePrice) ? c.inputs.salePrice.toFixed(2) : '—'}</td>
                    <td>{Number.isFinite(c.inputs.lossPercent) ? c.inputs.lossPercent.toFixed(1) : '—'}</td>
                    <td>{Number.isFinite(c.inputs.freight) ? inr0(c.inputs.freight) : '—'}</td>
                    <td>{c.result ? inr0(c.result.margin) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Reproduce</h3>
          <div className="actions">
            <button type="button" className="primary-action" onClick={download}>Download scenario JSON</button>
            <button type="button" className="secondary-action" onClick={() => setShareUrl(`${location.origin}${location.pathname}?s=${encodeShare(state, route)}`)}>Create share link</button>
          </div>
          {shareUrl && (
            <div className="field">
              <label htmlFor="sc-share">Share link</label>
              <input id="sc-share" readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
              <span className="field-hint">The link stores your assumptions and route metadata. It still describes a modeled scenario.</span>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function DeltaInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const id = `delta-${label.replace(/\W+/g, '-')}`
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" min={0} step="any" value={value} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) onChange(v) }} />
    </div>
  )
}
