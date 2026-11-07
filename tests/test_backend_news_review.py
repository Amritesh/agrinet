"""Offline regression coverage of the real news ingest SQL and orchestration."""
import re

import duckdb
import httpx
import pytest

from pipeline import news


class OfflinePG:
    """Run relational SQL locally; translate only PostgreSQL spatial/system columns."""
    def __init__(self):
        self.db = duckdb.connect()
        self.db.execute("CREATE SCHEMA agri")
        self.db.execute("CREATE SEQUENCE ids")
        self.db.execute("CREATE TABLE agri.ingest_runs(id INTEGER DEFAULT nextval('ids'),job TEXT,finished_at TIMESTAMP,status TEXT,rows_in INTEGER,rows_out INTEGER,details JSON)")
        self.db.execute("CREATE TABLE agri.markets(id INTEGER,state TEXT,district TEXT,lat DOUBLE,lon DOUBLE)")
        self.db.execute("INSERT INTO agri.markets VALUES(1,'Maharashtra','Nashik',20,74)")
        self.db.execute("CREATE TABLE agri.shocks(id INTEGER,market_id INTEGER,commodity_id INTEGER,obs_date DATE,severity DOUBLE,details JSON)")
        self.db.execute("INSERT INTO agri.shocks VALUES(7,1,23,'2026-11-06',99,'{\"source_status\":\"superseded\"}'),(8,1,23,'2026-11-06',3,'{}')")
        self.db.execute("CREATE TABLE agri.news_events(id INTEGER DEFAULT nextval('ids'),dedupe_hash TEXT UNIQUE,title TEXT,url TEXT,source TEXT,published_at TIMESTAMPTZ,event_date DATE,event_type TEXT,commodity_ids INTEGER[],state TEXT,district TEXT,geom INTEGER,summary TEXT,evidence TEXT,impact_hint TEXT)")
        self.db.execute("CREATE TABLE agri.news_market_links(news_id INTEGER,market_id INTEGER,commodity_id INTEGER,association TEXT,shock_id INTEGER,PRIMARY KEY(news_id,market_id,commodity_id))")
        self.commits = 0
        self.rollbacks = 0
        self.rowcount = 1
        self.fail_gazetteer = False

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def cursor(self):
        return self

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def execute(self, sql, params=None):
        if self.fail_gazetteer and 'array_agg' in sql:
            raise RuntimeError('postgresql://admin:secret@private.invalid/db token=hidden')
        if 'INSERT INTO agri.news_events' in sql:
            sql = re.sub(r'CASE WHEN %s::float.*?END', 'NULL', sql, flags=re.S)
            params = params[:10] + params[13:]
            sql = sql.replace('(xmax=0) AS inserted', 'true AS inserted')
        sql = sql.replace('%s', '?')
        self.result = self.db.execute(sql, params or [])
        return self

    def fetchone(self):
        return self.result.fetchone()

    def fetchall(self):
        return self.result.fetchall()


@pytest.fixture
def offline_ingest(monkeypatch):
    pg = OfflinePG()
    body = '<rss version="2.0"><channel><title>Test</title><item><title>Onion prices in Nashik Maharashtra</title><link>https://example.test/news</link><pubDate>Fri, 06 Nov 2026 12:00:00 GMT</pubDate></item></channel></rss>'
    make_client = httpx.Client
    monkeypatch.setenv('DATABASE_URL', 'offline-test')
    monkeypatch.setattr(news.psycopg, 'connect', lambda *a, **k: pg)
    monkeypatch.setattr(news.httpx, 'Client', lambda **k: make_client(transport=httpx.MockTransport(lambda req: httpx.Response(200, text=body))))
    monkeypatch.setattr(news, 'FEEDS', [('Test', 'https://example.test/rss', 'news')])
    return pg


def test_rerun_refreshes_current_evidence_without_downgrading_official_links(offline_ingest, monkeypatch):
    pg = offline_ingest
    news.main()
    assert pg.db.execute('SELECT association,shock_id FROM agri.news_market_links').fetchall() == [('statistical', 8)]
    pg.db.execute("UPDATE agri.shocks SET details='{\"source_status\":\"superseded\"}'")
    news.main()
    assert pg.db.execute('SELECT association,shock_id FROM agri.news_market_links').fetchall() == [('speculative', None)]
    monkeypatch.setattr(news, 'FEEDS', [('PIB', 'https://example.test/rss', 'gov')])
    news.main()
    monkeypatch.setattr(news, 'FEEDS', [('Test', 'https://example.test/rss', 'news')])
    pg.db.execute("UPDATE agri.shocks SET details='{}' WHERE id=8")
    news.main()
    assert pg.db.execute('SELECT association,shock_id FROM agri.news_market_links').fetchall() == [('verified_event', 8)]
    assert pg.db.execute('SELECT count(*) FROM agri.news_events').fetchone()[0] == 1
    assert pg.db.execute('SELECT count(*) FROM agri.shocks').fetchone()[0] == 2


def test_unexpected_failure_finishes_committed_run_without_secrets(offline_ingest):
    pg = offline_ingest
    pg.fail_gazetteer = True
    with pytest.raises(RuntimeError, match='secret'):
        news.main()
    status, finished, details = pg.db.execute('SELECT status,finished_at,details FROM agri.ingest_runs').fetchone()
    assert status == 'failed'
    assert finished is not None
    assert 'RuntimeError' in details
    assert not any(value in details for value in ('secret', 'hidden', 'private.invalid', 'admin'))
    assert pg.rollbacks == 1
    assert pg.commits == 2


def test_all_feed_failures_preserve_safe_diagnostics(offline_ingest, monkeypatch):
    def fail(*args):
        raise ValueError('postgresql://admin:secret@private.invalid/db token=hidden')
    monkeypatch.setattr(news, 'fetch_entries', fail)
    with pytest.raises(RuntimeError, match='All news feeds failed'):
        news.main()
    status, finished, details = offline_ingest.db.execute('SELECT status,finished_at,details FROM agri.ingest_runs').fetchone()
    assert status == 'failed' and finished is not None
    assert 'feed_errors' in details and 'ValueError' in details
    assert not any(value in details for value in ('secret', 'hidden', 'private.invalid', 'admin'))
