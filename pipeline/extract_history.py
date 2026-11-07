"""Extract pilot-commodity rows from the HF mirror of the AGMARKNET/data.gov.in
history (GODL-India licensed) into local raw Parquet, one file per year.

Idempotent: a year is skipped when its output file exists with a matching
source ETag recorded in data/raw/mandi_daily/_manifest.json.  Restartable:
each year is written atomically (tmp file + rename).
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "mandi_daily"
RAW.mkdir(parents=True, exist_ok=True)
MANIFEST = RAW / "_manifest.json"

SOURCE = (
    "https://huggingface.co/datasets/DHIVAKARNAIDUSUNKARI/"
    "mandi-india-daily-prices-2001-2026/resolve/main/data/mandi_daily_by_year/"
)
PILOT = ("Onion", "Tomato", "Potato")
YEARS = range(2001, 2027)


def head(url: str) -> dict:
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=60) as r:
        return {
            "etag": r.headers.get("ETag") or r.headers.get("x-linked-etag"),
            "size": int(r.headers.get("x-linked-size") or r.headers.get("Content-Length") or 0),
        }


def main(years=YEARS) -> None:
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    sel = ", ".join(f"'{c}'" for c in PILOT)
    for y in years:
        url = f"{SOURCE}mandi_daily_{y}.parquet"
        out = RAW / f"pilot_{y}.parquet"
        meta = head(url)
        prev = manifest.get(str(y))
        if out.exists() and prev and prev.get("etag") == meta["etag"]:
            print(f"{y}: up to date ({prev['rows']} rows)")
            continue
        t0 = time.time()
        tmp = out.with_suffix(".tmp.parquet")
        con.execute(
            f"""COPY (SELECT *, {y} AS source_year, '{url}' AS source_url
                     FROM read_parquet('{url}')
                     WHERE Commodity IN ({sel}))
                TO '{tmp}' (FORMAT PARQUET, COMPRESSION ZSTD)"""
        )
        rows = con.execute(f"SELECT count(*) FROM read_parquet('{tmp}')").fetchone()[0]
        tmp.rename(out)
        manifest[str(y)] = {
            "etag": meta["etag"],
            "source_bytes": meta["size"],
            "rows": rows,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "source_url": url,
        }
        MANIFEST.write_text(json.dumps(manifest, indent=2))
        print(f"{y}: {rows} rows in {time.time()-t0:.0f}s", flush=True)
    con.close()


if __name__ == "__main__":
    ys = [int(a) for a in sys.argv[1:]] or YEARS
    main(ys)
