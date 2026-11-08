"""Download ALL commodities (every product) from the HF mirror of the AGMARKNET /
data.gov.in daily mandi history, for the years covered by AGRINET's cited cost
evidence (RBI survey, TE 2021-22 -> used for 2021-01 .. latest).

Writes data/raw/mandi_all/all_<year>.parquet (one file per year, atomic, ETag
manifest, idempotent).  Keeps Variety and Grade so the story engine only ever
compares like with like.  Nothing here is modelled: rows are copied verbatim.

Run: caffeinate -dimsu uv run python -m pipeline.extract_all [years...]
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import duckdb

from pipeline.extract_history import SOURCE, head

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "mandi_all"
MANIFEST = RAW / "_manifest.json"
YEARS = range(2021, 2027)


def main(years=YEARS) -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    for y in years:
        url = f"{SOURCE}mandi_daily_{y}.parquet"
        out = RAW / f"all_{y}.parquet"
        meta = head(url)
        prev = manifest.get(str(y))
        if out.exists() and prev and prev.get("etag") == meta["etag"]:
            print(f"{y}: up to date ({prev['rows']} rows)", flush=True)
            continue
        t0 = time.time()
        tmp = out.with_suffix(".tmp.parquet")
        con.execute(
            f"""COPY (SELECT State, District, Market, Commodity, Variety, Grade, Arrival_Date,
                             Min_Price, Max_Price, Modal_Price, {y} AS source_year
                      FROM read_parquet('{url}'))
                TO '{tmp}' (FORMAT PARQUET, COMPRESSION ZSTD)"""
        )
        rows, ncom = con.execute(f"SELECT count(*), count(DISTINCT Commodity) FROM read_parquet('{tmp}')").fetchone()
        tmp.rename(out)
        manifest[str(y)] = {"etag": meta["etag"], "source_bytes": meta["size"], "rows": rows, "commodities": ncom,
                            "fetched_at": datetime.now(timezone.utc).isoformat(), "source_url": url}
        MANIFEST.write_text(json.dumps(manifest, indent=2))
        print(f"{y}: {rows} rows, {ncom} commodities in {time.time() - t0:.0f}s", flush=True)
    con.close()


if __name__ == "__main__":
    main([int(a) for a in sys.argv[1:]] or YEARS)
