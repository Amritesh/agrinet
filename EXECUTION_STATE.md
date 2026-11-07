# AGRINET — execution state

Project root: `~/Projects/agrinet`. Python: `uv run`; frontend: `web/`, npm.

## Authorized infrastructure
- Dedicated AGRINET Supabase project: `fltrrikxuvsgnmoulqjd` (Mumbai). **Never touch heritage `rwdjasxvkupweowgrrwl`.** Writer credentials remain in untracked `.env`; browser uses a public read-only publishable key.
- Repository: https://github.com/Amritesh/agrinet
- HTTPS app: https://amritesh.github.io/agrinet/
- GitHub Pages workflow restores checksum-pinned release `data-2026-11-07-v2`, tests and builds. No billable GCP/Cloudflare infrastructure was activated.

## Actual data
- 8,460,842 normalized daily market/commodity observations; Onion, Potato, Tomato; history begins 2001, ends **2026-04-20**. Do not claim today's prices.
- 3,389 market identities. Geographic source/confidence labels distinguish OSM matches from approximate district/state centroids. See BLOCKERS.md.
- Static AGR2/AGS3 files preserve uint32 prices; original uint16 clipping fixed with regression tests. Release archive restore checksum verified across all 3,469 files.
- Raw and derived Parquet remain local and untracked. Public history binary files are in the release, not Git.
- News uses actual RSS feeds; PIB403 is recorded as partial source failure. Official current-price probes timed out; no synthetic replacement.

## Final verification
- Backend: 47 passing tests with live API checks enabled. Frontend: 6 unit checks and production build passed.
- Deployed desktop/mobile acceptance: 52 passed (18 real deployment checks; 34 mocked initialization/date-order regressions).
- Corrected shock load verified: 375,849 current signals; 76,800 superseded rows excluded, IDs retained.
- Database backup: 9 tables / 1,207,097 rows; SHA-256, gzip, sizes and isolated-schema restoration checked. Local data-only, not PITR/off-device recovery.
- Final code deployment 42388591411 and monitor 42388600108 succeeded. All 52 deployed browser checks passed. Requested WhatsApp completion link sent (message 3EB055289B909B139B3EF1).

## Detailed evidence / limitations
See DEPLOYMENT.md, TEST_RESULTS.md, BLOCKERS.md, logs/backend-verification.md and logs/frontend-verification.md. Original production scope is not fully satisfied: current-price gap, research validation, privileged scheduled ingestion, managed recovery and satellite pipeline remain explicit limitations. Do not describe a verified historical pilot as a complete production service.