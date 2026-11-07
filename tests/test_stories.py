"""Story engine: deterministic, evidence-backed, no future leakage, no invented costs."""
from datetime import date, timedelta

import pytest

from pipeline import stories as S


def d(s):
    return date.fromisoformat(s)


def daily(start, prices):
    t = d(start)
    return {t + timedelta(days=i): p for i, p in enumerate(prices) if p is not None}


# ---------- monthly panel + seasonal baseline ----------

def test_panel_change_uses_only_markets_present_in_both_months():
    mm = {(1, '2023-09'): 1000, (1, '2023-10'): 1500, (2, '2023-09'): 2000, (2, '2023-10'): 2000,
          (3, '2023-10'): 9000}  # market 3 has no September value -> excluded
    p = S.panel_change(mm, '2023-10')
    assert p['n_markets'] == 2
    assert p['median_pct'] == pytest.approx(25.0)  # median of +50% and 0%
    assert p['share_up'] == pytest.approx(0.5)


def test_seasonal_z_uses_only_prior_years():
    hist = {f'{y}-10': float(v) for y, v in zip(range(2010, 2016), [1, -1, 2, -2, 1, -1])}
    z1 = S.seasonal_z(hist | {'2016-10': 20.0}, '2016-10')
    # Changing a FUTURE year must not change the z-score for 2016.
    z2 = S.seasonal_z(hist | {'2016-10': 20.0, '2017-10': -500.0, '2018-10': 900.0}, '2016-10')
    assert z1 == z2 and z1 > 5
    assert S.seasonal_z({'2014-10': 1.0, '2015-10': 2.0, '2016-10': 3.0}, '2016-10') is None  # <5 prior years


# ---------- corridor economics ----------

COSTS = S.corridor_cost_params(route_km=S.ANCHOR_ROUTE_KM, period='2023-04')


def test_costs_come_from_cited_evidence_and_scale_with_distance():
    assert COSTS['status'] == 'sourced'
    base = COSTS['scenarios']['baseline']
    assert base['freight_per_qtl'] == pytest.approx(240.0)
    assert base['loss_fraction'] == pytest.approx(0.05)
    assert COSTS['scenarios']['adverse']['loss_fraction'] == pytest.approx(0.10)
    assert COSTS['scenarios']['adverse']['freight_per_qtl'] > 240
    assert all(a['source'] for a in COSTS['assumptions'] if a['kind'] == 'sourced')
    half = S.corridor_cost_params(route_km=S.ANCHOR_ROUTE_KM / 2, period='2023-04')
    assert half['scenarios']['baseline']['freight_per_qtl'] == pytest.approx(120.0)


def test_costs_outside_evidence_window_are_not_invented():
    old = S.corridor_cost_params(route_km=1000, period='2009-04')
    assert old['status'] == 'unsupported_period' and old['scenarios'] is None


def test_net_per_qtl_matches_economics_engine_by_hand():
    # buy 1000/qtl, sell 1500/qtl, freight 240, fees 5% of buy, loading 9.02, loss 5%, financing 12% p.a. 9 days
    r = S.net_per_qtl(1000, 1500, COSTS['scenarios']['baseline'], financing_days=9)
    capital = 1000 + 240 + 50 + 9.02
    expected = 1500 * 0.95 - capital * (1 + 0.12 * 9 / 365)
    assert r == pytest.approx(expected, abs=0.01)


def test_corridor_sale_happens_after_transit_never_same_day():
    o = daily('2023-04-01', [1000] * 30)
    dst = daily('2023-04-01', [1600] + [1100] * 29)  # same-day spike must not be capturable
    ev = S.evaluate_corridor_month(o, dst, '2023-04', transit_days=2, costs=COSTS)
    assert ev['trades'] and all(t['sell_date'] >= t['buy_date'] + 2 for t in ev['trades_ord'])
    assert max(t['gross'] for t in ev['trades']) == 100


def test_informed_decisions_do_not_use_future_prices():
    o = daily('2023-04-01', [1000] * 30)
    dst_a = daily('2023-04-01', [1500] * 30)
    dst_b = dict(dst_a)
    for k in list(dst_b):
        if k >= d('2023-04-10'):
            dst_b[k] = 100  # the future collapses
    ea = S.evaluate_corridor_month(o, dst_a, '2023-04', transit_days=2, costs=COSTS)
    eb = S.evaluate_corridor_month(o, dst_b, '2023-04', transit_days=2, costs=COSTS)
    shipped_a = {t['buy'] for t in ea['informed']['decisions'] if t['ship'] and t['buy'] < '2023-04-10'}
    shipped_b = {t['buy'] for t in eb['informed']['decisions'] if t['ship'] and t['buy'] < '2023-04-10'}
    assert shipped_a == shipped_b and shipped_a
    # ...but the realized outcome of those decisions does reflect the collapse.
    assert eb['informed']['realized_net_per_qtl_mean'] < ea['informed']['realized_net_per_qtl_mean']


def test_hindsight_is_an_upper_bound_on_informed():
    o = daily('2023-04-01', [1000 + (i % 5) * 40 for i in range(30)])
    dst = daily('2023-04-01', [1300 + (i % 7) * 60 for i in range(30)])
    ev = S.evaluate_corridor_month(o, dst, '2023-04', transit_days=2, costs=COSTS)
    assert ev['hindsight']['best_net_per_qtl'] >= max((t['realized_net'] for t in ev['informed']['decisions'] if t['ship']), default=-1e9)


def test_no_net_claim_without_cost_evidence():
    o = daily('2009-04-01', [1000] * 30)
    dst = daily('2009-04-01', [1500] * 30)
    ev = S.evaluate_corridor_month(o, dst, '2009-04', transit_days=2,
                                   costs=S.corridor_cost_params(route_km=1000, period='2009-04'))
    assert ev['gross_median'] == 500
    assert ev['net_baseline_median'] is None and ev['informed'] is None and ev['hindsight'] is None


def test_classification_is_honest():
    assert S.classify_corridor({'n': 15, 'gross_median': 300, 'persistence': 0.9, 'net_baseline_median': -20, 'net_adverse_median': -120}) == 'looked_profitable'
    assert S.classify_corridor({'n': 15, 'gross_median': 900, 'persistence': 0.9, 'net_baseline_median': 400, 'net_adverse_median': 250}) == 'survives_costs'
    assert S.classify_corridor({'n': 15, 'gross_median': 500, 'persistence': 0.9, 'net_baseline_median': 90, 'net_adverse_median': -40}) == 'fragile_margin'
    assert S.classify_corridor({'n': 15, 'gross_median': -600, 'persistence': 0.05, 'net_baseline_median': -900, 'net_adverse_median': -1000}) == 'reverse_gap'
    assert S.classify_corridor({'n': 4, 'gross_median': 900, 'persistence': 1, 'net_baseline_median': 500, 'net_adverse_median': 400}) == 'insufficient'
    assert S.classify_corridor({'n': 15, 'gross_median': 500, 'persistence': 0.9, 'net_baseline_median': None, 'net_adverse_median': None}) == 'gross_only'


def test_waterfall_components_reconcile_to_engine_net():
    sc = COSTS['scenarios']['baseline']
    w = S.waterfall(1000, 1500, sc, financing_days=9)
    assert w['sell'] - w['buy'] - w['freight'] - w['fees'] - w['loading'] - w['loss'] - w['interest'] == pytest.approx(w['net'], abs=0.02)
    assert w['net'] == pytest.approx(S.net_per_qtl(1000, 1500, sc, financing_days=9), abs=0.01)


def test_typical_day_is_an_actual_trade():
    trades = [{'net_baseline': v} for v in (-50, 10, 300, -400, 20)]
    assert S.typical(trades, 'net_baseline')['net_baseline'] == 10


# ---------- story objects ----------

def test_caption_numbers_resolve_to_facts():
    story = S.example_story_for_tests()
    S.validate_story(story)  # raises on any unresolvable number / missing geometry
    bad = dict(story, scenes=[dict(story['scenes'][0], caption='Prices rose 12345%')] + story['scenes'][1:])
    with pytest.raises(ValueError, match='12345'):
        S.validate_story(bad)


def test_scene_markets_must_have_geography_and_precision():
    story = S.example_story_for_tests()
    broken = dict(story, markets=[dict(story['markets'][0], lat=None)] + story['markets'][1:])
    with pytest.raises(ValueError, match='geography'):
        S.validate_story(broken)


def test_market_identities_are_not_merged():
    assert S.CORRIDORS, 'at least one corridor'
    for c in S.CORRIDORS:
        assert 'apmc' not in c['origin_key'] and 'apmc' not in c['dest_key']
        assert c['origin_id'] != c['dest_id']


def test_story_ids_are_stable_and_url_safe():
    assert S.story_id('onion', '2023-04', 'gap', 'lasalgaon-azadpur') == 'onion-2023-04-gap-lasalgaon-azadpur'
    assert S.story_id('onion', '2023-04', 'shock') == 'onion-2023-04-shock'


def test_market_precision_labels_never_overstate_location_quality():
    assert S.precision_of('nominatim') == 'geocoded point (OpenStreetMap)'
    for src in ('district_centroid', 'state_centroid', 'nominatim_near', 'nominatim_state', None, 'weird'):
        assert S.precision_of(src).startswith('approximate')
