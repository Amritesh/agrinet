"""Hypothetical trade economics in INR/kg and kg; never an executable quotation.

All cost items are incremental, mutually exclusive lot-level INR amounts (not
per-kg rates); freight is required even when explicitly zero. Purchase and
financing are calculated separately and must not be included as cost items.
Decimal values serialize as strings, without binary floats or currency rounding.
"""
from collections.abc import Mapping
from decimal import Context, Decimal, InvalidOperation, ROUND_HALF_EVEN, localcontext

# Each amount is lot-level INR. "other" MUST exclude every named category;
# the engine rejects aggregate/finance aliases but cannot audit real invoices.
COST_CATEGORIES = frozenset({"freight", "handling", "loading", "unloading", "storage",
                             "packaging", "insurance", "commission", "market_fees",
                             "taxes", "other"})


def _nonnegative(value, name):
    if isinstance(value, bool) or not isinstance(value, (str, int, Decimal)):
        raise ValueError(f"{name} must be a Decimal, integer or decimal string")
    try:
        result = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError(f"{name} must be numeric") from exc
    if not result.is_finite() or result < 0:
        raise ValueError(f"{name} must be finite and nonnegative")
    return result


def _costs(values):
    if not isinstance(values, Mapping) or "freight" not in values:
        raise ValueError("costs_inr must itemize freight explicitly")
    result = {}
    for name, value in values.items():
        if not isinstance(name, str) or name not in COST_CATEGORIES:
            raise ValueError("cost names must be canonical, non-overlapping incremental items")
        result[name] = _nonnegative(value, name)
    return result


def _text(value):
    return format(value, "f").rstrip("0").rstrip(".") if "." in format(value, "f") else format(value, "f")


def calculate_economics(*, purchase_price_inr_per_kg, sale_price_inr_per_kg,
                        quantity_kg, loss_fraction, costs_inr,
                        annual_financing_rate=None, financing_days=None):
    """Calculate a hypothetical lot, preserving fractional rupees.

    Financing is optional; supply both annual fractional rate and duration in
    days, or neither. Simple interest uses a fixed actual/365 convention on
    purchase + all non-finance costs. ROI uses that same pre-finance capital,
    not revenue, purchase alone or interest-inclusive total costs.
    """
    with localcontext(Context(prec=50, rounding=ROUND_HALF_EVEN)) as ctx:
        purchase_price = _nonnegative(purchase_price_inr_per_kg, "purchase_price_inr_per_kg")
        sale_price = _nonnegative(sale_price_inr_per_kg, "sale_price_inr_per_kg")
        quantity = _nonnegative(quantity_kg, "quantity_kg")
        loss = _nonnegative(loss_fraction, "loss_fraction")
        if quantity == 0 or loss >= 1:
            raise ValueError("quantity must be positive and loss must be less than one")
        costs = _costs(costs_inr)
        if (annual_financing_rate is None) != (financing_days is None):
            raise ValueError("financing requires both annual rate and explicit duration")
        rate = _nonnegative(annual_financing_rate, "annual_financing_rate") if annual_financing_rate is not None else Decimal(0)
        days = _nonnegative(financing_days, "financing_days") if financing_days is not None else Decimal(0)
        # Preserve finite input products and small losses; repeating divisions
        # use at least 50 significant digits, independently of caller context.
        values = [purchase_price, sale_price, quantity, loss, rate, days, *costs.values()]
        ctx.prec = max(50, 20 + sum(len(v.as_tuple().digits) + abs(v.as_tuple().exponent)
                                    for v in values))
        saleable = quantity * (1 - loss)
        purchase = purchase_price * quantity
        revenue = sale_price * saleable
        capital = purchase + sum(costs.values(), Decimal(0))
        factor = rate * days / 365
        financing = capital * factor
        total = capital + financing
        margin = revenue - total
        # Hold every input except freight fixed; interest changes with freight.
        freight_limit = revenue / (1 + factor) - (capital - costs["freight"])
        if sale_price == 0:
            loss_limit = {"status": "infeasible" if total else "all_allowed_losses_break_even",
                          "fraction": None}
        else:
            threshold = 1 - total / (sale_price * quantity)
            status = ("infeasible" if threshold < 0 else
                      "outside_allowed_loss_range" if threshold >= 1 else "feasible")
            loss_limit = {"status": status, "fraction": _text(threshold)}
        return {
            "break_even_freight": {"status": "feasible" if freight_limit >= 0 else "infeasible",
                                   "inr": _text(freight_limit)},
            "break_even_loss": loss_limit,
            "capital_employed_inr": _text(capital),
            "capital_definition": "purchase_plus_non_finance_costs",
            "financing_cost_inr": _text(financing),
            "financing": {"annual_rate_fraction": _text(rate), "duration_days": _text(days),
                          "day_count_basis": "365", "method": "simple_interest"},
            "roi_fraction": _text(margin / capital) if capital else None,
            "roi_status": "defined" if capital else "undefined_zero_capital",
            "status": "hypothetical", "executable_quote": False,
            "saleable_quantity_kg": _text(saleable),
            "purchase_cost_inr": _text(purchase), "revenue_inr": _text(revenue),
            "costs_inr": {name: _text(value) for name, value in costs.items()},
            "total_costs_inr": _text(total), "margin_inr": _text(revenue - total),
            "breakeven_sale_price_inr_per_kg": _text(total / saleable),
            "margin_inr_per_input_tonne": _text((revenue - total) * 1000 / quantity),
        }


def compare_scenarios(*, optimistic, baseline, adverse):
    """Compare three complete caller-supplied cases, not probabilistic forecasts.

    Labels do not imply probabilities or executable buy/sell offers. Each case
    must independently provide the same explicit units and required freight.
    The caller owns all assumptions; no public modal price is fetched or used.
    """
    return {
        "status": "hypothetical",
        "executable_quote": False,
        "scenarios": {
            name: calculate_economics(**inputs)
            for name, inputs in (("optimistic", optimistic), ("baseline", baseline),
                                 ("adverse", adverse))
        },
    }
