from datetime import date

import pandas as pd

from core.phenology import daily_gdd, gdd_window, stage_dates

# Synthetic constant weather: Tmax = Tmin = 20 °C, base 10 °C -> exactly 10 GDD per day.
IDX = pd.date_range("2020-04-01", "2020-12-31")
TMAX = pd.Series(20.0, index=IDX)
SOWING = date(2020, 5, 1)


def test_daily_gdd_constant_and_floor():
    assert (daily_gdd(TMAX, TMAX, 10) == 10).all()
    assert (daily_gdd(TMAX, TMAX, 25) == 0).all()  # below base gives 0, never negative


def test_stage_dates_by_hand():
    # lengths 10/20/30/15 days from 1 May: dev starts 11 May, mid 31 May,
    # late 30 Jun, last day 14 Jul (75 days in total).
    d = stage_dates(SOWING, 10, 20, 30, 15)
    assert d["ini"] == date(2020, 5, 1)
    assert d["dev"] == date(2020, 5, 11)
    assert d["mid"] == date(2020, 5, 31)
    assert d["late"] == date(2020, 6, 30)
    assert d["end"] == date(2020, 7, 14)


def test_gdd_window_by_hand():
    # 10 GDD/day, sowing day is day 1: 100 GDD is reached on day 10 (10 May), 200 GDD on day 20 (20 May).
    gdd = daily_gdd(TMAX, TMAX, 10)
    assert gdd_window(SOWING, gdd, 100, 200) == (date(2020, 5, 10), date(2020, 5, 20))


def test_gdd_window_not_reached():
    gdd = daily_gdd(TMAX, TMAX, 10)
    assert gdd_window(date(2020, 12, 25), gdd, 100, 200) is None


def test_sowing_temperature_rising_by_hand():
    from core.phenology import sowing_date_temperature
    # Tmean: 5 °C until 31 Mar, then +1 °C per day from 1 Apr (6, 7, ...). Rule: 10-day mean >= 13.
    # Mean of days k..k+9 after 1 Apr (values 5+k+1 .. 5+k+10)... by hand: 10-day mean ending on 1 Apr + n days =
    # (5*(9-n) + sum_{j=1}^{n+1}(5+j)) / 10 for n < 9. For n = 9: mean of 6..15 = 10.5; n = 12: mean of 9..18 = 13.5;
    # n = 11: mean of 8..17 = 12.5 -> first >= 13 is n = 12, i.e. 13 April.
    idx = pd.date_range("2020-01-01", "2020-06-30")
    vals = [5.0 if d < pd.Timestamp("2020-04-01") else 5.0 + (d - pd.Timestamp("2020-04-01")).days + 1 for d in idx]
    t = pd.Series(vals, index=idx)
    assert sowing_date_temperature(t, 2020, 13, "rising", "03-01") == date(2020, 4, 13)


def test_sowing_temperature_falling_with_latest_date():
    from core.phenology import sowing_date_temperature
    idx = pd.date_range("2020-08-01", "2020-12-31")
    warm = pd.Series(20.0, index=idx)  # never falls to 17 -> fallback date
    assert sowing_date_temperature(warm, 2020, 17, "falling", "08-15", "12-01") == date(2020, 12, 1)
    assert sowing_date_temperature(warm, 2020, 17, "falling", "08-15") is None
    cool = pd.Series(10.0, index=idx)  # already <= 17 on the first running-mean day after 15 Aug
    assert sowing_date_temperature(cool, 2020, 17, "falling", "08-15", "12-01") == date(2020, 8, 15)
