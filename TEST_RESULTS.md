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

## AGRINET 3.0 cycle 1 (2026-11-07, local, before deploy)
- pytest: 149 passed, 9 skipped (live checks) — includes 38 transport, economics, audit tests.
- vitest: 43/43. `tsc -b` clean; build OK (chunk >500 kB warning retained, main JS 3.55 MB / 1.04 MB gzip).
- Playwright local desktop+mobile (workspaces, agrinet, journey, date-race): 64/64. OSRM/Supabase mocked in workspaces tests.
- Production baseline before deploy: 18/18 real e2e.

## 4.0 Stories — 2026-11-07 (local, worktree `agrinet-stories`)
- `pytest tests/test_stories.py`: 17 passed (RED first). Full `pytest tests`: 159 passed, 15 skipped, 1 failed only because the worktree has no `data/raw` (same test passes in the main checkout: 7/7).
- `vitest`: 66 passed (stories routing/selection 7, share page 3, existing 56).
- Playwright full suite, desktop + mobile: 86 passed (14 new stories tests).
- Measured locally (`scripts/perf.mjs`, Chromium, Apple M5, `vite preview`): story title visible 856 ms desktop / 151 ms mobile (warm), FCP 472 ms; route animation 58–60 fps; JS heap ~10 MB stable after 24 scene jumps. Not a reference-broadband measurement.

### 4.0 production verification (https://amritesh.github.io/agrinet/, deploy run 42399605866, merge 0d58c4e)
- Deploy: build success, deploy success. `/`, `stories/catalog.json`, `stories/onion/2023.json`, `s/<id>/` and `s/<id>/og.png` all return 200; the share page serves story-specific `og:title`, `og:description` and `og:image`.
- Playwright against production, desktop + mobile: 52/52.
  - This includes the 14 Stories tests. The four that failed on the first run were caused by the tests' own blocked analytics-beacon console message; the filter was fixed and they re-ran green.
  - `date-race.spec.ts` (34 tests) is excluded: it asserts React StrictMode's double effect replay, which happens only on the dev server.
- Production perf (`scripts/perf.mjs`, local Chromium on Apple M5, home broadband):

  | | story title visible | first contentful paint | route animation | JS heap |
  |---|---|---|---|---|
  | desktop | 504 ms | 400 ms | 60 fps | ~10 MB |
  | mobile viewport | 342 ms | 224 ms | 60 fps | ~14 MB |

- Screenshots: `docs/screens/4.0/prod-corridor-*.png`.

### 4.0 mobile pass (fix/mobile-stories)
- **New `tests/e2e/stories-mobile.spec.ts`** covers:
  - phone portrait at 360×740, 390×844 and 430×932;
  - phone landscape at 844×390;
  - Explore at 390×844.
- **Checks in each test:**
  - nothing is wider than the screen;
  - the title, the pinned map (≥220 px tall) and the bottom player bar are on screen at load;
  - the page scrolls to the footer while the map stays pinned;
  - every header, scene-dot and player control is at least 40 px (most are 44 px);
  - after tapping Next, the new caption starts below the map;
  - landscape shows map and story side by side with no page scroll;
  - in Explore, controls are finger-sized and map attribution folds into its (i) button.
- **Bugs found and fixed:**
  - On phones, the story page could not scroll at all: the 3.0 app locks body scrolling, so the provenance, More stories and footer were unreachable.
  - At 360 px the header was 10 px too wide, which made phones zoom out.
- **Local run:** full Playwright 102/102 (desktop + mobile projects); vitest 66/66.
- **Audit:** `node web/scripts/mobile-audit.mjs <url> <outdir>`. Before/after screenshots are in `evidence/mobile-before|after/` (kept local).
