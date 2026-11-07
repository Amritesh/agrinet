"""AGRINET 4.0 monthly story engine.

Deterministic, offline. Every number shown in a story is computed here from
retained Agmarknet modal-price observations or from an explicitly labelled
assumption. Nothing is invented by a language model.

Run: uv run python -m pipeline.stories   (needs data/derived/*.parquet)
"""
from __future__ import annotations

import hashlib
import json
import re
import statistics
from datetime import date, timedelta
from pathlib import Path

from analytics.economics import calculate_economics

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public" / "stories"
EVIDENCE = ROOT / "evidence"
ENGINE_VERSION = "stories-1.0.0"
COMMODITIES = {23: "onion", 24: "potato", 78: "tomato"}
NAMES = {"onion": "Onion", "potato": "Potato", "tomato": "Tomato"}

# ---------------------------------------------------------------- evidence
RBI = {
    "id": "rbi-wps-depr-08-2024",
    "title": "RBI Working Paper WPS (DEPR) 08/2024 — Price Dynamics of Tomato, Onion and Potato",
    "url": "https://www.rbi.org.in/Scripts/PublicationsView.aspx?id=22723",
    "reference_period": "survey values for TE 2021-22, published 2024",
}
ANCHOR_ROUTE_KM = 1114.8  # OSRM car-profile road distance Lasalgaon -> Azadpur (evidence/story_routes_osrm.json)
ANCHOR_FREIGHT_PER_QTL = 240.0  # RBI: "transport of about Rs 240 per quintal" Nashik -> Delhi (onion)
COST_WINDOW = ("2021-01", "2026-04")  # periods where RBI 2021-22 survey costs are used, nominal, not inflation-adjusted
SETTLEMENT_DAYS = 7  # assumption: capital tied up for transit + 7 days settlement


def corridor_cost_params(*, route_km: float, period: str) -> dict:
    """Cost scenarios for one road corridor. Returns no numbers outside the evidence window."""
    if not (COST_WINDOW[0] <= period <= COST_WINDOW[1]):
        return {"status": "unsupported_period", "scenarios": None, "assumptions": [],
                "reason": f"Cited cost evidence covers {COST_WINDOW[0]} to {COST_WINDOW[1]} only."}
    freight = round(ANCHOR_FREIGHT_PER_QTL * route_km / ANCHOR_ROUTE_KM, 2)
    base = {"freight_per_qtl": freight, "fee_fraction": 0.05, "loading_per_qtl": 9.02,
            "loss_fraction": 0.05, "annual_rate": 0.12}
    adverse = dict(base, freight_per_qtl=round(freight * 1.25, 2), loss_fraction=0.10, annual_rate=0.14)
    assumptions = [
        {"kind": "sourced", "item": "Freight", "value": f"≈₹240 per quintal Nashik→Delhi", "source": RBI["id"]},
        {"kind": "assumption", "item": "Freight on other distances",
         "value": f"scaled by road km against the 1,115 km Lasalgaon→Azadpur route → ₹{freight:,.0f}/qtl here", "source": None},
        {"kind": "sourced", "item": "Mandi fee + commission", "value": "1% + 4% of purchase value", "source": RBI["id"]},
        {"kind": "sourced", "item": "Loading/unloading", "value": "₹9.02 per quintal", "source": RBI["id"]},
        {"kind": "assumption", "item": "Weight & quality loss in transit", "value": "5% baseline, 10% adverse", "source": None},
        {"kind": "assumption", "item": "Working capital", "value": f"12% a year (14% adverse) for transit + {SETTLEMENT_DAYS} days", "source": None},
        {"kind": "assumption", "item": "Adverse freight", "value": "+25% over baseline", "source": None},
    ]
    return {"status": "sourced", "scenarios": {"baseline": base, "adverse": adverse}, "assumptions": assumptions,
            "reason": "Nominal 2021-22 survey costs; not inflation-adjusted; not a freight quote."}


def net_per_qtl(buy: float, sell: float, sc: dict, *, financing_days: float) -> float:
    """Modeled net surplus for one input quintal, via the audited economics engine."""
    fee = sc["fee_fraction"] * buy
    r = calculate_economics(
        purchase_price_inr_per_kg=f"{buy / 100:.6f}", sale_price_inr_per_kg=f"{sell / 100:.6f}",
        quantity_kg=100, loss_fraction=f"{sc['loss_fraction']:.6f}",
        costs_inr={"freight": f"{sc['freight_per_qtl']:.4f}", "market_fees": f"{fee:.4f}",
                   "loading": f"{sc['loading_per_qtl']:.4f}"},
        annual_financing_rate=f"{sc['annual_rate']:.6f}", financing_days=f"{financing_days:g}")
    return float(r["margin_inr"])


def waterfall(buy: float, sell: float, sc: dict, *, financing_days: float) -> dict:
    """Per-quintal cost walk from purchase to modeled net; reconciles with net_per_qtl."""
    fees = sc["fee_fraction"] * buy
    capital = buy + sc["freight_per_qtl"] + fees + sc["loading_per_qtl"]
    interest = capital * sc["annual_rate"] * financing_days / 365
    loss = sell * sc["loss_fraction"]
    net = net_per_qtl(buy, sell, sc, financing_days=financing_days)
    r = lambda v: round(v, 2)
    return {"buy": r(buy), "freight": r(sc["freight_per_qtl"]), "fees": r(fees), "loading": r(sc["loading_per_qtl"]),
            "loss": r(loss), "interest": r(interest), "sell": r(sell), "net": r(net)}


def typical(trades: list, key: str) -> dict:
    """The actual trade at the (lower) median rank of `key` — a real day, not an average of two."""
    srt = sorted(trades, key=lambda t: t[key])
    return srt[(len(srt) - 1) // 2]


# ---------------------------------------------------------------- statistics
def month_of(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def prev_month(m: str) -> str:
    y, mo = int(m[:4]), int(m[5:])
    return f"{y - 1}-12" if mo == 1 else f"{y}-{mo - 1:02d}"


def panel_change(mm: dict, month: str) -> dict:
    """Median % change of market monthly medians, using only markets present in both months."""
    pm = prev_month(month)
    ch = []
    for (mid, m), v in mm.items():
        if m == month and (mid, pm) in mm and mm[(mid, pm)] > 0:
            ch.append((mid, 100.0 * (v - mm[(mid, pm)]) / mm[(mid, pm)]))
    if not ch:
        return {"n_markets": 0, "median_pct": None, "share_up": None, "changes": []}
    vals = [c for _, c in ch]
    return {"n_markets": len(ch), "median_pct": statistics.median(vals),
            "share_up": sum(1 for v in vals if v > 0) / len(vals), "changes": ch}


def seasonal_z(hist: dict, month: str) -> float | None:
    """z-score of `month`'s value against the same calendar month in PRIOR years only (>=5)."""
    mo = month[5:]
    prior = [v for m, v in hist.items() if m[5:] == mo and m < month and v is not None]
    if len(prior) < 5 or hist.get(month) is None:
        return None
    sd = statistics.pstdev(prior)
    if sd == 0:
        return None
    return round((hist[month] - statistics.mean(prior)) / sd, 2)


# ---------------------------------------------------------------- corridors
def evaluate_corridor_month(origin: dict, dest: dict, month: str, *, transit_days: int, costs: dict) -> dict:
    """Buy at origin on day b, sell at destination on the first report in [b+transit, b+transit+2]."""
    sc = costs.get("scenarios")
    fin_days = transit_days + SETTLEMENT_DAYS
    trades, trades_ord = [], []
    for b in sorted(k for k in origin if month_of(k) == month):
        s = next((b + timedelta(days=transit_days + k) for k in range(3)
                  if b + timedelta(days=transit_days + k) in dest), None)
        if s is None:
            continue
        bp, sp = origin[b], dest[s]
        t = {"buy": b.isoformat(), "sell": s.isoformat(), "buy_price": bp, "sell_price": sp, "gross": round(sp - bp, 2)}
        if sc:
            t["net_baseline"] = round(net_per_qtl(bp, sp, sc["baseline"], financing_days=fin_days), 2)
            t["net_adverse"] = round(net_per_qtl(bp, sp, sc["adverse"], financing_days=fin_days), 2)
        trades.append(t)
        trades_ord.append({"buy_date": b.toordinal(), "sell_date": s.toordinal()})
    gross = [t["gross"] for t in trades]
    ev = {"n": len(trades), "trades": trades, "trades_ord": trades_ord,
          "gross_median": statistics.median(gross) if gross else None,
          "persistence": (sum(1 for g in gross if g > 0) / len(gross)) if gross else None,
          "net_baseline_median": None, "net_adverse_median": None, "informed": None, "hindsight": None}
    if not sc or not trades:
        return ev
    # "Median" here is the typical actual day (lower-median rank), so captions, charts and verdicts agree.
    ev["net_baseline_median"] = typical(trades, "net_baseline")["net_baseline"]
    ev["net_adverse_median"] = typical(trades, "net_adverse")["net_adverse"]
    # Perfect hindsight: knows every realised sale price in advance; ships only winning days.
    winners = [t["net_baseline"] for t in trades if t["net_baseline"] > 0]
    ev["hindsight"] = {"label": "Perfect-hindsight simulation", "best_net_per_qtl": max(t["net_baseline"] for t in trades),
                       "profitable_days": len(winners), "mean_net_if_only_winners": round(statistics.mean(winners), 2) if winners else None}
    # Historically informed: on buy day b, expected sale = latest destination report strictly BEFORE b.
    dkeys = sorted(dest)
    decisions = []
    for t in trades:
        b = date.fromisoformat(t["buy"])
        known = [k for k in dkeys if k < b]
        if not known:
            continue
        exp = net_per_qtl(t["buy_price"], dest[known[-1]], sc["baseline"], financing_days=fin_days)
        decisions.append({"buy": t["buy"], "known_dest_date": known[-1].isoformat(), "expected_net": round(exp, 2),
                          "ship": exp > 0, "realized_net": t["net_baseline"], "realized_adverse": t["net_adverse"]})
    shipped = [x["realized_net"] for x in decisions if x["ship"]]
    shipped_adv = [x["realized_adverse"] for x in decisions if x["ship"]]
    ev["informed"] = {"label": "Historically informed rule (uses only reports available before the decision)",
                      "rule": "ship when the latest destination report before buying implies a positive modeled net",
                      "decisions": decisions, "shipped": len(shipped), "considered": len(decisions),
                      "realized_net_per_qtl_mean": round(statistics.mean(shipped), 2) if shipped else None,
                      "realized_adverse_per_qtl_mean": round(statistics.mean(shipped_adv), 2) if shipped_adv else None,
                      "shipped_losing": sum(1 for x in shipped if x <= 0)}
    return ev


def classify_corridor(ev: dict) -> str:
    if ev["n"] < 10:
        return "insufficient"
    if ev["gross_median"] is not None and ev["gross_median"] < 0 and (ev["persistence"] or 0) < 0.25:
        return "reverse_gap"
    if ev["net_baseline_median"] is None:
        return "gross_only"
    if ev["net_adverse_median"] > 0:
        return "survives_costs"
    if ev["net_baseline_median"] > 0:
        return "fragile_margin"
    if ev["gross_median"] > 0:
        return "looked_profitable"
    return "no_gap"


CORRIDORS = [
    {"slug": "lasalgaon-azadpur", "commodity": "onion", "origin_id": 1512, "origin_key": "lasalgaon",
     "dest_id": 1689, "dest_key": "azadpur", "transit_days": 2,
     "why": "Lasalgaon (Nashik) is India's best-known onion auction; Azadpur (Delhi) is the largest terminal market it feeds, a link the RBI paper describes."},
    {"slug": "lasalgaon-vashi", "commodity": "onion", "origin_id": 1512, "origin_key": "lasalgaon",
     "dest_id": 1485, "dest_key": "vashi new mumbai", "transit_days": 1,
     "why": "The short road from Nashik's onion belt to Mumbai's wholesale market at Vashi."},
    {"slug": "agra-vashi", "commodity": "potato", "origin_id": 2736, "origin_key": "agra",
     "dest_id": 1485, "dest_key": "vashi new mumbai", "transit_days": 2,
     "why": "Agra sits in western Uttar Pradesh's cold-stored potato belt; Vashi supplies Mumbai."},
]


def story_id(commodity: str, month: str, kind: str, slug: str | None = None) -> str:
    return "-".join(x for x in (commodity, month, kind, slug) if x)


# ---------------------------------------------------------------- validation
NUM = re.compile(r"(?<![\w.])[-−]?\d[\d,]*(?:\.\d+)?")


def _allowed_numbers(story: dict) -> set[str]:
    ok: set[str] = set()

    def add(v):
        if isinstance(v, bool) or v is None:
            return
        if isinstance(v, (int, float)):
            for s in (f"{v:,.0f}", f"{abs(v):,.0f}", f"{v:.0f}", f"{abs(v):.0f}", f"{v:,.1f}", f"{abs(v):,.1f}",
                      f"{v:,.2f}", f"{abs(v):,.2f}", str(v)):
                ok.add(s.replace(",", ""))
        elif isinstance(v, str):
            for m in NUM.findall(v):
                ok.add(m.replace(",", "").replace("−", "-").lstrip("-"))
        elif isinstance(v, dict):
            for x in v.values():
                add(x)
        elif isinstance(v, (list, tuple)):
            for x in v:
                add(x)
    add(story["facts"])
    add([story["period"], story.get("sources"), [a.get("value") for a in story.get("assumptions", [])]])
    return ok


def validate_story(story: dict) -> None:
    allowed = _allowed_numbers(story)
    texts = [story["title"], story["summary"], story.get("why_selected", ""), story.get("conclusion", "")]
    texts += [s["caption"] for s in story["scenes"]] + [s.get("headline", "") for s in story["scenes"]]
    for txt in texts:
        for m in NUM.findall(txt):
            if m.replace(",", "").replace("−", "-").lstrip("-") not in allowed:
                raise ValueError(f"number {m!r} in {txt[:60]!r} does not resolve to a fact")
    ids = set()
    for mk in story["markets"]:
        if mk.get("lat") is None or mk.get("lon") is None or not mk.get("precision"):
            raise ValueError(f"market {mk.get('name')} lacks geography/precision")
        if not (6 <= mk["lat"] <= 37.5 and 68 <= mk["lon"] <= 98):
            raise ValueError(f"market {mk.get('name')} geography outside India")
        ids.add(mk["id"])
    for s in story["scenes"]:
        for f in s.get("focus", []):
            if f not in ids:
                raise ValueError(f"scene focus {f} has no geography")
        if s.get("route") and s["route"] not in {r["slug"] for r in story.get("routes", [])}:
            raise ValueError("scene route missing geometry")
    if not story.get("sources"):
        raise ValueError("story without provenance")


def example_story_for_tests() -> dict:
    return {
        "id": "onion-2023-04-gap-x", "title": "A 344 rupee gap", "summary": "Median gap ₹344 per quintal over 16 days.",
        "period": "2023-04", "facts": {"gap": 343.5, "days": 16},
        "markets": [{"id": 1, "name": "A", "lat": 20.1, "lon": 74.2, "precision": "osm_point"},
                    {"id": 2, "name": "B", "lat": 28.7, "lon": 77.2, "precision": "osm_point"}],
        "routes": [{"slug": "a-b", "path": [[74.2, 20.1], [77.2, 28.7]]}],
        "scenes": [{"caption": "In 2023-04 the gap was ₹344.", "focus": [1, 2]},
                   {"caption": "16 matched days.", "focus": [1], "route": "a-b"}],
        "sources": [{"id": "agmarknet"}],
    }


# ---------------------------------------------------------------- build (needs local data)
def fmt_month(m: str) -> str:
    return date(int(m[:4]), int(m[5:]), 1).strftime("%B %Y")


def _load(commodity_id: int):
    import duckdb
    c = duckdb.connect()
    P = f"'{ROOT / 'data/derived/price_daily.parquet'}'"
    M = f"'{ROOT / 'data/derived/market_ids.parquet'}'"
    # Exact (state, district, market) identity join: sub-yards and renamed APMC identities are never merged.
    daily = c.sql(f"""select m.id, p.obs_date, p.modal_price from {P} p
                      join {M} m using (state_norm, district_norm, market_norm)
                      where p.commodity_id={commodity_id} and p.modal_price > 0""").fetchall()
    return daily


def _market_meta():
    rows = json.loads((ROOT / "web/public/data/markets.json").read_text())
    return {r["id"]: r for r in rows}


def _osm_points():
    p = json.loads((EVIDENCE / "story_points_nominatim.json").read_text())
    return {k: v for k, v in p["results"].items() if v}


def _routes():
    return {f"{r['origin']}|{r['destination']}": r for r in json.loads((EVIDENCE / "story_routes_osrm.json").read_text())}


def precision_of(src: str) -> str:
    return {"district_centroid": "approximate: district centre", "state_centroid": "approximate: state centre",
            "nominatim": "geocoded point (OpenStreetMap)", "nominatim_near": "approximate: nearby place",
            "nominatim_state": "approximate: state-level match"}.get(src, f"approximate: {src or 'unknown'}")


def build() -> dict:
    meta, osm, routes = _market_meta(), _osm_points(), _routes()
    OUT.mkdir(parents=True, exist_ok=True)
    data_hash = hashlib.sha256((ROOT / "web/public/data/coverage.json").read_bytes()).hexdigest()[:12]
    catalog = {"engine": ENGINE_VERSION, "data_snapshot": data_hash, "latest_observation": None, "commodities": {}, "featured": []}
    all_stories = []
    for cid, cslug in COMMODITIES.items():
        daily = _load(cid)
        catalog["latest_observation"] = max(catalog["latest_observation"] or "", max(d.isoformat() for _, d, _ in daily))
        by_mm: dict = {}
        by_mkt: dict = {}
        for mid, d, p in daily:
            by_mm.setdefault((mid, month_of(d)), []).append(p)
            by_mkt.setdefault(mid, {})[d] = p
        mm = {k: statistics.median(v) for k, v in by_mm.items() if len(v) >= 5}
        counts = {k: len(v) for k, v in by_mm.items()}
        months = sorted({m for _, m in mm})
        panel = {m: panel_change(mm, m) for m in months}
        hist = {m: p["median_pct"] for m, p in panel.items() if p["n_markets"] >= 20}
        stories = []
        for m in months:
            p = panel[m]
            if p["n_markets"] < 20:
                continue
            z = seasonal_z(hist, m)
            st = shock_story(cslug, m, p, z, mm, meta, counts)
            if st:
                stories.append(st)
        for cor in (c for c in CORRIDORS if c["commodity"] == cslug):
            route = routes[f"{cor['origin_key']}|{cor['dest_key']}"]
            for m in months:
                costs = corridor_cost_params(route_km=route["distance_km"], period=m)
                ev = evaluate_corridor_month(by_mkt.get(cor["origin_id"], {}), by_mkt.get(cor["dest_id"], {}), m,
                                             transit_days=cor["transit_days"], costs=costs)
                kind = classify_corridor(ev)
                if kind in ("insufficient",):
                    continue
                st = corridor_story(cslug, m, cor, ev, kind, costs, route, meta, osm)
                if st:
                    stories.append(st)
        if cslug == "potato":
            stories += storage_stories(by_mkt.get(2736, {}), meta, osm)
        for st in stories:
            validate_story(st)
        all_stories += stories
        idx: dict = {}
        for st in stories:
            idx.setdefault(st["period"], []).append({"id": st["id"], "kind": st["kind"], "title": st["title"], "score": st["score"]})
        for v in idx.values():
            v.sort(key=lambda x: -x["score"])
        catalog["commodities"][cslug] = {"months": idx}
    by_year: dict = {}
    for st in all_stories:
        by_year.setdefault((st["commodity"], st["period"][:4]), []).append(st)
    for (c, y), sts in by_year.items():
        (OUT / c).mkdir(exist_ok=True)
        (OUT / c / f"{y}.json").write_text(json.dumps(sorted(sts, key=lambda s: s["id"]), ensure_ascii=False, separators=(",", ":")))
    catalog["featured"] = pick_featured(all_stories)
    catalog["story_count"] = len(all_stories)
    (OUT / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")))
    return catalog


def pick_featured(stories: list) -> list:
    """Three strong, different stories: best corridor-economics, best shock, best storage."""
    out = []
    for kinds, com in ((("corridor",), "onion"), (("shock",), None), (("storage",), None)):
        cands = sorted((s for s in stories if s["kind"] in kinds and s["evidence"]["level"] in ("strong", "moderate")
                        and (com is None or s["commodity"] == com) and s.get("verdict") not in ("gross_only", "no_gap", "reverse_gap")),
                       key=lambda s: -s["score"])
        if cands:
            s = cands[0]
            out.append({"id": s["id"], "title": s["title"], "commodity": s["commodity"], "period": s["period"],
                        "kind": s["kind"], "teaser": s["summary"]})
    return out


# ---------------------------------------------------------------- story writers
def inr(v) -> str:
    v = round(v)
    return f"−₹{abs(v):,}" if v < 0 else f"₹{v:,}"


def a_an(word: str) -> str:
    return ("An " if word[:1].lower() in "aeiou" else "A ") + word
AGMARK = {"id": "agmarknet", "title": "Agmarknet / data.gov.in daily mandi modal prices (retained AGRINET snapshot)",
          "url": "https://data.gov.in/catalog/current-daily-price-various-commodities-various-markets-mandi"}


def _mk(mid, meta, osm_key=None, osm=None):
    if osm_key and osm and osm_key in osm:
        o = osm[osm_key]
        return {"id": mid, "name": meta[mid]["n"], "state": meta[mid]["s"], "lat": round(float(o["lat"]), 4),
                "lon": round(float(o["lon"]), 4), "precision": "verified point (OpenStreetMap)"}
    m = meta.get(mid)
    if not m:
        return None
    return {"id": mid, "name": m["n"], "state": m["s"], "lat": m["lat"], "lon": m["lon"], "precision": precision_of(m.get("src"))}


def shock_story(c: str, m: str, p: dict, z, mm: dict, meta: dict, counts: dict):
    if z is None or abs(z) < 2 or p["median_pct"] is None:
        return None
    up = p["median_pct"] > 0
    pm = prev_month(m)
    # Spotlight robust movers: well-reported markets (>=10 reports in both months), then the busiest of the top quartile.
    ch = [(mid, v) for mid, v in p["changes"] if mid in meta and counts.get((mid, m), 0) >= 10 and counts.get((mid, pm), 0) >= 10]
    ch.sort(key=lambda x: -x[1] if up else x[1])
    q = ch[:max(3, len(ch) // 4)]
    # Prefer markets with a verified point location over district-centre approximations, then the busiest.
    approx = lambda mid: meta[mid].get("src") != "nominatim"
    top = sorted(q, key=lambda x: (approx(x[0]), -(counts[(x[0], m)] + counts[(x[0], pm)])))[:3]
    states: dict = {}
    for mid, v in p["changes"]:
        if mid in meta:
            states.setdefault(meta[mid]["s"], []).append(v)
    st_rank = sorted(((s_, statistics.median(v), len(v)) for s_, v in states.items() if len(v) >= 15), key=lambda x: -abs(x[1]))
    lead = st_rank[0] if st_rank else None
    agree = sum(1 for _, v in p["changes"] if (v > 0) == up) / p["n_markets"]
    mkts = []
    for mid, v in sorted(p["changes"], key=lambda x: -abs(x[1]))[:120]:
        mk = _mk(mid, meta)
        if mk:
            mk["pct"] = round(v, 1)
            mk["price"] = round(mm[(mid, m)])
            mk["prev"] = round(mm[(mid, pm)])
            mkts.append(mk)
    mk_by = {x["id"]: x for x in mkts}
    top = [(mid, v) for mid, v in top if mid in mk_by]
    word = "jumped" if up else "fell"
    facts = {"prev_month": pm, "median_pct": round(p["median_pct"], 1), "abs_median_pct": round(abs(p["median_pct"]), 1), "z": z, "abs_z": abs(z),
             "n_markets": p["n_markets"], "agree_pct": round(100 * agree), "lead_state_pct": round(lead[1], 1) if lead else None,
             "lead_state_n": lead[2] if lead else None,
             "top": [{"id": mid, "pct": round(v, 1), "price": mk_by[mid]["price"], "prev": mk_by[mid]["prev"]} for mid, v in top]}
    t0 = top[0] if top else None
    sid = story_id(c, m, "shock")
    period = fmt_month(m)
    level = "strong" if p["n_markets"] >= 100 else "moderate" if p["n_markets"] >= 40 else "limited"
    scenes = [
        {"kind": "intro", "headline": period, "caption": f"{NAMES[c]} prices across {p['n_markets']} markets that reported in both {fmt_month(pm)} and {period}.",
         "camera": "india", "focus": []},
        {"kind": "panel", "headline": f"Median move {facts['median_pct']:+.1f}%", "caption":
            f"The typical market's {c} price {word} {facts['abs_median_pct']:.1f}% in one month. {facts['agree_pct']}% of markets moved the same way.",
         "camera": "india", "focus": [], "colorBy": "pct"},
        {"kind": "rare", "headline": f"{facts['abs_z']:.1f}× the usual swing", "caption":
            f"Compared with the same month in every earlier year on record, this move was {facts['abs_z']:.1f} standard deviations from normal.",
         "camera": "india", "focus": [], "colorBy": "pct"},
    ]
    if lead:
        scenes.append({"kind": "region", "headline": lead[0], "caption":
                       f"Neighbouring markets moved together: the {lead[2]} reporting markets in {lead[0]} had a median change of {facts['lead_state_pct']:+.1f}%.",
                       "camera": "state", "state": lead[0], "focus": [x["id"] for x in mkts if x["state"] == lead[0]][:12], "colorBy": "pct"})
    if t0:
        mk = mk_by[t0[0]]
        scenes.append({"kind": "market", "headline": mk["name"], "caption":
                       f"{mk['name']} ({mk['state']}), one of the busiest markets among the biggest movers: monthly median ₹{mk['prev']:,} → ₹{mk['price']:,} per quintal ({t0[1]:+.1f}%).",
                       "camera": "focus", "focus": [mk["id"]], "cards": [mk["id"]], "colorBy": "pct"})
    scenes.append({"kind": "conclusion", "headline": "What this does and doesn't show", "caption":
                   "These are reported wholesale modal prices, not causes. Weather, arrivals or policy may explain the move, but this story shows only what markets reported.",
                   "camera": "india", "focus": [t[0] for t in top], "colorBy": "pct"})
    score = round(min(abs(z), 6) * 10 + min(p["n_markets"], 300) / 15, 2)
    return {"id": sid, "kind": "shock", "commodity": c, "period": m, "engine": ENGINE_VERSION,
            "title": f"The month {c} prices {word} across India" if p["n_markets"] >= 60 else f"{NAMES[c]} prices {word} in {period}",
            "summary": f"In {period}, the median {c} market moved {facts['median_pct']:+.1f}% in a month, {facts['abs_z']:.1f} standard deviations from the usual for that month.",
            "why_selected": f"Chosen automatically: the {facts['abs_z']:.1f}σ seasonal move is among the largest on record for {c}, across {p['n_markets']} reporting markets.",
            "evidence": {"level": level, "observations": "monthly medians of daily modal prices; markets need ≥5 reports in both months",
                         "caveats": ["Many market points are district centres, not mandi gates.", "Modal prices are reported aggregates, not transaction offers."]},
            "facts": facts, "markets": mkts, "routes": [], "scenes": scenes, "assumptions": [],
            "conclusion": scenes[-1]["caption"], "sources": [AGMARK], "score": score}


KIND_TITLES = {
    "looked_profitable": "The {c} trade that looked profitable but wasn't",
    "fragile_margin": "A thin {c} margin that breaks under stress",
    "survives_costs": "{A} price gap that outlasted modeled costs",
    "reverse_gap": "When {c} cost more at the source",
    "gross_only": "{A} price gap without cost evidence",
    "no_gap": "No {c} gap worth the road",
}


def corridor_story(c, m, cor, ev, kind, costs, route, meta, osm):
    o = _mk(cor["origin_id"], meta, cor["origin_key"], osm)
    d = _mk(cor["dest_id"], meta, cor["dest_key"], osm)
    if not o or not d:
        return None
    period = fmt_month(m)
    tr = ev["trades"]
    f = {"n": ev["n"], "gross_median": round(ev["gross_median"]), "persistence_pct": round(100 * ev["persistence"]),
         "buy_median": round(statistics.median(t["buy_price"] for t in tr)), "sell_median": round(statistics.median(t["sell_price"] for t in tr)),
         "km": route["distance_km"], "hours": route["duration_h"], "transit_days": cor["transit_days"]}
    scenes = [
        {"kind": "intro", "headline": period, "caption": cor["why"], "camera": "corridor", "focus": [o["id"], d["id"]]},
        {"kind": "prices", "headline": "Two markets, two prices", "caption":
         f"On {f['n']} matched days, {o['name']} reported a median ₹{f['buy_median']:,} per quintal; {d['name']} reported ₹{f['sell_median']:,} {cor['transit_days']} days later.",
         "camera": "corridor", "focus": [o["id"], d["id"]], "cards": [o["id"], d["id"]]},
        {"kind": "gap", "headline": f"Gap ₹{f['gross_median']:,}/qtl", "caption":
         f"The median gross gap was ₹{f['gross_median']:,} per quintal and was positive on {f['persistence_pct']}% of days.",
         "camera": "corridor", "focus": [o["id"], d["id"]], "chart": "gap"},
        {"kind": "route", "headline": f"{f['km']:,.0f} km by road", "caption":
         f"Routed road distance {f['km']:,.0f} km (OpenStreetMap car routing, ~{f['hours']:.0f} driving hours). Trucks are slower; we allow {cor['transit_days']} days.",
         "camera": "corridor", "focus": [o["id"], d["id"]], "route": cor["slug"], "truck": True},
    ]
    assumptions = costs["assumptions"]
    if ev["net_baseline_median"] is not None:
        b = costs["scenarios"]["baseline"]
        fin = cor["transit_days"] + SETTLEMENT_DAYS
        tb, ta = typical(tr, "net_baseline"), typical(tr, "net_adverse")
        f["wf_base"] = waterfall(tb["buy_price"], tb["sell_price"], b, financing_days=fin) | {"buy_date": tb["buy"], "sell_date": tb["sell"]}
        f["wf_adverse"] = waterfall(ta["buy_price"], ta["sell_price"], costs["scenarios"]["adverse"], financing_days=fin) | {"buy_date": ta["buy"], "sell_date": ta["sell"]}
        f.update({"freight": round(b["freight_per_qtl"]), "net_baseline": round(f["wf_base"]["net"]), "net_adverse": round(f["wf_adverse"]["net"]),
                  "hind_days": ev["hindsight"]["profitable_days"], "inf_shipped": ev["informed"]["shipped"], "inf_considered": ev["informed"]["considered"],
                  "inf_mean": round(ev["informed"]["realized_net_per_qtl_mean"]) if ev["informed"]["realized_net_per_qtl_mean"] is not None else None,
                  "inf_losing": ev["informed"]["shipped_losing"],
                  "inf_adverse": round(ev["informed"]["realized_adverse_per_qtl_mean"]) if ev["informed"]["realized_adverse_per_qtl_mean"] is not None else None})
        scenes.append({"kind": "costs", "headline": "Now add the costs", "caption":
                       f"Freight ≈₹{f['freight']:,}/qtl, 5% fees and commission, loading, 5% loss and interest. Modeled net on the typical (median) day: {inr(f['net_baseline'])} per quintal.",
                       "camera": "corridor", "focus": [o["id"], d["id"]], "route": cor["slug"], "chart": "waterfall"})
        scenes.append({"kind": "stress", "headline": "Stress test", "caption":
                       f"With 25% dearer freight, 10% loss and costlier credit, the typical day becomes {inr(f['net_adverse'])} per quintal.",
                       "camera": "corridor", "focus": [o["id"], d["id"]], "route": cor["slug"], "chart": "waterfall"})
        if f["inf_mean"] is not None:
            inf = (f"A trader using only reports available on the day would have shipped on {f['inf_shipped']} of {f['inf_considered']} days, "
                   f"averaging {inr(f['inf_mean'])} per quintal; {f['inf_losing']} of those shipments lost money.")
        else:
            inf = f"A trader using only reports available on the day would not have shipped on any of {f['inf_considered']} days."
        scenes.append({"kind": "strategy", "headline": "Hindsight vs. a real trader", "caption":
                       f"With perfect hindsight, {f['hind_days']} of {f['n']} days cleared modeled costs. {inf}",
                       "camera": "corridor", "focus": [o["id"], d["id"]], "route": cor["slug"], "chart": "strategy"})
    rule_note = ""
    if f.get("inf_mean") is not None and f["inf_mean"] > 0:
        rule_note = (f" A trader acting on the previous report did average {inr(f['inf_mean'])} per quintal under baseline costs"
                     + (f", but {inr(f['inf_adverse'])} under the stress test." if f.get("inf_adverse") is not None and f["inf_adverse"] <= 0 else
                        f" and {inr(f['inf_adverse'])} under stress: thin, modeled, and not proof of a real trade."))
    concl = {
        "looked_profitable": f"The ₹{f['gross_median']:,} gap looked tempting, but on the typical day modeled costs absorbed it.{rule_note} A gap on a price board is not a margin.",
        "fragile_margin": f"A modeled surplus survived baseline costs but not the stress test, so it depended on everything going right.{rule_note}",
        "survives_costs": f"Even under the stress test, the modeled median stayed positive. It is still a historical model, not proof a trade happened or would work today.",
        "reverse_gap": f"Here the source market was dearer than the destination on most days. Produce would not have flowed this way on price alone.",
        "gross_only": f"The reported gap was ₹{f['gross_median']:,} per quintal, but we have no cited cost evidence for {period}, so no after-cost result is claimed.",
        "no_gap": "There was little gap to begin with: the two markets moved together.",
    }[kind]
    scenes.append({"kind": "conclusion", "headline": "The lesson", "caption": concl, "camera": "corridor", "focus": [o["id"], d["id"]], "route": cor["slug"]})
    level = "strong" if ev["n"] >= 15 else "moderate"
    unusual = abs(f["gross_median"]) / max(f["buy_median"], 1)
    educational = {"looked_profitable": 30, "fragile_margin": 25, "survives_costs": 22, "reverse_gap": 12, "gross_only": 8, "no_gap": 2}[kind]
    score = round(educational + min(ev["n"], 25) / 2 + min(unusual * 40, 15), 2)
    ship_by = {x["buy"]: x["ship"] for x in (ev["informed"] or {}).get("decisions", [])}
    rpath = {"slug": cor["slug"], "path": route["geometry"], "km": route["distance_km"], "hours": route["duration_h"],
             "provider": route["provider"], "profile": route["profile"], "truck_suitable": False, "requested": route["requested"]}
    return {"id": story_id(c, m, "gap", cor["slug"]), "kind": "corridor", "verdict": kind, "commodity": c, "period": m, "engine": ENGINE_VERSION,
            "title": KIND_TITLES[kind].format(c=c, A=a_an(c)), "summary":
            f"{o['name']} → {d['name']}, {period}: a ₹{f['gross_median']:,} per quintal median price gap on {f['n']} matched days." + (
                f" After modeled costs: {inr(f['net_baseline'])} per quintal on the typical day." if "net_baseline" in f else " No cited cost evidence for this period."),
            "why_selected": f"Chosen automatically for {period}: one of AGRINET's documented trade corridors with {f['n']} matched report days.",
            "evidence": {"level": level, "observations": "daily modal prices; sale matched to the first destination report 1–3 days after transit",
                         "caveats": ["Hypothetical: no actual shipment is claimed.", "Modal prices may mix varieties and grades (mostly FAQ).",
                                     "Costs are survey values and assumptions, not quotes.", "OSRM car profile; truck route not verified."]},
            "facts": f, "markets": [o, d], "routes": [rpath], "scenes": scenes, "assumptions": assumptions,
            "trades": [{k: t[k] for k in ("buy", "sell", "buy_price", "sell_price", "gross") if k in t} | (
                {"net_baseline": t["net_baseline"], "net_adverse": t["net_adverse"]} if "net_baseline" in t else {}) | (
                {"informed_ship": ship_by[t["buy"]]} if t["buy"] in ship_by else {}) for t in tr],
            "conclusion": concl, "sources": [AGMARK, RBI, {"id": "osrm", "title": "OSRM demo server, OpenStreetMap data", "url": "https://router.project-osrm.org"},
                                              {"id": "nominatim", "title": "Nominatim / OpenStreetMap market points", "url": "https://nominatim.openstreetmap.org"}],
            "score": score}


def storage_stories(agra: dict, meta, osm):
    """Potato, Agra: harvest-month purchase (March) vs October sale. No storage fee is cited, so we report the break-even budget."""
    mon: dict = {}
    for d, p in agra.items():
        mon.setdefault(month_of(d), []).append(p)
    med = {m: statistics.median(v) for m, v in mon.items() if len(v) >= 8}
    out = []
    gains = {}
    for y in range(2005, 2026):
        a, b = f"{y}-03", f"{y}-10"
        if a in med and b in med:
            gains[y] = med[b] - med[a]
    for y, g in sorted(gains.items()):
        prior = [gains[k] for k in gains if k < y]
        if len(prior) < 5:
            continue
        buy, sell = med[f"{y}-03"], med[f"{y}-10"]
        # Break-even storage budget per quintal after an assumed 7% shrink/sorting loss and 12%/yr interest for 7 months.
        loss, rate, months = 0.07, 0.12, 7
        budget = sell * (1 - loss) - buy * (1 + rate * months / 12)
        exp = statistics.mean(prior)
        mk = _mk(2736, meta, "agra", osm)
        f = {"year": y, "buy": round(buy), "sell": round(sell), "gain": round(g), "gain_pct": round(100 * g / buy, 1),
             "prior_mean": round(exp), "prior_years": len(prior), "budget": round(budget), "loss_pct": 7, "rate_pct": 12, "months": months}
        verdict = "room" if budget > 0 else "no_room"
        decided = "store" if exp > 0 else "sell at harvest"
        concl = (f"Seven months of storage needed to cost less than ₹{f['budget']:,} per quintal to break even. Cold-storage rents are not in our cited evidence, so AGRINET does not claim a profit."
                 if budget > 0 else f"Even before paying any storage rent, shrinkage and interest wiped out the gain: holding lost about ₹{abs(f['budget']):,} per quintal.")
        scenes = [
            {"kind": "intro", "headline": f"March {y}", "caption": "Potatoes are harvested in early spring and often held in cold stores in western Uttar Pradesh, which the RBI paper calls the potato belt's key selling point.", "camera": "focus", "focus": [2736]},
            {"kind": "prices", "headline": "Harvest price", "caption": f"Agra's March {y} median: ₹{f['buy']:,} per quintal.", "camera": "focus", "focus": [2736], "cards": [2736]},
            {"kind": "decision", "headline": "The informed bet", "caption": f"Using only the {f['prior_years']} earlier years, March→October had averaged {'+' if f['prior_mean'] >= 0 else '−'}₹{abs(f['prior_mean']):,}. A rule-following trader would {decided}.", "camera": "focus", "focus": [2736], "chart": "storage"},
            {"kind": "outcome", "headline": f"October {y}", "caption": f"October median: ₹{f['sell']:,}, a change of {f['gain_pct']:+.1f}%.", "camera": "focus", "focus": [2736], "cards": [2736], "chart": "storage"},
            {"kind": "costs", "headline": "Shrinkage and interest", "caption": f"Allowing {f['loss_pct']}% loss and {f['rate_pct']}% a year interest for {f['months']} months leaves a storage budget of ₹{f['budget']:,} per quintal.", "camera": "focus", "focus": [2736], "chart": "storage"},
            {"kind": "conclusion", "headline": "The lesson", "caption": concl, "camera": "focus", "focus": [2736]},
        ]
        out.append({"id": story_id("potato", f"{y}-10", "storage", "agra"), "kind": "storage", "verdict": verdict, "commodity": "potato", "period": f"{y}-10",
                    "engine": ENGINE_VERSION, "title": "Why storing potatoes is complicated" if budget <= 0 else "The potato storage gamble",
                    "summary": f"Agra potatoes: ₹{f['buy']:,} in March {y}, ₹{f['sell']:,} in October. Break-even storage budget: ₹{f['budget']:,} per quintal.",
                    "why_selected": f"Chosen automatically: the yearly harvest-to-autumn storage question at Agra, with {f['prior_years']} earlier seasons to learn from.",
                    "evidence": {"level": "moderate", "observations": "monthly medians of Agra daily modal prices (≥8 reports)",
                                 "caveats": ["No cold-storage rent is cited, so no net profit is claimed.", "Stored and fresh potatoes may differ in grade."]},
                    "facts": f, "markets": [mk], "routes": [], "scenes": scenes,
                    "assumptions": [{"kind": "assumption", "item": "Shrinkage and sorting loss", "value": "7% over 7 months", "source": None},
                                    {"kind": "assumption", "item": "Working capital", "value": "12% a year", "source": None},
                                    {"kind": "missing", "item": "Cold-storage rent", "value": "not in cited evidence; shown as break-even budget", "source": None}],
                    "conclusion": concl, "sources": [AGMARK, RBI], "score": round(18 + min(abs(f["gain_pct"]), 100) / 5, 2)})
    return out


if __name__ == "__main__":
    cat = build()
    print(json.dumps({k: cat[k] for k in ("engine", "data_snapshot", "latest_observation", "story_count", "featured")}, indent=1, ensure_ascii=False))
