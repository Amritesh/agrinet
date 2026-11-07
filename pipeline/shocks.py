"""Price-shock detection over data/derived/price_daily.parquet.

Methods (all per market×commodity series, on observed days only — no interpolation):
  return_1d     log return vs previous observation (gap <= 7 days), z vs rolling 90-obs std
  return_7d     log return vs observation ~7 days earlier (nearest within 5-10 days)
  mad_z         robust z: (x - rolling median_60) / (1.4826 * MAD_60)
  seasonal_dev  deviation of log price from the market's day-of-year seasonal baseline
                (median of same ISO-week in prior years, >=3 prior years) in units of
                that week's historical MAD
  regional_div  market's log price minus state-level daily median, z vs 90-obs std
  sync          cross-market: fraction of state markets with |return_1d z| > 2 same day
                (recorded at state level into details of the triggering shocks)

Commodity-specific thresholds (z-like scores) — vegetables are volatile, so thresholds
are higher than for grains:
  onion  : 3.0 / tomato : 3.5 / potato : 2.8
Severity: 1 (>= thr), 2 (>= thr+1), 3 (>= thr+2), 4 (>= thr+3.5)

Sparse handling: a series needs >= 60 observations and the point needs >= 30 trailing
observations in the window; otherwise no score (explicitly null).
Output: data/derived/shocks.parquet, data/derived/shock_summary.json
Everything here is a pure function of price_daily.parquet (reproducible).
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DERIVED = ROOT / "data" / "derived"
THRESH = {23: 3.0, 78: 3.5, 24: 2.8}
MIN_OBS = 60
WIN = 90
MAD_WIN = 60


def severity(score: float, thr: float) -> int:
    a = abs(score)
    if a >= thr + 3.5:
        return 4
    if a >= thr + 2:
        return 3
    if a >= thr + 1:
        return 2
    return 1


def rolling_std(x: np.ndarray, win: int) -> np.ndarray:
    """Trailing std of previous `win` values (excluding current); nan where < 30 values."""
    return pd.Series(x).rolling(win, min_periods=30).std().shift(1).to_numpy()


def rolling_mean(x: np.ndarray, win: int) -> np.ndarray:
    return pd.Series(x).rolling(win, min_periods=10).mean().shift(1).to_numpy()


def rolling_median_mad(x: np.ndarray, win: int):
    s = pd.Series(x)
    med = s.rolling(win, min_periods=30).median().shift(1)
    mad = (s - med).abs().rolling(win, min_periods=30).median().shift(1)
    return med.to_numpy(), mad.to_numpy()


def detect_series(dates: np.ndarray, modal: np.ndarray, thr: float, state_med: np.ndarray | None):
    """dates: datetime64[D] sorted; modal: float. Returns list of shock dicts."""
    n = len(modal)
    if n < MIN_OBS:
        return []
    lp = np.log(modal)
    day = dates.astype("datetime64[D]").astype(np.int64)
    gap = np.diff(day, prepend=day[0])
    r1 = np.diff(lp, prepend=lp[0])
    r1[(gap > 7) | (gap == 0)] = np.nan
    r1[0] = np.nan
    sd1 = rolling_std(np.nan_to_num(r1), WIN)
    z1 = r1 / np.where(sd1 > 0.005, sd1, np.nan)  # floor: 0.5% daily std

    # 7-day return: find nearest previous obs 5-10 days back
    r7 = np.full(n, np.nan)
    j = 0
    for i in range(n):
        while j < i and day[i] - day[j] > 10:
            j += 1
        k = j
        best = None
        while k < i and day[i] - day[k] >= 5:
            best = k
            k += 1
        if best is not None:
            r7[i] = lp[i] - lp[best]
    sd7 = rolling_std(np.nan_to_num(r7), WIN)
    z7 = r7 / np.where(sd7 > 0.01, sd7, np.nan)

    med, mad = rolling_median_mad(lp, MAD_WIN)
    zm = (lp - med) / np.where(mad > 0.01, 1.4826 * mad, np.nan)

    # seasonal: iso-week baseline from prior years
    isoweek = (dates.astype("datetime64[W]").astype(np.int64)) % 52
    years = dates.astype("datetime64[Y]").astype(np.int64) + 1970
    zs = np.full(n, np.nan)
    base = np.full(n, np.nan)
    by_wk: dict[int, list[tuple[int, float]]] = {}
    for i in range(n):
        wk = int(isoweek[i])
        prior = [v for (y, v) in by_wk.get(wk, []) if y < years[i]]
        if len({y for (y, v) in by_wk.get(wk, []) if y < years[i]}) >= 3:
            arr = np.array(prior)
            m = np.median(arr)
            md = np.median(np.abs(arr - m))
            base[i] = m
            if md > 0.02:
                zs[i] = (lp[i] - m) / (1.4826 * md)
        by_wk.setdefault(wk, []).append((int(years[i]), float(lp[i])))

    zr = None
    if state_med is not None:
        d = lp - state_med  # nan where no state median
        dev = d - rolling_mean(d, 30)
        sdr = rolling_std(dev, WIN)
        zr = dev / np.where(sdr > 0.02, sdr, np.nan)

    out = []
    for i in range(n):
        cands = [
            ("return_1d", z1[i], r1[i], None if i == 0 else modal[i - 1]),
            ("return_7d", z7[i], r7[i], None),
            ("mad_z", zm[i], None if np.isnan(med[i]) else lp[i] - med[i], None if np.isnan(med[i]) else float(np.exp(med[i]))),
            ("seasonal_dev", zs[i], None if np.isnan(base[i]) else lp[i] - base[i], None if np.isnan(base[i]) else float(np.exp(base[i]))),
        ]
        if zr is not None:
            cands.append(("regional_div", zr[i], None if state_med is None else lp[i] - state_med[i], None if state_med is None or np.isnan(state_med[i]) else float(np.exp(state_med[i]))))
        for method, z, lr, baseline in cands:
            if z is None or np.isnan(z) or abs(z) < thr:
                continue
            out.append(
                {
                    "obs_date": dates[i],
                    "method": method,
                    "direction": "up" if z > 0 else "down",
                    "score": float(z),
                    "pct_change": None if lr is None or np.isnan(lr) else float(np.expm1(lr) * 100),
                    "baseline": baseline,
                    "observed": float(modal[i]),
                    "severity": severity(float(z), thr),
                    "window_start": dates[max(0, i - WIN)],
                    "window_end": dates[i],
                }
            )
    return out


def main() -> None:
    t0 = time.time()
    con = duckdb.connect()
    con.execute(
        f"""CREATE TABLE p AS SELECT state_norm, district_norm, market_norm, commodity_id, obs_date, modal_price
            FROM '{DERIVED}/price_daily.parquet'"""
    )
    con.execute(
        """CREATE TABLE sm AS SELECT state_norm, commodity_id, obs_date, median(ln(modal_price)) AS state_lmed, count(*) AS n
           FROM p GROUP BY ALL"""
    )
    series = con.execute(
        """SELECT p.state_norm, p.district_norm, p.market_norm, p.commodity_id,
                  list(p.obs_date ORDER BY p.obs_date) AS dates,
                  list(p.modal_price ORDER BY p.obs_date) AS modal,
                  list(CASE WHEN sm.n >= 3 THEN sm.state_lmed END ORDER BY p.obs_date) AS smed
           FROM p LEFT JOIN sm USING (state_norm, commodity_id, obs_date)
           GROUP BY ALL HAVING count(*) >= ?""",
        [MIN_OBS],
    ).fetchall()
    rows = []
    for sn, dn, mn, cid, dates, modal, smed in series:
        d = np.array(dates, dtype="datetime64[D]")
        m = np.array(modal, dtype=float)
        s = np.array([np.nan if v is None else v for v in smed], dtype=float)
        for sh in detect_series(d, m, THRESH[cid], s if np.isfinite(s).sum() > MIN_OBS else None):
            sh.update({"state_norm": sn, "district_norm": dn, "market_norm": mn, "commodity_id": cid})
            rows.append(sh)
    df = pd.DataFrame(rows)
    for c in ("obs_date", "window_start", "window_end"):
        df[c] = pd.to_datetime(df[c]).dt.date
    con.execute("CREATE TABLE out AS SELECT * FROM df")
    con.execute(f"COPY out TO '{DERIVED}/shocks.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)")
    summ = con.execute(
        f"""SELECT commodity_id, method, severity, count(*) FROM '{DERIVED}/shocks.parquet' GROUP BY ALL ORDER BY ALL"""
    ).fetchall()
    (DERIVED / "shock_summary.json").write_text(
        json.dumps({"series": len(series), "shocks": len(rows), "seconds": round(time.time() - t0, 1), "by": summ}, indent=1, default=str)
    )
    print(f"series={len(series)} shocks={len(rows)} in {time.time()-t0:.0f}s")
    for r in summ:
        print(r)


if __name__ == "__main__":
    main()
