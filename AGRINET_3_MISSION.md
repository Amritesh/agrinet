# AGRINET 3.0 implementation checkpoint

## Authorized scope
Implement phased agricultural intelligence and optimization platform on existing AGRINET stack and dedicated Supabase project only. Preserve historical viewer/data/pipelines/rollback. No paid subscriptions, billing activation, terms acceptance, identity verification, privileged access, unrelated infrastructure or legacy Supabase writes.

## Priority
Data truth → mathematical correctness → commercial feasibility → reliability → visual clarity → animation. Current public historical pilot is not a complete production intelligence platform.

## Active first cycle
- Read existing AGENTS, EXECUTION_STATE, TASKS, PROGRESS, BLOCKERS, DECISIONS, DEPLOYMENT, TEST_RESULTS and actual frontend/deployment files.
- Baseline backend: `uv run python -m pytest tests -q` returned 39 passed / 9 intentionally skipped live checks.
- Data quality agent: actual retained Parquet counts/date/quality/geolocation reproducible report.
- Economics agent: Python Decimal landed-cost model and deterministic fixture/validation tests.
- Frontend agent: preserve atlas, four workspaces, hypothetical scenario calculator, explicit route-point selection, route inspector, versioned scenario export, unit/browser tests.
- Research agent: primary-source participant/logistics/evidence model and monetization hypotheses.
- Optimization agent: NetworkX integer minimum-cost transportation with independently checked feasibility and mathematical fixtures.
- Parent: road provider boundary and evidence/precision gates, integration/review/staging/deployment acceptance.

## Routing checkpoint
`web/src/lib/routing.ts` and `web/tests/routing.test.ts`: five passing tests after missing-implementation RED. Gate centroid/unknown locations, require explicit representative or verified endpoints with evidence, validate coordinates/metrics/geometry and <=1km road snapping; preserve driving-profile limitations, no freight cost inferred.
Actual bounded provider request saved in `logs/route-provider-probe.json`: HTTP 200, OSRM Ok, 3346 geometry points. Coordinates are explicitly hypothetical representative points, NOT verified mandi loading addresses. This probe establishes provider availability for that request, not endpoint commercial validity or heavy-truck access.

## Remaining acceptance
Integrate returned artifacts, review calculations/contracts, run combined tests, local desktop/mobile staging, check accessibility and route error paths. Commit safe working slice only after checks. Promote existing authorized GitHub Pages only after staging; verify exact deployed behavior. Keep freshness, comparable grade, counterparty, truck access and freight quotation gaps visible. Do not claim full mission complete based on this first slice.
