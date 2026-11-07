# Test results — 2026-11-07

## Actual executions
- `uv run python -m pytest tests -q`: **23 passed** (before opt-in live test module was added). Covers backend upserts/news parsing, retained data, geocoding cache-only behavior, lossless binary prices and robust shock math.
- `AGRINET_LIVE_TESTS=1 uv run python -m pytest tests/test_live_api.py -q -s`: **7 passed**, 1.96 s total against the actual Mumbai API. Health 0.282 s, shocks 0.133 s, nearby spatial query 0.349 s in that sample. Includes bad-key rejection, pagination, empty range, invalid-filter error and source URLs.
- `npm run build`: TypeScript and Vite succeeded. Observed initial JS bundle 3.52 MB raw / 1.03 MB gzip before optional chunking; a build-size warning is not suppressed.
- `npx vitest run`: **6 passed** at 20:33 IST; includes binary decoder regression work.
- First Pages deployment run 42383606735: build **success**, deploy **success**. Actual HTTPS GET returned 200; live `markets.json` held 3,389 identities. Final promotion and browser acceptance still pending at this log entry.

## Real data acceptance
Six retained-data tests pass on the actual Parquet and exported files:
1. Raw quality ledger reconciles exactly.
2. No duplicate normalized market/commodity/day keys.
3. Stored integer prices are positive and respect min/max tolerance.
4. All 3,389 market identities have valid India-range coordinates and explicit source/confidence labels.
5. Every exported commodity snapshot's row total matches actual retained Parquet rows (8,460,842 total).
6. Actual 2014-07-16 Potato observation at market1090 is retained at ₹71,000/quintal instead of silently clipping to ₹65,535.

Additional fixes were test-driven: trailing MAD previously used historical residual medians instead of the actual same-window MAD; fixed and recalculated. 24 fractional-price raw records would become invalid after integer conversion; now rejected under a separately counted quality reason, not silently repaired.

## Backup/restore check
All 3,469 immutable snapshot files were read back from the compressed archive and SHA-256 compared with source, totaling 178,388,592 bytes. GitHub's release-asset digest independently matches the local archive SHA-256. This verifies retained static-data restore, not a Postgres PITR recovery.

## Not established by these tests
A statistical anomaly is not a validated economic event. Ground-truth alert precision/false-positive rates and production-scale load/concurrency are not established. Coordinates labelled district/state fallbacks are approximate, not surveyed mandi locations. Source history ends 2026-04-20; successful ingestion/health does not make it current.

## Final combined acceptance
- Final full backend suite with live tests enabled: **47 passed**, 11.04 seconds.
- Deployed desktop/mobile Playwright: **52 passed**: 18 actual deployment acceptance checks and 34 intentionally mocked response-order/initialization regressions. Mock health dates are test fixtures, not evidence of real data freshness.
- Date-range initialization race fixed and tested with both response orders, health failure, empty/error coverage, deep links, user changes while loading, and StrictMode stale completion.
- Final database backup: 9 tables / 1,207,097 rows, 14,941,063 compressed bytes; gzip, SHA-256, sizes and isolated-schema restore counts all verified. Local data-only recovery, not PITR or off-device disaster recovery.
- Current shock set: 375,849 signals; superseded IDs retained and excluded from current APIs.
