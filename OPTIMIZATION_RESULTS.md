# Transport optimizer results (`analytics/transport.py`)

`optimize_transport(problem) -> dict` is a single-commodity, single-period min-cost transportation solver built on `networkx.min_cost_flow`. Surplus supply drains to a zero-cost sink.

- **Units:** integers only. Quantities are kg, `cost_cents_per_kg` is INR cents/kg, `total_cost_cents` is INR cents, and travel times are minutes.
- **Statuses:**
  - `optimal`: a solution was found and passed the post-solve check.
  - `invalid`: the input was rejected. The result carries `errors` and the solver never raises.
  - `infeasible`: no solution exists. The result carries an `explanation`.
  - `error`: the independent post-solve check failed.
- **Fields in every result:**
  - `excluded_routes`: lanes over `max_travel_time_minutes`, each with a reason.
  - `greedy_baseline`: the cheapest-edge-first comparator.
  - `savings_vs_greedy_cents`
  - `feasibility_check`
  - `provenance`
  - `verified`: true only if every supply, demand and route is `verified`.
  - `unsupported_constraints`
- **Output safety:** output is JSON-safe with `allow_nan=False`.

## Fixtures: hand-calculated optimum vs solver output

| Fixture | Hand-calculated expectation | Solver | Greedy |
|---|---|---|---|
| Base 2x2 (A,B=5 kg → X,Y=5 kg; costs AX1 AY2 BX2 BY100) | Cost = 20 + 97·(AX kg), so AX=0: AY5 + BX5 = **20** | 20, AY5 BX5 | 505 (it takes AX=1 first, which forces BY=100) |
| Capacity forces costlier lane (A→X cap 4 @3, B→X @7; X=10) | 4·3 + 6·7 = **54** | 54, AX4 BX6 | 54 |
| Surplus supply (X=3) | 3·3 = **9**; unshipped A7, B10 | 9 | n/a |
| Infeasible supply (X=25 > 20) | infeasible, shortfall 5 kg | infeasible: "total supply 20 kg is below total demand 25 kg; shortfall 5 kg" | n/a |
| Insufficient capacity (X=15, lanes 4+10) | infeasible | infeasible: capacity 14 < 15 | n/a |
| Deadline exclusion (max 60 min drops B→X at 90 min) | infeasible: only 4 kg of capacity is left | infeasible, B→X listed in `excluded_routes` | n/a |
| Deadline exclusion, still feasible (B→Y at 61 > 60 min) | **20** | 20, B→Y excluded | n/a |
| No route (demand Y has no lane) | infeasible | infeasible: "demand 'Y' (1 kg) has no usable route" | n/a |
| Ties (all costs 4) | Every plan costs **40** | 40, identical across 25 shuffled-input runs: AX5 BY5 | 40 |
| Hand 3x3 (supplies P30 Q25 R45; demands U40 V35 W25; costs PU8 PV6 PW10 / QU9 QV12 QW13 / RU14 RV9 RW17) | PU5 PW25 QU25 RU10 RV35 = 40+250+225+140+315 = **970**. MODI u=(0,1,6), v=(8,3,10); reduced costs PV3 QV8 QW2 RW1 are all >0, so the optimum is unique. | 970, the same 5 shipments | 1085 (saving 115) |
| Invalid inputs (floats, bools, negatives, NaN/inf, strings, zero total demand, missing/bad provenance, commodity mismatch, unknown endpoints, duplicates) | `invalid` with errors, no exception | `invalid` | n/a |
| Post-solve check (monkeypatched corrupt flows: supply overrun, demand short, capacity overrun, negative flow, wrong objective) | `error` | `error` | n/a |

The corrupted flows in the post-solve check row are injected by the tests. The real solver did not produce them.

A seeded fuzz run of 5,000 mutated problems gave 4,590 `invalid`, 113 `infeasible` and 297 `optimal`. There were no exceptions and every result was JSON-safe. This was an ad-hoc check and is not part of the test suite.

## Explicit limitations (NOT modeled)
- **Fixed truck costs.** Cost is linear per kg, so there are no per-trip or per-vehicle charges.
- **Integer vehicle selection.** The solver does not choose truck counts or sizes. Flow is integer kg, not vehicles.
- **Capital limits.** No working-capital or budget caps are applied.
- **Storage.** There is no warehousing, holding cost or multi-period inventory.
- **Spoilage.** No perishability loss is modeled.
- **Single commodity and single period.** Every supply, demand and route in a problem must share one commodity. Travel time acts only as a hard per-route cutoff.
- **Tie-breaking.** When several plans have the same optimal cost, the choice among them is deterministic but arbitrary. It does not express a business preference.
- **Provenance.** Fixtures are `assumed` or `verified` test data, not market-verified AGRINET data.
