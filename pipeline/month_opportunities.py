"""Offline month API over the retained AGMARKNET-backed archive; no live API calls.

Run: uv run python -m pipeline.month_opportunities --out /path/to/empty/output
Output is static JSON for a static host. Only cached, named-place OSRM roads are
modeled; this is NOT an exhaustive search of India or an executable-price feed.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from collections import defaultdict
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

from pipeline.stories import SETTLEMENT_DAYS, corridor_cost_params, evaluate_corridor_month
from pipeline.trade_stories import (
    LEAFY_MAX_KM,
    MAX_KM,
    MIN_KM,
    NORM_SQL,
    RAW,
    ROOT,
    ROUTES,
    _con,
    _load,
    excluded,
    is_leafy,
    product_slug,
    transit_days_for,
)

MONTH_RE = re.compile(r'^20\d\d-(0[1-9]|1[0-2])$')
DISCLAIMERS = [
    'Retained third-party AGMARKNET-backed archive; no live data.gov.in API request or credential.',
    'Modal mandi observations are not executable bids/offers; no actual trade or profit is verified.',
    'Only roads already in the retained OSRM cache between vetted named places are analyzed; not all India market pairs.',
    'OSRM driving/car profile is not truck-certified; freight and loss are assumptions extrapolated from an onion survey.',
    'Destination sale observations and the selected maximum chain were not known on the buy day; retrospective selection bias.',
    'No arrivals, capacity, actual fees, counterparty, inventory, initial working-capital budget or transport booking evidence.',
]


def _files(raw: Path, years=None) -> list[Path]:
    paths = sorted(raw.glob('all_*.parquet')) if years is None else [raw / f'all_{y}.parquet' for y in years]
    return [p for p in paths if p.is_file()]


def _read(paths: list[Path]) -> str:
    if not paths:
        raise FileNotFoundError('No local retained yearly parquet files')
    # Paths come from local pathlib glob; DuckDB parameter binding cannot bind table paths.
    return 'read_parquet(' + json.dumps([str(p) for p in paths]) + ')'


def archive_catalog(raw: Path = RAW) -> dict:
    """List ALL distinct archived source products and observed months, including zero-road crops."""
    con = _con()
    try:
        rows = con.execute(f"""SELECT Commodity, strftime(Arrival_Date, '%Y-%m'), count(*), max(Arrival_Date)
                               FROM {_read(_files(raw))} WHERE Commodity IS NOT NULL
                               GROUP BY 1, 2 ORDER BY 1, 2""").fetchall()
    finally:
        con.close()
    products: dict = {}
    for name, ym, n, _last in rows:
        slug = product_slug(name)
        p = products.setdefault(slug, {'name': name, 'source_names': [], 'months': [], 'raw_rows': 0,
                                        'supported_product': not excluded(name)})
        if name not in p['source_names']:
            p['source_names'].append(name)
        if ym not in p['months']:
            p['months'].append(ym)
        p['raw_rows'] += n
        p['supported_product'] = p['supported_product'] and not excluded(name)
    for p in products.values():
        p['months'].sort()
    last = max((r[3] for r in rows), default=None)
    return {'schema': 'agrinet-month-1', 'source': 'retained AGMARKNET-backed local parquet (not live API)',
            'latest_observation': last.isoformat() if last else None,
            'products': products, 'caveats': DISCLAIMERS}


def analyze_month(product: str, month: str, *, catalog: dict, raw: Path = RAW,
                  routes: Path = ROUTES, points: dict | None = None) -> dict:
    """Analyze all comparable daily observations on cached named-place roads only.

    No per-product top-N finalist cut; empty months/products retain explicit status.
    """
    if not re.fullmatch(r'[a-z0-9]+(?:_[a-z0-9]+)*', product) or not MONTH_RE.fullmatch(month):
        raise ValueError('Invalid product or month')
    item = catalog['products'].get(product)
    if item is None:
        raise ValueError('Unknown archived product')
    response = {'schema': 'agrinet-month-1', 'product': product, 'product_name': item['name'],
                'month': month, 'source': catalog['source'], 'latest_observation': catalog['latest_observation'],
                'status': 'no_supported_opportunity', 'coverage': {'scope': 'cached_named_place_roads_only',
                'clean_market_variety_days_in_month': 0, 'routed_pairs_considered': 0, 'matched_pairs': 0,
                'matched_days': 0, 'note': 'No claim of all routes or all Indian market pairs.'},
                'opportunities': [], 'chains': [], 'caveats': DISCLAIMERS}
    if month not in item['months']:
        response['status'] = 'no_source_observations'
        return response
    if not item['supported_product']:
        response['status'] = 'unsupported_product'
        return response
    costs_check = corridor_cost_params(route_km=180, period=month)
    if costs_check['status'] != 'sourced':
        response['status'] = 'unsupported_cost_period'
        return response
    year, mo = map(int, month.split('-'))
    first = date(year, mo, 1)
    end = date(year + (mo == 12), mo % 12 + 1, 1)
    paths = _files(raw, (year - 1, year, year + 1))
    con = _con()
    try:
        source = _read(paths)
        # One month of purchases; previous reports for an informed decision and
        # subsequent reports for modeled arrival (max route 6 days + two-day wait).
        con.execute(f"""CREATE TABLE daily AS SELECT Commodity AS commodity,
            coalesce(Variety, 'Other') AS variety, coalesce(Grade, 'FAQ') AS grade,
            {NORM_SQL.format(c='State')} AS sn, {NORM_SQL.format(c='District')} AS dn,
            {NORM_SQL.format(c='Market')} AS mn, any_value(State) AS state,
            any_value(District) AS district, any_value(Market) AS market,
            Arrival_Date AS d, round(median(Modal_Price))::INTEGER AS p
            FROM {source} WHERE Commodity IN (SELECT unnest(?::VARCHAR[]))
            AND Arrival_Date >= ? AND Arrival_Date < ?
            AND Modal_Price > 0 AND Modal_Price <= 300000 AND Min_Price > 0
            AND Max_Price >= Min_Price AND Modal_Price BETWEEN Min_Price * 0.99 AND Max_Price * 1.01
            GROUP BY ALL""", [item['source_names'], first - timedelta(days=16), end + timedelta(days=10)])
        response['coverage']['clean_market_variety_days_in_month'] = con.execute(
            'SELECT count(*) FROM daily WHERE d >= ? AND d < ?', [first, end]).fetchone()[0]
        if points is None:
            from pipeline.trade_stories import market_points
            points = market_points(con)
        names = {(sn, dn, mn): (state, district, market) for sn, dn, mn, state, district, market in
                 con.execute('SELECT sn,dn,mn,any_value(state),any_value(district),any_value(market) FROM daily GROUP BY 1,2,3').fetchall()}
        data = defaultdict(dict)
        for c, v, g, sn, dn, mn, d, p in con.execute(
                'SELECT commodity,variety,grade,sn,dn,mn,d,p FROM daily').fetchall():
            data[(c, v, g, (sn, dn, mn))][d] = float(p)
    finally:
        con.close()
    route_cache = _load(routes)
    routes_ok = []
    for key, route in route_cache.items():
        if not route or '>' not in key:
            continue
        os, ds = key.split('>', 1)
        origin, destination = tuple(os.split('|')), tuple(ds.split('|'))
        if len(origin) != 3 or len(destination) != 3 or origin not in points or destination not in points:
            continue
        km = route['distance_km']
        if not MIN_KM <= km <= MAX_KM:
            continue
        routes_ok.append((key, origin, destination, route))
    grouped = defaultdict(dict)
    for (c, v, g, market), series in data.items():
        grouped[(c, v, g)][market] = series
    for (c, v, g), markets in grouped.items():
        for key, origin, destination, route in routes_ok:
            if origin not in markets or destination not in markets:
                continue
            km = route['distance_km']
            if is_leafy(c) and km > LEAFY_MAX_KM:
                continue
            response['coverage']['routed_pairs_considered'] += 1
            transit = transit_days_for(km)
            costs = corridor_cost_params(route_km=km, period=month)
            ev = evaluate_corridor_month(markets[origin], markets[destination], month,
                                         transit_days=transit, costs=costs)
            response['coverage']['matched_days'] += ev['n']
            if not ev['trades']:
                continue
            response['coverage']['matched_pairs'] += 1
            # Only price-comparable series with enough actual reporting. This is
            # not a positive-margin gate on a selected typical month.
            if ev['n'] < 12 or len({x['buy_price'] for x in ev['trades']}) < 4 or len({x['sell_price'] for x in ev['trades']}) < 4:
                continue
            decisions = {x['buy']: x for x in ev['informed']['decisions']}
            for trade in ev['trades']:
                decision = decisions.get(trade['buy'])
                if not decision or not decision['ship'] or trade['net_baseline'] <= 0 or trade['net_adverse'] <= 0:
                    continue
                if trade['gross'] / trade['buy_price'] > 0.6 or trade['net_baseline'] / trade['buy_price'] > 0.30:
                    continue
                def market(k):
                    state, district, name = names[k]
                    return {'key': '|'.join(k), 'name': name, 'state': state, 'district': district,
                            'lat': points[k]['lat'], 'lon': points[k]['lon'], 'precision': points[k]['precision']}
                response['opportunities'].append({
                    'origin': '|'.join(origin), 'destination': '|'.join(destination),
                    'origin_market': market(origin), 'destination_market': market(destination),
                    'commodity': c, 'variety': v, 'grade': g,
                    'route': {'key': key, 'km': km, 'transit_days': transit, 'geometry': route['geometry'],
                              'provider': route['provider'], 'profile': route['profile'], 'truck_suitable': False},
                    'buy': trade['buy'], 'sell': trade['sell'], 'buy_price': trade['buy_price'],
                    'sell_price': trade['sell_price'], 'gross': trade['gross'],
                    'net_baseline': trade['net_baseline'], 'net_adverse': trade['net_adverse'],
                    'known_destination_date': decision['known_dest_date'],
                    'expected_net_on_buy_day': decision['expected_net'],
                    'cost_scenarios': costs['scenarios'], 'assumptions': costs['assumptions'],
                    'verdict': 'positive_retrospective_modeled_surplus_not_verified_profit',
                })
    response['opportunities'].sort(key=lambda x: (-x['net_baseline'], x['buy'], x['origin']))
    by_variety = defaultdict(list)
    for row in response['opportunities']:
        by_variety[(row['commodity'], row['variety'], row['grade'])].append(row)
    for (commodity, variety, grade), legs in by_variety.items():
        chain = best_chain(legs)
        if chain['legs']:
            response['chains'].append({'commodity': commodity, 'variety': variety, 'grade': grade, **chain})
    response['chains'].sort(key=lambda x: -x['modeled_net_per_initial_qtl'])
    if response['opportunities']:
        response['status'] = 'modeled_scenarios_only'
    return response


def best_chain(legs: list[dict], *, settlement_days: int = SETTLEMENT_DAYS) -> dict:
    """Best retrospective sequential path for ONE commodity/variety/grade and one quintal.

    Dynamic programming on time-ordered edges: the next purchase must occur at
    the prior destination after sale AND settlement. No parallel capital reuse,
    compounding, synthetic repositioning or inventory creation is modeled.
    """
    ordered = sorted((e for e in legs if e['net_baseline'] > 0 and e['net_adverse'] > 0
                      and e['buy'] < e['sell']), key=lambda e: (e['buy'], e['sell'], e['origin'], e['destination']))

    @lru_cache(None)
    def finish(i):
        edge = ordered[i]
        ready = (date.fromisoformat(edge['sell']) + timedelta(days=settlement_days)).isoformat()
        best_net, best_indices = edge['net_baseline'], (i,)
        for j in range(i + 1, len(ordered)):
            next_edge = ordered[j]
            if next_edge['origin'] != edge['destination'] or next_edge['buy'] < ready:
                continue
            suffix_net, suffix_indices = finish(j)
            if edge['net_baseline'] + suffix_net > best_net:
                best_net, best_indices = edge['net_baseline'] + suffix_net, (i, *suffix_indices)
        return best_net, best_indices

    total, indices = max((finish(i) for i in range(len(ordered))), default=(0, ()),
                         key=lambda x: (x[0], len(x[1])))
    return {'legs': [ordered[i] for i in indices], 'modeled_net_per_initial_qtl': round(total, 2),
            'selection': 'retrospective maximum over eligible observed legs; not a trading rule'}


def export_static(out: Path, *, raw: Path = RAW, routes: Path = ROUTES) -> dict:
    """Generate static API JSON into a NEW directory; never overwrite existing assets.

    Catalog advertises every archived product/month, including unsupported and
    no-opportunity months. Analysis never calls external APIs or mutates source.
    """
    out = Path(out).resolve()
    if out.exists():
        raise FileExistsError(out)
    raw = Path(raw).resolve()
    protected = (raw, ROUTES.parent.resolve())
    if out == ROOT or any(out == p or p in out.parents for p in protected):
        raise ValueError('Refusing source/evidence location')
    catalog = archive_catalog(raw)
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.agrinet-month-staging-', dir=out.parent) as tmp:
        staging = Path(tmp) / 'api'
        staging.mkdir()
        (staging / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False))
        # A missing geography file is an error for supported products, rather
        # than silently declaring all possible opportunities impossible.
        for slug, meta in catalog['products'].items():
            folder = staging / slug
            folder.mkdir()
            for month in meta['months']:
                result = analyze_month(slug, month, catalog=catalog, raw=raw, routes=routes)
                # The route geometry is repeated for each candidate leg but the
                # Month Lab only consumes route distance. Keep the provenance and
                # economics while avoiding a huge static site export.
                for leg in [*result['opportunities'], *(leg for chain in result['chains'] for leg in chain['legs'])]:
                    if 'route' in leg:
                        leg['route'] = {k: v for k, v in leg['route'].items() if k != 'geometry'}
                (folder / f'{month}.json').write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
        out.parent.mkdir(parents=True, exist_ok=True)
        if out.exists():
            raise FileExistsError(out)
        os.rename(staging, out)
    return catalog


def main() -> None:
    parser = argparse.ArgumentParser(description='Generate static AGRINET archived month JSON (no live fetch)')
    parser.add_argument('--out', required=True, type=Path, help='new output directory; refuses overwrite')
    args = parser.parse_args()
    cat = export_static(args.out)
    print(json.dumps({'products': len(cat['products']), 'months': sum(len(x['months']) for x in cat['products'].values()),
                      'latest_observation': cat['latest_observation'], 'output': str(args.out)}))


if __name__ == '__main__':
    main()
