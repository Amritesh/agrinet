"""Load dimensions, hot prices (last 24 months), stats, coverage and shocks into Supabase.

Idempotent: markets/coverage/stats upserted by key; price_daily & shocks replaced per commodity
inside a transaction (truncate-free: delete+insert by commodity so a failed run leaves the
previous state intact). Every run is recorded in agri.ingest_runs.
"""
from __future__ import annotations

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


def main(steps: set[str]) -> None:
    t0 = time.time()
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
            "INSERT INTO agri.ingest_runs(job, details) VALUES ('load_db', %s) RETURNING id", [json.dumps({"steps": sorted(steps)})]
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
                    cur.execute("DELETE FROM agri.price_daily WHERE commodity_id=%s", [cid])
                    n = copy_rows(cur, "agri.price_daily", ["market_id", "commodity_id", "obs_date", "min_price", "max_price", "modal_price", "n_variety"], rows)
                    pg.commit()
                    print(f"price_daily cid={cid}: {n} rows (>= {cutoff})")

            if "stats" in steps:
                rows = con.execute(
                    """WITH s AS (
                         SELECT market_id, commodity_id, obs_date, modal_price,
                                ln(modal_price) - lag(ln(modal_price)) OVER (PARTITION BY market_id, commodity_id ORDER BY obs_date) AS lr,
                                row_number() OVER (PARTITION BY market_id, commodity_id ORDER BY obs_date DESC) AS rn
                         FROM p)
                       SELECT market_id, commodity_id, min(obs_date), max(obs_date), count(*),
                              max(CASE WHEN rn=1 THEN modal_price END), max(CASE WHEN rn=1 THEN obs_date END),
                              stddev_samp(CASE WHEN rn<=90 THEN lr END)
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
                    cur.execute("DELETE FROM agri.shocks WHERE commodity_id=%s", [cid])
                    n = copy_rows(cur, "agri.shocks", ["market_id", "commodity_id", "obs_date", "method", "direction", "score", "pct_change", "baseline", "observed", "severity", "window_start", "window_end"], rows)
                    pg.commit()
                    print(f"shocks cid={cid}: {n}")
            cur.execute("UPDATE agri.ingest_runs SET finished_at=now(), status='ok', details=details||%s WHERE id=%s", [json.dumps({"seconds": round(time.time() - t0)}), run_id])
            pg.commit()
        except Exception as e:  # noqa: BLE001
            pg.rollback()
            cur.execute("UPDATE agri.ingest_runs SET finished_at=now(), status='failed', details=details||%s WHERE id=%s", [json.dumps({"error": str(e)[:500]}), run_id])
            pg.commit()
            raise
    print(f"done in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main(set(sys.argv[1:]) or {"markets", "prices", "stats", "shocks"})
