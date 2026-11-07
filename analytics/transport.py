"""Minimum-cost transportation optimizer (integer kg, integer INR cents/kg).

Bad user input never raises: it yields ``status == 'invalid'`` with ``errors``.
"""
from __future__ import annotations

import networkx as nx

UNITS = {"quantity": "kg", "unit_cost": "INR cents/kg",
         "total_cost": "INR cents", "travel_time": "minutes"}


def _is_nonneg_int(value) -> bool:
    # bool is a subclass of int; floats (even 5.0, nan, inf) are rejected.
    return type(value) is int and value >= 0


PROVENANCE_KINDS = ("hypothetical", "assumed", "verified")


UNSUPPORTED_CONSTRAINTS = [
    "fixed truck costs (per-trip or per-vehicle charges are not modeled; cost is linear per kg)",
    "integer vehicle selection (truck counts/sizes are not chosen; flow is continuous kg)",
    "capital limits (working-capital or budget caps on purchases/freight are not enforced)",
    "storage (warehousing, holding costs and multi-period inventory are not modeled)",
    "spoilage (perishability losses in transit or storage are not modeled)",
]


def _provenance_error(prov, where: str, required: bool) -> str | None:
    if prov is None and not required:
        return None
    if (not isinstance(prov, dict) or prov.get("kind") not in PROVENANCE_KINDS
            or not isinstance(prov.get("source"), str) or not prov["source"].strip()):
        return (f"{where}.provenance must be an object with kind in "
                f"{list(PROVENANCE_KINDS)} and a non-empty source")
    return None


def _base(status: str, errors: list[str] | None = None) -> dict:
    return {"status": status, "errors": errors or [], "total_cost_cents": None,
            "shipments": [], "excluded_routes": [], "units": dict(UNITS), "verified": False,
            "provenance": {"supplies": [], "demands": [], "routes": []},
            "greedy_baseline": None, "savings_vs_greedy_cents": None,
            "unsupported_constraints": list(UNSUPPORTED_CONSTRAINTS)}


def _validate(problem) -> list[str]:
    if not isinstance(problem, dict):
        return ["problem must be an object"]
    errors: list[str] = []
    lists = {}
    for key in ("supplies", "demands", "routes"):
        value = problem.get(key)
        if not isinstance(value, list) or not all(isinstance(x, dict) for x in value):
            errors.append(f"{key} must be a list of objects")
        else:
            lists[key] = value
    if not _is_nonneg_int(problem.get("max_travel_time_minutes")):
        errors.append("max_travel_time_minutes must be a non-negative integer (minutes)")
    if errors:
        return errors
    for kind in ("supplies", "demands"):
        for i, node in enumerate(lists[kind]):
            if not isinstance(node.get("id"), str) or not node["id"]:
                errors.append(f"{kind}[{i}].id must be a non-empty string")
            if not isinstance(node.get("commodity"), str) or not node["commodity"].strip():
                errors.append(f"{kind}[{i}].commodity must be a non-empty string")
            if not _is_nonneg_int(node.get("kg")):
                errors.append(f"{kind}[{i}].kg must be a non-negative integer (kg)")
            err = _provenance_error(node.get("provenance"), f"{kind}[{i}]", required=True)
            if err:
                errors.append(err)
    for i, r in enumerate(lists["routes"]):
        for field in ("origin", "destination"):
            if not isinstance(r.get(field), str):
                errors.append(f"routes[{i}].{field} must be a string id")
        for field, unit in (("capacity_kg", "kg"), ("cost_cents_per_kg", "INR cents/kg"),
                            ("travel_time_minutes", "minutes")):
            if not _is_nonneg_int(r.get(field)):
                errors.append(f"routes[{i}].{field} must be a non-negative integer ({unit})")
        if "commodity" in r and not isinstance(r["commodity"], str):
            errors.append(f"routes[{i}].commodity must be a string when given")
        err = _provenance_error(r.get("provenance"), f"routes[{i}]", required=False)
        if err:
            errors.append(err)
    if errors:
        return errors
    commodity = {}
    for kind, tag in (("supplies", "S"), ("demands", "D")):
        for node in lists[kind]:
            if (tag, node["id"]) in commodity:
                errors.append(f"duplicate {kind} id {node['id']!r}")
            commodity[(tag, node["id"])] = node["commodity"]
    seen = set()
    for i, r in enumerate(lists["routes"]):
        key = (r["origin"], r["destination"])
        if key in seen:
            errors.append(f"routes[{i}] duplicates route {key[0]}->{key[1]}")
        seen.add(key)
        src, dst = commodity.get(("S", r["origin"])), commodity.get(("D", r["destination"]))
        if src is None:
            errors.append(f"routes[{i}].origin {r['origin']!r} is not a supply id")
        if dst is None:
            errors.append(f"routes[{i}].destination {r['destination']!r} is not a demand id")
        named = {c for c in (src, dst, r.get("commodity")) if c is not None}
        if len(named) > 1:
            errors.append(f"routes[{i}] {key[0]}->{key[1]} commodity mismatch: "
                          f"supply={src!r}, demand={dst!r}, route={r.get('commodity')!r}")
    if not errors and sum(d["kg"] for d in lists["demands"]) == 0:
        errors.append("total demand must be greater than 0 kg")
    return errors


def _infeasibility(supplies, demands, routes) -> str | None:
    supply_kg = sum(s["kg"] for s in supplies)
    demand_kg = sum(d["kg"] for d in demands)
    if supply_kg < demand_kg:
        return (f"total supply {supply_kg} kg is below total demand {demand_kg} kg; "
                f"shortfall {demand_kg - supply_kg} kg")
    for d in sorted(demands, key=lambda d: d["id"]):
        inbound = [r for r in routes if r["destination"] == d["id"]]
        if d["kg"] and not inbound:
            return f"demand {d['id']!r} ({d['kg']} kg) has no usable route"
        cap = sum(r["capacity_kg"] for r in inbound)
        if cap < d["kg"]:
            return (f"route capacity into demand {d['id']!r} is {cap} kg, "
                    f"below its demand of {d['kg']} kg")
    return None


def _solve_min_cost_flow(supplies, demands, routes):
    """Return {(origin, destination): kg} or None when no feasible flow exists."""
    g = nx.DiGraph()
    surplus = sum(s["kg"] for s in supplies) - sum(d["kg"] for d in demands)
    # Insert nodes/edges in sorted order so networkx tie-breaking is reproducible.
    for s in sorted(supplies, key=lambda s: s["id"]):
        g.add_node(("S", s["id"]), demand=-s["kg"])
    for d in sorted(demands, key=lambda d: d["id"]):
        g.add_node(("D", d["id"]), demand=d["kg"])
    g.add_node(("SINK", ""), demand=surplus)  # absorbs unshipped supply at zero cost
    for r in sorted(routes, key=lambda r: (r["origin"], r["destination"])):
        g.add_edge(("S", r["origin"]), ("D", r["destination"]),
                   capacity=r["capacity_kg"], weight=r["cost_cents_per_kg"])
    for s in sorted(supplies, key=lambda s: s["id"]):
        g.add_edge(("S", s["id"]), ("SINK", ""), capacity=s["kg"], weight=0)
    try:
        flow = nx.min_cost_flow(g)
    except nx.NetworkXUnfeasible:
        return None
    return {(r["origin"], r["destination"]): flow[("S", r["origin"])][("D", r["destination"])]
            for r in routes}


def _objective_cents(shipments) -> int:
    return sum(s["cost_cents"] for s in shipments)


def _check_solution(flow, supplies, demands, routes, reported_cents):
    """Independent of the solver: re-derive every constraint from the raw flow."""
    errors = []
    lane = {(r["origin"], r["destination"]): r for r in routes}
    if set(flow) - set(lane):
        errors.append("solution uses a lane that is not an allowed route")
    bad = [k for k, kg in flow.items() if type(kg) is not int or kg < 0]
    if bad:
        errors.append(f"non-integer or negative flow on {sorted(bad)}")
    flow = {k: kg for k, kg in flow.items() if k in lane and k not in bad}
    out, inn = {}, {}
    for (o, d), kg in flow.items():
        out[o] = out.get(o, 0) + kg
        inn[d] = inn.get(d, 0) + kg
    supply_ok = all(out.get(s["id"], 0) <= s["kg"] for s in supplies)
    demand_ok = all(inn.get(d["id"], 0) == d["kg"] for d in demands)
    cap_ok = all(kg <= lane[k]["capacity_kg"] for k, kg in flow.items())
    recomputed = sum(kg * lane[k]["cost_cents_per_kg"] for k, kg in flow.items())
    if not supply_ok:
        errors.append("shipments exceed available supply")
    if not demand_ok:
        errors.append("shipments do not exactly meet demand")
    if not cap_ok:
        errors.append("shipments exceed route capacity_kg")
    if recomputed != reported_cents:
        errors.append(f"reported objective {reported_cents} cents != recomputed {recomputed} cents")
    return errors, {"passed": not errors, "supply_within_limits": supply_ok,
                    "demand_exactly_met": demand_ok, "capacities_respected": cap_ok,
                    "objective_recomputed_cents": recomputed}


def _greedy_baseline(supplies, demands, routes) -> dict:
    """Naive comparator: fill the cheapest remaining lane first, no look-ahead."""
    left = {s["id"]: s["kg"] for s in supplies}
    need = {d["id"]: d["kg"] for d in demands}
    shipments = []
    for r in sorted(routes, key=lambda r: (r["cost_cents_per_kg"], r["origin"], r["destination"])):
        kg = min(left[r["origin"]], need[r["destination"]], r["capacity_kg"])
        if kg:
            left[r["origin"]] -= kg
            need[r["destination"]] -= kg
            shipments.append({"origin": r["origin"], "destination": r["destination"],
                                  "kg": kg, "cost_cents": kg * r["cost_cents_per_kg"]})
    shipments.sort(key=lambda s: (s["origin"], s["destination"]))
    feasible = not any(need.values())
    return {"method": "cheapest-edge-first greedy", "feasible": feasible,
            "total_cost_cents": sum(s["cost_cents"] for s in shipments) if feasible else None,
            "shipments": shipments, "unmet_demand_kg": dict(sorted(need.items()))}


def optimize_transport(problem: dict) -> dict:
    errors = _validate(problem)
    if errors:
        return _base("invalid", errors)
    supplies, demands, routes = problem["supplies"], problem["demands"], problem["routes"]
    provenance = {"supplies": [s["provenance"] for s in supplies],
                  "demands": [d["provenance"] for d in demands],
                  "routes": [r.get("provenance") for r in routes]}
    verified = all(
        isinstance(x.get("provenance"), dict) and x["provenance"]["kind"] == "verified"
        for x in supplies + demands + routes)

    limit = problem["max_travel_time_minutes"]
    excluded = [{"origin": r["origin"], "destination": r["destination"],
                     "travel_time_minutes": r["travel_time_minutes"],
                     "max_travel_time_minutes": limit,
                     "reason": (f"travel_time_minutes {r['travel_time_minutes']} exceeds "
                             f"max_travel_time_minutes {limit}")}
                for r in sorted(routes, key=lambda r: (r["origin"], r["destination"]))
                if r["travel_time_minutes"] > limit]
    routes = [r for r in routes if r["travel_time_minutes"] <= limit]

    greedy = _greedy_baseline(supplies, demands, routes)

    def finish(result):
        result.update(provenance=provenance, verified=verified, excluded_routes=excluded,
                      greedy_baseline=greedy)
        if result["total_cost_cents"] is not None and greedy["feasible"]:
            result["savings_vs_greedy_cents"] = (greedy["total_cost_cents"]
                                                 - result["total_cost_cents"])
        return result

    explanation = _infeasibility(supplies, demands, routes)
    flow = None if explanation else _solve_min_cost_flow(supplies, demands, routes)
    if flow is None:
        result = _base("infeasible")
        result["explanation"] = explanation or (
            "route capacities cannot route every demand from available supply "
            "(no feasible flow)")
        return finish(result)

    cost = {(r["origin"], r["destination"]): r["cost_cents_per_kg"] for r in routes}
    shipments = [{"origin": o, "destination": d, "kg": kg, "cost_cents": kg * cost[(o, d)]}
                 for (o, d), kg in sorted(flow.items()) if kg]
    shipped = {}
    for sh in shipments:
        shipped[sh["origin"]] = shipped.get(sh["origin"], 0) + sh["kg"]
    reported = _objective_cents(shipments)
    check_errors, check = _check_solution(flow, supplies, demands, routes, reported)
    if check_errors:
        result = _base("error", ["post-solve feasibility check failed: " + e
                                 for e in check_errors])
        result["feasibility_check"] = check
        return finish(result)
    result = _base("optimal")
    result.update(total_cost_cents=reported, feasibility_check=check,
                  shipments=shipments,
                  unshipped_supply_kg={s["id"]: s["kg"] - shipped.get(s["id"], 0)
                                       for s in sorted(supplies, key=lambda s: s["id"])})
    return finish(result)
