from pathlib import Path
import gzip
import os
import psycopg
from dotenv import load_dotenv
from pipeline.backup_db import backup_table, verify_restore
import pytest


def test_restore_uses_spillable_exact_multiset_plan(tmp_path):
    load_dotenv(Path(__file__).resolve().parents[1] / '.env')
    if not os.getenv('DATABASE_URL'):
        pytest.skip('DB connection absent')

    class PlanCursor:
        def __init__(self, cursor):
            self.cursor = cursor
            self.plan = ''

        def execute(self, query, *args):
            text = query.as_string(self.cursor) if hasattr(query, 'as_string') else query
            if 'SELECT NOT EXISTS' in text:
                self.plan = '\n'.join(row[0] for row in self.cursor.execute('EXPLAIN ' + text).fetchall())
            return self.cursor.execute(query, *args)

        def copy(self, query):
            return self.cursor.copy(query)

    with psycopg.connect(os.environ['DATABASE_URL']) as pg:
        with pg.cursor() as cur:
            cur.execute('SET LOCAL enable_hashagg = on')
            cur.execute('CREATE TEMP TABLE backup_multiset (id integer, label text) ON COMMIT DROP')
            cur.execute("INSERT INTO backup_multiset SELECT n % 2000, CASE WHEN n % 3 = 0 THEN NULL ELSE 'value' END FROM generate_series(1,4000) n")
            path = tmp_path / 'multiset.csv.gz'
            backup_table(cur, 'backup_multiset', path)
            observed = PlanCursor(cur)
            assert verify_restore(observed, 'backup_multiset', path) == 4000
            assert 'HashSetOp' not in observed.plan, observed.plan
            assert 'SetOp Except All' in observed.plan, observed.plan
            # Same row count and same distinct values, different duplicate/NULL
            # multiplicities: neither a count nor plain EXCEPT is sufficient.
            with gzip.open(path, 'wt') as out:
                out.write('id,label\n1,value\n1,value\n2,\n')
            cur.execute('CREATE TEMP TABLE backup_duplicates (id integer, label text) ON COMMIT DROP')
            cur.execute("INSERT INTO backup_duplicates VALUES (1,'value'),(2,NULL),(2,NULL)")
            with pytest.raises(ValueError, match='Restored rows differ'):
                verify_restore(cur, 'backup_duplicates', path)
            assert cur.execute('SELECT count(*) FROM backup_multiset').fetchone()[0] == 4000
            assert cur.execute('SELECT count(*) FROM backup_duplicates').fetchone()[0] == 3


def test_backup_roundtrip_preserves_rows_without_changing_source(tmp_path):
    load_dotenv(Path(__file__).resolve().parents[1] / '.env')
    if not os.getenv('DATABASE_URL'):
        import pytest
        pytest.skip('DB connection absent')
    with psycopg.connect(os.environ['DATABASE_URL']) as pg:
        with pg.cursor() as cur:
            cur.execute('CREATE TEMP TABLE backup_fixture (id integer, label text, amount numeric) ON COMMIT DROP')
            cur.execute("INSERT INTO backup_fixture VALUES (1,'comma, and newline' || chr(10) || 'second line',1.5),(2,NULL,NULL)")
            path = tmp_path / 'fixture.csv.gz'
            info = backup_table(cur, 'backup_fixture', path)
            assert info['rows'] == 2
            assert info['sha256']
            assert gzip.open(path, 'rt').read().startswith('id,label,amount\n')
            assert verify_restore(cur, 'backup_fixture', path) == 2
            assert cur.execute('SELECT count(*) FROM backup_fixture').fetchone()[0] == 2
