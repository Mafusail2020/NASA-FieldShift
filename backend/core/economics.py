"""Gross margin per hectare: margin(c | a, y) = Yhat(c, y) * k(c | a) * P(c) - C(c).

Yhat is the detrended yield rescaled to the current technology level (see pipeline/yields.py). k is the predecessor
effect. k drives money; the water balance drives the agronomic risk panel: they never penalise the same yield.
Fallow has no revenue, only its own cost. Years with no yield value are skipped.
"""
import numpy as np

FALLOW = "black_fallow"


def margins(yhat: dict[int, float], k: float, price: float, cost: float) -> dict[int, float]:
    return {y: v * k * price - cost for y, v in yhat.items()}


def fallow_margins(years: list[int], cost: float) -> dict[int, float]:
    return {y: -cost for y in years}


def summary(m: dict[int, float], k: float = 1.0, price: float | None = None, cost: float | None = None,
            yhat: dict[int, float] | None = None) -> dict:
    """Median margin, loss years, and break-evens (yield at which margin is 0; price at the median yield)."""
    v = np.array(list(m.values()), dtype=float)
    out = {"n_years": int(len(v)), "median": float(np.median(v)), "loss_years": int((v < 0).sum()),
           "min": float(v.min()), "max": float(v.max())}
    if price and cost is not None:
        out["break_even_yield_t_ha"] = cost / (k * price)
        if yhat:
            out["break_even_price_uah_t"] = cost / (k * float(np.median(list(yhat.values()))))
    return out


def rotation_margins(rotation: list[str], yhat: dict[str, dict[int, float]], k: dict[tuple, float],
                     price: dict[str, float], cost: dict[str, float], use_k: bool = True) -> dict[int, float]:
    """Mean margin per year across the rotation's positions (UAH/ha/year), for years present in every crop's yields."""
    crops = [c for c in rotation if c != FALLOW]
    years = sorted(set.intersection(*(set(yhat[c]) for c in crops))) if crops else []
    slots = []
    for j, c in enumerate(rotation):
        if c == FALLOW:
            slots.append(fallow_margins(years, cost[c]))
        else:
            kk = k.get((c, rotation[j - 1]), 1.0) if use_k else 1.0
            slots.append(margins({y: yhat[c][y] for y in years}, kk, price[c], cost[c]))
    return {y: float(np.mean([m[y] for m in slots])) for y in years}
