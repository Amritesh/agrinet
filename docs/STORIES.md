# AGRINET 4.0 — Stories

The default home is now **Stories**: automatically generated, evidence-backed historical market investigations played on an India board map. **Explore** is a simplified map. The 3.0 workspaces (Market Atlas, Opportunity Lab, Network Optimizer, Simulation Studio, Shocks/News/Analytics) are unchanged and live under **Research tools** (`?mode=research`). Collaborate is a header and footer link.

## Modes and URLs (base path `/agrinet/`)
| URL | Opens |
|---|---|
| `/agrinet/` | Stories, the featured story |
| `/agrinet/?story=<id>` | that exact story, e.g. `onion-2023-02-gap-lasalgaon-azadpur` |
| `/agrinet/s/<id>/` | static share page with story-specific Open Graph tags and `og.png` (featured stories), forwards to `?story=` |
| `/agrinet/?mode=explore` | simplified map: commodity, date, mandi search, playback; no workspace tabs or layer panel |
| `/agrinet/?mode=research` | all 3.0 tools |
| old deep links `?c=…&v=map`, `?v=news|shocks|analytics`, `?s=…`, `#collaborate` | keep working (Explore or Research) |

## Regenerate (offline, deterministic)
```bash
uv run python -m pipeline.stories           # data/derived/*.parquet -> web/public/stories/{catalog.json,<commodity>/<year>.json}
cd web && node scripts/share-page.mjs        # featured share pages + PNG cards -> web/public/s/<id>/
```
The output is committed: CI does not hold the parquet files. The same inputs give byte-identical JSON. The engine version is `stories-1.0.0`, and `data_snapshot` is a hash of `coverage.json`.

## What the engine computes (`pipeline/stories.py`)
- **Identity:** an exact `(state, district, market)` join to `market_ids`. Sub-yards and renamed APMCs are never merged.
- **Price shock (Story A/E):** each market's monthly median modal price, with at least 5 reports in **both** months. The month-on-month change is computed only on markets present in both months. Its seasonal z-score is compared with the same calendar month in **prior years only** (at least 5 years), so there is no look-ahead. A story is published when |z| ≥ 2 and at least 20 markets report.
  - The spotlight market must have at least 10 reports in both months.
  - Verified-point markets are preferred over district centres.
  - The caption states that co-movement is not causation.
- **Price divide / hypothetical trader / trade that looked profitable (B/C/F):** three documented corridors: Lasalgaon→Azadpur (onion), Lasalgaon→Vashi (onion) and Agra→Vashi (potato).
  - A purchase on day *b* is matched to the first destination report on days *b*+transit to *b*+transit+2.
  - Costs go through the audited `analytics.economics.calculate_economics` (Decimal).
  - Every corridor story carries its full trade table; the gross median, waterfall and net are reproducible from it (an e2e test does this).
- **Two experiments, labelled:**
  - **Perfect-hindsight simulation:** an upper bound; it counts days that cleared modeled costs.
  - **Historically informed rule:** it ships only if the *latest destination report before the buy date* implies a positive modeled net. Outcomes are evaluated afterwards, so there is no future leakage (unit-tested).
- **Storage decision (D):** Agra potato, March buy vs October median.
  - Cold-storage rent is **not** in our cited evidence, so the story reports the remaining break-even storage budget after 7% shrink and 12%/yr interest, never a profit.
  - The "informed" decision uses only earlier seasons.
- **No feasible opportunity (G):** before 2021-01 there is no cited cost evidence. Those corridor stories show the gross gap only and say so (`gross_only`). The month selector falls back to the nearest month that has a story and labels the substitution; it never invents one.
- **Validation:** every number in a title, summary, caption or conclusion must resolve to a value in the story's `facts`, assumptions or sources. Every scene focus must have geography inside India, and every market must carry a precision label. The build fails otherwise.

## Cost evidence and assumptions (shown in every corridor story)
| Item | Value | Status |
|---|---|---|
| Freight Nashik→Delhi | ≈₹240/quintal | cited: RBI WPS (DEPR) 08/2024, survey TE 2021-22 |
| Freight on other routes | ₹240 × road km / 1,115 km | assumption |
| Mandi fee + commission | 1% + 4% of purchase | cited (RBI) |
| Loading/unloading | ₹9.02/quintal | cited (RBI) |
| Transit loss | 5% baseline, 10% adverse | assumption |
| Working capital | 12%/yr (14% adverse) for transit + 7 days | assumption |
| Adverse freight | +25% | assumption |
Cost scenarios apply only from 2021-01 to 2026-04, in nominal rupees and without inflation adjustment. **None of these is a freight quote.**

## Geography
- Corridor endpoints are geocoded points (Nominatim, `evidence/story_points_nominatim.json`).
- Routes are OSRM public demo, *car* profile, simplified with Douglas-Peucker at 0.004° (`evidence/story_routes_osrm.json`) and flagged `truck_suitable:false`.
- Shock-story markets use the existing geocodes. District and state centroids are labelled "approximate" on the map and in provenance.

## Output (current run)
- 580 stories: onion 391, potato 165, tomato 24. 51 yearly files (5.9 MB, loaded lazily per year) and a catalog of about 40 KB.
- By kind:
  - 65 shocks
  - 7 storage
  - 508 corridor-months:
    - 320 gross-only (before cost evidence)
    - 79 "looked profitable but wasn't"
    - 57 reverse gap
    - 20 fragile margin
    - 19 no gap
    - 13 survived modeled stress costs
- Featured (ranked by evidence, educational value and unusualness; not by profit):
  1. `onion-2023-02-gap-lasalgaon-azadpur`: a ₹358/qtl gap over 22 matched days becomes −₹7 on the typical day after modeled costs.
  2. `onion-2013-08-shock`: the median market rose 77.8% in a month, 6.1σ.
  3. `potato-2020-10-storage-agra`.

## Known limits (not hidden in the UI)
- The data is historical and ends 2026-04-20.
- Modal prices are aggregates, not offers. Varieties and grades can be mixed (mostly FAQ).
- Many market points are district or state centroids, and some identities collapse sub-yards.
- There are no freight quotes and no buyer or seller confirmations.
- OSRM routing is not truck-verified.
- The informed rule is a simple one-signal heuristic.
- Not yet built:
  - the time-expanded multi-market MILP (the 3.0 transport solver is still single-period and linear);
  - tomato corridors;
  - animated exports;
  - story-open/completion analytics events (Cloudflare Web Analytics page views only).
