# AGRINET — Trade stories

The default `/agrinet/` view is a story player, not a research workspace. A story is a **historical, modeled trade**, never an executable offer or verified profit. Select a product, month or featured story; step through a map route, price comparison, modeled costs, adverse scenario, and the day-by-day evidence. `/agrinet/?story=<id>` opens one story directly; `/agrinet/s/<id>/` is a share preview for the three featured stories. Explore and the older research workspaces remain at `?mode=explore` and `?mode=research`; existing deep links remain supported.

## Rebuild

```bash
uv run python -m pipeline.extract_all       # existing raw AGMARKNET archive -> data/derived/mandi_all.parquet
uv run python -m pipeline.trade_stories      # derived data -> web/public/stories/
cd web && node scripts/share-page.mjs        # share pages and preview cards
```

The complete source archive is local, not in CI. `data/derived/mandi_all.parquet` and `web/public/data` may be local symlinks; don't commit them. Commit the generated story JSON and share pages with the application. The generator reads a locally cached OSRM route ledger (`evidence/trade_routes_osrm.json`); never silently substitute a straight-line distance for a road route. Rerunning with unchanged inputs/cache produces deterministic story JSON.

## Selection and limits

The engine (`pipeline/trade_stories.py`) scans reported prices for each exact commodity **and variety**. It screens same-month market pairs, then evaluates matched purchase reports and destination reports after road transit. A purchase is matched to the first destination report in the transit window. It rejects thin reporting, copy-forward prices, implausible price ratios, short or implausibly long trips, and oversized margins that could indicate a quality mismatch. Only a subset of top-ranked candidate pairs is routed and evaluated because routing is bounded. One top story per commodity-month survives. This is **not** a global optimization over all trades or a promise of profit.

For each surviving candidate, the cost waterfall reuses the audited Decimal economics model: route-scaled freight, mandi fee and commission, loading, transit loss, and working-capital interest. Adverse scenarios increase loss, freight and interest. The historically informed rule decides whether to ship using only the latest destination report available **before purchase**; realized outcomes use the subsequent destination report. Candidate screening and ranking themselves use historical outcomes, so these are **retrospectively selected back-tests**, not out-of-sample validation. The modal prices are reported market aggregates, not binding bids, and do not guarantee the same grade, quantity, buyer, or actual ability to trade. A daily positive net is a modeled surplus after assumed costs, not observed realized profit.

Cost assumptions are period-specific (2021 onward) and nominal; older periods have no cited comparable cost evidence. Route geometry comes from public OSRM car-profile routing and is not truck-suitability verification. The UI labels route and cost assumptions; there are no real freight quotes or buyer confirmations. No live trading or automatic order execution exists.

## Current generated output

- 1,664 monthly stories across 74 products with a surviving story, in 312 product/year JSON files (~19.6 MB), loaded lazily. The catalog lists all 368 source product slugs, including those with no qualifying story.
- The latest source observation is **April 21, 2026**. Do not portray these as today's market opportunities.
- 1,350,614 pairs screened; 48,500 evaluated; 12,064 tested; 125 road pairs routed. The route budget was hit, so coverage is incomplete and top-ranked within the bounded set.
- Three featured examples have static share pages. The featured product and period are derived from the generated catalog, not hard-coded to onion or potato.

Run checks with `uv run python -m pytest tests/test_trade_stories.py` and, from `web/`, `npm test`, `npm run build`, and `npx playwright test tests/e2e/stories.spec.ts tests/e2e/stories-mobile.spec.ts`.
