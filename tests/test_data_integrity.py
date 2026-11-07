"""Retained-data acceptance checks; use local real Parquet, never synthetic fixtures."""
import json
import struct
import unittest
from datetime import date
from pathlib import Path
import duckdb
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'web/public/data'
DERIVED = ROOT / 'data/derived'


@unittest.skipUnless((DERIVED / 'price_daily.parquet').exists(), 'Retained Parquet not restored')
class RetainedDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = duckdb.connect()
        cls.db.execute(f"CREATE VIEW p AS SELECT * FROM '{DERIVED}/price_daily.parquet'")

    def test_quality_ledger_reconciles_raw_rows(self):
        q = json.loads((DERIVED / 'quality.json').read_text())
        self.assertEqual(q['raw_rows'], q['kept_rows'] + sum(q['rejected'].values()))
        self.assertEqual(q['daily_rows'], self.db.execute('SELECT count(*) FROM p').fetchone()[0])

    def test_market_day_keys_are_unique(self):
        n = self.db.execute('SELECT count(*) FROM (SELECT state_norm,district_norm,market_norm,commodity_id,obs_date,count(*) n FROM p GROUP BY ALL HAVING n>1)').fetchone()[0]
        self.assertEqual(n, 0)

    def test_prices_are_positive_and_ordered(self):
        n = self.db.execute('SELECT count(*) FROM p WHERE min_price<=0 OR modal_price<=0 OR max_price<min_price OR modal_price<min_price*.99 OR modal_price>max_price*1.01').fetchone()[0]
        self.assertEqual(n, 0)

    def test_all_markets_have_valid_and_labelled_coordinates(self):
        markets = json.loads((DATA / 'markets.json').read_text())
        expected = self.db.execute(f"SELECT count(*) FROM '{DERIVED}/markets.parquet'").fetchone()[0]
        self.assertEqual(len(markets), expected)
        self.assertEqual(len({m['id'] for m in markets}), expected)
        for m in markets:
            self.assertTrue(6.5 <= m['lat'] <= 37.2 and 68 <= m['lon'] <= 97.5, m)
            self.assertIn(m['src'], ['nominatim','nominatim_near','nominatim_state','district_centroid','state_centroid'])
            self.assertTrue(0 < m['c'] <= 100)

    def test_every_snapshot_row_reconciles_with_parquet(self):
        counts = {}
        for slug, cid in [('onion',23),('potato',24),('tomato',78)]:
            total = 0
            for path in (DATA / 'snap' / slug).glob('*.bin'):
                raw = path.read_bytes()
                magic, days = struct.unpack_from('<II', raw)
                self.assertEqual(magic, 0x41475232)
                offset = 8
                last = -1
                for _ in range(days):
                    day, n = struct.unpack_from('<II', raw, offset)
                    self.assertGreater(day, last)
                    last = day
                    total += n
                    offset += 8 + n * 6
                self.assertEqual(offset, len(raw))
            expected = self.db.execute('SELECT count(*) FROM p WHERE commodity_id=?',[cid]).fetchone()[0]
            self.assertEqual(total, expected)
            counts[cid] = total

    def test_previously_clipped_real_price_is_preserved(self):
        raw = (DATA / 'series/1090.bin').read_bytes()
        magic, ncomm = struct.unpack_from('<IB', raw)
        self.assertEqual(magic, 0x41475333)
        offset = 5
        found = False
        target = (date(2014,7,16)-date(2001,1,1)).days
        dtype = np.dtype([('d','<u2'),('mn','<u4'),('mx','<u4'),('md','<u4'),('nv','u1')])
        for _ in range(ncomm):
            cid,n = struct.unpack_from('<BI',raw,offset)
            offset += 5
            arr = np.frombuffer(raw, dtype=dtype, count=n, offset=offset)
            offset += n*15
            if cid == 24:
                match = arr[arr['d'] == target]
                self.assertEqual(len(match),1)
                self.assertEqual(int(match['md'][0]),71000)
                found = True
        self.assertTrue(found)
