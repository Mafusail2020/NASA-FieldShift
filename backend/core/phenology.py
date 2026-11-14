"""Phenology from a sowing date and daily temperature. GDD only drives the clock, it is not shown in the UI.

Daily GDD = max((Tmax + Tmin) / 2 - base, 0). The sowing day is day 1 and counts.
"""
from datetime import date, timedelta

import numpy as np
import pandas as pd


def daily_gdd(tmax: pd.Series, tmin: pd.Series, base: float) -> pd.Series:
    return np.maximum((tmax + tmin) / 2 - base, 0)


def stage_dates(sowing: date, l_ini: int, l_dev: int, l_mid: int, l_late: int) -> dict[str, date]:
    """Start date of each FAO-56 stage; 'end' is the last day of the late stage."""
    return {
        "ini": sowing,
        "dev": sowing + timedelta(days=l_ini),
        "mid": sowing + timedelta(days=l_ini + l_dev),
        "late": sowing + timedelta(days=l_ini + l_dev + l_mid),
        "end": sowing + timedelta(days=l_ini + l_dev + l_mid + l_late - 1),
    }


def gdd_window(sowing: date, gdd: pd.Series, start_gdd: float, end_gdd: float):
    """First day cumulative GDD (from sowing, inclusive) reaches start_gdd and end_gdd.

    Returns (start_date, end_date), or None if the series ends before end_gdd is reached.
    """
    cum = gdd[gdd.index >= pd.Timestamp(sowing)].cumsum()
    s, e = cum[cum >= start_gdd], cum[cum >= end_gdd]
    if s.empty or e.empty:
        return None
    return s.index[0].date(), e.index[0].date()
