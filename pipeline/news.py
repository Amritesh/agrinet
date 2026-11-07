"""News intelligence pipeline: permitted RSS feeds → rule-based extraction → Postgres.

Feeds (public RSS; each item keeps its source URL; we store title + short snippet only):
  * PIB (Press Information Bureau) ministry RSS — official notices (verified_event candidates)
  * Google News RSS queries (commodity + price/mandi/India) — aggregator of licensed outlets
  * Hindu BusinessLine agri-business RSS, Economic Times agriculture RSS

Extraction (rule-based, explainable): commodity by keyword, state/district by gazetteer match
against our markets table, event type by keyword classes, impact hint by direction words.
Dedup by normalized title hash. Linking: for each item with commodity + place, link to markets
in that district (or state capital-less: all state markets up to 25) and mark association:
  verified_event  — PIB/government source
  statistical     — a detected shock for that commodity exists in that market within ±7 days
  speculative     — otherwise (same commodity/region only)
Idempotent (hash-unique), incremental (only new items inserted), observable (ingest_runs row).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import feedparser
import httpx
import psycopg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
UA = "AGRINET/0.1 (+https://github.com/amriteshanand/agrinet)"

FEEDS = [
    ("PIB", "https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3", "gov"),
    ("Google News", "https://news.google.com/rss/search?q=onion+price+mandi+India&hl=en-IN&gl=IN&ceid=IN:en", "news"),
    ("Google News", "https://news.google.com/rss/search?q=tomato+price+India+farmers&hl=en-IN&gl=IN&ceid=IN:en", "news"),
    ("Google News", "https://news.google.com/rss/search?q=potato+price+India+mandi&hl=en-IN&gl=IN&ceid=IN:en", "news"),
    ("Google News", "https://news.google.com/rss/search?q=onion+export+ban+OR+MEP+OR+stock+limit&hl=en-IN&gl=IN&ceid=IN:en", "news"),
    ("Google News", "https://news.google.com/rss/search?q=IMD+heavy+rain+alert+Maharashtra+OR+Karnataka+OR+Madhya+Pradesh+crops&hl=en-IN&gl=IN&ceid=IN:en", "news"),
    ("BusinessLine", "https://www.thehindubusinessline.com/economy/agri-business/feeder/default.rss", "news"),
    ("Economic Times", "https://economictimes.indiatimes.com/news/economy/agriculture/rssfeeds/1286551815.cms", "news"),
]

COMMODITY_KW = {23: ["onion", "pyaz", "pyaaz", "kanda"], 24: ["potato", "aloo", "alu "], 78: ["tomato", "tamatar"]}
EVENT_KW = {
    "policy": ["export", "import", "ban", "duty", "mep", "minimum export price", "stock limit", "msp", "subsidy", "scheme", "government", "ministry", "nafed", "ncc", "buffer", "pmfby", "cabinet", "notification"],
    "weather": ["rain", "rainfall", "monsoon", "flood", "drought", "hailstorm", "heatwave", "cyclone", "imd", "frost", "unseasonal"],
    "export_import": ["export", "import", "shipment"],
    "market": ["price", "prices", "mandi", "apmc", "arrival", "arrivals", "wholesale", "retail", "rate", "kg", "quintal", "traders", "farmers"],
}
UP_KW = ["surge", "soar", "spike", "rise", "rises", "rising", "jump", "costlier", "skyrocket", "shoot", "hike", "high", "double"]
DOWN_KW = ["crash", "fall", "falls", "falling", "drop", "drops", "plunge", "slump", "cheaper", "glut", "dump", "low", "decline", "tumble"]


def norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()


def classify(text: str) -> tuple[list[int], str, str]:
    t = text.lower()
    def matches(keywords):
        return any(re.search(rf"\b{re.escape(k.strip())}(?:s|es)?\b", t) for k in keywords)

    comms = [cid for cid, kws in COMMODITY_KW.items() if matches(kws)]
    etype = "other"
    for et in ("weather", "policy", "export_import", "market"):
        if matches(EVENT_KW[et]):
            etype = et
            break
    up = matches(UP_KW)
    down = matches(DOWN_KW)
    hint = "mixed" if up and down else "up" if up else "down" if down else "none"
    return comms, etype, hint


def fetch_entries(client: httpx.Client, url: str) -> list:
    """Reject HTTP/block pages rather than reporting a healthy empty feed."""
    response = client.get(url)
    response.raise_for_status()
    feed = feedparser.parse(response.content)
    if not feed.version or not feed.entries:
        raise ValueError("Feed has no recognizable RSS/Atom entries")
    return feed.entries


def main() -> None:
    t0 = time.time()
    with psycopg.connect(os.environ["DATABASE_URL"]) as pg:
        cur = pg.cursor()
        run_id = cur.execute("INSERT INTO agri.ingest_runs(job) VALUES ('news') RETURNING id").fetchone()[0]
        pg.commit()
        client = None
        try:
            # gazetteer from markets: state names and district names (lowercase) -> representative point
            gaz = cur.execute(
                """SELECT state, district, avg(lat), avg(lon), array_agg(id) FROM agri.markets WHERE lat IS NOT NULL GROUP BY 1,2"""
            ).fetchall()
            states: dict[str, tuple[float, float]] = {}
            districts: dict[str, tuple[str, str, float, float, list[int]]] = {}
            for st, di, la, lo, ids in gaz:
                states.setdefault(st.lower(), (la, lo))
                dl = di.lower().split("(")[0].strip()
                if len(dl) >= 4:
                    districts[dl] = (st, di, la, lo, ids)
            state_pts = cur.execute("SELECT state, avg(lat), avg(lon) FROM agri.markets WHERE lat IS NOT NULL GROUP BY 1").fetchall()
            states = {s.lower(): (la, lo) for s, la, lo in state_pts}

            fetched = inserted = linked = 0
            feed_errors = []
            client = httpx.Client(headers={"User-Agent": UA}, follow_redirects=True, timeout=30)
            for source, url, kind in FEEDS:
                try:
                    entries = fetch_entries(client, url)
                except (httpx.HTTPError, ValueError) as e:
                    feed_errors.append({"source": source, "url": url, "error": type(e).__name__})
                    print(f"{source}: fetch failed ({type(e).__name__})")
                    continue
                for e in entries:
                    fetched += 1
                    title = (e.get("title") or "").strip()
                    link = e.get("link") or ""
                    if not title or not link:
                        continue
                    summary = re.sub(r"<[^>]+>", " ", e.get("summary", "") or "")[:600].strip()
                    pub = None
                    for k in ("published", "updated"):
                        if e.get(k):
                            try:
                                pub = parsedate_to_datetime(e[k])
                                break
                            except (TypeError, ValueError):
                                pass
                    if pub is None:
                        pub = datetime.now(timezone.utc)
                    if pub.tzinfo is None:
                        pub = pub.replace(tzinfo=timezone.utc)
                    text = f"{title}. {summary}"
                    comms, etype, hint = classify(text)
                    src_name = source
                    if source == "Google News" and " - " in title:
                        title, src_name = title.rsplit(" - ", 1)
                    if kind == "news" and not comms:
                        continue  # only keep commodity-relevant news; PIB notices are kept if agri-related
                    if kind == "gov" and not comms and etype not in ("policy", "weather"):
                        continue
                    tl = text.lower()
                    st_hit = next((s for s in states if s in tl), None)
                    di_hit = next((d for d in districts if re.search(rf"\b{re.escape(d)}\b", tl)), None)
                    lat = lon = None
                    state = district = None
                    if di_hit:
                        state, district, lat, lon, _ = districts[di_hit]
                    elif st_hit:
                        state = st_hit.title()
                        lat, lon = states[st_hit]
                    h = hashlib.sha1(norm_title(title).encode()).hexdigest()
                    row = cur.execute(
                        """INSERT INTO agri.news_events (dedupe_hash,title,url,source,published_at,event_date,event_type,commodity_ids,state,district,geom,summary,evidence,impact_hint)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                                   CASE WHEN %s::float IS NOT NULL THEN extensions.ST_SetSRID(extensions.ST_MakePoint(%s,%s),4326)::extensions.geography END,
                                   %s,%s,%s)
                           ON CONFLICT (dedupe_hash) DO UPDATE SET
                             commodity_ids=excluded.commodity_ids, event_type=excluded.event_type,
                             state=excluded.state, district=excluded.district, geom=excluded.geom,
                             summary=excluded.summary, evidence=excluded.evidence, impact_hint=excluded.impact_hint
                           RETURNING id, (xmax=0) AS inserted""",
                        [h, title[:400], link, src_name[:80], pub, pub.date(), etype, comms, state, district, lat, lon, lat, summary[:600] or None, summary[:300] or title[:300], hint],
                    ).fetchone()
                    if not row:
                        continue
                    inserted += int(row[1])
                    nid = row[0]
                    # link to markets by geography + commodity + time
                    if comms and (di_hit or st_hit):
                        if di_hit:
                            mids = districts[di_hit][4][:25]
                        else:
                            mids = [r[0] for r in cur.execute("SELECT id FROM agri.markets WHERE lower(state)=%s AND lat IS NOT NULL LIMIT 25", [st_hit]).fetchall()]
                        for cid in comms:
                            for mid in mids:
                                sh = cur.execute(
                                    """SELECT id FROM agri.shocks WHERE market_id=%s AND commodity_id=%s AND obs_date BETWEEN %s AND %s AND (details->>'source_status') IS DISTINCT FROM 'superseded' ORDER BY severity DESC, id LIMIT 1""",
                                    [mid, cid, pub.date() - timedelta(days=7), pub.date() + timedelta(days=7)],
                                ).fetchone()
                                assoc = "verified_event" if kind == "gov" else "statistical" if sh else "speculative"
                                cur.execute(
                                    """INSERT INTO agri.news_market_links (news_id, market_id, commodity_id, association, shock_id)
                                       VALUES (%s,%s,%s,%s,%s)
                                       ON CONFLICT (news_id, market_id, commodity_id) DO UPDATE SET
                                         association=CASE WHEN news_market_links.association='verified_event'
                                                          THEN 'verified_event' ELSE excluded.association END,
                                         shock_id=excluded.shock_id""",
                                    [nid, mid, cid, assoc, sh[0] if sh else None],
                                )
                                linked += cur.rowcount
                pg.commit()
                print(f"{source}: ok (total inserted so far {inserted})")
            status = "failed" if not fetched else "partial" if feed_errors else "ok"
            cur.execute(
                "UPDATE agri.ingest_runs SET finished_at=now(), status=%s, rows_in=%s, rows_out=%s, details=%s WHERE id=%s",
                [status, fetched, inserted, json.dumps({"links": linked, "feed_errors": feed_errors, "seconds": round(time.time() - t0)}), run_id],
            )
            pg.commit()
        except Exception as exc:
            pg.rollback()
            cur.execute(
                "UPDATE agri.ingest_runs SET finished_at=now(), status='failed', details=%s WHERE id=%s",
                [json.dumps({"error": type(exc).__name__}), run_id],
            )
            pg.commit()
            raise
        finally:
            if client is not None:
                client.close()
    if not fetched:
        raise RuntimeError("All news feeds failed; see agri.ingest_runs.details")
    print(f"fetched={fetched} inserted={inserted} links={linked} in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
