"""Regression checks for retrospective month screens and sequencing."""
from datetime import date, timedelta

import pytest

from pipeline.month_opportunities import analyze_month, archive_catalog, best_chain
from pipeline.trade_stories import RAW


requires_archive = pytest.mark.skipif(
    not any(RAW.glob('all_*.parquet')),
    reason='retained yearly parquet is local-only, not checked into git',
)


def leg(origin, destination, buy, sell, net, stress=10, variety='standard'):
    return {'origin': origin, 'destination': destination, 'buy': buy, 'sell': sell,
            'net_baseline': net, 'net_adverse': stress, 'variety': variety}


def test_dp_uses_settlement_market_and_positive_stressed_legs():
    edges = [
        leg('a', 'b', '2024-08-01', '2024-08-03', 100),
        leg('b', 'c', '2024-08-09', '2024-08-10', 150),  # too soon after sale
        leg('b', 'c', '2024-08-10', '2024-08-11', 60),
        leg('z', 'c', '2024-08-12', '2024-08-13', 150),  # no repositioning
        leg('c', 'd', '2024-08-18', '2024-08-19', 50),
        leg('a', 'd', '2024-08-01', '2024-08-19', 180),
        leg('d', 'e', '2024-08-25', '2024-08-26', 900, stress=-5),
    ]
    result = best_chain(edges)
    assert [(e['origin'], e['destination']) for e in result['legs']] == [('a', 'b'), ('b', 'c'), ('c', 'd')]
    assert result['modeled_net_per_initial_qtl'] == 210
    for previous, following in zip(result['legs'], result['legs'][1:]):
        assert previous['destination'] == following['origin']
        assert date.fromisoformat(following['buy']) >= date.fromisoformat(previous['sell']) + timedelta(days=7)


@requires_archive
def test_archived_products_not_limited_to_story_finalists():
    catalog = archive_catalog()
    assert catalog['schema'] == 'agrinet-month-1'
    assert 'ajwan' in catalog['products']  # no survivor story required
    assert '2025-01' in catalog['products']['ajwan']['months']
    result = analyze_month('ajwan', '2025-01', catalog=catalog)
    assert result['product'] == 'ajwan'
    assert result['status'] in ('no_supported_opportunity', 'unsupported_product', 'unsupported_cost_period')
    assert result['opportunities'] == []
    assert result['coverage']['scope'] == 'cached_named_place_roads_only'


@requires_archive
def test_real_screen_preserves_informed_decision_and_sequential_chain():
    result = analyze_month('tomato', '2024-08', catalog=archive_catalog())
    assert result['opportunities']
    assert result['chains']
    for candidate in result['opportunities']:
        assert candidate['known_destination_date'] < candidate['buy'] < candidate['sell']
        assert candidate['net_baseline'] > 0 and candidate['net_adverse'] > 0
    for chain in result['chains']:
        assert chain['modeled_net_per_initial_qtl'] == round(sum(e['net_baseline'] for e in chain['legs']), 2)
        for previous, following in zip(chain['legs'], chain['legs'][1:]):
            assert previous['destination'] == following['origin']
            assert date.fromisoformat(following['buy']) >= date.fromisoformat(previous['sell']) + timedelta(days=7)
