# DATA_QUALITY — AGRINET retained data audit

Generated 2026-11-07 from local retained data, read-only. Reproduce:

```bash
caffeinate -dimsu uv run python pipeline/audit_v3.py > logs/audit_v3.json
uv run python -m pytest tests/test_audit_v3.py -q
```

All numbers below come from `logs/audit_v3.json` (DuckDB 2.0.0). Every check in `checks` is true.

## 1. Volume and dates (verified)
| Item | Value |
|---|---|
| Raw source rows (26 yearly Parquet files, manifest) | 9,234,851 |
| Kept after validation | 8,883,073 |
| Rejected: null price | 351,737 |
| Rejected: implausibly high | 17 |
| Rejected: fractional price became invalid after integer conversion | 24 |
| Normalized daily market × commodity rows | **8,460,842** (0 duplicate keys) |
| Market identities | **3,389** (33 states) |
| First / last observation | 2001-01-10 / **2026-04-20** |
| Static snapshots / per-market series | rows match daily table exactly (8,460,842) |

By commodity: Onion 2,833,967 rows / 2,927 markets; Potato 2,986,528 / 2,702; Tomato 2,640,347 / 2,785.

**Freshness:** latest observation is 2026-04-20, about 6.5 months before this audit. Nothing in AGRINET may be labeled a current price.

## 2. Product comparability
- Raw records keep `Variety` and `Grade`. 47 varieties and 14 grade labels occur since 2015.
- Grade `FAQ` covers 8,769,674 of 9,234,851 raw rows (95.0%). Other labels (Local, Medium, Non-FAQ, Large, Small, Grade A/B/C, Ref/Range grades) are rare and mutually inconsistent across markets.
- Public daily prices (`modal_price`) are the **median of variety modal prices** for a market-day. 359,993 market-days combine 2–12 raw rows. These aggregates are fine for exploration but **not** sufficient for commercial comparison.
- Opportunity evaluation must compare the same commodity + variety + grade, or record an explicit adjustment. Not yet implemented as a stored comparable table (`market_price_comparables` pending).
- No unit field exists in raw data; prices are INR/quintal by AGMARKNET convention. No arrival quantities are retained.

## 3. Location precision (the main blocker for routing)
| Source | Confidence | Markets | Distinct coordinates |
|---|---|---|---|
| OSM (Nominatim) district-validated | 90 | 437 | 436 |
| OSM near match | 70 | 9 | 9 |
| OSM state-validated only | 50 | 45 | 45 |
| District centroid fallback | 40 | 1,985 | **370** |
| State centroid fallback | 20 | 913 | **26** |

1,985 markets share only 370 district points, and 913 markets share 26 state points. A map dot is not a mandi gate.

**Rule enforced in code (`web/src/lib/routing.ts`):** district/state/unknown precision is rejected for routing. A route needs a verified point or a user-chosen representative point with written evidence, and the representative label stays visible.

## 4. Identity discontinuity (new finding)
Around Nov–Dec 2025 the source started reporting markets under new `... APMC` names, which created separate identities:

| Old identity | Last obs | New identity | Obs (first–last) |
|---|---|---|---|
| 1512 Lasalgaon | 2025-11-03 | 1513 Lasalgaon (Vinchur) APMC | 68 (2025-12-03 → 2026-04-17) |
| 1527 Pimpalgaon | 2025-11-03 | 1528 Pimpalgaon APMC | 43 |
| 1485 Vashi New Mumbai | 2025-11-04 | 1486 Vashi New Mumbai APMC | 24 |
| 1689 Azadpur | 2025-11-04 | 1690 Azadpur APMC | 36 |

Consequences: (a) the major onion markets have no observations between early Nov and early Dec 2025; (b) after Dec 2025 reporting is sparse (e.g. 68 days in about 4.5 months); (c) series charts for the old identity stop in Nov 2025. Linking these identities needs evidence (APMC sub-yard vs main yard; "Lasalgaon (Vinchur)" is plausibly a sub-yard, not the same market) and must not be merged automatically.

Name normalization also collapses sub-yards: e.g. `Pune`, `Pune (Khadiki)`, `Pune (Manjri)`, `Pune (Moshi)`, `Pune (Pimpri)` → one key `pune`. Six such collisions in Solan, five in Kangra/Pune. Sub-yard prices are combined into one identity today.

## 5. First corridor candidate (evidence only, not an opportunity)
| Pair (onion) | Time-aligned shared days | Span |
|---|---|---|
| Lasalgaon (1512) → Azadpur (1689) | 4,051 | 2005-04-12 → 2025-11-01 |
| Lasalgaon (1512) → Vashi New Mumbai (1485) | 3,250 | 2009-01-17 → 2025-11-03 |
| Pimpalgaon (1527) → Azadpur (1689) | 3,068 | 2005-04-11 → 2025-10-30 |

Chosen first slice: **Lasalgaon → Vashi New Mumbai** (shortest real road corridor, ~220 km, long aligned history).

Gaps that block anything beyond a modeled scenario:
- Both endpoints are **district centroids** (confidence 40). Routing requires an explicit representative point; it is not a loading address.
- Raw Lasalgaon onion is mostly variety `Other`/`Red`, Vashi mostly `Other`, all `FAQ`. Variety labels are source categories, not verified quality specs.
- Data ends Nov 2025 for these identities (Apr 2026 for the APMC identities, sparse).
- No arrivals, bids, offers, counterparties, freight quotes, market fee schedules, or loss measurements.

## 6. Not established
Shock signals are statistical, not confirmed events. No current price feed (data.gov.in probes timed out; see BLOCKERS.md). No surveyed market locations.

## 4.0 story-engine safeguards
- Exact (state, district, market) identity join; no sub-yard merging. Panel changes use only markets present in both months (≥5 reports each); seasonal z uses prior years only.
- Corridor trades match destination reports 1–3 days after transit; every published number is reproducible from the trade table embedded in the story JSON.
- Location precision is stated per market: `nominatim` = geocoded point; `nominatim_near`, `nominatim_state`, district/state centroids = approximate.
- The build fails if any caption number does not resolve to a computed fact or labelled assumption.
