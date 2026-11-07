"""Actual deployed, read-only HTTP contract tests. Opt in: AGRINET_LIVE_TESTS=1."""
import json
import os
import time
import unittest
import urllib.error
import urllib.request

API = 'https://fltrrikxuvsgnmoulqjd.supabase.co/rest/v1/'
KEY = 'sb_publishable_bjH4is7RfBhJUZB9U9YiPA_t7MWSiMK'


def fetch(path, payload=None, key=KEY):
    req = urllib.request.Request(API + path, data=None if payload is None else json.dumps(payload).encode(), headers={'apikey':key,'Content-Type':'application/json'})
    start = time.monotonic()
    with urllib.request.urlopen(req, timeout=30) as response:
        data = json.load(response)
    return data, time.monotonic()-start


@unittest.skipUnless(os.getenv('AGRINET_LIVE_TESTS') == '1', 'Live HTTP tests explicitly opt in')
class PublicAPIContractTests(unittest.TestCase):
    def test_internal_schema_is_not_http_exposed(self):
        request = urllib.request.Request(API + 'ingest_runs?select=details&limit=1', headers={'apikey':KEY,'Accept-Profile':'agri'})
        with self.assertRaises(urllib.error.HTTPError) as result:
            urllib.request.urlopen(request, timeout=30)
        self.assertEqual(result.exception.code, 406)

    def test_health_contract(self):
        data, elapsed = fetch('rpc/health', {})
        self.assertTrue(data['ok'])
        self.assertEqual(data['markets'], 3389)
        self.assertGreater(data['shocks'], 0)
        self.assertEqual(data['latest_price_date'], '2026-04-20')
        self.assertLess(elapsed, 10)
        print(f'health_seconds={elapsed:.3f}')

    def test_invalid_key_is_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as result:
            fetch('shocks?select=id&limit=1', key='invalid-key')
        self.assertIn(result.exception.code, [401,403])

    def test_shock_pagination_and_price_contract(self):
        first, elapsed = fetch('shocks?select=*&commodity_id=eq.23&order=id&limit=2')
        second, _ = fetch('shocks?select=*&commodity_id=eq.23&order=id&offset=1&limit=1')
        self.assertEqual(len(first),2)
        self.assertEqual(first[1]['id'],second[0]['id'])
        self.assertGreater(first[0]['observed'],0)
        self.assertTrue(first[0]['market_name'])
        self.assertIn(first[0]['direction'],['up','down'])
        self.assertIn(first[0]['severity'],[1,2,3,4])
        print(f'shocks_seconds={elapsed:.3f}')

    def test_nearby_parameters_are_server_bounded(self):
        rows, _ = fetch('rpc/nearby_markets', {'p_market_id':1090,'p_commodity_id':24,'p_km':1e9,'p_limit':1000000})
        self.assertLessEqual(len(rows), 50)
        self.assertTrue(all(row['distance_km'] <= 500 for row in rows))
        rows, _ = fetch('rpc/nearby_markets', {'p_market_id':1090,'p_commodity_id':24,'p_km':-1,'p_limit':-1})
        self.assertEqual(rows, [])

    def test_nearby_spatial_query(self):
        result, elapsed = fetch('rpc/nearby_markets', {'p_market_id':1090,'p_commodity_id':24})
        self.assertGreater(len(result),0)
        distances = [r['distance_km'] for r in result]
        self.assertEqual(distances,sorted(distances))
        self.assertTrue(all(r['id']!=1090 and r['distance_km']>=0 for r in result))
        print(f'nearby_seconds={elapsed:.3f}')

    def test_news_preserves_original_evidence_urls(self):
        news, _ = fetch('news_events?select=*&order=published_at.desc&limit=5')
        self.assertGreater(len(news),0)
        for event in news:
            self.assertTrue(event['url'].startswith(('https://','http://')))
            self.assertTrue(event['title'])
            self.assertTrue(event['source'])

    def test_explicit_empty_range(self):
        shocks, _ = fetch('shocks?select=id&obs_date=eq.1900-01-01&limit=2')
        self.assertEqual(shocks,[])

    def test_invalid_filter_is_error_not_empty_success(self):
        with self.assertRaises(urllib.error.HTTPError) as result:
            fetch('shocks?commodity_id=eq.not-an-integer&limit=1')
        self.assertEqual(result.exception.code,400)
