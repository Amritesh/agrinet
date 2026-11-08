"""Regression gates for the trade-story screening and cached-place routing."""
from datetime import date, timedelta

from pipeline.trade_stories import cached_place, qualifies, select_finalists, prioritize_routes, product_slug
from pipeline.stories import corridor_cost_params, evaluate_corridor_month


def test_static_export_writes_all_observed_product_months_and_refuses_existing_target(tmp_path):
    import duckdb
    import json
    import pytest
    from pipeline.month_opportunities import export_static
    raw = tmp_path / 'raw'
    raw.mkdir()
    con = duckdb.connect()
    con.execute("""CREATE TABLE source AS SELECT 'State' State, 'District' District, 'Market' Market,
        'Fish' Commodity, 'Other' Variety, 'FAQ' Grade, DATE '2024-01-01' Arrival_Date,
        100 Min_Price, 100 Max_Price, 100 Modal_Price""")
    con.execute("""INSERT INTO source SELECT State,District,Market,'Egg',Variety,Grade,
                 DATE '2024-02-01',Min_Price,Max_Price,Modal_Price FROM source""")
    con.execute(f"COPY source TO '{raw / 'all_2024.parquet'}' (FORMAT PARQUET)")
    out = tmp_path / 'api'
    catalog = export_static(out, raw=raw, routes=tmp_path / 'missing.json')
    assert set(catalog['products']) == {'fish', 'egg'}
    assert json.loads((out / 'fish' / '2024-01.json').read_text())['status'] == 'unsupported_product'
    assert json.loads((out / 'egg' / '2024-02.json').read_text())['status'] == 'unsupported_product'
    assert not (out / 'fish' / '2024-02.json').exists()
    with pytest.raises(FileExistsError):
        export_static(out, raw=raw, routes=tmp_path / 'missing.json')
    with pytest.raises(ValueError, match='source'):
        export_static(raw / 'nested-output', raw=raw, routes=tmp_path / 'missing.json')


def test_archive_month_api_includes_every_source_product_and_only_cached_road(tmp_path):
    import duckdb
    import json
    from pipeline.month_opportunities import archive_catalog, analyze_month
    raw = tmp_path / 'raw'
    raw.mkdir()
    con = duckdb.connect()
    con.execute("""CREATE TABLE source(State VARCHAR, District VARCHAR, Market VARCHAR,
                Commodity VARCHAR, Variety VARCHAR, Grade VARCHAR, Arrival_Date DATE,
                Min_Price INTEGER, Max_Price INTEGER, Modal_Price INTEGER)""")
    start = date(2024, 1, 1)
    for i in range(20):
        for market, price in [('Town A', 1000 + i * 2), ('Town B', 1400 + i * 2)]:
            con.execute('INSERT INTO source VALUES (?,?,?,?,?,?,?,?,?,?)',
                        ['State', 'District', market, 'Potato', 'Red', 'FAQ',
                         start + timedelta(days=i), price, price, price])
    con.execute('INSERT INTO source VALUES (?,?,?,?,?,?,?,?,?,?)',
                ['State', 'District', 'Town A', 'Fish', 'Other', 'FAQ', start, 100, 100, 100])
    con.execute(f"COPY source TO '{raw / 'all_2024.parquet'}' (FORMAT PARQUET)")
    routes = tmp_path / 'routes.json'
    route_key = 'state|district|town a>state|district|town b'
    routes.write_text(json.dumps({route_key: {'distance_km': 180, 'duration_h': 3,
                                             'geometry': [[75, 20], [76, 20]],
                                             'provider': 'OSRM', 'profile': 'driving',
                                             'truck_suitable': False}}))
    points = {(s, d, m): {'lat': 20, 'lon': lon, 'precision': 'verified marketplace point'}
              for s, d, m, lon in [('state', 'district', 'town a', 75),
                                   ('state', 'district', 'town b', 76)]}
    catalog = archive_catalog(raw)
    assert set(catalog['products']) == {'potato', 'fish'}
    assert catalog['products']['fish']['months'] == ['2024-01']
    result = analyze_month('potato', '2024-01', catalog=catalog, raw=raw, routes=routes, points=points)
    assert result['coverage']['routed_pairs_considered'] == 1
    assert result['coverage']['scope'] == 'cached_named_place_roads_only'
    assert result['opportunities']
    assert all(x['net_baseline'] > 0 and x['net_adverse'] > 0 and
               x['known_destination_date'] < x['buy'] < x['sell'] for x in result['opportunities'])
    assert analyze_month('fish', '2024-01', catalog=catalog, raw=raw, routes=routes, points=points)['status'] == 'unsupported_product'
    assert analyze_month('potato', '2024-02', catalog=catalog, raw=raw, routes=routes, points=points)['status'] == 'no_source_observations'


def test_sequential_chain_requires_settlement_and_same_destination_origin():
    from pipeline.month_opportunities import best_chain
    legs = [
        {'origin': 'A', 'destination': 'B', 'buy': '2024-01-01', 'sell': '2024-01-03', 'net_baseline': 100, 'net_adverse': 40},
        {'origin': 'B', 'destination': 'C', 'buy': '2024-01-05', 'sell': '2024-01-06', 'net_baseline': 130, 'net_adverse': 20},
        {'origin': 'B', 'destination': 'C', 'buy': '2024-01-10', 'sell': '2024-01-12', 'net_baseline': 80, 'net_adverse': 20},
        {'origin': 'X', 'destination': 'C', 'buy': '2024-01-10', 'sell': '2024-01-12', 'net_baseline': 150, 'net_adverse': 20},
    ]
    chain = best_chain(legs, settlement_days=7)
    assert [(x['origin'], x['destination'], x['buy']) for x in chain['legs']] == [
        ('A', 'B', '2024-01-01'), ('B', 'C', '2024-01-10')]
    assert chain['modeled_net_per_initial_qtl'] == 180


def test_chain_cannot_reuse_capital_on_overlapping_trades():
    from pipeline.month_opportunities import best_chain
    legs = [
        {'origin': 'A', 'destination': 'B', 'buy': '2024-01-01', 'sell': '2024-01-10', 'net_baseline': 100, 'net_adverse': 30},
        {'origin': 'A', 'destination': 'C', 'buy': '2024-01-02', 'sell': '2024-01-04', 'net_baseline': 80, 'net_adverse': 30},
    ]
    assert best_chain(legs, settlement_days=7)['modeled_net_per_initial_qtl'] == 100


def test_cached_place_rejects_centroids_and_unrelated_pois():
    cache = {
        'X, D, S, India': [
            {'lat': '20.0', 'lon': '74.0', 'type': 'hospital', 'display_name': 'X Hospital, D, S, India'}
        ],
        'Y, D, S, India': [
            {'lat': '21.0', 'lon': '75.0', 'type': 'town', 'display_name': 'Y, D, S, India', 'osm_type': 'relation', 'osm_id': 7}
        ],
    }
    assert cached_place('district_centroid', 'X, D, S, India', 20, 74, cache) is None
    assert cached_place('nominatim', 'X, D, S, India', 20, 74, cache) is None
    assert cached_place('nominatim', 'Y, D, S, India', 21, 75, cache) == {
        'lat': 21.0, 'lon': 75.0, 'precision': 'representative town/place (not the mandi gate)',
        'display_name': 'Y, D, S, India', 'osm': 'relation/7',
    }


def test_exact_cached_hit_and_no_precise_market_claim():
    c = {'X, D, S, India': [
        {'lat': '23.0', 'lon': '77.0', 'type': 'town', 'display_name': 'Elsewhere'},
        {'lat': '20.0', 'lon': '74.0', 'type': 'marketplace', 'display_name': 'X Mandi, D, S', 'osm_type': 'node', 'osm_id': 8},
    ]}
    p = cached_place('nominatim', 'X, D, S, India', 20, 74, c)
    assert p['precision'] == 'verified marketplace point (OpenStreetMap)'
    assert p['osm'] == 'node/8'


def test_select_finalists_balances_product_month_and_deduplicates_routes():
    # We retain alternates until a route is independently checked. No universal top-three
    # cutoff that silently discards a product after three missing geocodes.
    rows = [(90, 'onion', 'red', 'FAQ', '2023-01', ('a',), ('b',)),
            (89, 'onion', 'red', 'FAQ', '2023-01', ('a',), ('b',)),
            (80, 'onion', 'red', 'FAQ', '2023-01', ('a',), ('c',)),
            (75, 'potato', 'red', 'FAQ', '2023-01', ('d',), ('e',)),
            (70, 'onion', 'red', 'FAQ', '2023-02', ('a',), ('b',))]
    selected = select_finalists(rows)
    assert len(selected) == 4
    assert [x[1] for x in selected[:2]] == ['onion', 'potato']


def test_route_budget_greedily_covers_more_distinct_product_months():
    rows = [(100, 'onion', 'x', 'FAQ', '2023-01', ('a',), ('b',)),
            (90, 'potato', 'x', 'FAQ', '2023-01', ('c',), ('d',)),
            (80, 'potato', 'x', 'FAQ', '2023-02', ('c',), ('d',)),
            (70, 'tomato', 'x', 'FAQ', '2023-01', ('c',), ('d',))]
    selected = prioritize_routes(rows, set(), 1)
    assert selected == {(('c',), ('d',))}
    # Already-routed paths cost no new request and remain available.
    assert prioritize_routes(rows, {(('a',), ('b',))}, 1) == {(('a',), ('b',)), (('c',), ('d',))}


def test_profit_gate_requires_stress_and_morning_rule_not_just_spread():
    start = date(2023, 2, 1)
    buy = {start + timedelta(days=i): 1000 + i * 2 for i in range(20)}
    sell = {start + timedelta(days=i): 1320 + i * 2 for i in range(28)}
    costs = corridor_cost_params(route_km=180, period='2023-02')
    ev = evaluate_corridor_month(buy, sell, '2023-02', transit_days=1, costs=costs)
    assert qualifies(ev, km=180)[0]
    ev['informed']['realized_adverse_per_qtl_mean'] = -1
    assert not qualifies(ev, km=180)[0]
    assert product_slug('Bengal Gram (Gram)') == 'bengal_gram_gram'
