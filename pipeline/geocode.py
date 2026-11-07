"""Geocode markets with Nominatim (OSM), validated against district polygons.

Cache: data/geo/geocode_cache.json  (query -> raw nominatim result | null). Restartable.
Output: data/derived/markets_geo.parquet with lat, lon, geocode_source, geocode_confidence.

Confidence rules (0-100):
  90  nominatim hit inside the matched district polygon
  70  nominatim hit within 60 km of district centroid (polygon mismatch, e.g. new district)
  40  district centroid fallback (no usable hit)
  20  state centroid fallback (district not matched)
   0  nothing (market excluded from map, kept in tables)
Rate limit 1 req/s per Nominatim usage policy; identifies itself with a UA.
"""
from __future__ import annotations

import json
import math
import re
import sys
import time
from pathlib import Path

import duckdb
import httpx
from shapely.geometry import Point, shape

ROOT = Path(__file__).resolve().parents[1]
GEO = ROOT / "data" / "geo"
DERIVED = ROOT / "data" / "derived"
CACHE = GEO / "geocode_cache.json"
UA = "AGRINET/0.1 (agricultural research; github.com/amriteshanand/agrinet)"
INDIA_BBOX = (68.0, 6.5, 97.5, 37.2)

STATE_ALIASES = {
    "nct of delhi": "delhi",
    "andaman nicobar island": "andaman nicobar",
    "arunanchal pradesh": "arunachal pradesh",
    "dadara nagar havelli": "dadra and nagar haveli and daman and diu",
    "daman diu": "dadra and nagar haveli and daman and diu",
    "andaman and nicobar": "andaman nicobar",
    "chattisgarh": "chhattisgarh",
    "orissa": "odisha",
    "pondicherry": "puducherry",
    "uttrakhand": "uttarakhand",
    "jammu and kashmir": "jammu kashmir",
    "dadra and nagar haveli": "dadra and nagar haveli and daman and diu",
    "daman and diu": "dadra and nagar haveli and daman and diu",
}


def norm(s: str) -> str:
    s = s.lower()
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def haversine(lon1, lat1, lon2, lat2):
    p = math.pi / 180
    a = 0.5 - math.cos((lat2 - lat1) * p) / 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * (1 - math.cos((lon2 - lon1) * p)) / 2
    return 12742 * math.asin(math.sqrt(a))


def load_polys():
    d = json.loads((GEO / "india_districts.geojson").read_text())
    s = json.loads((GEO / "india_states.geojson").read_text())
    districts = {}
    for f in d["features"]:
        sn = norm(f["properties"]["ST_NM"])
        key = (STATE_ALIASES.get(sn, sn), norm(f["properties"]["DISTRICT"]))
        districts[key] = shape(f["geometry"])
    states = {}
    for f in s["features"]:
        sn = norm(f["properties"]["ST_NM"])
        states[STATE_ALIASES.get(sn, sn)] = shape(f["geometry"])
    return districts, states


def match_district(districts, state_n, dist_n):
    state_n = STATE_ALIASES.get(state_n, state_n)
    if state_n == "telangana":  # 2011 census districts predate Telangana
        state_n = "andhra pradesh"
    if (state_n, dist_n) in districts:
        return (state_n, dist_n)
    # token containment fallback (e.g. "vadodara baroda" vs "vadodara")
    cands = [k for k in districts if k[0] == state_n]
    toks = set(dist_n.split())
    best = None
    for k in cands:
        kt = set(k[1].split())
        if kt & toks and (kt <= toks or toks <= kt):
            best = k
            break
    return best


def nominatim(client, q, cache, cache_only=False):
    if q in cache:
        return cache[q]
    if cache_only:
        return []
    for attempt in range(3):
        try:
            r = client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": q, "format": "jsonv2", "limit": 3, "countrycodes": "in"},
                headers={"User-Agent": UA},
                timeout=30,
            )
            if r.status_code == 200:
                res = r.json()
                cache[q] = res
                time.sleep(1.05)
                return res
            time.sleep(5)
        except httpx.HTTPError:
            time.sleep(5)
    return None


def main(limit: int | None = None, cache_only: bool = False):
    districts, states = load_polys()
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    con = duckdb.connect()
    rows = con.execute(
        f"SELECT state_norm, district_norm, market_norm, state, district, market FROM '{DERIVED}/markets.parquet' ORDER BY 1,2,3"
    ).fetchall()
    if limit:
        rows = rows[:limit]
    out = []
    client = httpx.Client()
    t0 = time.time()
    for i, (sn, dn, mn, state, district, market) in enumerate(rows):
        dkey = match_district(districts, sn, dn)
        dpoly = districts.get(dkey) if dkey else None
        spoly = states.get(STATE_ALIASES.get(sn, sn))
        lat = lon = None
        src, conf, used_q = "none", 0, None
        queries = [f"{market}, {district}, {state}, India", f"{market} mandi, {state}, India"]
        for q in queries:
            res = nominatim(client, q, cache, cache_only=cache_only)
            if not res:
                continue
            for hit in res:
                la, lo = float(hit["lat"]), float(hit["lon"])
                if not (INDIA_BBOX[0] <= lo <= INDIA_BBOX[2] and INDIA_BBOX[1] <= la <= INDIA_BBOX[3]):
                    continue
                pt = Point(lo, la)
                if dpoly is not None and dpoly.contains(pt):
                    lat, lon, src, conf, used_q = la, lo, "nominatim", 90, q
                    break
                if dpoly is not None:
                    c = dpoly.centroid
                    if haversine(lo, la, c.x, c.y) <= 60:
                        lat, lon, src, conf, used_q = la, lo, "nominatim_near", 70, q
                        break
                elif spoly is not None and spoly.contains(pt):
                    lat, lon, src, conf, used_q = la, lo, "nominatim_state", 50, q
                    break
            if lat is not None:
                break
        if lat is None and dpoly is not None:
            c = dpoly.representative_point()
            lat, lon, src, conf = c.y, c.x, "district_centroid", 40
        elif lat is None and spoly is not None:
            c = spoly.representative_point()
            lat, lon, src, conf = c.y, c.x, "state_centroid", 20
        out.append((sn, dn, mn, lat, lon, src, conf, used_q))
        if i % 50 == 0:
            CACHE.write_text(json.dumps(cache))
            print(f"{i}/{len(rows)} {time.time()-t0:.0f}s last={market},{district}: {src} {conf}", flush=True)
    CACHE.write_text(json.dumps(cache))
    con.execute(
        "CREATE TABLE g (state_norm TEXT, district_norm TEXT, market_norm TEXT, lat DOUBLE, lon DOUBLE, geocode_source TEXT, geocode_confidence SMALLINT, geocode_query TEXT)"
    )
    con.executemany("INSERT INTO g VALUES (?,?,?,?,?,?,?,?)", out)
    con.execute(f"COPY g TO '{DERIVED}/markets_geo.parquet' (FORMAT PARQUET)")
    print(con.execute("SELECT geocode_source, count(*) FROM g GROUP BY 1 ORDER BY 2 DESC").fetchall())


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("limit", nargs="?", type=int)
    parser.add_argument("--cache-only", action="store_true", help="Use retained hits and labelled polygon fallbacks; never query Nominatim")
    args = parser.parse_args()
    main(args.limit, cache_only=args.cache_only)
