# AGRINET — Execution State (read this first after any interruption)

Project root: `~/Projects/agrinet`. Python via `uv run` (3.12). Node for frontend.

## Infrastructure (live)
- **Database**: Supabase project `agrinet` ref `fltrrikxuvsgnmoulqjd`, region ap-south-1 (Mumbai), Postgres 17 + PostGIS, free tier (₹0). URL `https://fltrrikxuvsgnmoulqjd.supabase.co`. Schema `agri` (migration 0001 applied via MCP). Separate from the heritage project — never touch `rwdjasxvkupweowgrrwl`.
- Publishable (anon, read-only via RLS) key: `sb_publishable_bjH4is7RfBhJUZB9U9YiPA_t7MWSiMK`.
- DB writes: via Supabase MCP `execute_sql` or psycopg with the service connection (password in `.env`, not committed).
- **Frontend host**: Cloudflare Pages (free) — TODO; fallback GitHub Pages.
- **Repo**: GitHub `amriteshanand/agrinet` — TODO create via `gh`.

## Data
- History source: HF mirror `DHIVAKARNAIDUSUNKARI/mandi-india-daily-prices-2001-2026` (GODL-India, AGMARKNET via data.gov.in; refreshed 2026-11-04). Per-year parquet. Pilot extraction → `data/raw/mandi_daily/pilot_<year>.parquet` (+ `_manifest.json` etag ledger). ~5.7M pilot rows.
- Live/current: data.gov.in resource `9ef84268-d588-465a-a308-a864a43d0070` (sample key works, needs own key for prod — TODO register, free).
- Weather: Open-Meteo (free, no key). Boundaries: datameet/maps india states+districts GeoJSON (ODbL-ish, attribution).

## Pipeline steps (pipeline/)
1. `extract_history.py` — DONE/RUNNING (log: logs/extract_history.log)
2. `build_dims.py` — markets+daily aggregate parquet → TODO
3. `geocode.py` — Nominatim (1 req/s, cache) + district-centroid fallback → TODO
4. `load_db.py` — markets, price_daily (2015+ hot), stats, coverage → TODO
5. `shocks.py` — detection methods → TODO
6. `news.py` — RSS (PIB, Google News agri queries) → TODO
7. `export_tiles.py` — static per-commodity daily snapshots for time machine → TODO

## Next action
See TASKS.md top unchecked item.
