"""Daily single-layer soil water bucket, FAO-56 Chapter 8 (Eq. 85, 84), with a degree-day snow store.

Not modelled: surface runoff, capillary rise, irrigation, runoff from frozen ground, snow sublimation.
Soil evaporation and transpiration are both zero while snow lies on the ground.
"""
import numpy as np
import pandas as pd

SNOW_T = 0.0  # precipitation at Tmean < 0 °C is snow; melt starts above 0 °C


def snow_store(precip: pd.Series, tmean: pd.Series, ddf: float) -> pd.DataFrame:
    """Degree-day snow store. Returns water_in (rain + melt, mm), snow (store at end of day, mm) and melt (mm)."""
    p, t = precip.to_numpy(float), tmean.to_numpy(float)
    water, store, melt = np.zeros(len(p)), np.zeros(len(p)), np.zeros(len(p))
    s = 0.0
    for i in range(len(p)):
        snowfall = p[i] if t[i] < SNOW_T else 0.0
        rain = p[i] - snowfall
        m = min(s, ddf * max(t[i] - SNOW_T, 0.0))
        s += snowfall - m
        water[i], store[i], melt[i] = rain + m, s, m
    return pd.DataFrame({"water_in": water, "snow": store, "melt": melt}, index=precip.index)


def run_bucket(water_in: pd.Series, snow: pd.Series, eto: pd.Series, kc: pd.Series, zr: pd.Series,
               p: pd.Series, awc: float, dr0: float = 0.0) -> pd.DataFrame:
    """Daily root-zone depletion Dr (mm). awc is available water capacity in mm per m of soil.

    TAW = awc * Zr, RAW = p * TAW. Ks = 1 for Dr <= RAW, else (TAW - Dr) / ((1 - p) TAW) (Ch. 8).
    When Zr changes, Dr (mm) is kept if it fits (a deeper layer starts at field capacity) and is cut to the new
    TAW if it does not; the change in stored water is returned as `rezone`.
    Storage S = TAW - Dr satisfies  S_t = S_t-1 + rezone + water_in - et - dp.
    """
    w, sn, e = water_in.to_numpy(float), snow.to_numpy(float), eto.to_numpy(float)
    k, z, pp = kc.to_numpy(float), zr.to_numpy(float), p.to_numpy(float)
    n = len(w)
    cols = {c: np.zeros(n) for c in ("taw", "dr", "ks", "et", "dp", "rezone", "storage")}
    dr, taw_prev = dr0, awc * z[0]
    for i in range(n):
        taw = awc * z[i]
        dr_pre = min(dr, taw)
        rezone = (taw - dr_pre) - (taw_prev - dr)
        raw = pp[i] * taw
        ks = 1.0 if dr_pre <= raw else max((taw - dr_pre) / ((1 - pp[i]) * taw), 0.0)
        et = ks * k[i] * e[i] if sn[i] <= 0 else 0.0
        dr = dr_pre - w[i] + et
        dp = 0.0
        if dr < 0:
            dp, dr = -dr, 0.0
        if dr > taw:
            et -= dr - taw
            dr = taw
        taw_prev = taw
        for c, v in zip(cols, (taw, dr, ks, et, dp, rezone, taw - dr)):
            cols[c][i] = v
    return pd.DataFrame(cols, index=water_in.index)
