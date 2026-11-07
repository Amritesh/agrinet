"""Synthetic transportation fixtures; no market volumes inferred from price data."""
import importlib
import json


def solve(problem):
    return importlib.import_module("analytics.transport").optimize_transport(problem)


def fixture():
    provenance = {"kind": "hypothetical", "source": "test scenario, not observed volumes"}
    return {
        "supplies": [{"id": o, "commodity": "Onion", "kg": 5, "provenance": provenance.copy()}
                     for o in ("A", "B")],
        "demands": [{"id": d, "commodity": "Onion", "kg": 5, "provenance": provenance.copy()}
                    for d in ("X", "Y")],
        "routes": [{"origin": o, "destination": d, "capacity_kg": 10,
                        "cost_cents_per_kg": c, "travel_time_minutes": 60}
                   for o, d, c in [("A", "X", 1), ("A", "Y", 2),
                                   ("B", "X", 2), ("B", "Y", 100)]],
        "max_travel_time_minutes": 60,
    }


def test_global_optimum_beats_naive_greedy_with_exact_units():
    result = solve(fixture())
    assert result["status"] == "optimal"
    # Greedy A->X then B->Y costs 5*1+5*100 = 505 cents.
    assert result["total_cost_cents"] == 20
    assert result["total_cost_cents"] < 505
    assert result["shipments"] == [
        {"origin": "A", "destination": "Y", "kg": 5, "cost_cents": 10},
        {"origin": "B", "destination": "X", "kg": 5, "cost_cents": 10},
    ]
    assert result["units"] == {"quantity": "kg", "unit_cost": "INR cents/kg",
                               "total_cost": "INR cents", "travel_time": "minutes"}
    assert result["verified"] is False
    assert result["provenance"]["supplies"] == [s["provenance"] for s in fixture()["supplies"]]
    json.dumps(result, allow_nan=False)


import copy
import math

import pytest


def mutate(path, value):
    p = fixture()
    target = p
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    return p


@pytest.mark.parametrize("path,value", [
    (("supplies", 0, "kg"), 5.0),
    (("supplies", 0, "kg"), True),
    (("supplies", 0, "kg"), -1),
    (("demands", 0, "kg"), math.nan),
    (("routes", 0, "cost_cents_per_kg"), 1.5),
    (("routes", 0, "cost_cents_per_kg"), math.inf),
    (("routes", 0, "cost_cents_per_kg"), -3),
    (("routes", 0, "capacity_kg"), False),
    (("routes", 0, "travel_time_minutes"), "60"),
    (("max_travel_time_minutes",), None),
])
def test_rejects_non_integer_or_negative_quantities_without_raising(path, value):
    result = solve(mutate(path, value))
    assert result["status"] == "invalid"
    assert result["errors"] and all(isinstance(e, str) for e in result["errors"])
    assert result["shipments"] == []
    json.dumps(result, allow_nan=False)


def test_rejects_zero_total_demand_and_malformed_problem():
    p = fixture()
    for d in p["demands"]:
        d["kg"] = 0
    assert solve(p)["status"] == "invalid"
    for bad in (None, [], {}, {"supplies": "x", "demands": [], "routes": []}):
        result = solve(bad)
        assert result["status"] == "invalid" and result["errors"]


def all_verified():
    p = fixture()
    for item in p["supplies"] + p["demands"] + p["routes"]:
        item["provenance"] = {"kind": "verified", "source": "signed test contract"}
    return p


@pytest.mark.parametrize("bad", [None, {}, {"kind": "guess"}, {"kind": "verified"}, "verified"])
def test_supply_and_demand_provenance_kind_and_source_required(bad):
    for kind in ("supplies", "demands"):
        p = fixture()
        if bad is None:
            del p[kind][1]["provenance"]
        else:
            p[kind][1]["provenance"] = bad
        result = solve(p)
        assert result["status"] == "invalid", (kind, bad)
        assert any("provenance" in e for e in result["errors"])


def test_verified_only_when_every_supply_demand_and_route_verified():
    assert solve(all_verified())["verified"] is True
    for kind in ("supplies", "demands", "routes"):
        p = all_verified()
        p[kind][0]["provenance"] = {"kind": "assumed", "source": "planner estimate"}
        assert solve(p)["status"] == "optimal"
        assert solve(p)["verified"] is False, kind
    p = all_verified()
    del p["routes"][3]["provenance"]  # route without provenance is unverified
    assert solve(p)["verified"] is False
    p["routes"][3]["provenance"] = {"kind": "nonsense", "source": "x"}
    assert solve(p)["status"] == "invalid"


def test_commodity_must_match_between_route_endpoints_and_route():
    p = fixture()
    p["demands"][1]["commodity"] = "Potato"  # A->Y and B->Y now join Onion to Potato
    result = solve(p)
    assert result["status"] == "invalid"
    assert any("commodity" in e for e in result["errors"])
    p = fixture()
    p["routes"][0]["commodity"] = "Tomato"
    assert solve(p)["status"] == "invalid"
    p = fixture()
    p["routes"][0]["commodity"] = "Onion"  # explicit matching commodity is fine
    assert solve(p)["status"] == "optimal"
    p = fixture()
    del p["supplies"][0]["commodity"]
    assert solve(p)["status"] == "invalid"


def test_unknown_route_endpoint_and_duplicate_ids_are_invalid():
    p = fixture()
    p["routes"][0]["origin"] = "Z"
    assert solve(p)["status"] == "invalid"
    p = fixture()
    p["demands"][1]["id"] = "X"
    assert solve(p)["status"] == "invalid"
    p = fixture()
    p["routes"].append(copy.deepcopy(p["routes"][0]))
    assert solve(p)["status"] == "invalid"


def single_lane(supply_kg=10, demand_kg=10):
    prov = {"kind": "assumed", "source": "test scenario"}
    return {
        "supplies": [{"id": "A", "commodity": "Onion", "kg": supply_kg, "provenance": dict(prov)},
                     {"id": "B", "commodity": "Onion", "kg": 10, "provenance": dict(prov)}],
        "demands": [{"id": "X", "commodity": "Onion", "kg": demand_kg, "provenance": dict(prov)}],
        "routes": [{"origin": "A", "destination": "X", "capacity_kg": 4,
                        "cost_cents_per_kg": 3, "travel_time_minutes": 30},
                   {"origin": "B", "destination": "X", "capacity_kg": 10,
                        "cost_cents_per_kg": 7, "travel_time_minutes": 90}],
        "max_travel_time_minutes": 120,
    }


def test_capacity_forces_part_of_demand_onto_costlier_route():
    result = solve(single_lane())
    assert result["status"] == "optimal"
    # Hand: A->X capped at 4 kg * 3 = 12; remaining 6 kg via B->X * 7 = 42; total 54.
    assert result["shipments"] == [{"origin": "A", "destination": "X", "kg": 4, "cost_cents": 12},
                                   {"origin": "B", "destination": "X", "kg": 6, "cost_cents": 42}]
    assert result["total_cost_cents"] == 54


def test_surplus_supply_is_left_unshipped():
    result = solve(single_lane(demand_kg=3))
    assert result["status"] == "optimal"
    assert result["shipments"] == [{"origin": "A", "destination": "X", "kg": 3, "cost_cents": 9}]
    assert result["unshipped_supply_kg"] == {"A": 7, "B": 10}


def test_total_supply_below_demand_is_infeasible_not_optimal():
    result = solve(single_lane(demand_kg=25))
    assert result["status"] == "infeasible"
    assert result["shipments"] == [] and result["total_cost_cents"] is None
    assert "supply" in result["explanation"] and "20" in result["explanation"]
    assert "25" in result["explanation"]


def test_insufficient_route_capacity_is_infeasible():
    p = single_lane(demand_kg=15)  # supply 20 >= 15, but lanes carry only 4 + 10 = 14 kg
    result = solve(p)
    assert result["status"] == "infeasible"
    assert "capacity" in result["explanation"]


def test_demand_without_any_route_is_infeasible():
    p = single_lane()
    p["demands"].append({"id": "Y", "commodity": "Onion", "kg": 1,
                             "provenance": {"kind": "assumed", "source": "test"}})
    result = solve(p)
    assert result["status"] == "infeasible"
    assert "Y" in result["explanation"] and "no" in result["explanation"].lower()


def test_routes_over_max_travel_time_are_excluded_and_reported():
    p = fixture()
    p["routes"][3]["travel_time_minutes"] = 61  # B->Y, the 100-cent lane
    result = solve(p)
    assert result["status"] == "optimal" and result["total_cost_cents"] == 20
    assert result["excluded_routes"] == [{
        "origin": "B", "destination": "Y", "travel_time_minutes": 61, "max_travel_time_minutes": 60,
        "reason": "travel_time_minutes 61 exceeds max_travel_time_minutes 60"}]
    assert solve(fixture())["excluded_routes"] == []


def test_deadline_exclusion_can_make_problem_infeasible():
    p = single_lane()
    p["max_travel_time_minutes"] = 60  # B->X takes 90 min; only A->X (4 kg) remains
    result = solve(p)
    assert result["status"] == "infeasible"
    assert "capacity" in result["explanation"]
    assert [(r["origin"], r["destination"]) for r in result["excluded_routes"]] == [("B", "X")]
    p["routes"] = p["routes"][1:]  # only the slow lane: no usable route at all
    result = solve(p)
    assert result["status"] == "infeasible" and "no usable route" in result["explanation"]


def test_reports_naive_cheapest_edge_first_greedy_baseline():
    result = solve(fixture())
    greedy = result["greedy_baseline"]
    assert greedy["method"] == "cheapest-edge-first greedy"
    assert greedy["feasible"] is True and greedy["total_cost_cents"] == 505
    assert greedy["shipments"] == [{"origin": "A", "destination": "X", "kg": 5, "cost_cents": 5},
                                   {"origin": "B", "destination": "Y", "kg": 5, "cost_cents": 500}]
    assert result["savings_vs_greedy_cents"] == 485


def test_greedy_baseline_can_strand_demand_that_optimum_serves():
    p = fixture()
    del p["routes"][3]  # no B->Y lane
    result = solve(p)
    assert result["status"] == "optimal" and result["total_cost_cents"] == 20
    assert result["greedy_baseline"]["feasible"] is False
    assert result["greedy_baseline"]["total_cost_cents"] is None
    assert result["greedy_baseline"]["unmet_demand_kg"] == {"X": 0, "Y": 5}
    assert result["savings_vs_greedy_cents"] is None


def test_unsupported_constraints_are_named_explicitly():
    for result in (solve(fixture()), solve(single_lane(demand_kg=99)), solve(None)):
        names = " ".join(result["unsupported_constraints"]).lower()
        for term in ("fixed truck cost", "integer vehicle", "capital", "storage", "spoilage"):
            assert term in names, term


@pytest.mark.parametrize("corrupt", [
    lambda f: {**f, ("A", "Y"): f[("A", "Y")] + 1},  # A ships 6 > 5 kg supply
    lambda f: {**f, ("B", "X"): f[("B", "X")] - 1},  # X receives 4 != 5 kg demand
    lambda f: {**f, ("A", "Y"): 11, ("B", "X"): 11},  # capacity 10 exceeded
    lambda f: {**f, ("A", "X"): -1, ("A", "Y"): 6},   # negative flow
])
def test_independent_post_solve_check_turns_bad_solution_into_error(monkeypatch, corrupt):
    transport = importlib.import_module("analytics.transport")
    real = transport._solve_min_cost_flow
    monkeypatch.setattr(transport, "_solve_min_cost_flow", lambda *a: corrupt(real(*a)))
    result = transport.optimize_transport(fixture())
    assert result["status"] == "error"
    assert result["errors"] and result["shipments"] == []
    assert result["total_cost_cents"] is None
    json.dumps(result, allow_nan=False)


def test_post_solve_check_recomputes_objective(monkeypatch):
    transport = importlib.import_module("analytics.transport")
    monkeypatch.setattr(transport, "_objective_cents", lambda shipments: 19)
    result = transport.optimize_transport(fixture())
    assert result["status"] == "error"
    assert any("objective" in e for e in result["errors"])


def test_post_solve_check_passes_and_is_reported_for_optimal():
    assert solve(fixture())["feasibility_check"] == {
        "passed": True, "supply_within_limits": True, "demand_exactly_met": True,
        "capacities_respected": True, "objective_recomputed_cents": 20}


def ties():
    p = fixture()
    for r in p["routes"]:
        r["cost_cents_per_kg"] = 4  # every feasible plan costs 10 kg * 4 = 40 cents
    return p


def test_tied_optima_are_deterministic_across_runs_and_input_order():
    import random
    first = solve(ties())
    assert first["status"] == "optimal" and first["total_cost_cents"] == 40
    rng = random.Random(7)
    for _ in range(25):
        p = ties()
        for key in ("supplies", "demands", "routes"):
            rng.shuffle(p[key])
        result = solve(p)
        assert result["shipments"] == first["shipments"]
        assert result["greedy_baseline"] == first["greedy_baseline"]
        assert [s["origin"] for s in result["shipments"]] == sorted(
            s["origin"] for s in result["shipments"])
    assert json.dumps(solve(ties()), sort_keys=True) == json.dumps(first, sort_keys=True)


def three_by_three():
    prov = {"kind": "verified", "source": "hand-worked textbook-style example"}
    costs = {("P", "U"): 8, ("P", "V"): 6, ("P", "W"): 10,
             ("Q", "U"): 9, ("Q", "V"): 12, ("Q", "W"): 13,
             ("R", "U"): 14, ("R", "V"): 9, ("R", "W"): 17}
    return {
        "supplies": [{"id": i, "commodity": "Wheat", "kg": kg, "provenance": dict(prov)}
                     for i, kg in (("P", 30), ("Q", 25), ("R", 45))],
        "demands": [{"id": i, "commodity": "Wheat", "kg": kg, "provenance": dict(prov)}
                    for i, kg in (("U", 40), ("V", 35), ("W", 25))],
        "routes": [{"origin": o, "destination": d, "capacity_kg": 100, "cost_cents_per_kg": c,
                        "travel_time_minutes": 120, "provenance": dict(prov)}
                   for (o, d), c in costs.items()],
        "max_travel_time_minutes": 240,
    }


def test_hand_computed_three_by_three_optimum():
    # Hand solution: P->U 5, P->W 25, Q->U 25, R->U 10, R->V 35 = 40+250+225+140+315 = 970.
    # MODI potentials u=(P0,Q1,R6), v=(U8,V3,W10): non-basic reduced costs
    # PV=3, QV=8, QW=2, RW=1 are all > 0, so this optimum is unique.
    result = solve(three_by_three())
    assert result["status"] == "optimal" and result["verified"] is True
    assert [(s["origin"], s["destination"], s["kg"]) for s in result["shipments"]] == [
        ("P", "U", 5), ("P", "W", 25), ("Q", "U", 25), ("R", "U", 10), ("R", "V", 35)]
    assert result["total_cost_cents"] == 970
    # Greedy: PV30=180, QU25=225, RV5=45, RU15=210, RW25=425 -> 1085.
    assert result["greedy_baseline"]["total_cost_cents"] == 1085
    assert result["savings_vs_greedy_cents"] == 115
    assert result["unshipped_supply_kg"] == {"P": 0, "Q": 0, "R": 0}
