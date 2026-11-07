# Deployment

## Verified public deployment
- Application: https://amritesh.github.io/agrinet/
- Source: https://github.com/Amritesh/agrinet
- Initial deployed GitHub Actions run: https://github.com/Amritesh/agrinet/actions/runs/42383606735 — build and deploy succeeded; actual HTTPS HTML and `data/markets.json` returned 200 with 3,389 identities.
- Database/API: Supabase `fltrrikxuvsgnmoulqjd`, Mumbai, PostgreSQL/PostGIS. Other projects must not be touched.
- Public browser credentials are a **publishable**, read-only key, not a service credential. Database password remains untracked in local `.env`.
- No login is required for the intentionally public, read-only dataset. Write/admin UI is not exposed.

## Architecture
React/TypeScript + MapLibre + deck.gl + ECharts on GitHub Pages; immutable, compact binary historical files on the same CDN; managed Postgres/PostGIS serves shock/event queries, nearby markets, stats and health. Raw and normalized Parquet retained locally. This substitutes free services for the proposed billable GCP architecture; no billing activation was authorized.

## Reproducible build and promotion
1. `uv sync --frozen`
2. `uv run python -m pytest tests -q`
3. `AGRINET_LIVE_TESTS=1 uv run python -m pytest tests/test_live_api.py -q -s`
4. `cd web && npm ci && npx vitest run && npm run build -- --base=/agrinet/`
5. Push reviewed changes to `main`; `.github/workflows/deploy.yml` restores the checksum-pinned immutable public data snapshot, tests, builds and deploys Pages.
6. Open the actual HTTPS deployment and run the Playwright suite against it. A successful Actions deployment alone is insufficient.

## Historical snapshot / restore
- Release `data-2026-11-07-v2`, asset `agrinet-data-v2.tar.gz` (47,485,586 compressed bytes).
- SHA-256: `7045c5c5dff202de4b3870abf3eb65ea84cf44724f7d294a25e2480d9c54f4b5` (matched GitHub's server-reported asset digest).
- Restore: `gh release download data-2026-11-07-v2 --pattern agrinet-data-v2.tar.gz`, verify SHA-256, then `tar -xzf agrinet-data-v2.tar.gz -C web/public`.
- Restore verification exercised all 3,469 files / 178,388,592 uncompressed bytes; each restored file hash matched its source.
- AGR2 snapshots retain uint32 modal prices. AGS3 series retain uint32 min/max/modal prices. Do not downgrade these files to the initial uint16-clipping export.
- Retained raw Parquet plus manifest/ETags permit regeneration. Database data-only backup `data/backups/20261107T153353Z` contains 9 tables / 1,207,097 rows. Every gzip/hash/size was checked; all tables were restored into an isolated temporary schema and row-count compared, then only that temporary schema was removed. This is a local data-only restore, not off-device recovery or managed PITR.

## Rollback
Revert a bad code commit with `git revert <commit>` and push to main; CI redeploys with the pinned snapshot. Alternatively rerun a known-good workflow commit. Keep snapshot and compatible decoder versions together. Do not drop tables or reset the database as a rollback. Database loads upsert natural keys and preserve referenced IDs.

## Monitoring and budget
- Health: public POST `/rest/v1/rpc/health` with the publishable key; reports latest observed date, row counts and last ingestion.
- `.github/workflows/monitor.yml`: hourly scheduled availability/data/health check plus manual dispatch. Actions failure notification depends on the owner's GitHub notification settings; no external paging service has been configured.
- Observed database footprint before the final shock refresh: 213,063,347 bytes, below the chosen 500 MB free-tier planning limit. Recheck after bulk refreshes.
- Provisioned services use free tiers; no paid service or spend was authorized. ₹0 is the planned service charge within those limits, not a billing guarantee. Expansion, quotas, or a production SLA require a new cost decision.

## Configuration separation
Browser build uses public `VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY`. Database writer uses local `.env` `DATABASE_URL`; never commit it, embed it into Vite, or include it in artifacts. Development uses Vite locally; production is the Pages base path `/agrinet/` and the published immutable snapshot.

## 4.0
Static story JSON (`web/public/stories/`) and share pages (`web/public/s/`) ship with the repo; the deploy workflow is unchanged. Rollback = redeploy the previous main commit (`6dbf9ba` before 4.0).
