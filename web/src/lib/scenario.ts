import { calculateEconomics, KG_PER_QUINTAL, type EconomicsInputs, type EconomicsResult } from './economics'

export const SCHEMA_VERSION = 'agrinet.scenario/1'
export const DATA_CUTOFF = '2026-04-20'
export const SCENARIO_DISCLAIMER = 'Modeled scenario — not a verified trade, quotation or forecast.'

export type PriceUnit = 'kg' | 'quintal'
export type QuantityUnit = 'kg' | 't'
export type VehicleId = '9t' | '16t' | '25t' | 'custom'

export const VEHICLE_PRESETS: { id: Exclude<VehicleId, 'custom'>; label: string; capacityKg: number }[] = [
  { id: '9t', label: '9 t payload', capacityKg: 9000 },
  { id: '16t', label: '16 t payload', capacityKg: 16000 },
  { id: '25t', label: '25 t payload', capacityKg: 25000 },
]

export interface SensitivityDeltas {
  /** ± % applied to expected sale price. */
  salePricePercent: number
  /** ± percentage points applied to loss. */
  lossPoints: number
  /** ± % applied to freight. */
  freightPercent: number
}

/** Raw user inputs. `null` means "not entered". Prices are in `priceUnit`. */
export interface ScenarioState {
  priceUnit: PriceUnit
  purchasePrice: number | null
  salePrice: number | null
  quantity: number | null
  quantityUnit: QuantityUnit
  vehicle: VehicleId
  customCapacityKg: number | null
  lossPercent: number | null
  freight: number | null
  freightRatePerKm: number | null
  handling: number | null
  storage: number | null
  fees: number | null
  annualInterestPercent: number | null
  financingDays: number | null
  sensitivity: SensitivityDeltas
}

export interface ScenarioRoutePoint {
  marketId: number
  label: string
  lat: number
  lon: number
  precision: string
  evidence: string
}

export interface ScenarioRoute {
  origin: ScenarioRoutePoint
  destination: ScenarioRoutePoint
  distanceKm: number
  durationHours: number
  provider: string
  profile: string
  requestedAt: string
  warnings: string[]
}

export const DEFAULT_SCENARIO: ScenarioState = {
  priceUnit: 'kg',
  purchasePrice: null,
  salePrice: null,
  quantity: null,
  quantityUnit: 't',
  vehicle: '16t',
  customCapacityKg: null,
  lossPercent: 5,
  freight: null,
  freightRatePerKm: null,
  handling: 0,
  storage: 0,
  fees: 0,
  annualInterestPercent: 0,
  financingDays: 0,
  sensitivity: { salePricePercent: 10, lossPoints: 2, freightPercent: 15 },
}

export type FieldErrors = Partial<Record<keyof ScenarioState, string>>

export function capacityKgOf(state: ScenarioState): number | null {
  if (state.vehicle === 'custom') return state.customCapacityKg
  return VEHICLE_PRESETS.find(v => v.id === state.vehicle)?.capacityKg ?? null
}

export function quantityKgOf(state: ScenarioState): number | null {
  if (state.quantity === null) return null
  return state.quantityUnit === 't' ? state.quantity * 1000 : state.quantity
}

export function pricePerKg(value: number | null, unit: PriceUnit): number | null {
  if (value === null) return null
  return unit === 'quintal' ? value / KG_PER_QUINTAL : value
}

/** User INR/km rate × routed road distance. Only a rough estimate; never a quotation. */
export function freightEstimate(ratePerKm: number | null, distanceKm: number | null): number | null {
  if (ratePerKm === null || distanceKm === null || !Number.isFinite(ratePerKm) || !Number.isFinite(distanceKm) || ratePerKm < 0) return null
  return Math.round(ratePerKm * distanceKm)
}

/** Converts state to calculator units. Missing values become NaN so validation catches them. */
export function toEconomicsInputs(state: ScenarioState): EconomicsInputs {
  const n = (v: number | null) => (v === null ? NaN : v)
  return {
    purchasePrice: n(pricePerKg(state.purchasePrice, state.priceUnit)),
    salePrice: n(pricePerKg(state.salePrice, state.priceUnit)),
    quantityKg: n(quantityKgOf(state)),
    lossPercent: n(state.lossPercent),
    freight: n(state.freight),
    handling: n(state.handling),
    storage: n(state.storage),
    fees: n(state.fees),
    annualInterestPercent: n(state.annualInterestPercent),
    financingDays: n(state.financingDays),
    capacityKg: n(capacityKgOf(state)),
  }
}

const bad = (v: number | null) => v === null || !Number.isFinite(v) || v < 0

export function validateScenario(state: ScenarioState): FieldErrors {
  const e: FieldErrors = {}
  if (bad(state.purchasePrice)) e.purchasePrice = 'Enter a purchase price (0 or more).'
  if (bad(state.salePrice)) e.salePrice = 'Enter an expected sale price (0 or more).'
  const qty = quantityKgOf(state)
  const cap = capacityKgOf(state)
  if (bad(state.quantity) || !qty) e.quantity = 'Enter a quantity greater than zero.'
  if (state.vehicle === 'custom' && (bad(state.customCapacityKg) || !state.customCapacityKg)) e.customCapacityKg = 'Enter the vehicle payload capacity in kg.'
  else if (qty && cap && qty > cap) e.quantity = `Quantity ${qty.toLocaleString('en-IN')} kg exceeds the assumed vehicle capacity of ${cap.toLocaleString('en-IN')} kg.`
  if (bad(state.lossPercent)) e.lossPercent = 'Enter a loss % (0 or more).'
  else if ((state.lossPercent as number) >= 100) e.lossPercent = 'Loss must be below 100%.'
  if (bad(state.freight)) e.freight = 'Freight is a mandatory manual assumption — enter a value (0 if truly none).'
  if (bad(state.handling)) e.handling = 'Enter handling cost (0 if none).'
  if (bad(state.storage)) e.storage = 'Enter storage cost (0 if none).'
  if (bad(state.fees)) e.fees = 'Enter market fees (0 if none).'
  if (bad(state.annualInterestPercent)) e.annualInterestPercent = 'Enter an annual interest % (0 if none).'
  if (bad(state.financingDays)) e.financingDays = 'Enter financing days (0 if none).'
  return e
}

export type ScenarioRun =
  | { ok: true; inputs: EconomicsInputs; result: EconomicsResult }
  | { ok: false; errors: FieldErrors }

export function runScenario(state: ScenarioState): ScenarioRun {
  const errors = validateScenario(state)
  if (Object.keys(errors).length) return { ok: false, errors }
  const inputs = toEconomicsInputs(state)
  try {
    return { ok: true, inputs, result: calculateEconomics(inputs) }
  } catch (err) {
    return { ok: false, errors: { purchasePrice: err instanceof Error ? err.message : String(err) } }
  }
}

export interface SensitivityCase {
  id: 'optimistic' | 'baseline' | 'adverse'
  label: string
  inputs: EconomicsInputs
  result: EconomicsResult | null
}

/** Three what-if cases from user-set deltas. They are not probabilities or forecasts. */
export function sensitivityCases(state: ScenarioState): SensitivityCase[] {
  const run = runScenario(state)
  const base = toEconomicsInputs(state)
  const d = state.sensitivity
  const make = (id: SensitivityCase['id'], label: string, sign: -1 | 0 | 1): SensitivityCase => {
    const inputs: EconomicsInputs = {
      ...base,
      salePrice: base.salePrice * (1 + sign * d.salePricePercent / 100),
      lossPercent: Math.min(99.999, Math.max(0, base.lossPercent - sign * d.lossPoints)),
      freight: Math.max(0, base.freight * (1 - sign * d.freightPercent / 100)),
    }
    if (!run.ok) return { id, label, inputs, result: null }
    try { return { id, label, inputs, result: calculateEconomics(inputs) } } catch { return { id, label, inputs, result: null } }
  }
  return [make('optimistic', 'Optimistic', 1), make('baseline', 'Baseline', 0), make('adverse', 'Adverse', -1)]
}

export interface ScenarioExport {
  schemaVersion: typeof SCHEMA_VERSION
  kind: 'modeled-scenario'
  disclaimer: string
  dataCutoff: string
  exportedAt: string
  inputs: ScenarioState
  normalizedInputs: EconomicsInputs | null
  route: ScenarioRoute | null
  outputs: EconomicsResult | null
  validationErrors: FieldErrors
  sensitivity: { id: string; inputs: EconomicsInputs; margin: number | null }[]
}

export function buildExport(state: ScenarioState, route: ScenarioRoute | null, exportedAt = new Date().toISOString()): ScenarioExport {
  const run = runScenario(state)
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'modeled-scenario',
    disclaimer: SCENARIO_DISCLAIMER,
    dataCutoff: DATA_CUTOFF,
    exportedAt,
    inputs: state,
    normalizedInputs: run.ok ? run.inputs : null,
    route,
    outputs: run.ok ? run.result : null,
    validationErrors: run.ok ? {} : run.errors,
    sensitivity: sensitivityCases(state).map(c => ({ id: c.id, inputs: c.inputs, margin: c.result?.margin ?? null })),
  }
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  bytes.forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(token: string): string {
  const b64 = token.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))
}

export function encodeShare(state: ScenarioState, route: ScenarioRoute | null): string {
  return toBase64Url(JSON.stringify({ schemaVersion: SCHEMA_VERSION, inputs: state, route }))
}

const NUMERIC_FIELDS: (keyof ScenarioState)[] = ['purchasePrice', 'salePrice', 'quantity', 'customCapacityKg', 'lossPercent', 'freight', 'freightRatePerKm', 'handling', 'storage', 'fees', 'annualInterestPercent', 'financingDays']

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

export type DecodedShare = { ok: true; state: ScenarioState; route: ScenarioRoute | null } | { ok: false; error: string }

export function decodeShare(token: string): DecodedShare {
  let parsed: unknown
  try { parsed = JSON.parse(fromBase64Url(token)) } catch { return { ok: false, error: 'Shared scenario link is not readable.' } }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'Shared scenario is empty.' }
  const p = parsed as { schemaVersion?: unknown; inputs?: Record<string, unknown>; route?: unknown }
  if (p.schemaVersion !== SCHEMA_VERSION) return { ok: false, error: `Unsupported scenario schema ${String(p.schemaVersion)}.` }
  const inp = p.inputs
  if (!inp || typeof inp !== 'object') return { ok: false, error: 'Shared scenario has no inputs.' }
  for (const f of NUMERIC_FIELDS) {
    if (inp[f] !== null && inp[f] !== undefined && !isNum(inp[f])) return { ok: false, error: `Shared scenario field ${f} is not a number.` }
  }
  if (!['kg', 'quintal'].includes(inp.priceUnit as string) || !['kg', 't'].includes(inp.quantityUnit as string) || !['9t', '16t', '25t', 'custom'].includes(inp.vehicle as string)) {
    return { ok: false, error: 'Shared scenario has invalid units or vehicle.' }
  }
  const s = inp.sensitivity as Record<string, unknown> | undefined
  const sensitivity = s && isNum(s.salePricePercent) && isNum(s.lossPoints) && isNum(s.freightPercent)
    ? { salePricePercent: s.salePricePercent as number, lossPoints: s.lossPoints as number, freightPercent: s.freightPercent as number }
    : DEFAULT_SCENARIO.sensitivity
  const state = { ...DEFAULT_SCENARIO } as Record<string, unknown>
  for (const f of NUMERIC_FIELDS) state[f] = inp[f] ?? null
  state.priceUnit = inp.priceUnit
  state.quantityUnit = inp.quantityUnit
  state.vehicle = inp.vehicle
  state.sensitivity = sensitivity
  let route: ScenarioRoute | null = null
  const r = p.route as ScenarioRoute | null | undefined
  if (r && typeof r === 'object') {
    const pt = (x: ScenarioRoutePoint | undefined) => !!x && isNum(x.lat) && isNum(x.lon) && typeof x.evidence === 'string' && typeof x.label === 'string'
    if (!pt(r.origin) || !pt(r.destination) || !isNum(r.distanceKm) || !isNum(r.durationHours) || typeof r.provider !== 'string' || typeof r.requestedAt !== 'string') {
      return { ok: false, error: 'Shared scenario route metadata is invalid.' }
    }
    route = { ...r, warnings: Array.isArray(r.warnings) ? r.warnings.filter(w => typeof w === 'string') : [] }
  }
  return { ok: true, state: state as unknown as ScenarioState, route }
}
