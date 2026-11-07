import unittest
import numpy as np
from pipeline.shocks import rolling_median_mad, detect_series


class ShockCalculationTests(unittest.TestCase):
    def test_mad_uses_the_same_trailing_window_as_its_median(self):
        values = np.arange(100, dtype=float)
        med, mad = rolling_median_mad(values, 60)
        window = values[39:99]
        self.assertAlmostEqual(med[99], np.median(window))
        self.assertAlmostEqual(mad[99], np.median(np.abs(window - np.median(window))))

    def test_insufficient_history_is_unscored(self):
        dates = np.arange('2024-01-01', '2024-02-01', dtype='datetime64[D]')
        self.assertEqual(detect_series(dates, np.full(len(dates), 100.), 3., None), [])

    def test_flat_series_does_not_generate_shocks(self):
        dates = np.arange('2023-01-01', '2024-01-01', dtype='datetime64[D]')
        self.assertEqual(detect_series(dates, np.full(len(dates), 100.), 3., None), [])
