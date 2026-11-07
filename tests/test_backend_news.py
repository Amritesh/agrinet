"""Backend regression tests; feed responses are deterministic, not production data."""
import httpx
import pytest

from pipeline import news


def test_rerun_backfills_links_for_previously_seen_news(monkeypatch):
    import os
    import psycopg

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        pytest.skip("DATABASE_URL required for rollback-only integration")
    assert "fltrrikxuvsgnmoulqjd" in psycopg.conninfo.conninfo_to_dict(dsn)["user"]
    with psycopg.connect(dsn) as pg:
        # All fixture writes and main's commits stay inside this rolled-back transaction.
        class TransactionProxy:
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def cursor(self):
                return pg.cursor()
            def commit(self):
                pass
        import hashlib
        title = "Backend regression fixture onion prices in Maharashtra"
        dedupe = hashlib.sha1(news.norm_title(title).encode()).hexdigest()
        nid = pg.execute("INSERT INTO agri.news_events(dedupe_hash,title,url,source,published_at,event_type,commodity_ids) VALUES(%s,%s,'https://example.test/news','Test',now(),'market',ARRAY[23]::smallint[]) RETURNING id", [dedupe, title]).fetchone()[0]
        body = f'<rss version="2.0"><channel><title>Test</title><item><title>{title}</title><link>https://example.test/news</link><pubDate>Fri, 06 Nov 2026 12:00:00 GMT</pubDate></item></channel></rss>'
        client = httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(200, text=body)))
        monkeypatch.setattr(news, "FEEDS", [("Test", "https://example.test/rss", "news")])
        monkeypatch.setattr(news.psycopg, "connect", lambda *args, **kwargs: TransactionProxy())
        monkeypatch.setattr(news.httpx, "Client", lambda *args, **kwargs: client)
        try:
            news.main()
            assert pg.execute("SELECT count(*) FROM agri.news_market_links WHERE news_id=%s", [nid]).fetchone()[0] > 0
        finally:
            pg.rollback()


@pytest.mark.parametrize("status,body", [(403, "Forbidden"), (200, "<html>blocked</html>"), (200, "<rss><channel/></rss>")])
def test_unusable_feeds_are_errors_instead_of_success(status, body):
    transport = httpx.MockTransport(lambda request: httpx.Response(status, text=body))
    with httpx.Client(transport=transport) as client:
        with pytest.raises((httpx.HTTPError, ValueError)):
            news.fetch_entries(client, "https://example.test/feed")


def test_valid_feed_entries_are_returned():
    body = '<rss version="2.0"><channel><title>Test</title><item><title>Onion prices rise</title><link>https://example.test/1</link></item></channel></rss>'
    transport = httpx.MockTransport(lambda request: httpx.Response(200, text=body))
    with httpx.Client(transport=transport) as client:
        assert news.fetch_entries(client, "https://example.test/feed")[0].title == "Onion prices rise"


@pytest.mark.parametrize("text", ["Union budget: aluminium output grows", "Bangalore hospital opens", "Potatoes available in flower market"])
def test_classification_does_not_match_inside_unrelated_words(text):
    comms, event_type, hint = news.classify(text)
    if text.startswith("Potatoes"):
        assert comms == [24]
        assert hint == "none"
    else:
        assert comms == []
        assert event_type == "other"
        assert hint == "none"
