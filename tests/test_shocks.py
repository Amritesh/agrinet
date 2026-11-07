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

    def test_weekly_return_uses_seven_days_not_five(self):
        dates = np.arange('2024-01-01', '2024-04-10', dtype='datetime64[D]')
        modal = np.exp(np.arange(len(dates)) * .01) * 100
        modal[-1] *= 10
        weekly = [s for s in detect_series(dates, modal, 3., None) if s['method'] == 'return_7d']
        self.assertTrue(weekly)
        self.assertAlmostEqual(weekly[-1]['pct_change'], (modal[-1] / modal[-8] - 1) * 100)
        self.assertAlmostEqual(weekly[-1]['baseline'], modal[-8])

    def test_missing_returns_do_not_become_zero_return_history(self):
        dates = np.datetime64('2020-01-01') + np.arange(100) * np.timedelta64(20, 'D')
        dates[-1] = dates[-2] + np.timedelta64(1, 'D')
        modal = np.full(100,100.)
        modal[-1] = 1000.
        daily = [s for s in detect_series(dates, modal, 3., None) if s['method'] == 'return_1d']
        self.assertEqual(daily, [])

    def test_iso_seasonal_key_handles_year_boundaries(self):
        from pipeline.shocks import iso_seasonal_keys
        years, weeks = iso_seasonal_keys(np.array(['2020-12-31','2021-01-01','2021-01-04'], dtype='datetime64[D]'))
        self.assertEqual(years.tolist(), [2020,2020,2021])
        self.assertEqual(weeks.tolist(), [53,53,1])

    def test_regional_movement_uses_the_same_direction_and_baseline(self):
        dates = np.arange('2024-01-01', '2024-04-10', dtype='datetime64[D]')
        modal = np.full(len(dates), 25.)
        modal[-1] = 50.
        regional = [s for s in detect_series(dates, modal, 3., np.full(len(dates), np.log(100.))) if s['method'] == 'regional_div']
        self.assertTrue(regional)
        latest = regional[-1]
        self.assertEqual(latest['direction'], 'up')
        self.assertAlmostEqual(latest['baseline'], 25.)
        self.assertAlmostEqual(latest['pct_change'], 100.)
        self.assertAlmostEqual((latest['observed']/latest['baseline']-1)*100, latest['pct_change'])

    def test_flat_series_does_not_generate_shocks(self):
        dates = np.arange('2023-01-01', '2024-01-01', dtype='datetime64[D]')
        self.assertEqual(detect_series(dates, np.full(len(dates), 100.), 3., None), [])
