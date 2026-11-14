"""Hand-computed bucket cases. awc 100 mm/m, zr 1 m -> TAW 100 mm; p 0.5 -> RAW 50 mm."""
import numpy as np
import pandas as pd
import pytest

from core.bucket import run_bucket, snow_store
from core.stress import bare_soil_months, fallow_storage_share, heat_days, mean_ks, min_winter_tmin_no_snow, water_stress_days


def series(values, start="2020-01-01"):
    return pd.Series(values, index=pd.date_range(start, periods=len(values)), dtype=float)


def const(n, v):
    return series([v] * n)


def test_ks_is_one_when_dr_below_raw():
    out = run_bucket(const(1, 0), const(1, 0), const(1, 4), const(1, 1), const(1, 1), const(1, 0.5), 100, dr0=50)
    assert out.ks.iloc[0] == 1.0
    assert out.dr.iloc[0] == 54  # 50 + 1.0 * 1.0 * 4


def test_ks_below_raw_by_hand():
    # Dr = 75 > RAW = 50: Ks = (100 - 75) / ((1 - 0.5) * 100) = 0.5; ETc = 0.5 * 1 * 4 = 2 -> Dr = 77
    out = run_bucket(const(1, 0), const(1, 0), const(1, 4), const(1, 1), const(1, 1), const(1, 0.5), 100, dr0=75)
    assert out.ks.iloc[0] == pytest.approx(0.5)
    assert out.dr.iloc[0] == pytest.approx(77)
    assert out.et.iloc[0] == pytest.approx(2)


def test_deep_percolation_when_overfilled():
    # Dr = 20, rain 50, ETc = 0.0 -> 30 mm drains, Dr = 0
    out = run_bucket(const(1, 50), const(1, 0), const(1, 0), const(1, 1), const(1, 1), const(1, 0.5), 100, dr0=20)
    assert out.dp.iloc[0] == pytest.approx(30)
    assert out.dr.iloc[0] == 0


def test_no_evaporation_under_snow():
    out = run_bucket(const(1, 0), const(1, 5), const(1, 4), const(1, 1), const(1, 1), const(1, 0.5), 100, dr0=10)
    assert out.et.iloc[0] == 0 and out.dr.iloc[0] == 10


def test_snow_store_by_hand():
    # ddf = 2 mm/degC/day. Day 1: Tmean -5, P 10 -> snow 10. Day 2: Tmean +3, no rain -> melt 6, store 4.
    # Day 3: Tmean +4 -> melt min(4, 8) = 4, store 0. Day 4: Tmean +2, P 3 -> rain 3.
    r = snow_store(series([10, 0, 0, 3]), series([-5, 3, 4, 2]), ddf=2)
    assert list(r.snow) == [10, 4, 0, 0]
    assert list(r["melt"]) == [0, 6, 4, 0]
    assert list(r.water_in) == [0, 6, 4, 3]


def test_water_balance_closes_over_a_year():
    rng = np.random.default_rng(1)
    n = 365
    idx = pd.date_range("2021-01-01", periods=n)
    tmean = pd.Series(10 - 15 * np.cos(2 * np.pi * (np.arange(n) - 10) / 365), index=idx)
    precip = pd.Series(rng.exponential(2.0, n) * (rng.random(n) < 0.4), index=idx)
    eto = pd.Series(np.maximum(0.3 + 2.5 * (1 - np.cos(2 * np.pi * (np.arange(n) - 10) / 365)), 0), index=idx)
    sn = snow_store(precip, tmean, ddf=3)
    zr = pd.Series(np.where(np.arange(n) < 150, 0.3, 1.2), index=idx)  # Zr changes: rezone is non-zero
    kc = pd.Series(0.9, index=idx)
    out = run_bucket(sn.water_in, sn.snow, eto, kc, zr, pd.Series(0.5, index=idx), 150, dr0=40)
    assert (out.rezone != 0).any()
    # sum(P) = sum(ET) + sum(DP) + d(snow) + d(storage) - sum(rezone)
    storage0 = out.taw.iloc[0] - 40
    lhs = precip.sum()
    rhs = out.et.sum() + out.dp.sum() + sn.snow.iloc[-1] + (out.storage.iloc[-1] - storage0) - out.rezone.sum()
    assert lhs == pytest.approx(rhs, abs=1e-6)
    assert (out.dr >= 0).all() and (out.dr <= out.taw + 1e-9).all()


def test_rezone_keeps_dr_and_cuts_to_new_taw():
    zr = series([1.0, 0.5])
    out = run_bucket(const(2, 0), const(2, 0), const(2, 0), const(2, 1), zr, const(2, 0.5), 100, dr0=70)
    # day 2: TAW 100 -> 50, Dr 70 -> cut to 50, storage 30 -> 0: rezone = -30
    assert out.rezone.iloc[1] == pytest.approx(-30)
    assert out.dr.iloc[1] == pytest.approx(50)


def test_stress_helpers():
    ks = series([1, 1, 0.8, 0.5, 1])
    out = pd.DataFrame({"ks": ks})
    assert mean_ks(out, "2020-01-03", "2020-01-04") == pytest.approx(0.65)
    assert water_stress_days(out, "2020-01-01", "2020-01-05") == 2
    assert heat_days(series([30, 32, 35, 31]), "2020-01-01", "2020-01-04", 32) == 2
    assert min_winter_tmin_no_snow(series([-10, -20, -5]), series([3, 0, 0]), "2020-01-01", "2020-01-03") == -20
    assert np.isnan(min_winter_tmin_no_snow(series([-10]), series([3]), "2020-01-01", "2020-01-01"))
    bare = pd.Series([True] * 20 + [False] * 11 + [True] * 10 + [False] * 18, index=pd.date_range("2020-01-01", periods=59))
    assert [str(m) for m in bare_soil_months(bare)] == ["2020-01"]  # Jan 20/31 bare, Feb 10/28 not


def test_fallow_storage_share_by_hand():
    # Day 1 rain 30 on dry soil (Dr 50 of TAW 100); no ET; Dr -> 20, storage 30 -> 80. Day 2 rain 10, no ET -> storage 90.
    w = series([0, 30, 10])
    out = run_bucket(w, const(3, 0), const(3, 0), const(3, 0), const(3, 1), const(3, 0.5), 100, dr0=50)
    # change in storage over days 2-3 = 90 - 50 = 40 of 40 mm input -> 1.0
    assert fallow_storage_share(out, w, "2020-01-02", "2020-01-03") == pytest.approx(1.0)
