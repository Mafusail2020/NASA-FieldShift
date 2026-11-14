"""Rotation chaining on hand-made pairs (no model run)."""
import pytest

from core.rotations import evaluate, return_gap


def rec(year, ks, stress=10, bare=2, frac=0.5, tmin=None, h1=None, h="2020-08-15"):
    return {"year": year, "mean_ks_mid": ks, "water_stress_days": stress, "bare_months": bare, "harvest": h,
            "soil_water_at_sowing_frac": frac, "min_winter_tmin_no_snow": tmin, "heat_days_1": h1, "heat_days_2": None}


def tl(label):
    return [{"m": m, "frac": 0.5, "label": label} for m in range(24)]


def pair(records, label="a"):
    return {"records": records, "timeline": tl(label)}


def test_return_gap():
    assert return_gap(["a", "b"], "a") == 2
    assert return_gap(["a"], "a") == 1
    assert return_gap(["a", "a", "b"], "a") == 1  # two a's in a row
    assert return_gap(["a", "b", "a", "c", "c"], "a") == 2


def test_chain_two_crop_rotation_by_hand():
    pairs = {
        "w>m": pair([rec(2000, 0.4), rec(2001, 0.8)]),
        "m>w": pair([rec(2000, 0.6), rec(2001, 1.0)]),
        "w>w": pair([rec(2000, 0.2)]),
        "m>m": pair([rec(2000, 0.2)]),
    }
    out = evaluate(["w", "m"], pairs, {})
    # slot 0 = m>w pair, slot 1 = w>m pair: ks values 0.6, 1.0, 0.4, 0.8 -> mean 0.7
    c = {x["id"]: x for x in out["criteria"] if x["id"] != "return_years"}
    assert c["mean_ks_mid"]["value"] == pytest.approx(0.7)
    assert c["bare_months"]["value"] == pytest.approx(2)


def test_fallow_excluded_from_ks_and_kmu_text():
    pairs = {
        "w>f": pair([{**rec(2000, None, None), "water_stress_days": None}]),
        "f>w": pair([rec(2000, 0.5)]),
    }
    out = evaluate(["w", "black_fallow"], {"w>black_fallow": pairs["w>f"], "black_fallow>w": pairs["f>w"],
                                          "w>w": pair([rec(2000, 0.5)]), "black_fallow>black_fallow": pair([])}, {})
    c = [x for x in out["criteria"] if x["id"] == "mean_ks_mid"][0]
    assert c["value"] == pytest.approx(0.5)  # only the wheat year counts


def test_kmu_text():
    pairs = {"s>s": pair([rec(2000, 0.5)])}
    out = evaluate(["s"], pairs, {"s": {"min_return_years": 7, "source": "KMU No. 164"}})
    r = [x for x in out["criteria"] if x["id"] == "return_years"][0]
    assert r["text"] == "s returns after 1 years (norm: 7)." and r["norm"] == 7 and "violation" not in r["text"].lower()
