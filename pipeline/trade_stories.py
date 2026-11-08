"""AGRINET story engine 2: profitable trade stories across every product.

Only stories where a real, reported price gap between two mandis for the SAME
product, variety and grade paid for every modeled cost -- on the typical day,
under the stress test, and for a trader who decided each morning using only the
reports already published -- are published.  Nothing is invented: prices are
retained Agmarknet modal prices, routes are OSRM road routes between verified
OpenStreetMap points, and costs are the cited RBI survey values plus labelled,
deliberately conservative allowances (loss, interest, transit time).

Run: caffeinate -dimsu uv run python -m pipeline.trade_stories
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import shutil
import statistics
import sys
import time
import zlib
from datetime import date, timedelta
from pathlib import Path

from pipeline.stories import (AGMARK, RBI, SETTLEMENT_DAYS, corridor_cost_params, evaluate_corridor_month,
                              fmt_month, inr, typical, validate_story, waterfall)

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "mandi_all"
OUT = ROOT / "web" / "public" / "stories"
EVIDENCE = ROOT / "evidence"
POINTS = EVIDENCE / "trade_points_nominatim.json"
ROUTES = EVIDENCE / "trade_routes_osrm.json"
ENGINE_VERSION = "stories-2.0.0"
FIRST_MONTH = "2021-01"  # cited cost evidence (RBI survey, TE 2021-22) is used from here on
UA = "AGRINET/0.2 (agricultural research; github.com/Amritesh/agrinet)"

# Not priced per quintal of produce, not farm produce, or not movable as ordinary truck freight.
EXCLUDED = {
    "cock", "hen", "duck", "goat", "she goat", "sheep", "ram", "cow", "ox", "bull", "calf", "she buffalo", "he buffalo",
    "pigs", "egg", "fish", "wood", "firewood", "bamboo", "green fodder", "dry fodder", "skin and hide", "stone pulverizer",
    "wool", "sugarcane", "broomstick", "tender coconut", "coconut", "coconut seed", "resinwood", "torchwood", "cane",
    "lilly", "jarbara", "carnation", "gladiolus cut flower", "astera", "lotus", "tube rose", "orchid", "anthorium",
    "chrysanthemum", "calendula", "daila", "kankambra", "bop", "rose", "marigold", "jasmine", "tube flower",
    "patti calcutta", "marget", "tulip", "dhawai flowers", "palash flowers", "honey", "tea",
}
# Wilt within a day or two: only short routes are believable even with a 10% stress loss.
LEAFY = {"coriander", "spinach", "amaranthus", "amranthas red", "methi", "mint", "onion green", "leafy vegetable",
         "season leaves", "betal leaves", "mashrooms", "other green and fresh vegetables", "basil", "lak"}
LEAFY_MAX_KM = 400

# Qualification thresholds (all must hold).
MIN_NET = 10            # minimum stress-tested net INR/qtl to survive rounding and thin margins
MIN_DAYS = 12            # matched buy/sell days in the month
MIN_DISTINCT = 4         # distinct reported prices at each end (rules out copy-forward reporting)
MIN_KM, MAX_KM = 60, 2600
MAX_GAP_RATIO = 0.6      # gross gap at most 60% of the buy price; larger is usually a unit/grade error
MAX_MARGIN = 0.30        # after-cost margin above 30% of the buy price, month after month, signals a hidden quality gap
UNIT_BAND = 3.0          # each market's monthly median within 1/3x..3x the national median for that variety
MIN_PAYING_SHARE = 0.75  # share of matched days that cleared baseline costs
MIN_SHIPPED = 8          # morning-rule shipments
MAX_LOSING_SHARE = 0.2   # of those shipments, at most this share lost money (baseline)
ROAD_FACTOR = 1.35       # straight-line -> road km, prefilter only (final numbers use OSRM)


def norm(s: str) -> str:
    s = (s or "").lower()
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def base_name(commodity: str) -> str:
    return norm(commodity)


def excluded(commodity: str) -> bool:
    b = base_name(commodity)
    return b in EXCLUDED or any(b.startswith(x + " ") or b == x for x in EXCLUDED)


def is_leafy(commodity: str) -> bool:
    b = base_name(commodity)
    return any(b == x or b.startswith(x + " ") for x in LEAFY)


# The retained geocoding cache includes hospitals, stations and other arbitrary
# points that happen to be in a district. Only a named settlement or marketplace
# is fit to be a *representative* routing endpoint; none is silently a mandi gate.
PLACE_TYPES = {"town", "city", "village", "suburb", "hamlet", "neighbourhood",
               "administrative", "local_authority", "marketplace"}


def cached_place(source: str, query: str | None, lat: float, lon: float, cache: dict) -> dict | None:
    if source != "nominatim" or not query:
        return None
    market = norm(query.split(",")[0])
    for h in cache.get(query) or []:
        if abs(float(h["lat"]) - lat) > 0.0001 or abs(float(h["lon"]) - lon) > 0.0001:
            continue
        kind = h.get("type", "")
        label = h.get("display_name", "")
        name = norm(label.split(",")[0])
        if kind not in PLACE_TYPES or not name:
            continue
        if kind == "marketplace":
            if not (market in name or name in market):
                continue
            precision = "verified marketplace point (OpenStreetMap)"
        else:
            if not (market == name or market in name.split(" mandi")[0]):
                continue
            precision = "representative town/place (not the mandi gate)"
        return {"lat": round(lat, 5), "lon": round(lon, 5), "precision": precision,
                "display_name": label, "osm": f"{h.get('osm_type')}/{h.get('osm_id')}"}
    return None


def product_slug(commodity: str) -> str:
    raw = re.sub(r"[^a-z0-9]+", "_", commodity.lower()).strip("_")
    return raw or "product"


def display_name(commodity: str) -> str:
    s = re.sub(r"\)\(", ", ", commodity.strip())
    s = re.sub(r"\s*\(", " (", s)
    return " ".join(s.split())


def market_id(state_n: str, district_n: str, market_n: str, known: dict) -> int:
    k = (state_n, district_n, market_n)
    if k in known:
        return known[k]
    return 100000 + zlib.crc32("|".join(k).encode()) % 900000


def transit_days_for(km: float) -> int:
    """Assumption: a loaded truck covers ~450 road km a day (slower than OSRM car time)."""
    return max(1, math.ceil(km / 450))


def haversine(lat1, lon1, lat2, lon2):
    p = math.pi / 180
    a = 0.5 - math.cos((lat2 - lat1) * p) / 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * (1 - math.cos((lon2 - lon1) * p)) / 2
    return 12742 * math.asin(math.sqrt(a))


# ---------------------------------------------------------------- qualification
def qualifies(ev: dict, *, km: float, leafy: bool = False) -> tuple[bool, str]:
    """Strict profitability + data-sanity test. Returns (ok, reason)."""
    if ev["n"] < MIN_DAYS:
        return False, "too few matched days"
    if not (MIN_KM <= km <= MAX_KM):
        return False, "distance out of range"
    if leafy and km > LEAFY_MAX_KM:
        return False, "too far for a leafy crop"
    tr = ev["trades"]
    if len({t["buy_price"] for t in tr}) < MIN_DISTINCT or len({t["sell_price"] for t in tr}) < MIN_DISTINCT:
        return False, "prices barely change (possible copy-forward reporting)"
    buy_med = statistics.median(t["buy_price"] for t in tr)
    if ev["gross_median"] is None or ev["gross_median"] <= 0 or ev["gross_median"] / buy_med > MAX_GAP_RATIO:
        return False, "gap absent or implausibly large"
    if ev["net_baseline_median"] is None:
        return False, "no cited cost evidence"
    if ev["net_adverse_median"] < MIN_NET:
        return False, "typical day loses money under the stress test"
    paying = sum(1 for t in tr if t["net_baseline"] > 0) / len(tr)
    if paying < MIN_PAYING_SHARE:
        return False, "too few days paid after costs"
    inf = ev["informed"]
    if not inf or inf["shipped"] < MIN_SHIPPED:
        return False, "a morning-report trader would rarely have shipped"
    if inf["shipped_losing"] > MAX_LOSING_SHARE * inf["shipped"]:
        return False, "too many morning-rule shipments lost money"
    if (inf["realized_adverse_per_qtl_mean"] or 0) < MIN_NET:
        return False, "morning-rule shipments lose money under the stress test"
    if inf["realized_net_per_qtl_mean"] > MAX_MARGIN * buy_med:
        return False, "margin too large to be like-for-like (likely a hidden quality difference)"
    return True, "profitable"


def score_of(ev: dict, buy_med: float) -> float:
    inf = ev["informed"]
    paying = sum(1 for t in ev["trades"] if t["net_baseline"] > 0) / len(ev["trades"])
    margin = inf["realized_adverse_per_qtl_mean"] / buy_med
    return round(40 * paying + min(ev["n"], 25) + min(30, 100 * margin) + 10 * (1 - inf["shipped_losing"] / max(1, inf["shipped"])), 2)


def select_finalists(stage1: list, per_product_month: int = 8) -> list:
    """Round-robin across products/months; preserve alternate routes for rechecks.

    Scores rank feasible historical candidates, not guaranteed realizable trades.
    The same road corridor across months is routed only once by the caller.
    """
    groups: dict = {}
    for row in sorted(stage1, reverse=True):
        k = (row[1], row[4])
        group = groups.setdefault(k, [])
        if len(group) < per_product_month and not any(x[5:7] == row[5:7] for x in group):
            group.append(row)
    result = []
    for rank in range(per_product_month):
        result.extend(groups[k][rank] for k in sorted(groups, key=lambda k: -groups[k][0][0]) if len(groups[k]) > rank)
    return result


def prioritize_routes(finalists: list, cached: set, budget: int) -> set:
    """Greedy maximum coverage of eligible product-months per NEW routing request.

    This optimizes evidence collection under a public-router query budget, NOT
    truck allocation or a claim about an executable trade. Cached roads are free.
    """
    groups: dict = {}
    for row in finalists:
        key, group = (row[5], row[6]), (row[1], row[4])
        scores = groups.setdefault(key, {})
        scores[group] = max(scores.get(group, 0), row[0])
    chosen = cached & groups.keys()
    covered = set().union(*(set(groups[k]) for k in chosen)) if chosen else set()
    remaining = set(groups) - chosen
    for _ in range(max(0, budget)):
        if not remaining:
            break
        # Coverage first, then product diversity, then calibrated stage-1 score.
        # If coverage is saturated, retain the strongest alternate as a fallback.
        k = max(remaining, key=lambda k: (len(groups[k].keys() - covered),
                                          len({g[0] for g in groups[k].keys() - covered}),
                                          sum(groups[k].values()), str(k)))
        chosen.add(k)
        covered.update(groups[k])
        remaining.remove(k)
    return chosen


# ---------------------------------------------------------------- data
def _con():
    import duckdb
    c = duckdb.connect()
    c.execute("SET preserve_insertion_order=false")
    return c


NORM_SQL = ("trim(regexp_replace(regexp_replace(regexp_replace(lower({c}), '\\(.*?\\)', ' ', 'g'),"
            " '[^a-z0-9]+', ' ', 'g'), ' +', ' ', 'g'))")


def load_daily(con) -> None:
    """Clean daily table: one modal price per (product, variety, grade, market, day)."""
    con.execute(f"""
      CREATE OR REPLACE TABLE daily AS
      SELECT Commodity AS commodity, coalesce(Variety, 'Other') AS variety, coalesce(Grade, 'FAQ') AS grade,
             {NORM_SQL.format(c='State')} AS sn, {NORM_SQL.format(c='District')} AS dn, {NORM_SQL.format(c='Market')} AS mn,
             any_value(State) AS state, any_value(District) AS district, any_value(Market) AS market,
             Arrival_Date AS d, round(median(Modal_Price))::INTEGER AS p
      FROM read_parquet('{RAW}/all_*.parquet')
      WHERE Arrival_Date >= DATE '{FIRST_MONTH}-01' AND Modal_Price > 0 AND Modal_Price <= 300000
        AND Min_Price > 0 AND Max_Price >= Min_Price AND Modal_Price BETWEEN Min_Price * 0.99 AND Max_Price * 1.01
      GROUP BY ALL""")


def market_points(con) -> dict:
    """Only retained named OSM settlements/marketplaces, not centroid or arbitrary POI.

    Place locations are representative and are identified as such in each story.
    Never perform bulk queries to Nominatim just to fill missing market geography.
    """
    cache = _load(ROOT / "data/geo/geocode_cache.json")
    out = {}
    gp = ROOT / "data/derived/markets_geo.parquet"
    for sn, dn, mn, lat, lon, src, query in con.execute(
            f"select state_norm, district_norm, market_norm, lat, lon, geocode_source, geocode_query from '{gp}'").fetchall():
        if lat is None:
            continue
        p = cached_place(src, query, lat, lon, cache)
        if p:
            out[(sn, dn, mn)] = p
    return out


def candidate_pairs(con, pts: dict, per_group: int = 24) -> list:
    """Monthly prefilter: same product/variety/grade, both markets well reported, adverse costs roughly covered."""
    con.execute("CREATE OR REPLACE TABLE pts (sn TEXT, dn TEXT, mn TEXT, lat DOUBLE, lon DOUBLE)")
    con.executemany("INSERT INTO pts VALUES (?,?,?,?,?)", [(*k, v["lat"], v["lon"]) for k, v in pts.items()])
    con.execute(f"""
      CREATE OR REPLACE TABLE monthly AS
      WITH m AS (
        SELECT commodity, variety, grade, sn, dn, mn, strftime(d, '%Y-%m') AS ym,
               median(p) AS med, count(*) AS n, count(DISTINCT p) AS nd
        FROM daily GROUP BY ALL),
      nat AS (SELECT commodity, variety, grade, ym, median(med) AS nat_med, count(*) AS n_mk FROM m GROUP BY ALL)
      SELECT m.*, nat.nat_med, nat.n_mk, pts.lat, pts.lon FROM m
      JOIN nat USING (commodity, variety, grade, ym) JOIN pts USING (sn, dn, mn)
      WHERE m.n >= {MIN_DAYS} AND m.nd >= {MIN_DISTINCT} AND m.med BETWEEN nat.nat_med / {UNIT_BAND} AND nat.nat_med * {UNIT_BAND}""")
    rows = con.execute(f"""
      WITH pr AS (
        SELECT o.commodity, o.variety, o.grade, o.ym, o.sn AS osn, o.dn AS odn, o.mn AS omn, d.sn AS dsn, d.dn AS ddn, d.mn AS dmn,
               o.med AS omed, d.med AS dmed,
               {ROAD_FACTOR} * 12742 * asin(sqrt(0.5 - cos(radians(d.lat - o.lat)) / 2
                   + cos(radians(o.lat)) * cos(radians(d.lat)) * (1 - cos(radians(d.lon - o.lon))) / 2)) AS km
        FROM monthly o JOIN monthly d
          ON o.commodity = d.commodity AND o.variety = d.variety AND o.grade = d.grade AND o.ym = d.ym
         AND d.med > o.med * 1.08 AND d.med < o.med * {1 + MAX_GAP_RATIO}
         AND (o.sn, o.dn, o.mn) <> (d.sn, d.dn, d.mn)),
      ok AS (
        SELECT *, dmed * 0.90 - omed * 1.05 - 9.02 - 300 * km / 1114.8 - omed * 0.14 * 12 / 365 AS est_net
        FROM pr WHERE km BETWEEN {MIN_KM} AND {MAX_KM}),
      ranked AS (
        SELECT *, row_number() OVER (PARTITION BY commodity, ym ORDER BY est_net / omed DESC) AS rk FROM ok WHERE est_net > 0)
      SELECT commodity, variety, grade, ym, osn, odn, omn, dsn, ddn, dmn, km, est_net FROM ranked WHERE rk <= {per_group}""").fetchall()
    return rows


def series_for(con, keys: set) -> dict:
    """Daily series for the (product, variety, grade, market) keys that survived the prefilter."""
    con.execute("CREATE OR REPLACE TABLE want (commodity TEXT, variety TEXT, grade TEXT, sn TEXT, dn TEXT, mn TEXT)")
    con.executemany("INSERT INTO want VALUES (?,?,?,?,?,?)", list(keys))
    out: dict = {}
    for c, v, g, sn, dn, mn, d, p in con.execute(
            "SELECT commodity, variety, grade, sn, dn, mn, d, p FROM daily JOIN want USING (commodity, variety, grade, sn, dn, mn)").fetchall():
        out.setdefault((c, v, g, sn, dn, mn), {})[d] = float(p)
    return out


def market_names(con) -> dict:
    return {(sn, dn, mn): (s, di, m) for sn, dn, mn, s, di, m in con.execute(
        "SELECT sn, dn, mn, any_value(state), any_value(district), any_value(market) FROM daily GROUP BY ALL").fetchall()}


# ---------------------------------------------------------------- verified geography + routes
def _load(p: Path) -> dict:
    return json.loads(p.read_text()) if p.exists() else {}


def osrm_route(client, a: dict, b: dict, cache: dict, key: str) -> dict | None:
    from shapely.geometry import LineString
    if key in cache and cache[key] is not None:
        return cache[key]
    url = f"https://router.project-osrm.org/route/v1/driving/{a['lon']},{a['lat']};{b['lon']},{b['lat']}"
    r = None
    for _ in range(3):
        try:
            resp = client.get(url, params={"overview": "full", "geometries": "geojson"}, headers={"User-Agent": UA}, timeout=60)
            time.sleep(1.1)  # OSRM demo policy: at most 1 request per second
            if resp.status_code == 200 and resp.json().get("code") == "Ok":
                r = resp.json()["routes"][0]
                break
        except Exception:  # noqa: BLE001 - network errors are retried then recorded as no route
            time.sleep(5)
    if r is None:
        return None  # a transient demo-server failure is not a permanently absent road
    line = LineString(r["geometry"]["coordinates"]).simplify(0.004)
    out = {"distance_km": round(r["distance"] / 1000, 1), "duration_h": round(r["duration"] / 3600, 2),
           "geometry": [[round(x, 4), round(y, 4)] for x, y in line.coords], "provider": "router.project-osrm.org",
           "profile": "driving (car)", "requested": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "truck_suitable": False}
    cache[key] = out
    return out


# ---------------------------------------------------------------- story writer
SOURCES = [AGMARK, RBI, {"id": "osrm", "title": "OSRM demo server, OpenStreetMap data", "url": "https://router.project-osrm.org"},
           {"id": "nominatim", "title": "Nominatim / OpenStreetMap representative place points", "url": "https://nominatim.openstreetmap.org"}]


def trade_story(*, product: str, variety: str, grade: str, m: str, o: dict, d: dict, route: dict, ev: dict, costs: dict,
                transit: int, n_checked: int) -> dict:
    slug = product_slug(product)
    name = display_name(product)
    lname = name[0].lower() + name[1:] if not name[:2].isupper() else name
    period = fmt_month(m)
    tr = ev["trades"]
    b, a = costs["scenarios"]["baseline"], costs["scenarios"]["adverse"]
    fin = transit + SETTLEMENT_DAYS
    tb, ta = typical(tr, "net_baseline"), typical(tr, "net_adverse")
    inf = ev["informed"]
    paying = sum(1 for t in tr if t["net_baseline"] > 0)
    won = inf["shipped"] - inf["shipped_losing"]
    f = {"n": ev["n"], "buy_median": round(statistics.median(t["buy_price"] for t in tr)),
         "sell_median": round(statistics.median(t["sell_price"] for t in tr)), "gross_median": round(ev["gross_median"]),
         "persistence_pct": round(100 * ev["persistence"]), "km": route["distance_km"], "hours": route["duration_h"],
         "transit_days": transit, "freight": round(b["freight_per_qtl"]),
         "wf_base": waterfall(tb["buy_price"], tb["sell_price"], b, financing_days=fin) | {"buy_date": tb["buy"], "sell_date": tb["sell"]},
         "wf_adverse": waterfall(ta["buy_price"], ta["sell_price"], a, financing_days=fin) | {"buy_date": ta["buy"], "sell_date": ta["sell"]},
         "paying_days": paying, "paying_pct": round(100 * paying / len(tr)), "inf_shipped": inf["shipped"],
         "inf_considered": inf["considered"], "inf_won": won, "inf_losing": inf["shipped_losing"],
         "inf_mean": round(inf["realized_net_per_qtl_mean"]), "inf_adverse": round(inf["realized_adverse_per_qtl_mean"]),
         "n_checked": n_checked, "variety": variety, "grade": grade}
    f["net_baseline"] = round(f["wf_base"]["net"])
    f["net_adverse"] = round(f["wf_adverse"]["net"])
    f["margin_pct"] = round(100 * f["inf_mean"] / f["buy_median"], 1)
    f["truck_qtl"], f["truck_t"], f["settle_days"] = 100, 10, SETTLEMENT_DAYS
    f["truck_inr"] = round(f["inf_mean"] * 100)
    f["truck_adverse_inr"] = round(f["inf_adverse"] * 100)
    route_slug = f"{o['slug']}-{d['slug']}"
    vg = f"{variety}, {grade}" if variety.lower() not in (name.lower(), "other") else grade
    same = f"same variety and grade ({vg})"
    focus = [o["id"], d["id"]]
    scenes = [
        {"kind": "intro", "headline": period, "caption":
            f"{o['name']} ({o['state']}) and {d['name']} ({d['state']}) both reported {lname} prices for the {same} on {f['n']} matched days.",
         "camera": "corridor", "focus": focus},
        {"kind": "prices", "headline": "Two markets, two prices", "caption":
            f"{o['name']} reported a median ₹{f['buy_median']:,} per quintal. {d['name']} reported a median ₹{f['sell_median']:,} around modeled arrival days. These are not offers.",
         "camera": "corridor", "focus": focus, "cards": focus},
        {"kind": "gap", "headline": f"Gap ₹{f['gross_median']:,}/qtl", "caption":
            f"The median gap was ₹{f['gross_median']:,} per quintal, and {d['name']} was dearer on {f['persistence_pct']}% of days.",
         "camera": "corridor", "focus": focus, "chart": "gap"},
        {"kind": "route", "headline": f"{f['km']:,.0f} km by road", "caption":
            f"{f['km']:,.0f} km on OpenStreetMap roads (~{f['hours']:.0f} hours by car). A loaded truck is slower, so we allow {f['transit_days']} days plus {SETTLEMENT_DAYS} days to get paid.",
         "camera": "corridor", "focus": focus, "route": route_slug, "truck": True},
        {"kind": "costs", "headline": "After modeled costs", "caption":
            f"Freight ≈₹{f['freight']:,}/qtl, 5% fees and commission, loading, 5% loss and interest. On the typical day ₹{f['net_baseline']:,} per quintal was left.",
         "camera": "corridor", "focus": focus, "route": route_slug, "chart": "waterfall"},
        {"kind": "stress", "headline": "Still positive under stress", "caption":
            f"With 25% dearer freight, 10% loss and costlier credit, the typical day still kept ₹{f['net_adverse']:,} per quintal.",
         "camera": "corridor", "focus": focus, "route": route_slug, "chart": "waterfall"},
        {"kind": "strategy", "headline": "A trader who only knew the morning's news", "caption":
            f"Using only the latest available {d['name']} report, the rule selects {f['inf_shipped']} of {f['inf_considered']} modeled shipping days. "
            f"{f['inf_won']} had positive modeled net, averaging ₹{f['inf_mean']:,} per quintal (₹{f['inf_adverse']:,} under stress).",
         "camera": "corridor", "focus": focus, "route": route_slug, "chart": "strategy"},
        {"kind": "conclusion", "headline": "The back-test", "caption":
            f"The modeled {name} route from {o['name']} to {d['name']} was positive on {f['paying_pct']}% of matched days in {period}. At that average, a 100-quintal (10-tonne) load implies ₹{f['truck_inr']:,}, "
            f"or ₹{f['truck_adverse_inr']:,} under stress. Actual buyer, capacity, haggling, rejection and delays are unknown.",
         "camera": "corridor", "focus": focus, "route": route_slug},
    ]
    assumptions = list(costs["assumptions"])
    if base_name(product) != "onion":
        assumptions.insert(1, {"kind": "assumption", "item": "Freight for this product",
                               "value": f"onion survey freight applied per quintal to {lname}", "source": None})
    assumptions.append({"kind": "assumption", "item": "Truck transit", "value": f"~450 road km a day → {transit} days here", "source": None})
    level = "moderate"  # reported prices and *modeled* costs never verify a commercial trade
    title = f"{name}: modeled ₹{f['inf_mean']:,}/qtl left, {o['name']} → {d['name']}"
    story = {
        "id": f"{slug}-{m}-trade-{route_slug}", "kind": "corridor", "verdict": "positive_modeled_surplus", "commodity": slug, "commodity_name": name,
        "period": m, "engine": ENGINE_VERSION, "title": title,
        "summary": (f"{period}: reported {lname} prices at {o['name']} and {d['name']} imply a positive modeled margin after costs on {f['paying_pct']}% of {f['n']} matched days; "
                    f"a morning-report back-test averages ₹{f['inf_mean']:,} per quintal. No actual trade verified."),
        "why_selected": (f"Selected from {f['n_checked']:,} same-variety market pairs screened for {lname} in {period}; best tested candidate among the bounded set of routed finalists, not a global optimum."),
        "evidence": {"level": level,
                     "observations": f"daily modal prices for the {same} at both markets; sale matched to the first {d['name']} report {transit}–{transit + 2} days after purchase",
                     "caveats": ["Back-test on reported prices: no actual shipment, buyer or seller is claimed.",
                                 "Modal prices are reported daily aggregates, not offers anyone could be sure to get.",
                                 "This data has no arrival volumes, so it cannot show whether the destination could absorb more supply; no capital-constrained or volume allocation optimum is claimed.",
                                 "Costs extrapolate onion survey values (including to other crops) plus stated allowances, not freight quotes; OSRM car routing, not a verified truck route. Representative town points may not be at mandi gates.",
                                 "Historical: this says what paid then, not what pays today."]},
        "facts": f, "markets": [o, d],
        "routes": [{"slug": route_slug, "path": route["geometry"], "km": route["distance_km"], "hours": route["duration_h"],
                    "provider": route["provider"], "profile": route["profile"], "truck_suitable": False, "requested": route["requested"]}],
        "scenes": scenes, "assumptions": assumptions,
        "trades": [{k: t[k] for k in ("buy", "sell", "buy_price", "sell_price", "gross", "net_baseline", "net_adverse")}
                   | {"informed_ship": next((x["ship"] for x in inf["decisions"] if x["buy"] == t["buy"]), False)} for t in tr],
        "conclusion": scenes[-1]["caption"], "sources": SOURCES, "score": 0.0,
    }
    return story


# ---------------------------------------------------------------- build
def build(max_routes: int = 45) -> dict:
    import httpx
    t0 = time.time()
    con = _con()
    load_daily(con)
    print(f"daily rows {con.execute('select count(*) from daily').fetchone()[0]:,} in {time.time() - t0:.0f}s", flush=True)
    pts = market_points(con)
    names = market_names(con)
    cands = [r for r in candidate_pairs(con, pts) if not excluded(r[0])]
    # Every well-reported same-variety ordered market pair in the month counts as "checked".
    checked = {(c, ym): int(n) for c, ym, n in con.execute(
        "select commodity, ym, sum(k * (k - 1)) from (select commodity, variety, grade, ym, count(*) k from monthly group by all) group by all").fetchall()}
    print(f"prefilter candidates {len(cands):,} in {time.time() - t0:.0f}s", flush=True)
    keys = set()
    for c, v, g, ym, osn, odn, omn, dsn, ddn, dmn, km, _ in cands:
        keys.add((c, v, g, osn, odn, omn))
        keys.add((c, v, g, dsn, ddn, dmn))
    series = series_for(con, keys)
    latest = con.execute("select max(d) from daily").fetchone()[0].isoformat()
    # Pass 1: daily evaluation with an estimated road distance.
    stage1 = []
    for c, v, g, ym, osn, odn, omn, dsn, ddn, dmn, km, _ in cands:
        o_s, d_s = series.get((c, v, g, osn, odn, omn), {}), series.get((c, v, g, dsn, ddn, dmn), {})
        td = transit_days_for(km)
        costs = corridor_cost_params(route_km=km, period=ym)
        if costs["status"] != "sourced":
            continue
        ev = evaluate_corridor_month(o_s, d_s, ym, transit_days=td, costs=costs)
        ok, _why = qualifies(ev, km=km, leafy=is_leafy(c))
        if ok:
            stage1.append((score_of(ev, statistics.median(t["buy_price"] for t in ev["trades"])), c, v, g, ym, (osn, odn, omn), (dsn, ddn, dmn)))
    stage1.sort(reverse=True)
    finalists = select_finalists(stage1)
    print(f"stage1 pass {len(stage1):,}; finalists {len(finalists):,} across "
          f"{len({(r[1], r[4]) for r in finalists}):,} product-months", flush=True)
    # Pass 2: retained named-place points + OSRM roads; never invent a route.
    rcache = _load(ROUTES)
    cached = {(row[5], row[6]) for row in finalists
              if rcache.get("|".join(row[5]) + ">" + "|".join(row[6]))}
    routed = prioritize_routes(finalists, cached, max_routes)
    print(f"coverage routing: {len(cached)} cached, {len(routed) - len(cached)} new of "
          f"{len({(r[5], r[6]) for r in finalists})} candidate corridors", flush=True)
    client = httpx.Client()
    known = {}
    mi = ROOT / "data/derived/market_ids.parquet"
    for sn, dn, mn, i in con.execute(f"select state_norm, district_norm, market_norm, id from '{mi}'").fetchall():
        known[(sn, dn, mn)] = i
    best: dict = {}
    n_route = 0
    route_budget_hit = len({(r[5], r[6]) for r in finalists}) > len(routed)
    for i, (sc, c, v, g, ym, ok_, dk_) in enumerate(finalists):
        if (ok_, dk_) not in routed:
            continue
        po, pd = pts[ok_], pts[dk_]
        rk = "|".join(ok_) + ">" + "|".join(dk_)
        if rk not in rcache:
            if n_route >= max_routes:
                route_budget_hit = True
                continue
            n_route += 1
        route = osrm_route(client, po, pd, rcache, rk)
        if i % 25 == 0:
            ROUTES.write_text(json.dumps(rcache, separators=(",", ":")))
            print(f"  verify {i}/{len(finalists)} stories {len(best)} routes {n_route} {time.time() - t0:.0f}s", flush=True)
        if not route:
            continue
        km = route["distance_km"]
        td = transit_days_for(km)
        costs = corridor_cost_params(route_km=km, period=ym)
        ev = evaluate_corridor_month(series[(c, v, g, *ok_)], series[(c, v, g, *dk_)], ym, transit_days=td, costs=costs)
        ok, _why = qualifies(ev, km=km, leafy=is_leafy(c))
        if not ok:
            continue

        def mk(key, p):
            st, di, nm = names[key]
            return {"id": market_id(*key, known), "name": nm.strip(), "state": st.strip(), "district": di.strip(),
                    "lat": p["lat"], "lon": p["lon"], "precision": p["precision"],
                    "slug": re.sub(r"[^a-z0-9]+", "-", key[2]).strip("-")}
        story = trade_story(product=c, variety=v, grade=g, m=ym, o=mk(ok_, po), d=mk(dk_, pd), route=route, ev=ev, costs=costs,
                            transit=td, n_checked=checked.get((c, ym), 0))
        story["score"] = score_of(ev, story["facts"]["buy_median"])
        validate_story(story)
        if story["score"] > best.get((c, ym), {}).get("score", -1):
            best[(c, ym)] = story
    ROUTES.write_text(json.dumps(rcache, separators=(",", ":")))
    print(f"routes requested {n_route}/{max_routes}; budget hit {route_budget_hit}", flush=True)
    raw_products = con.execute(f"select Commodity, count(*) n from '{ROOT / 'data/raw/mandi_all/all_*.parquet'}' group by 1 order by n desc").fetchall()
    return write(list(best.values()), latest, raw_products=raw_products, source_products=len(raw_products),
                 eligible_products=con.execute("select count(distinct commodity) from monthly").fetchone()[0],
                 candidate_products=len({x[0] for x in cands}),
                 screened_pairs=sum(checked.values()), evaluated_pairs=len(cands), tested_pairs=len(stage1),
                 routed_pairs=len([v for v in rcache.values() if v]), route_budget_hit=route_budget_hit)


def write(stories: list, latest: str, raw_products: list[tuple[str, int]] | None = None, **coverage) -> dict:
    for p in OUT.iterdir() if OUT.exists() else []:
        if p.is_dir():
            shutil.rmtree(p)
    OUT.mkdir(parents=True, exist_ok=True)
    for s in stories:
        for mk in s["markets"]:
            mk.pop("slug", None)
    cat = {"engine": ENGINE_VERSION, "data_snapshot": hashlib.sha256(json.dumps(sorted(s["id"] for s in stories)).encode()).hexdigest()[:12],
           "latest_observation": latest, "story_count": len(stories), "commodities": {}, "products": {}, "featured": [],
           "coverage": coverage}
    # Include all source commodities in the selector, even those with zero safe
    # stories. Distinct source spellings like tulip/Tulip map to one product.
    for name, _n in raw_products or []:
        cat["products"].setdefault(product_slug(name), {"name": name, "stories": 0, "best": 0})
    by_year: dict = {}
    for s in stories:
        by_year.setdefault((s["commodity"], s["period"][:4]), []).append(s)
        c = cat["commodities"].setdefault(s["commodity"], {"months": {}})
        c["months"].setdefault(s["period"], []).append({"id": s["id"], "kind": s["kind"], "title": s["title"], "score": s["score"]})
        pr = cat["products"].setdefault(s["commodity"], {"name": s["commodity_name"], "stories": 0, "best": 0})
        pr["stories"] += 1
        pr["best"] = max(pr["best"], s["score"])
    for (c, y), sts in by_year.items():
        (OUT / c).mkdir(exist_ok=True)
        (OUT / c / f"{y}.json").write_text(json.dumps(sorted(sts, key=lambda s: s["id"]), ensure_ascii=False, separators=(",", ":")))
    seen = set()
    for s in sorted(stories, key=lambda s: -s["score"]):
        if s["commodity"] in seen:
            continue
        seen.add(s["commodity"])
        cat["featured"].append({"id": s["id"], "title": s["title"], "commodity": s["commodity"], "period": s["period"],
                                "kind": s["kind"], "teaser": s["summary"]})
        if len(cat["featured"]) == 3:
            break
    (OUT / "catalog.json").write_text(json.dumps(cat, ensure_ascii=False, separators=(",", ":")))
    return cat


if __name__ == "__main__":
    cat = build(*(int(a) for a in sys.argv[1:]))
    print(json.dumps({k: cat[k] for k in ("engine", "latest_observation", "story_count", "featured")}, indent=1, ensure_ascii=False))
    print("products:", len(cat["products"]))
