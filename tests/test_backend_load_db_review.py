"""Offline execution of loader SQL and transaction publication boundaries."""
import ast
import inspect
import math
from datetime import date, timedelta
from statistics import stdev

import duckdb
import pytest

from pipeline import load_db


def test_volatility_uses_calendar_window_relative_to_each_series_latest_date():
    con = duckdb.connect()
    con.execute('CREATE TABLE p(market_id INTEGER,commodity_id INTEGER,obs_date DATE,modal_price DOUBLE)')
    for mid, latest in [(1, date(2026, 11, 6)), (2, date(2024, 1, 1))]:
        con.executemany('INSERT INTO p VALUES (?,23,?,?)', [(mid, latest-timedelta(days=days), price) for days, price in [(500,10),(120,1000),(90,10),(89,20),(30,60),(0,240)]])
    # Execute the SQL literally used by main(), not a parallel reimplementation.
    queries = [node.value for node in ast.walk(ast.parse(inspect.getsource(load_db.main))) if isinstance(node, ast.Constant) and isinstance(node.value, str) and 'WITH s AS' in node.value]
    assert len(queries) == 1
    rows = con.execute(queries[0]).fetchall()
    expected = stdev([math.log(2), math.log(3), math.log(4)])
    assert len(rows) == 2
    for row in rows:
        assert row[-1] == pytest.approx(expected)
        assert row[4] == 6


class LoaderPG:
    def __init__(self):
        self.pending = []
        self.published = []
        self.status = None
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def cursor(self):
        return self

    def execute(self, sql, params=None):
        if "status='failed'" in sql:
            self.status = 'failed'
            self.error = params[0]
        return self

    def fetchone(self):
        return (1,)

    def commit(self):
        self.published.extend(self.pending)
        self.pending.clear()

    def rollback(self):
        self.pending.clear()


class LoaderSource:
    def execute(self, *args):
        return self

    def fetchall(self):
        return []


@pytest.fixture
def loader(monkeypatch):
    pg = LoaderPG()
    monkeypatch.setenv('DATABASE_URL', 'offline-test')
    monkeypatch.setattr(load_db.psycopg, 'connect', lambda *a, **k: pg)
    monkeypatch.setattr(load_db.duckdb, 'connect', LoaderSource)
    monkeypatch.setattr(load_db, 'source_manifest', lambda paths: {str(load_db.DERIVED / 'shocks.parquet'): {'sha256': 'test-sha'}})
    return pg


@pytest.mark.parametrize('failure', ['second_commodity', 'flags'])
def test_failed_shock_generation_never_publishes_mixed_current_version(loader, monkeypatch, failure):
    pg = loader
    calls = []
    def upsert(cur, table, cols, keys, rows):
        calls.append(table)
        if failure == 'second_commodity' and len(calls) == 2:
            raise RuntimeError('database password=secret')
        pg.pending.append('commodity')
        return 0
    def flags(*args):
        if failure == 'flags':
            raise RuntimeError('database password=secret')
        pg.pending.append('flags')
        return 0
    monkeypatch.setattr(load_db, 'upsert_rows', upsert)
    monkeypatch.setattr(load_db, 'flag_stale_shocks', flags)
    with pytest.raises(RuntimeError):
        load_db.main({'shocks'})
    assert pg.published == []
    assert pg.status == 'failed'
    assert 'secret' not in pg.error
