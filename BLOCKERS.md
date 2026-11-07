# Blockers and explicit limitations

## Data freshness — unresolved
- Retained real AGMARKNET mirror history ends **2026-04-20**; do not label it current or live on 2026-11-07.
- Three bounded official data.gov.in sample-key commodity probes timed out after 35 seconds each. Evidence retained in `data/raw/current_snapshot/data_gov_probe_2026-11-07.json`. A personal production API registration may require consent/terms; no registration or fabricated substitute was made.
- PIB feed returned HTTP 403; other permitted news feeds succeeded and partial feed health is recorded. Do not bypass the block.

## Location precision
- 3,389 identities have coordinates, but only 437 are district-validated OSM hits and 9 nearby matches; 45 hits are state-validated only. 1,985 are explicitly district-centroid fallbacks and 913 state-centroid fallbacks. A displayed dot is not a surveyed mandi location. Source/confidence must remain visible.

## Unsupported source fields / research
- Arrivals and per-variety/grade histories are not represented as invented values. Original variety/grade records are retained raw; public prices aggregate available varieties.
- No verified satellite crop-product pipeline is active. This remains roadmap work, not a simulated layer.
- Shock scores are reproducible statistical signals, not confirmed economic causes. Ground-truth alert precision/false-positive backtesting, synchronization analysis, and calibrated forecast uncertainty need further research. No claim of validated predictive accuracy.
- Historical source archive attribution is retained; future-source licensing/terms must be checked before expansion.

## Operational maturity
- GCP Cloud Run/GCS/Scheduler were not provisioned: billing/consent was not authorized. Free equivalent frontend/database/CDN services are used.
- Immutable static-data restore and a 9-table / 1,207,097-row local Postgres data-only restore are exercised. Managed PITR, off-device database backups, cloud-scheduled privileged ingestion and formal incident-response paging are not established.
- Existing publication is intentionally public and read-only; authentication is not required to read public observations. An authenticated administrative writer is not shipped.
- Free-tier service quotas/availability are not a production SLA. Do not call the complete original production-grade scope finished based solely on a successful pilot deployment.
