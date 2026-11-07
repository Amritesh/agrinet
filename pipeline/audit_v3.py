"""Offline retained-data audit; SELECTs only, no services or pipeline imports.

Run: uv run python pipeline/audit_v3.py
JSON goes to stdout. DuckDB memory is capped; temporary spill stays in TMPDIR.
"""
from __future__ import annotations

import argparse
import json
import os
import struct
import tempfile
from datetime import date, timedelta
from pathlib import Path

import duckdb


def inspect_binary(path: Path, kind: str) -> dict:
    """Validate AGR2/AGS3 framing one file at a time (not row-value equality)."""
    data = path.read_bytes()
    rows, days, commodities = 0, [], []
    try:
        if kind == 'snapshot':
            magic, groups = struct.unpack_from('<II', data)
            if magic != 0x41475232:
                raise ValueError('not AGR2')
            offset = 8
            for _ in range(groups):
                day, n = struct.unpack_from('<II', data, offset)
                if days and day <= days[-1]:
                    raise ValueError('unordered snapshot days')
                days.append(day)
                rows += n
                offset += 8 + n * 6
        elif kind == 'series':
            magic, groups = struct.unpack_from('<IB', data)
            if magic != 0x41475333:
                raise ValueError('not AGS3')
            offset = 5
            for _ in range(groups):
                cid, n = struct.unpack_from('<BI', data, offset)
                if cid in commodities:
                    raise ValueError('duplicate series commodity')
                commodities.append(cid)
                offset += 5
                last = -1
                for i in range(n):
                    day = struct.unpack_from('<H', data, offset + i * 15)[0]
                    if day <= last:
                        raise ValueError('unordered series days')
                    days.append(day)
                    last = day
                offset += n * 15
                rows += n
        else:
            raise ValueError('unknown binary kind')
        if offset != len(data):
            raise ValueError('truncated or trailing binary bytes')
    except struct.error as exc:
        raise ValueError(f'{path}: truncated binary') from exc
    return {'rows': rows, 'min_day': min(days, default=None),
            'max_day': max(days, default=None), 'commodities': commodities}


def audit(root: Path) -> dict:
    """Read actual local inputs, returning measured facts and reconciliation checks.

    Uses only in-memory temporary views and SELECTs. Never opens an on-disk DB,
    imports side-effecting pipeline modules, reads .env or contacts a service.
    DuckDB is capped at 512 MB, one thread, and 2 GB scratch spill.
    """
    root = root.resolve()
    result = {'duckdb_version': duckdb.__version__}
    raw_dir, derived, public = root / 'data/raw/mandi_daily', root / 'data/derived', root / 'web/public/data'
    with tempfile.TemporaryDirectory(prefix='agrinet-audit-', dir=os.environ.get('TMPDIR')) as spill:
        with duckdb.connect(config={'memory_limit': '512MB', 'threads': '1',
                                   'temp_directory': spill, 'max_temp_directory_size': '2GB',
                                   'autoinstall_known_extensions': 'false',
                                   'autoload_known_extensions': 'false'}) as con:
            def query(sql, params=None):
                cursor = con.execute(sql, params or [])
                return [dict(zip([c[0] for c in cursor.description], row)) for row in cursor.fetchall()]

            for view, path in [('r', raw_dir / 'pilot_*.parquet'),
                               ('p', derived / 'price_daily.parquet'),
                               ('m', derived / 'market_ids.parquet'),
                               ('g', derived / 'markets_geo.parquet'),
                               ('v', derived / 'varieties.parquet')]:
                quoted = str(path).replace("'", "''")
                con.execute(f"CREATE TEMP VIEW {view} AS SELECT * FROM read_parquet('{quoted}')")
            result['raw_files'] = len(list(raw_dir.glob('pilot_*.parquet')))
            result['raw_schema_by_file'] = {}
            for path in sorted(raw_dir.glob('pilot_*.parquet')):
                quoted = str(path).replace("'", "''")
                result['raw_schema_by_file'][path.name] = query(f"DESCRIBE SELECT * FROM read_parquet('{quoted}')")
            result['schemas'] = {view: query(f'DESCRIBE {view}') for view in ['r', 'p', 'm', 'g', 'v']}
            result['raw_years'] = query('SELECT source_year,count(*) rows,min(Arrival_Date) first_date,max(Arrival_Date) last_date FROM r GROUP BY 1 ORDER BY 1')
            result['raw_commodities'] = query('SELECT Commodity,Commodity_Code,count(*) rows FROM r GROUP BY ALL ORDER BY 2,1')
            result['raw_fields'] = query('''SELECT count(*) rows,min(Arrival_Date) first_date,max(Arrival_Date) last_date,
                count(*) FILTER(WHERE Variety IS NULL) null_variety,
                count(*) FILTER(WHERE Grade IS NULL) null_grade,
                count(DISTINCT Variety) varieties,count(DISTINCT Grade) grades FROM r''')[0]
            result['raw_grades'] = query('SELECT Grade,count(*) rows FROM r GROUP BY 1 ORDER BY 2 DESC')
            result['raw_variety_examples'] = query('SELECT Commodity,Variety,count(*) rows FROM r GROUP BY ALL ORDER BY 3 DESC LIMIT 15')
            # CASE is intentionally mirrored, not imported: build_dims imports create directories.
            result['validation'] = query('''SELECT CASE
                WHEN Min_Price IS NULL OR Max_Price IS NULL OR Modal_Price IS NULL THEN 'null_price'
                WHEN Min_Price <= 0 OR Max_Price <= 0 OR Modal_Price <= 0 THEN 'nonpositive_price'
                WHEN Modal_Price > 100000 THEN 'implausible_high'
                WHEN Modal_Price < Min_Price*.99 OR Modal_Price > Max_Price*1.01 THEN 'modal_out_of_range'
                WHEN Max_Price < Min_Price THEN 'max_lt_min'
                WHEN Min_Price::INTEGER<1 OR Max_Price::INTEGER<1 OR round(Modal_Price)::INTEGER<1
                    OR round(Modal_Price)::INTEGER<Min_Price::INTEGER*.99
                    OR round(Modal_Price)::INTEGER>Max_Price::INTEGER*1.01 THEN 'invalid_after_integer_rounding'
                ELSE 'kept' END reason,count(*) rows FROM r GROUP BY 1 ORDER BY 1''')
            result['daily'] = query('''SELECT count(*) rows,min(obs_date) first_date,max(obs_date) last_date,
                count(DISTINCT (state_norm,district_norm,market_norm)) markets,
                count(DISTINCT state_norm) states,sum(n_variety) retained_raw_rows,
                count(*) FILTER(WHERE n_variety>1) multirow_days,
                max(n_variety) max_rows_per_day,
                count(*) FILTER(WHERE obs_date IS NULL OR state_norm IS NULL OR district_norm IS NULL OR market_norm IS NULL
                    OR state_norm='' OR district_norm='' OR market_norm='' OR commodity_id IS NULL
                    OR min_price IS NULL OR max_price IS NULL OR modal_price IS NULL OR n_variety IS NULL) null_or_blank_rows,
                count(*) FILTER(WHERE min_price<=0 OR modal_price<=0 OR max_price<min_price
                    OR modal_price<min_price*.99 OR modal_price>max_price*1.01 OR modal_price>100000) invalid_prices,
                count(*) FILTER(WHERE modal_price>65535) modal_above_uint16 FROM p''')[0]
            result['duplicate_daily_keys'] = query('''SELECT count(*) groups FROM
                (SELECT state_norm,district_norm,market_norm,commodity_id,obs_date FROM p GROUP BY ALL HAVING count(*)>1)''')[0]['groups']
            result['commodities'] = query('''SELECT commodity_id,count(*) rows,min(obs_date) first_date,max(obs_date) last_date,
                count(DISTINCT (state_norm,district_norm,market_norm)) markets FROM p GROUP BY 1 ORDER BY 1''')
            result['coverage'] = query('''SELECT commodity_id,year(obs_date) AS year,count(*) n_rows,
                count(DISTINCT (state_norm,district_norm,market_norm)) n_markets,
                count(DISTINCT obs_date) n_days,count(DISTINCT state_norm) n_states FROM p GROUP BY ALL ORDER BY 1,2''')
            result['varieties'] = query('''SELECT count(*) rows,min(obs_date) first_date,max(obs_date) last_date,
                count(DISTINCT variety) varieties,count(DISTINCT grade) grades FROM v''')[0]
            result['identities'] = query('''SELECT count(*) rows,count(DISTINCT id) ids,
                count(DISTINCT (state_norm,district_norm,market_norm)) keys FROM m''')[0]
            result['geolocation'] = query('''SELECT geocode_source,geocode_confidence,count(*) markets,
                count(DISTINCT (lat,lon)) coordinate_pairs FROM g GROUP BY ALL ORDER BY 1,2''')
            result['geo_totals'] = query('''SELECT count(*) rows,count(DISTINCT (state_norm,district_norm,market_norm)) keys,
                count(DISTINCT (lat,lon)) coordinate_pairs,
                count(*) FILTER(WHERE lat IS NULL OR lon IS NULL OR lat NOT BETWEEN 6.5 AND 37.2 OR lon NOT BETWEEN 68 AND 97.5) invalid_coordinates FROM g''')[0]
            result['onion_candidates'] = query('''SELECT m.id,m.state,m.district,m.market,m.market_norm,
                count(*) rows,min(p.obs_date) first_date,max(p.obs_date) last_date,
                g.lat,g.lon,g.geocode_source,g.geocode_confidence,g.geocode_query
                FROM p JOIN m USING(state_norm,district_norm,market_norm)
                LEFT JOIN g USING(state_norm,district_norm,market_norm)
                WHERE commodity_id=23 AND (m.market_norm LIKE '%lasal%' OR m.market_norm LIKE '%pimpal%'
                  OR m.market_norm LIKE '%azad%' OR m.market_norm LIKE '%vashi%')
                GROUP BY ALL ORDER BY rows DESC,m.id''')
            result['candidate_raw_names'] = query('''SELECT State,District,Market,Variety,Grade,Commodity_Code,
                count(*) rows,min(Arrival_Date) first_date,max(Arrival_Date) last_date FROM r
                WHERE Commodity='Onion' AND (lower(Market) LIKE '%lasal%' OR lower(Market) LIKE '%pimpal%'
                    OR lower(Market) LIKE '%azad%' OR lower(Market) LIKE '%vashi%') GROUP BY ALL ORDER BY rows DESC''')
            result['corridor_overlap'] = query('''SELECT a.id source_id,b.id destination_id,count(*) shared_days,
                min(x.obs_date) first_date,max(x.obs_date) last_date
                FROM m a JOIN p x USING(state_norm,district_norm,market_norm)
                JOIN p y ON y.obs_date=x.obs_date AND y.commodity_id=x.commodity_id
                JOIN m b ON (b.state_norm,b.district_norm,b.market_norm)=(y.state_norm,y.district_norm,y.market_norm)
                WHERE x.commodity_id=23 AND a.market_norm IN ('lasalgaon','pimpalgaon','lasalgaon apmc','lasalgaon apmc vinchur','pimpalgaon apmc')
                AND b.market_norm IN ('azadpur','azadpur apmc','vashi new mumbai','vashi new mumbai apmc') GROUP BY ALL ORDER BY 3 DESC''')
            result['normalization_collisions'] = query(r'''WITH names AS (
                SELECT DISTINCT State,District,Market,
                trim(regexp_replace(regexp_replace(regexp_replace(lower(State),'\(.*?\)',' ','g'),'[^a-z0-9]+',' ','g'),' +',' ','g')) s,
                trim(regexp_replace(regexp_replace(regexp_replace(lower(District),'\(.*?\)',' ','g'),'[^a-z0-9]+',' ','g'),' +',' ','g')) d,
                trim(regexp_replace(regexp_replace(regexp_replace(lower(Market),'\(.*?\)',' ','g'),'[^a-z0-9]+',' ','g'),' +',' ','g')) m FROM r)
                SELECT s,d,m,list(Market ORDER BY Market) raw_names,count(*) spellings FROM names GROUP BY s,d,m HAVING count(*)>1 ORDER BY spellings DESC,s,d,m LIMIT 20''')

            markets = json.loads((public / 'markets.json').read_text())
            geo_rows = query('''SELECT m.id,m.market n,m.district d,m.state s,g.lat,g.lon,
                g.geocode_confidence c,g.geocode_source src FROM m JOIN g USING(state_norm,district_norm,market_norm) ORDER BY m.id''')
            for row in geo_rows:
                row['lat'] = None if row['lat'] is None else round(row['lat'], 5)
                row['lon'] = None if row['lon'] is None else round(row['lon'], 5)
            quality = json.loads((derived / 'quality.json').read_text())
            manifest = json.loads((raw_dir / '_manifest.json').read_text())
            result['quality_claim'] = quality
            result['raw_manifest_rows'] = sum(entry['rows'] for entry in manifest.values())
            result['raw_manifest_years'] = sorted(manifest)
            result['raw_manifest_fetch_range'] = [min(e['fetched_at'] for e in manifest.values()),max(e['fetched_at'] for e in manifest.values())]
            static = {}
            for slug, cid in [('onion', 23), ('potato', 24), ('tomato', 78)]:
                items = [inspect_binary(path, 'snapshot') for path in sorted((public / 'snap' / slug).glob('*.bin'))]
                static[slug] = {'commodity_id': cid, 'files': len(items), 'rows': sum(i['rows'] for i in items),
                    'first_date': date(2001, 1, 1) + timedelta(days=min(i['min_day'] for i in items if i['min_day'] is not None)),
                    'last_date': date(2001, 1, 1) + timedelta(days=max(i['max_day'] for i in items if i['max_day'] is not None))}
            result['static_snapshots'] = static
            series = sorted((public / 'series').glob('*.bin'))
            series_items = [inspect_binary(path, 'series') for path in series]
            result['static_series'] = {'files': len(series), 'rows': sum(i['rows'] for i in series_items)}
            observed_validation = {r['reason']: r['rows'] for r in result['validation']}
            result['checks'] = {
                'raw_schemas_consistent': all(s == result['schemas']['r'] for s in result['raw_schema_by_file'].values()),
                'daily_market_keys_resolve': query('SELECT count(*) n FROM p ANTI JOIN m USING(state_norm,district_norm,market_norm)')[0]['n'] == 0,
                'quality_raw': quality['raw_rows'] == result['raw_fields']['rows'],
                'quality_kept': quality['kept_rows'] == observed_validation.pop('kept', 0) == result['daily']['retained_raw_rows'],
                'quality_rejected': quality['rejected'] == observed_validation,
                'quality_daily': quality['daily_rows'] == result['daily']['rows'],
                'manifest_year_rows': all(manifest[str(r['source_year'])]['rows'] == r['rows'] for r in result['raw_years']) and len(manifest) == result['raw_files'],
                'daily_keys_unique': result['duplicate_daily_keys'] == 0,
                'daily_prices_valid': result['daily']['invalid_prices'] == 0,
                'daily_fields_present': result['daily']['null_or_blank_rows'] == 0,
                'identity_counts': quality['markets'] == result['identities']['rows'] == result['identities']['ids'] == result['identities']['keys'] == result['daily']['markets'] == result['geo_totals']['rows'] == result['geo_totals']['keys'],
                'coordinates_valid_bounds': result['geo_totals']['invalid_coordinates'] == 0,
                'static_market_records': sorted(markets, key=lambda m: m['id']) == geo_rows,
                'static_series_market_ids': {int(p.stem) for p in series} == {m['id'] for m in markets},
                'static_series_rows': result['static_series']['rows'] == result['daily']['rows'],
                'coverage_manifests': result['coverage'] == json.loads((public / 'coverage.json').read_text()) == json.loads((derived / 'coverage.json').read_text()),
                'static_snapshot_counts_dates': all((static[slug]['rows'],static[slug]['first_date'],static[slug]['last_date']) ==
                    (r['rows'],r['first_date'],r['last_date']) for slug in static for r in result['commodities'] if r['commodity_id']==static[slug]['commodity_id']),
            }
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    report = audit(args.root)
    print(json.dumps(report, indent=2, default=str))
    raise SystemExit(0 if all(report['checks'].values()) else 1)
