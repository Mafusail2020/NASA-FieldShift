import numpy as np
import pandas as pd

from pipeline.build_layers import YEARS, heavy_threshold, mann_kendall_theil_sen, per_year


def test_perfect_linear_series_has_exact_slope_and_tiny_p():
    slope, p = mann_kendall_theil_sen(YEARS, [0.05 * (y - 1991) + 9 for y in YEARS])
    assert abs(slope - 0.05) < 1e-12
    assert p < 1e-10


def test_constant_series_has_zero_slope_and_p_one():
    slope, p = mann_kendall_theil_sen(YEARS, [3.0] * len(YEARS))
    assert slope == 0 and p == 1.0


def test_alternating_series_is_not_significant():
    slope, p = mann_kendall_theil_sen(YEARS, [0, 1] * 17 + [0])
    assert p > 0.05


def test_too_few_valid_years_gives_none():
    vals = [float("nan")] * 20 + [1.0] * 15
    assert mann_kendall_theil_sen(YEARS, vals) == (None, None)


def test_missing_years_are_skipped_not_filled():
    vals = [0.1 * (y - 1991) for y in YEARS]
    vals[5] = vals[9] = float("nan")
    slope, _ = mann_kendall_theil_sen(YEARS, vals)
    assert abs(slope - 0.1) < 1e-12


def test_per_year_window_is_nan_when_a_day_is_missing():
    idx = pd.date_range("1991-01-01", "2025-12-31")
    s = pd.Series(1.0, index=idx)
    s["1995-07-10"] = np.nan
    out = per_year(None, s, "sum", (6, 8))
    assert out[0] == 92 and np.isnan(out[YEARS.index(1995)])


def test_heavy_threshold_is_percentile_of_wet_days_only():
    s = pd.Series([0.0] * 50 + list(range(1, 101)))  # wet days 1..100 (>= 1 mm)
    assert abs(heavy_threshold(s) - 95.05) < 1e-9


def _tmin(frost_days):
    idx = pd.date_range("1991-01-01", "2025-12-31")
    s = pd.Series(5.0, index=idx)
    for d, v in frost_days:
        s[d] = v
    return s


def test_frost_doy_last_and_first_pick_correct_days():
    from pipeline.build_layers import frost_doy
    s = _tmin([("2001-01-10", -5), ("2001-04-20", -0.5), ("2001-05-02", 0.0), ("2001-09-30", -1), ("2001-10-12", -3)])
    assert frost_doy(s, 2001, 0.0, "last") == 122   # 2 May (<= 0 counts)
    assert frost_doy(s, 2001, -2.2, "last") == 10   # only 10 Jan is that cold
    assert frost_doy(s, 2001, 0.0, "first") == 273  # 30 Sep
    assert frost_doy(s, 2001, -4.4, "first") == 367.0  # no such frost after 1 Aug: censored, latest rank
    assert frost_doy(s, 2001, -9.0, "last") == 0.0     # no such frost before 1 Aug: censored, earliest rank


def test_frost_doy_uses_non_leap_calendar_and_skips_missing_window():
    from pipeline.build_layers import frost_doy
    s = _tmin([("2000-03-01", -1), ("2001-03-01", -1)])
    assert frost_doy(s, 2000, 0.0, "last") == frost_doy(s, 2001, 0.0, "last") == 60
    s["2001-02-03"] = np.nan
    assert np.isnan(frost_doy(s, 2001, 0.0, "last"))


def test_frost_percentiles_known_answer_and_min_years():
    from pipeline.build_layers import frost_percentiles
    r = frost_percentiles(list(range(101, 136)))  # 35 values, 101..135
    assert r == {"d10": 104, "d50": 118, "d90": 132, "n_frost": 35, "n_years": 35}
    assert frost_percentiles(list(range(101, 110)) + [float("nan")] * 5) is None


def test_frost_percentiles_censored_last_spring():
    from pipeline.build_layers import frost_percentiles
    # 20 years: 12 with no frost (0 = before window), 8 real (101..108). Ranks 0..11 censored; pos(10%)=1.9, pos(50%)=9.5 -> both censored;
    # pos(90%)=17.1 -> between ranks 17 and 18 = 106 and 107 -> 106.1 -> 106
    r = frost_percentiles([0.0] * 12 + list(range(101, 109)), "last")
    assert r == {"d10": None, "d50": None, "d90": 106, "n_frost": 8, "n_years": 20}


def test_frost_percentiles_censored_first_autumn():
    from pipeline.build_layers import frost_percentiles
    # 20 years: 8 real (281..288), 12 with no frost (367 = after window). pos(10%)=1.9 -> ranks 1,2 = 282,283 -> 282.9 -> 283; 50%, 90% censored
    r = frost_percentiles(list(range(281, 289)) + [367.0] * 12, "first")
    assert r == {"d10": 283, "d50": None, "d90": None, "n_frost": 8, "n_years": 20}


def test_frost_season_with_and_without_censored_dates():
    from pipeline.build_layers import frost_season
    last = {"d50": 100, "n_years": 30}
    first = {"d50": 300, "n_years": 25}
    assert frost_season(last, first) == {"days": 200, "capped": False, "n_years": 25}
    assert frost_season({"d50": None, "n_years": 30}, {"d50": None, "n_years": 30}) == {"days": 365, "capped": True, "n_years": 30}
    assert frost_season(last, None) is None
