"""Hand-computed expected values (no model output)."""
import pytest

from core.economics import margins, rotation_margins, summary


def test_margin_by_hand():
    # 5 t/ha * k 1.08 * 6000 UAH/t - 20000 UAH/ha = 32400 - 20000
    assert margins({2000: 5.0}, 1.08, 6000, 20000)[2000] == pytest.approx(12400)


def test_summary_by_hand():
    m = {2000: -100, 2001: 300, 2002: 500, 2003: -50, 2004: 200}
    s = summary(m, k=1.0, price=5000, cost=20000, yhat={2000: 3, 2001: 4, 2002: 5})
    assert s["median"] == 200 and s["loss_years"] == 2 and s["n_years"] == 5
    assert s["break_even_yield_t_ha"] == pytest.approx(4.0)  # 20000 / (1 * 5000)
    assert s["break_even_price_uah_t"] == pytest.approx(5000)  # 20000 / (1 * median yield 4)


def test_rotation_with_fallow_and_k_switch():
    yhat = {"winter_wheat": {2000: 4.0, 2001: 4.0}}
    k = {("winter_wheat", "black_fallow"): 1.1}
    price, cost = {"winter_wheat": 5000}, {"winter_wheat": 15000, "black_fallow": 3000}
    # wheat after fallow: 4 * 1.1 * 5000 - 15000 = 7000; fallow: -3000; mean 2000
    on = rotation_margins(["winter_wheat", "black_fallow"], yhat, k, price, cost, use_k=True)
    assert on == {2000: pytest.approx(2000), 2001: pytest.approx(2000)}
    # k off: wheat 4 * 5000 - 15000 = 5000; mean (5000 - 3000) / 2 = 1000
    off = rotation_margins(["winter_wheat", "black_fallow"], yhat, k, price, cost, use_k=False)
    assert off[2000] == pytest.approx(1000)


def test_only_years_present_in_every_crop():
    yhat = {"a": {2000: 1.0, 2001: 1.0}, "b": {2001: 1.0, 2002: 1.0}}
    m = rotation_margins(["a", "b"], yhat, {}, {"a": 10, "b": 10}, {"a": 0, "b": 0})
    assert list(m) == [2001]
