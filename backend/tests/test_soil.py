import pytest

from core import humus, ph, salinity
from core.crops import CROPS, GREEN_MANURES
from core.soil import yield_factor, crop_factors, rotation_humus
from core.soil_params import (humus_params, load_humus, load_ph, load_salinity, ph_params, salt_params, todo)

SAL, PH, HUM = load_salinity(), load_ph(), load_humus()


# --- tables
def test_tables_load_and_species_known():
    for df in (SAL, PH, HUM):
        assert set(df.species) <= CROPS | GREEN_MANURES


def test_gaps_are_todo_not_zero():
    assert set(todo(SAL).species) == {"millet", "buckwheat", "white_mustard", "narrow_leaf_lupin"}
    assert set(todo(HUM).species) == {"winter_rapeseed", "buckwheat", "black_fallow"}
    assert salt_params(SAL, "millet") is None
    assert humus_params(HUM, "winter_rapeseed") is None
    assert humus_params(HUM, "black_fallow") is None  # mineralisation still todo


def test_category_only_crops_low_confidence():
    assert salt_params(SAL, "oats")["low_confidence"] and salt_params(SAL, "white_sweet_clover")["low_confidence"]
    assert not salt_params(SAL, "maize")["low_confidence"]


def test_proxy_status_is_estimate():
    assert salt_params(SAL, "oilseed_radish")["status"] == "estimate"
    assert humus_params(HUM, "soybean")[1]["status"] == "estimate"
    assert salt_params(SAL, "maize")["status"] == "literature"


# --- salinity (doc examples)
def f(crop, ece):
    p = salt_params(SAL, crop)
    return salinity.relative_yield_pct(ece, p["a"], p["b"])


def test_salinity_ece_4():
    assert f("maize", 4) == pytest.approx(72.4)
    assert f("sunflower", 4) == 100 and f("soybean", 4) == 100


def test_salinity_ece_6():
    assert f("maize", 6) == pytest.approx(48.4)
    assert f("sunflower", 6) == pytest.approx(94)
    assert f("soybean", 6) == pytest.approx(80)
    assert f("winter_wheat", 6) == 100


def test_salinity_edges():
    assert salinity.relative_yield_pct(1.7, 1.7, 12) == 100  # at the threshold
    assert salinity.relative_yield_pct(50, 1.7, 12) == 0      # clamped
    with pytest.raises(ValueError):
        salinity.relative_yield_pct(-1, 1.7, 12)
    assert salinity.f_salt(3, None, None) is None
    assert salinity.f_salt(6, 1.7, 12, gypsum_shift=2) == pytest.approx(0.724)  # ECe 6 - 2 = 4: 100 - 12*(4-1.7) = 72.4
    assert salinity.is_excluded(0.484, 0.5) and not salinity.is_excluded(0.5, 0.5) and not salinity.is_excluded(None, 0.5)


# --- pH (doc examples, ECe-independent)
def fp(crop, value):
    return ph.f_ph(value, *ph_params(PH, crop)["limits"])


def test_ph_carbonate_soil_8_2():
    assert fp("soybean", 8.2) == pytest.approx(0.105, abs=0.01)
    assert fp("maize", 8.2) == pytest.approx(0.20)
    assert fp("winter_wheat", 8.2) == pytest.approx(0.20)
    assert fp("sunflower", 8.2) == 0 and fp("winter_barley", 8.2) == 0


def test_ph_trapezoid_corners():
    assert ph.f_ph(5.5, 5.5, 6.0, 7.0, 8.5) == 0.0   # at min: rises from 0
    assert ph.f_ph(6.0, 5.5, 6.0, 7.0, 8.5) == 1.0
    assert ph.f_ph(7.0, 5.5, 6.0, 7.0, 8.5) == 1.0
    assert ph.f_ph(8.5, 5.5, 6.0, 7.0, 8.5) == 0.0
    assert ph.f_ph(5.0, 5.5, 6.0, 7.0, 8.5) == 0.0 and ph.f_ph(9, 5.5, 6.0, 7.0, 8.5) == 0.0
    assert fp("white_sweet_clover", 6.5) == 1.0       # min == optimum low
    with pytest.raises(ValueError):
        ph.f_ph(7, 6, 5, 7, 8)
    assert ph.needs_warning(0.2) and not ph.needs_warning(1.0) and not ph.needs_warning(None)


# --- humus (doc examples)
def hc(crop):
    return humus_params(HUM, crop)[0]


def test_humus_winter_wheat_35():
    c = hc("winter_wheat")
    assert humus.residues_t_ha(c, 35) == pytest.approx(5.64)
    b = humus.annual_balance(c, 35)
    assert b["p1"] == pytest.approx(1.128) and b["balance"] == pytest.approx(-0.222)


def test_humus_sunflower_15():
    b = humus.annual_balance(hc("sunflower"), 15)
    assert humus.residues_t_ha(hc("sunflower"), 15) == pytest.approx(1.665)
    assert b["balance"] == pytest.approx(-1.157, abs=0.001)


YIELDS = {"winter_wheat": 35, "sunflower": 15}
ROT = ["winter_wheat", "sunflower", "winter_wheat", "sunflower"]


def test_rotation_without_green_manure():
    r = rotation_humus(ROT, YIELDS, HUM)
    assert r["per_rotation"] == pytest.approx(-2.76, abs=0.01)
    assert r["mean_balance"] == pytest.approx(-0.69, abs=0.01)


def test_rotation_with_green_manure_after_wheat():
    r = rotation_humus(ROT, YIELDS, HUM, green_t_ha_by_crop={"winter_wheat": 15})
    assert r["per_rotation"] == pytest.approx(-1.89, abs=0.01)
    assert r["mean_balance"] == pytest.approx(-0.47, abs=0.01)


def test_manure_and_norm():
    assert humus.annual_balance(hc("winter_wheat"), 35, manure_t_ha=10)["p2"] == pytest.approx(0.58)
    assert humus.annual_balance(hc("winter_wheat"), 35, green_t_ha=15)["p3"] == pytest.approx(0.435)
    assert humus.manure_norm(0, -0.058) == pytest.approx(1.0)
    assert humus.manure_norm(5, -0.116) == pytest.approx(7.0)
    assert humus.manure_norm(5, 0.3) == 5          # surplus: nothing to add
    r = rotation_humus(ROT, YIELDS, HUM)  # deficit with no manure: the norm closes it
    after = rotation_humus(ROT, YIELDS, HUM, manure_t_ha_year=r["manure_norm"])
    assert after["mean_balance"] == pytest.approx(0, abs=1e-9)


def test_rotation_missing_data_is_reported():
    r = rotation_humus(["winter_rapeseed", "winter_wheat"], {"winter_rapeseed": 30, "winter_wheat": 35}, HUM)
    assert r["missing"] == ["winter_rapeseed"] and len(r["years"]) == 1
    r = rotation_humus(["winter_wheat"], {}, HUM)
    assert r["mean_balance"] is None and r["missing"] == ["winter_wheat"]
    with pytest.raises(ValueError):
        humus.annual_balance(hc("maize"), -1)
    with pytest.raises(ValueError):
        humus.rotation_balance([])


# --- combined
def test_crop_factors_maize_ece6_ph8_2():
    r = crop_factors("maize", 6, 8.2, SAL, PH)
    assert r["f_salt"] == pytest.approx(0.484) and r["excluded"] and r["ph_warning"]
    assert yield_factor(r) == pytest.approx(0.484)  # pH does not scale the yield


def test_crop_factors_sunflower_ph_warns_not_excludes():
    r = crop_factors("sunflower", 6, 8.2, SAL, PH)
    assert r["f_ph"] == 0 and r["ph_warning"] and not r["excluded"]


def test_crop_factors_missing_inputs_and_data():
    r = crop_factors("millet", 5, None, SAL, PH)
    assert r["f_salt"] is None and r["f_ph"] is None and not r["excluded"]
    assert "no salt-tolerance data for this crop" in r["notes"] and "pH not entered" in r["notes"]
    assert yield_factor(r) == 1.0
    assert "ECe not entered" in crop_factors("maize", None, 7, SAL, PH)["notes"]
    assert crop_factors("oats", 5, 6, SAL, PH)["low_confidence"]
    assert crop_factors("maize", 6, 7, SAL, PH, gypsum=True)["f_salt"] == pytest.approx(0.724)
