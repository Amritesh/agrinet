"""Local data-only CSV.gz backup and exact temporary-table restore check.

Never drop or overwrite a production table. No credentials are written into backup.
Usage: uv run python pipeline/backup_db.py --verify
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import psycopg
from psycopg import sql
from dotenv import load_dotenv


def identifier(table):
    return sql.Identifier(*table.split('.'))


def backup_table(cur, table: str, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, 'wb', compresslevel=6) as out:
        with cur.copy(sql.SQL('COPY {} TO STDOUT WITH (FORMAT CSV, HEADER TRUE)').format(identifier(table))) as copy:
            for block in copy:
                out.write(bytes(block))
    count = cur.execute(sql.SQL('SELECT count(*) FROM {}').format(identifier(table))).fetchone()[0]
    with path.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    return {'table':table,'file':path.name,'rows':count,'bytes':path.stat().st_size,'sha256':digest}


def verify_restore(cur, table: str, path: Path):
    cur.execute('DROP TABLE IF EXISTS pg_temp.agrinet_restore_verify')
    cur.execute(sql.SQL('CREATE TEMP TABLE agrinet_restore_verify (LIKE {}) ON COMMIT DROP').format(identifier(table)))
    with gzip.open(path, 'rb') as source:
        with cur.copy('COPY agrinet_restore_verify FROM STDIN WITH (FORMAT CSV, HEADER TRUE)') as copy:
            while block := source.read(1024*1024):
                copy.write(block)
    # COPY does not collect planner statistics. Without ANALYZE this large
    # restore may be estimated as only a few thousand rows. Force the spillable
    # sort-based SetOp rather than a memory-heavy HashSetOp; LOCAL confines the
    # setting to this transaction and main() bounds sort memory with work_mem.
    cur.execute('ANALYZE pg_temp.agrinet_restore_verify')
    cur.execute('SET LOCAL enable_hashagg = off')
    # Symmetric multiset difference preserves duplicate rows and NULL values.
    query = sql.SQL('''SELECT NOT EXISTS (
      (SELECT row_to_json(t)::text FROM {} t EXCEPT ALL SELECT row_to_json(r)::text FROM agrinet_restore_verify r)
      UNION ALL
      (SELECT row_to_json(r)::text FROM agrinet_restore_verify r EXCEPT ALL SELECT row_to_json(t)::text FROM {} t)
    )''').format(identifier(table), identifier(table))
    if not cur.execute(query).fetchone()[0]:
        raise ValueError(f'Restored rows differ: {table}')
    return cur.execute('SELECT count(*) FROM agrinet_restore_verify').fetchone()[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--verify', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    load_dotenv(root/'.env')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    output = args.output or root/'data'/'backups'/stamp
    output.mkdir(parents=True, exist_ok=False)
    manifest = {'created_at':stamp,'format':'postgresql COPY CSV HEADER, gzip','tables':[]}
    with psycopg.connect(os.environ['DATABASE_URL']) as conn:
        with conn.cursor() as cur:
            cur.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
            # Large duplicate-preserving EXCEPT checks need longer than the HTTP/API
            # role's default. Bound it for this local backup transaction only.
            cur.execute("SET LOCAL statement_timeout = '180s'")
            cur.execute("SET LOCAL work_mem = '32MB'")
            tables = cur.execute("SELECT tablename FROM pg_tables WHERE schemaname='agri' ORDER BY tablename").fetchall()
            for (name,) in tables:
                info = backup_table(cur, f'agri.{name}', output/f'{name}.csv.gz')
                if args.verify:
                    info['restored_rows'] = verify_restore(cur, f'agri.{name}', output/f'{name}.csv.gz')
                    info['restore_verified'] = True
                manifest['tables'].append(info)
                print(json.dumps(info), flush=True)
                (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
        # Temp tables vanish on commit. Source tables were read-only throughout.
    print('BACKUP',output,flush=True)


if __name__ == '__main__':
    main()
