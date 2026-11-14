"""Stress metrics from a bucket run. Windows are (start, end) dates, both inclusive."""
import pandas as pd


def _win(s: pd.Series, start, end) -> pd.Series:
    return s.loc[pd.Timestamp(start):pd.Timestamp(end)]


def mean_ks(out: pd.DataFrame, start, end) -> float:
    return float(_win(out["ks"], start, end).mean())


def water_stress_days(out: pd.DataFrame, start, end) -> int:
    """Days with Ks < 1, i.e. depletion beyond RAW."""
    return int((_win(out["ks"], start, end) < 1).sum())


def heat_days(tmax: pd.Series, start, end, threshold: float) -> int:
    return int((_win(tmax, start, end) >= threshold).sum())


def frost_days(tmin: pd.Series, start, end, threshold: float) -> int:
    """Days with Tmin below the threshold (use for the late spring / early autumn windows)."""
    return int((_win(tmin, start, end) < threshold).sum())


def min_winter_tmin_no_snow(tmin: pd.Series, snow: pd.Series, winter_start, winter_end) -> float:
    """Lowest Tmin in the window on days without snow in the model's snow store; NaN if snow covered the whole window."""
    t, s = _win(tmin, winter_start, winter_end), _win(snow, winter_start, winter_end)
    bare = t[s <= 0]
    return float(bare.min()) if len(bare) else float("nan")


def bare_soil_months(is_bare: pd.Series, min_share: float = 0.5) -> list[pd.Period]:
    """Months in which at least `min_share` of days have no crop on the field."""
    share = is_bare.astype(float).groupby(is_bare.index.to_period("M")).mean()
    return list(share[share >= min_share].index)


def soil_water_at(out: pd.DataFrame, day) -> dict:
    r = out.loc[pd.Timestamp(day)]
    return {"storage_mm": float(r.storage), "fraction_of_taw": float(r.storage / r.taw)}


def fallow_storage_share(out: pd.DataFrame, water_in: pd.Series, start, end) -> float:
    """Share of water input (rain + melt) stored in the soil over a fallow period: change in storage / input.

    Change from rezoning is excluded. Compare with 10-53% (Nielsen & Vigil 2010); values near 100% mean a bug.
    """
    o, w = _win(out, start, end), _win(water_in, start, end)
    s_before = out["storage"].shift(1).loc[o.index[0]]
    ds = o["storage"].iloc[-1] - s_before - o["rezone"].sum()
    return float(ds / w.sum())
