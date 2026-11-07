"""Pure hypothetical economics; no market prices or executable quotes."""
import json
import pytest

from decimal import Decimal


def fixture_inputs(**overrides):
    values = dict(purchase_price_inr_per_kg="18", sale_price_inr_per_kg="26",
                  quantity_kg="10000", loss_fraction="0.05",
                  costs_inr={"freight": "18000", "other": "8000"})
    return values | overrides


def calculate(**overrides):
    from analytics.economics import calculate_economics
    return calculate_economics(**fixture_inputs(**overrides))


def test_required_fixture_exact_values_and_hypothetical_json():
    result = calculate()
    assert result["status"] == "hypothetical"
    assert result["executable_quote"] is False
    assert result["saleable_quantity_kg"] == "9500"
    assert result["purchase_cost_inr"] == "180000"
    assert result["revenue_inr"] == "247000"
    assert result["total_costs_inr"] == "206000"
    assert result["margin_inr"] == "41000"
    assert abs(Decimal(result["breakeven_sale_price_inr_per_kg"]) - Decimal("21.6842")) < Decimal("0.0001")
    assert result["margin_inr_per_input_tonne"] == "4100"
    assert result["costs_inr"] == {"freight": "18000", "other": "8000"}
    assert json.loads(json.dumps(result)) == result


@pytest.mark.parametrize("field", ["purchase_price_inr_per_kg", "sale_price_inr_per_kg", "quantity_kg", "loss_fraction"])
@pytest.mark.parametrize("value", ["-1", "NaN", "Infinity", "-Infinity", "sNaN", None, True, 0.1, "oops"])
def test_invalid_scalars_rejected(field, value):
    with pytest.raises(ValueError):
        calculate(**{field: value})


@pytest.mark.parametrize("overrides", [
    {"quantity_kg": "0"}, {"loss_fraction": "1"}, {"loss_fraction": "1.1"},
    {"costs_inr": {}}, {"costs_inr": {"other": "1"}},
    {"costs_inr": {"freight": "-1"}}, {"costs_inr": {"freight": "NaN"}},
    {"costs_inr": {"freight": "Infinity"}}, {"costs_inr": {"freight": True}},
    {"costs_inr": {"freight": "1", "purchase": "1"}},
    {"costs_inr": {"freight": "1", "financing": "1"}},
    {"costs_inr": {"freight": "1", " Freight ": "1"}},
    {"costs_inr": {"freight": "1", "": "1"}}, {"costs_inr": None},
])
def test_invalid_quantity_loss_or_nonoverlapping_costs(overrides):
    with pytest.raises(ValueError):
        calculate(**overrides)


def test_financing_simple_interest_explicit_capital_and_negative_roi():
    result = calculate(annual_financing_rate="0.12", financing_days="365")
    assert result["capital_employed_inr"] == "206000"
    assert result["capital_definition"] == "purchase_plus_non_finance_costs"
    assert result["financing_cost_inr"] == "24720"
    assert result["total_costs_inr"] == "230720"
    assert result["margin_inr"] == "16280"
    assert abs(Decimal(result["roi_fraction"]) - Decimal("0.07902912621359223")) < Decimal("1e-16")
    assert result["financing"]["day_count_basis"] == "365"
    negative = calculate(sale_price_inr_per_kg="10")
    assert negative["margin_inr"] == "-111000"
    assert Decimal(negative["roi_fraction"]) < 0


@pytest.mark.parametrize("overrides", [
    {"annual_financing_rate": "0.1"}, {"financing_days": "30"},
    {"annual_financing_rate": "-1", "financing_days": "30"},
    {"annual_financing_rate": "NaN", "financing_days": "30"},
    {"annual_financing_rate": "0.1", "financing_days": "Infinity"},
    {"annual_financing_rate": "0.1", "financing_days": "-1"},
])
def test_financing_requires_both_finite_nonnegative_rate_and_duration(overrides):
    with pytest.raises(ValueError):
        calculate(**overrides)


def test_zero_capital_roi_is_undefined_and_zero_duration_has_no_interest():
    result = calculate(purchase_price_inr_per_kg="0", costs_inr={"freight": "0"})
    assert result["roi_fraction"] is None
    assert result["roi_status"] == "undefined_zero_capital"
    assert calculate(annual_financing_rate="1", financing_days="0")["financing_cost_inr"] == "0"


def test_break_even_freight_and_spoilage_thresholds():
    result = calculate()
    assert result["break_even_freight"] == {"status": "feasible", "inr": "59000"}
    spoilage = result["break_even_loss"]
    assert spoilage["status"] == "feasible"
    assert abs(Decimal(spoilage["fraction"]) - Decimal("0.207692307692307692")) < Decimal("1e-17")
    assert calculate(costs_inr={"freight": "59000", "other": "8000"})["margin_inr"] == "0"
    financed = calculate(annual_financing_rate="0.1", financing_days="365")
    assert abs(Decimal(financed["break_even_freight"]["inr"]) - Decimal("36545.454545454545")) < Decimal("1e-10")


def test_infeasible_thresholds_are_not_clipped_to_zero():
    result = calculate(sale_price_inr_per_kg="10")
    assert result["break_even_freight"]["status"] == "infeasible"
    assert result["break_even_freight"]["inr"] == "-93000"
    assert result["break_even_loss"]["status"] == "infeasible"
    assert result["break_even_loss"]["fraction"] == "-1.06"


def test_zero_sale_price_and_zero_cost_threshold_degeneracies():
    assert calculate(sale_price_inr_per_kg="0")["break_even_loss"] == {
        "status": "infeasible", "fraction": None}
    free = dict(purchase_price_inr_per_kg="0", costs_inr={"freight": "0"})
    assert calculate(**free)["break_even_loss"] == {"status": "outside_allowed_loss_range", "fraction": "1"}
    assert calculate(sale_price_inr_per_kg="0", **free)["break_even_loss"] == {
        "status": "all_allowed_losses_break_even", "fraction": None}


def test_zero_loss_boundary_is_feasible():
    result = calculate(sale_price_inr_per_kg="20.6", loss_fraction="0")
    assert result["margin_inr"] == "0"
    assert result["break_even_loss"] == {"status": "feasible", "fraction": "0"}


def test_only_explicit_nonoverlapping_cost_categories_allowed():
    for name in ("interest", "total_costs_inr", "purchase_price", "transport", "freight_inr"):
        with pytest.raises(ValueError):
            calculate(costs_inr={"freight": "1", name: "2"})
    assert calculate(costs_inr={"freight": "0", "handling": "1", "storage": "2"})["total_costs_inr"] == "180003"


def test_decimal_precision_does_not_follow_callers_context_or_round_finite_products():
    from decimal import ROUND_DOWN, localcontext
    with localcontext() as ctx:
        ctx.prec = 6
        ctx.rounding = ROUND_DOWN
        result = calculate()
    assert result == calculate()
    tiny = calculate(loss_fraction="0.000000000000000000000000000000000000000000000000000000000001",
                     quantity_kg="1", sale_price_inr_per_kg="1")
    assert Decimal(tiny["saleable_quantity_kg"]) < Decimal("1")
    assert tiny["saleable_quantity_kg"] == tiny["revenue_inr"]


def test_compare_three_explicit_scenarios_without_relabeling_as_forecasts():
    from analytics.economics import compare_scenarios
    baseline = dict(purchase_price_inr_per_kg="18", sale_price_inr_per_kg="26",
                    quantity_kg="10000", loss_fraction="0.05",
                    costs_inr={"freight": "18000", "other": "8000"})
    optimistic = {**baseline, "sale_price_inr_per_kg": "28", "loss_fraction": "0.03"}
    adverse = {**baseline, "sale_price_inr_per_kg": "19", "loss_fraction": "0.15"}
    result = compare_scenarios(optimistic=optimistic, baseline=baseline, adverse=adverse)
    assert result["status"] == "hypothetical"
    assert result["executable_quote"] is False
    assert result["scenarios"]["baseline"] == calculate()
    assert Decimal(result["scenarios"]["optimistic"]["margin_inr"]) > Decimal("41000")
    assert Decimal(result["scenarios"]["adverse"]["margin_inr"]) < 0
    assert baseline["costs_inr"] == {"freight": "18000", "other": "8000"}
    assert json.loads(json.dumps(result)) == result
