"""Build normalized dimensions and the daily market×commodity aggregate from raw Parquet.

Outputs (data/derived/):
  markets.parquet       one row per (state, district, market) with normalized keys
  price_daily.parquet   market_key, commodity_id, obs_date, min/max/modal, n_variety
  varieties.parquet     per-variety rows kept for the investigation panel (2015+)
  coverage.json         rows/markets/days/states per commodity-year
  quality.json          validation report (rejected rows + reasons)

Validation (rows rejected, counted, never interpolated):
  * any price <= 0 or NULL
  * modal outside [min, max] by more than 1% (tolerance for rounding)
  * modal > 100000 INR/quintal (implausible for pilot vegetables)
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "mandi_daily"
OUT = ROOT / "data" / "derived"
OUT.mkdir(parents=True, exist_ok=True)

COMMODITY_ID = {"Onion": 23, "Potato": 24, "Tomato": 78}


def norm(s: str) -> str:
    """Normalization used for market/district/state keys (also mirrored in SQL below)."""
    s = s.lower()
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


NORM_SQL = (
    "trim(regexp_replace(regexp_replace(regexp_replace(lower({c}), '\\(.*?\\)', ' ', 'g'),"
    " '[^a-z0-9]+', ' ', 'g'), ' +', ' ', 'g'))"
)


def main() -> None:
    t0 = time.time()
    con = duckdb.connect()
    con.execute(f"CREATE VIEW raw AS SELECT * FROM read_parquet('{RAW}/pilot_*.parquet')")
    total = con.execute("SELECT count(*) FROM raw").fetchone()[0]

    con.execute(
        f"""CREATE TABLE clean AS
        SELECT State AS state, District AS district, Market AS market,
               {NORM_SQL.format(c='State')} AS state_norm,
               {NORM_SQL.format(c='District')} AS district_norm,
               {NORM_SQL.format(c='Market')} AS market_norm,
               Commodity AS commodity, Commodity_Code::SMALLINT AS commodity_id,
               coalesce(Variety,'Other') AS variety, coalesce(Grade,'FAQ') AS grade,
               Arrival_Date AS obs_date,
               Min_Price AS min_price, Max_Price AS max_price, Modal_Price AS modal_price,
               CASE
                 WHEN Min_Price IS NULL OR Max_Price IS NULL OR Modal_Price IS NULL THEN 'null_price'
                 WHEN Min_Price <= 0 OR Max_Price <= 0 OR Modal_Price <= 0 THEN 'nonpositive_price'
                 WHEN Modal_Price > 100000 THEN 'implausible_high'
                 WHEN Modal_Price < Min_Price*0.99 OR Modal_Price > Max_Price*1.01 THEN 'modal_out_of_range'
                 WHEN Max_Price < Min_Price THEN 'max_lt_min'
                 ELSE NULL END AS reject_reason
        FROM raw"""
    )
    rejects = con.execute(
        "SELECT reject_reason, count(*) FROM clean WHERE reject_reason IS NOT NULL GROUP BY 1"
    ).fetchall()
    con.execute("CREATE TABLE ok AS SELECT * FROM clean WHERE reject_reason IS NULL")
    kept = con.execute("SELECT count(*) FROM ok").fetchone()[0]

    # markets dimension: canonical display names = most frequent raw spelling per norm key
    con.execute(
        f"""COPY (
          WITH counts AS (
            SELECT state_norm, district_norm, market_norm, state, district, market, count(*) AS n
            FROM ok GROUP BY ALL),
          ranked AS (
            SELECT *, row_number() OVER (PARTITION BY state_norm, district_norm, market_norm ORDER BY n DESC) AS rn
            FROM counts)
          SELECT state_norm, district_norm, market_norm, state, district, market, n AS n_rows
          FROM ranked WHERE rn=1 ORDER BY state_norm, district_norm, market_norm
        ) TO '{OUT}/markets.parquet' (FORMAT PARQUET)"""
    )
    n_markets = con.execute(f"SELECT count(*) FROM '{OUT}/markets.parquet'").fetchone()[0]

    con.execute(
        f"""COPY (
          SELECT state_norm, district_norm, market_norm, commodity_id, obs_date,
                 min(min_price)::INTEGER AS min_price,
                 max(max_price)::INTEGER AS max_price,
                 round(median(modal_price))::INTEGER AS modal_price,
                 count(*)::SMALLINT AS n_variety
          FROM ok GROUP BY ALL ORDER BY commodity_id, obs_date, state_norm, district_norm, market_norm
        ) TO '{OUT}/price_daily.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)"""
    )
    n_daily = con.execute(f"SELECT count(*) FROM '{OUT}/price_daily.parquet'").fetchone()[0]

    con.execute(
        f"""COPY (
          SELECT state_norm, district_norm, market_norm, commodity_id, obs_date, variety, grade,
                 min_price::INTEGER AS min_price, max_price::INTEGER AS max_price,
                 modal_price::INTEGER AS modal_price
          FROM ok WHERE obs_date >= DATE '2015-01-01'
        ) TO '{OUT}/varieties.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)"""
    )

    cov = con.execute(
        f"""SELECT commodity_id, year(obs_date) AS year, count(*) AS n_rows,
                   count(DISTINCT (state_norm, district_norm, market_norm)) AS n_markets,
                   count(DISTINCT obs_date) AS n_days, count(DISTINCT state_norm) AS n_states
            FROM '{OUT}/price_daily.parquet' GROUP BY ALL ORDER BY 1,2"""
    ).fetchall()
    (OUT / "coverage.json").write_text(
        json.dumps([dict(zip(["commodity_id", "year", "n_rows", "n_markets", "n_days", "n_states"], r)) for r in cov], indent=1)
    )
    quality = {
        "raw_rows": total,
        "kept_rows": kept,
        "rejected": {k: v for k, v in rejects},
        "markets": n_markets,
        "daily_rows": n_daily,
        "seconds": round(time.time() - t0, 1),
    }
    (OUT / "quality.json").write_text(json.dumps(quality, indent=1))
    print(json.dumps(quality, indent=1))


if __name__ == "__main__":
    main()
