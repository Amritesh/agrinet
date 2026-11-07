"""Exercise COPY/upsert against temporary PostgreSQL tables only."""
import os

import psycopg
import pytest

from pipeline import load_db


def test_source_manifest_fingerprints_actual_bytes(tmp_path):
    import hashlib
    path = tmp_path / "shocks.parquet"
    path.write_bytes(b"original parquet fixture")
    before = load_db.source_manifest([path])
    key = str(path)
    assert before[key] == {"bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    path.write_bytes(b"corrected parquet fixture")
    assert load_db.source_manifest([path])[key]["sha256"] != before[key]["sha256"]


def test_removed_invalid_series_is_not_reported_as_observed():
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        pytest.skip("DATABASE_URL required for rollback-only integration")
    with psycopg.connect(dsn) as pg:
        cur = pg.cursor()
        cur.execute("CREATE TEMP TABLE fixture_stats(market_id int,commodity_id smallint,n_obs int,latest_modal int,latest_date date,volatility_90d real) ON COMMIT DROP")
        cur.execute("INSERT INTO fixture_stats VALUES (1,23,1,100,'2026-01-01',NULL),(2,23,1,1,'2026-01-01',NULL)")
        cur.execute("CREATE TEMP TABLE fixture_valid_pairs(market_id int,commodity_id smallint) ON COMMIT DROP")
        cur.execute("INSERT INTO fixture_valid_pairs VALUES(1,23)")
        assert load_db.invalidate_missing_stats(cur, "fixture_stats", "fixture_valid_pairs") == 1
        assert cur.execute("SELECT market_id,n_obs,latest_modal,latest_date IS NULL FROM fixture_stats ORDER BY 1").fetchall() == [(1,1,100,False),(2,0,None,True)]
        pg.rollback()


def test_stale_shocks_are_flagged_without_deleting_ids():
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        pytest.skip("DATABASE_URL required for rollback-only integration")
    with psycopg.connect(dsn) as pg:
        cur = pg.cursor()
        cur.execute("CREATE TEMP TABLE fixture_shocks(id int primary key,market_id int,commodity_id smallint,obs_date date,method text,details jsonb default '{}') ON COMMIT DROP")
        cur.execute("INSERT INTO fixture_shocks VALUES (7,1,23,'2026-01-01','mad_z','{}'),(8,2,23,'2026-01-01','mad_z','{}')")
        from datetime import date
        assert load_db.flag_stale_shocks(cur, "fixture_shocks", [(1,23,date(2026,1,1),'mad_z')], "verified-sha") == 1
        assert cur.execute("SELECT id,details->>'source_status' FROM fixture_shocks ORDER BY id").fetchall() == [(7,None),(8,'superseded')]
        assert cur.execute("SELECT details->>'superseded_by' FROM fixture_shocks WHERE id=8").fetchone()[0] == "verified-sha"
        # A signal reintroduced by another source version must be current again.
        assert load_db.flag_stale_shocks(cur, "fixture_shocks", [(2,23,date(2026,1,1),'mad_z')], "next-sha") == 1
        assert cur.execute("SELECT id,details->>'source_status' FROM fixture_shocks ORDER BY id").fetchall() == [(7,'superseded'),(8,None)]
        pg.rollback()


def test_upsert_preserves_existing_identity_and_unmentioned_rows():
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        pytest.skip("DATABASE_URL required for temporary-table integration")
    assert "fltrrikxuvsgnmoulqjd" in psycopg.conninfo.conninfo_to_dict(dsn)["user"]
    with psycopg.connect(dsn) as pg:
        cur = pg.cursor()
        cur.execute("CREATE TEMP TABLE backend_test_items (id bigserial primary key, item text unique, value integer)")
        cur.execute("INSERT INTO backend_test_items(item,value) VALUES ('existing',1),('untouched',2)")
        before = cur.execute("SELECT id FROM backend_test_items WHERE item='existing'").fetchone()[0]
        assert load_db.upsert_rows(cur, "backend_test_items", ["item", "value"], ["item"], [("existing", 3), ("new", 4)]) == 2
        assert cur.execute("SELECT id,value FROM backend_test_items WHERE item='existing'").fetchone() == (before, 3)
        assert cur.execute("SELECT count(*) FROM backend_test_items").fetchone()[0] == 3
        assert load_db.upsert_rows(cur, "backend_test_items", ["item", "value"], ["item"], [("existing", 3), ("new", 4)]) == 2
        assert cur.execute("SELECT count(*) FROM backend_test_items").fetchone()[0] == 3
        pg.rollback()
