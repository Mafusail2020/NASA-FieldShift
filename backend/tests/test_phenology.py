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
