"""Load dimensions, hot prices (last 24 months), stats, coverage and shocks into Supabase.

Idempotent: dimensions and facts are upserted by natural key; existing shock IDs and
news references are retained. Only the bounded hot-price window is loaded; the full
history stays in Parquet/CDN. Every run is recorded in agri.ingest_runs.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import duckdb
import psycopg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
DERIVED = ROOT / "data" / "derived"
load_dotenv(ROOT / ".env")
HOT_MONTHS = 24


def copy_rows(cur, table: str, cols: list[str], rows) -> int:
    n = 0
    with cur.copy(f"COPY {table} ({', '.join(cols)}) FROM STDIN") as cp:
        for r in rows:
            cp.write_row(r)
            n += 1
    return n


def upsert_rows(cur, table: str, cols: list[str], keys: list[str], rows) -> int:
    """COPY to transaction-local staging, then upsert without deleting referenced IDs."""
    columns = ", ".join(cols)
    cur.execute(f"CREATE TEMP TABLE load_stage ON COMMIT DROP AS SELECT {columns} FROM {table} WITH NO DATA")
    n = copy_rows(cur, "load_stage", cols, rows)
    updates = [c for c in cols if c not in keys]
    assignments = ", ".join(f"{c}=excluded.{c}" for c in updates)
    old_values = ", ".join(f"target.{c}" for c in updates)
    new_values = ", ".join(f"excluded.{c}" for c in updates)
    cur.execute(
        f"INSERT INTO {table} AS target ({columns}) SELECT {columns} FROM load_stage "
        f"ON CONFLICT ({', '.join(keys)}) DO UPDATE SET {assignments} "
        f"WHERE ROW({old_values}) IS DISTINCT FROM ROW({new_values})"
    )
    cur.execute("DROP TABLE load_stage")
    return n


def invalidate_missing_stats(cur, table: str, valid_pairs: str) -> int:
    """Retain referenced series but stop claiming observations removed by validation."""
    cur.execute(f"UPDATE {table} s SET n_obs=0,latest_modal=NULL,latest_date=NULL,volatility_90d=NULL WHERE n_obs<>0 AND NOT EXISTS(SELECT 1 FROM {valid_pairs} k WHERE k.market_id=s.market_id AND k.commodity_id=s.commodity_id)")
    return cur.rowcount


def flag_stale_shocks(cur, table: str, current_keys, source_version: str) -> int:
    """Retain historic IDs/references but explicitly distinguish superseded signals."""
    cur.execute("CREATE TEMP TABLE current_shock_keys(market_id int,commodity_id smallint,obs_date date,method text,PRIMARY KEY(market_id,commodity_id,obs_date,method)) ON COMMIT DROP")
    copy_rows(cur, "current_shock_keys", ["market_id", "commodity_id", "obs_date", "method"], current_keys)
    cur.execute("ANALYZE current_shock_keys")
    match = "k.market_id=s.market_id AND k.commodity_id=s.commodity_id AND k.obs_date=s.obs_date AND k.method=s.method"
    cur.execute(f"UPDATE {table} s SET details=details-'source_status'-'superseded_by' WHERE details->>'source_status'='superseded' AND EXISTS(SELECT 1 FROM current_shock_keys k WHERE {match})")
    cur.execute(f"UPDATE {table} s SET details=details||%s::jsonb WHERE NOT EXISTS(SELECT 1 FROM current_shock_keys k WHERE {match})", [json.dumps({"source_status": "superseded", "superseded_by": source_version})])
    stale = cur.rowcount
    cur.execute("DROP TABLE current_shock_keys")
    return stale


def source_manifest(paths: list[Path]) -> dict:
    """Fingerprint exact source bytes so an ingest run identifies its dataset/code version."""
    result = {}
    for path in paths:
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        result[str(path)] = {"bytes": path.stat().st_size, "sha256": digest.hexdigest()}
    return result


def main(steps: set[str]) -> None:
    t0 = time.time()
    sources = [DERIVED / "market_ids.parquet", DERIVED / "price_daily.parquet", Path(__file__), ROOT / "pipeline/build_dims.py"]
    if "markets" in steps:
        sources.append(DERIVED / "markets_geo.parquet")
    if "stats" in steps:
        sources.append(DERIVED / "coverage.json")
    if "shocks" in steps:
        sources.extend([DERIVED / "shocks.parquet", ROOT / "pipeline/shocks.py"])
    manifest = source_manifest(sources)
    con = duckdb.connect()
    con.execute(f"CREATE TABLE m AS SELECT * FROM '{DERIVED}/market_ids.parquet'")
    con.execute(f"CREATE TABLE g AS SELECT * FROM '{DERIVED}/markets_geo.parquet'")
    con.execute(
        f"""CREATE TABLE p AS SELECT m.id AS market_id, p.* EXCLUDE(state_norm,district_norm,market_norm)
            FROM '{DERIVED}/price_daily.parquet' p JOIN m USING (state_norm, district_norm, market_norm)"""
    )
    with psycopg.connect(os.environ["DATABASE_URL"]) as pg:
        cur = pg.cursor()
        run_id = cur.execute(
            "INSERT INTO agri.ingest_runs(job, details) VALUES ('load_db', %s) RETURNING id", [json.dumps({"steps": sorted(steps), "source_manifest": manifest})]
        ).fetchone()[0]
        pg.commit()
        try:
            if "markets" in steps:
                rows = con.execute(
                    """SELECT m.id, m.market, m.district, m.state, m.market_norm, m.district_norm, m.state_norm,
                              g.lat, g.lon, g.geocode_source, g.geocode_confidence, g.geocode_query
                       FROM m LEFT JOIN g USING (state_norm, district_norm, market_norm) ORDER BY m.id"""
                ).fetchall()
                cur.execute("CREATE TEMP TABLE tm (LIKE agri.markets INCLUDING DEFAULTS) ON COMMIT DROP")
                cols = ["id", "name", "district", "state", "name_norm", "district_norm", "state_norm", "lat", "lon", "geocode_source", "geocode_confidence", "geocode_query"]
                copy_rows(cur, "tm", cols, rows)
                cur.execute(
                    """INSERT INTO agri.markets (id,name,district,state,name_norm,district_norm,state_norm,lat,lon,geom,geocode_source,geocode_confidence,geocode_query,geocoded_at)
                       SELECT id,name,district,state,name_norm,district_norm,state_norm,lat,lon,
                              CASE WHEN lat IS NOT NULL THEN extensions.ST_SetSRID(extensions.ST_MakePoint(lon,lat),4326)::extensions.geography END,
                              geocode_source,geocode_confidence,geocode_query, now()
                       FROM tm
                       ON CONFLICT (id) DO UPDATE SET name=excluded.name, district=excluded.district, state=excluded.state,
                         lat=excluded.lat, lon=excluded.lon, geom=excluded.geom, geocode_source=excluded.geocode_source,
                         geocode_confidence=excluded.geocode_confidence, geocode_query=excluded.geocode_query, geocoded_at=now()"""
                )
                cur.execute("SELECT setval('agri.markets_id_seq', (SELECT max(id) FROM agri.markets))")
                pg.commit()
                print(f"markets: {len(rows)} upserted")

            if "prices" in steps:
                cutoff = date.today().replace(day=1) - timedelta(days=30 * HOT_MONTHS)
                for cid in (23, 24, 78):
                    rows = con.execute(
                        "SELECT market_id, commodity_id, obs_date, min_price, max_price, modal_price, n_variety FROM p WHERE commodity_id=? AND obs_date>=? ORDER BY obs_date",
                        [cid, cutoff],
                    ).fetchall()
                    n = upsert_rows(cur, "agri.price_daily", ["market_id", "commodity_id", "obs_date", "min_price", "max_price", "modal_price", "n_variety"], ["market_id", "commodity_id", "obs_date"], rows)
                    pg.commit()
                    print(f"price_daily cid={cid}: {n} rows (>= {cutoff})")

            if "stats" in steps:
                rows = con.execute(
                    """WITH s AS (
                         SELECT market_id, commodity_id, obs_date, modal_price,
                                ln(modal_price) - lag(ln(modal_price)) OVER (PARTITION BY market_id, commodity_id ORDER BY obs_date) AS lr,
                                row_number() OVER (PARTITION BY market_id, commodity_id ORDER BY obs_date DESC) AS rn,
                                max(obs_date) OVER (PARTITION BY market_id, commodity_id) AS series_latest
                         FROM p)
                       SELECT market_id, commodity_id, min(obs_date), max(obs_date), count(*),
                              max(CASE WHEN rn=1 THEN modal_price END), max(CASE WHEN rn=1 THEN obs_date END),
                              stddev_samp(CASE WHEN obs_date > series_latest - INTERVAL '90 days' THEN lr END)
                       FROM s GROUP BY 1,2"""
                ).fetchall()
                cur.execute("CREATE TEMP TABLE ts (LIKE agri.market_commodity_stats) ON COMMIT DROP")
                cols = ["market_id", "commodity_id", "first_date", "last_date", "n_obs", "latest_modal", "latest_date", "volatility_90d"]
                copy_rows(cur, "ts", cols, rows)
                cur.execute(
                    """INSERT INTO agri.market_commodity_stats SELECT * FROM ts
                       ON CONFLICT (market_id, commodity_id) DO UPDATE SET first_date=excluded.first_date, last_date=excluded.last_date,
                         n_obs=excluded.n_obs, latest_modal=excluded.latest_modal, latest_date=excluded.latest_date, volatility_90d=excluded.volatility_90d"""
                )
                invalidated = invalidate_missing_stats(cur, "agri.market_commodity_stats", "ts")
                print(f"stats: {invalidated} removed invalid series cleared (IDs retained)")
                cov = json.loads((DERIVED / "coverage.json").read_text())
                cur.executemany(
                    """INSERT INTO agri.coverage VALUES (%(commodity_id)s,%(year)s,%(n_rows)s,%(n_markets)s,%(n_days)s,%(n_states)s)
                       ON CONFLICT (commodity_id, year) DO UPDATE SET n_rows=excluded.n_rows, n_markets=excluded.n_markets, n_days=excluded.n_days, n_states=excluded.n_states""",
                    cov,
                )
                pg.commit()
                print(f"stats: {len(rows)} rows; coverage: {len(cov)}")

            if "shocks" in steps:
                con.execute(f"CREATE TABLE sh AS SELECT m.id AS market_id, s.* FROM '{DERIVED}/shocks.parquet' s JOIN m USING (state_norm, district_norm, market_norm)")
                for cid in (23, 24, 78):
                    rows = con.execute(
                        """SELECT market_id, commodity_id, obs_date, method, direction, score, pct_change, baseline, observed, severity, window_start, window_end
                           FROM sh WHERE commodity_id=? ORDER BY obs_date""",
                        [cid],
                    ).fetchall()
                    n = upsert_rows(cur, "agri.shocks", ["market_id", "commodity_id", "obs_date", "method", "direction", "score", "pct_change", "baseline", "observed", "severity", "window_start", "window_end"], ["market_id", "commodity_id", "obs_date", "method"], rows)
                    print(f"shocks cid={cid}: {n} staged (not yet published)")
                current_keys = con.execute("SELECT market_id,commodity_id,obs_date,method FROM sh").fetchall()
                version = manifest[str(DERIVED / "shocks.parquet")]["sha256"]
                stale = flag_stale_shocks(cur, "agri.shocks", current_keys, version)
                cur.execute("UPDATE agri.ingest_runs SET details=details||%s WHERE id=%s", [json.dumps({"current_shocks": len(current_keys), "superseded_shocks": stale}), run_id])
                print(f"shocks current={len(current_keys)} superseded={stale}; existing IDs retained")
            cur.execute("UPDATE agri.ingest_runs SET finished_at=now(), status='ok', details=details||%s WHERE id=%s", [json.dumps({"seconds": round(time.time() - t0)}), run_id])
            pg.commit()
        except Exception as e:  # noqa: BLE001
            pg.rollback()
            cur.execute("UPDATE agri.ingest_runs SET finished_at=now(), status='failed', details=details||%s WHERE id=%s", [json.dumps({"error": type(e).__name__}), run_id])
            pg.commit()
            raise
    print(f"done in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main(set(sys.argv[1:]) or {"markets", "prices", "stats", "shocks"})
