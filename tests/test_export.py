import unittest
import numpy as np
from pipeline import export_tiles


class LosslessPriceEncodingTests(unittest.TestCase):
    def test_snapshot_price_above_16_bit_is_preserved(self):
        row = np.zeros(1, dtype=export_tiles.SNAPSHOT_DTYPE)
        row['id'], row['modal'] = 1090, 82000
        self.assertEqual(int(np.frombuffer(row.tobytes(), dtype=export_tiles.SNAPSHOT_DTYPE)['modal'][0]), 82000)
        self.assertEqual(row.itemsize, 6)

    def test_series_prices_above_16_bit_are_preserved(self):
        row = np.zeros(1, dtype=export_tiles.SERIES_DTYPE)
        row['d'], row['mn'], row['mx'], row['md'], row['nv'] = 8000, 70000, 100000, 82000, 2
        decoded = np.frombuffer(row.tobytes(), dtype=export_tiles.SERIES_DTYPE)[0]
        self.assertEqual(tuple(int(decoded[k]) for k in ['mn', 'mx', 'md']), (70000, 100000, 82000))
        self.assertEqual(row.itemsize, 15)
