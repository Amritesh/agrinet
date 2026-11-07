import unittest
from unittest.mock import Mock
from pipeline.geocode import nominatim


class CachedGeocodingTests(unittest.TestCase):
    def test_cache_only_returns_cached_hits_without_network(self):
        client = Mock()
        hits = [{'lat': '20', 'lon': '78'}]
        self.assertEqual(nominatim(client, 'known', {'known': hits}, cache_only=True), hits)
        client.get.assert_not_called()

    def test_cache_only_missing_query_never_uses_network(self):
        client = Mock()
        self.assertEqual(nominatim(client, 'missing', {}, cache_only=True), [])
        client.get.assert_not_called()
