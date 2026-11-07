"""Export static data tiles consumed by the web app (served from the CDN).

web/public/data/
  markets.json                 [{id,n,d,s,lat,lon,c,src}]  (c = geocode confidence)
  coverage.json                commodity-year coverage (copied)
  snap/{slug}/{year}.bin       daily snapshots for the time machine:
        header  u32 magic 0x41475231 ('AGR1'), u32 n_days
        per day u32 day_ordinal (days since 2001-01-01), u32 n, then n × (u16 market_id, u16 modal)
        modal clamped to 65535 (INR/quintal)
  series/{market_id}.bin       full history per market, all pilot commodities:
        header  u32 magic 0x41475332 ('AGS2'), u8 n_comm
        per commodity: u8 commodity_id, u32 n, then n × (u16 day_ordinal, u16 min, u16 max, u16 modal, u8 n_variety)
Market ids are deterministic: row number of markets.parquet ordered by normalized key.
"""
from __future__ import annotations

import json
import struct
import time
from datetime import date
from pathlib import Path

import duckdb
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DERIVED = ROOT / "data" / "derived"
OUT = ROOT / "web" / "public" / "data"
EPOCH = date(2001, 1, 1)
SLUG = {23: "onion", 24: "potato", 78: "tomato"}


def main() -> None:
    t0 = time.time()
    con = duckdb.connect()
    con.execute(
        f"""CREATE TABLE m AS
            SELECT row_number() OVER (ORDER BY state_norm, district_norm, market_norm)::INTEGER AS id, *
            FROM '{DERIVED}/markets.parquet'"""
    )
    con.execute(f"CREATE TABLE g AS SELECT * FROM '{DERIVED}/markets_geo.parquet'")
    con.execute(f"COPY (SELECT m.id, m.* EXCLUDE(id) FROM m) TO '{DERIVED}/market_ids.parquet' (FORMAT PARQUET)")
    OUT.mkdir(parents=True, exist_ok=True)
    rows = con.execute(
        """SELECT m.id, m.market, m.district, m.state, g.lat, g.lon, g.geocode_confidence, g.geocode_source
           FROM m LEFT JOIN g USING (state_norm, district_norm, market_norm) ORDER BY m.id"""
    ).fetchall()
    (OUT / "markets.json").write_text(
        json.dumps(
            [
                {"id": r[0], "n": r[1], "d": r[2], "s": r[3],
                 "lat": None if r[4] is None else round(r[4], 5),
                 "lon": None if r[5] is None else round(r[5], 5),
                 "c": r[6] or 0, "src": r[7] or "none"}
                for r in rows
            ],
            separators=(",", ":"),
        )
    )
    (OUT / "coverage.json").write_text((DERIVED / "coverage.json").read_text())

    con.execute(
        f"""CREATE TABLE p AS
            SELECT m.id AS market_id, p.commodity_id,
                   (p.obs_date - DATE '2001-01-01')::INTEGER AS d,
                   least(p.min_price,65535) AS mn, least(p.max_price,65535) AS mx,
                   least(p.modal_price,65535) AS md, least(p.n_variety,255) AS nv,
                   year(p.obs_date) AS yr
            FROM '{DERIVED}/price_daily.parquet' p JOIN m USING (state_norm, district_norm, market_norm)"""
    )
    # snapshots
    for cid, slug in SLUG.items():
        (OUT / "snap" / slug).mkdir(parents=True, exist_ok=True)
        years = [r[0] for r in con.execute("SELECT DISTINCT yr FROM p WHERE commodity_id=? ORDER BY 1", [cid]).fetchall()]
        for yr in years:
            days = con.execute(
                """SELECT d, list(market_id ORDER BY market_id), list(md ORDER BY market_id)
                   FROM p WHERE commodity_id=? AND yr=? GROUP BY d ORDER BY d""",
                [cid, yr],
            ).fetchall()
            buf = bytearray(struct.pack("<II", 0x41475231, len(days)))
            for d, ids, mds in days:
                buf += struct.pack("<II", d, len(ids))
                arr = np.empty(len(ids) * 2, dtype="<u2")
                arr[0::2] = ids
                arr[1::2] = mds
                buf += arr.tobytes()
            (OUT / "snap" / slug / f"{yr}.bin").write_bytes(buf)
    # series
    (OUT / "series").mkdir(exist_ok=True)
    series = con.execute(
        """SELECT market_id, commodity_id, list(d ORDER BY d), list(mn ORDER BY d), list(mx ORDER BY d),
                  list(md ORDER BY d), list(nv ORDER BY d)
           FROM p GROUP BY 1,2 ORDER BY 1,2"""
    ).fetchall()
    by_market: dict[int, list] = {}
    for r in series:
        by_market.setdefault(r[0], []).append(r[1:])
    for mid, comms in by_market.items():
        buf = bytearray(struct.pack("<IB", 0x41475332, len(comms)))
        for cid, ds, mns, mxs, mds, nvs in comms:
            n = len(ds)
            buf += struct.pack("<BI", cid, n)
            rec = np.zeros(n, dtype=[("d", "<u2"), ("mn", "<u2"), ("mx", "<u2"), ("md", "<u2"), ("nv", "u1")])
            rec["d"], rec["mn"], rec["mx"], rec["md"], rec["nv"] = ds, mns, mxs, mds, nvs
            buf += rec.tobytes()
        (OUT / "series" / f"{mid}.bin").write_bytes(buf)
    total = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"markets={len(rows)} series_files={len(by_market)} total_bytes={total/1e6:.1f}MB in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
