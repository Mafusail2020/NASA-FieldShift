"""One (previous crop -> crop, harvest year, oblast, soil) pair: run the bucket from the previous crop's sowing
date to the current crop's harvest and compute the stress metrics for the current crop.

Calendar rules (mine, see PROGRESS.md): year Y is the harvest year. Winter crops are sown in autumn of Y-1, spring crops
in spring of Y. Sowing follows the crop's `sowing_rule`: the FAO-56 temperature rule (default) or a fixed calendar date
per oblast (`sowing_mmdd_<oblast>`, needs `Climate.oblast`). Sowing is delayed until the day after the previous harvest.
Black fallow occupies 1 Sep Y-1 .. 31 Aug Y (shifted likewise). Bare days: fallow and the gap between crops.
Not modelled: effects of crops two or more years back, frost (thresholds are todo).
"""
from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np
import pandas as pd

from core import stress
from core.bucket import run_bucket
from core.kc import adjust_kc, adjust_kc_end, kc_curve, rh_min
from core.phenology import daily_gdd, gdd_window, sowing_date_temperature, stage_dates

FALLOW = "black_fallow"
WINTER_CROPS = {"winter_wheat", "winter_barley", "winter_rapeseed"}  # sown in autumn of the year before the harvest year
STAGES = ("L_ini_d", "L_dev_d", "L_mid_d", "L_late_d")


class Params:
    """Read access to the long-format crops table. Empty cells (status todo) read as None."""

    def __init__(self, df: pd.DataFrame):
        self.t = {(r.crop, r.parameter): r.value for r in df.itertuples()}

    def get(self, crop, name, cast=float):
        v = self.t.get((crop, name), "")
        return cast(v) if v != "" else None

    def sowing_missing(self, crop) -> list[str]:
        """Sowing parameters still empty. Rule 'calendar' needs at least one oblast date; anything else uses temperature."""
        if self.get(crop, "sowing_rule", str) == "calendar":
            dates = [k[1] for k in self.t if k[0] == crop and k[1].startswith("sowing_mmdd_") and self.t[k] != ""]
            return [] if dates else ["sowing_mmdd_<oblast>"]
        need = ("sowing_temp_c", "sowing_temp_dir", "sowing_window_start_mmdd", "sowing_latest_mmdd")
        return [n for n in need if self.get(crop, n, str) is None]

    def supported(self, crop) -> bool:
        if crop == FALLOW:
            return self.get(crop, "zr_max_m") is not None
        need = list(STAGES) + ["kc_ini", "kc_mid", "kc_end", "zr_max_m", "p", "h_m"]
        miss = self.sowing_missing(crop)
        # calendar: needs a date; temperature: needs the threshold (the latest date is optional, as before)
        sowing_ok = not miss if self.get(crop, "sowing_rule", str) == "calendar" else "sowing_temp_c" not in miss
        return all(self.get(crop, n) is not None for n in need) and sowing_ok


@dataclass
class Climate:
    """Daily series of one oblast and the soil-independent snow store. `oblast` is needed for calendar sowing dates."""
    df: pd.DataFrame
    snow: pd.DataFrame
    oblast: str | None = None

    @property
    def tmean(self):
        return (self.df["T2M_MAX"] + self.df["T2M_MIN"]) / 2


def season(crop, year, clim: Climate, P: Params, prev_harvest: date | None = None):
    """(sowing, harvest) of `crop` for harvest year `year`; None if the sowing rule finds no date."""
    if crop == FALLOW:
        sow, harv = date(year - 1, 9, 1), date(year, 8, 31)
    else:
        sow_year = year - 1 if crop in WINTER_CROPS else year
        if P.get(crop, "sowing_rule", str) == "calendar":
            mmdd = P.get(crop, f"sowing_mmdd_{clim.oblast}", str) if clim.oblast else None
            sow = date.fromisoformat(f"{sow_year}-{mmdd}") if mmdd else None
        else:
            sow = sowing_date_temperature(
                clim.tmean, sow_year, P.get(crop, "sowing_temp_c"),
                P.get(crop, "sowing_temp_dir", str), P.get(crop, "sowing_window_start_mmdd", str),
                P.get(crop, "sowing_latest_mmdd", str))
        if sow is None:
            return None
        harv = None
    if prev_harvest is not None and sow <= prev_harvest:
        sow = prev_harvest + timedelta(days=1)
    if harv is None:
        harv = sow + timedelta(days=sum(P.get(crop, s, int) for s in STAGES) - 1)
    return sow, harv


def _crop_kc(crop, sow, clim: Climate, P: Params) -> pd.Series:
    L = [P.get(crop, s, int) for s in STAGES]
    st = stage_dates(sow, *L)
    df = clim.df

    def mean_over(a, b):
        w = df.loc[pd.Timestamp(a):pd.Timestamp(b)]
        return float(w["WS2M"].mean()), float(rh_min(w["T2MDEW"], w["T2M_MAX"]).mean())

    h = P.get(crop, "h_m")
    u2, rh = mean_over(st["mid"], st["late"] - timedelta(days=1))
    kc_mid = adjust_kc(P.get(crop, "kc_mid"), u2, rh, h)
    u2, rh = mean_over(st["late"], st["end"])
    kc_end = adjust_kc_end(P.get(crop, "kc_end"), u2, rh, h)
    return kc_curve(sow, *L, P.get(crop, "kc_ini"), kc_mid, kc_end)


def _heat(crop, sow, harv, clim: Climate, P: Params):
    """(days at threshold 1, days at threshold 2, thresholds) in the heat window, or None when the window is todo."""
    t1, t2 = P.get(crop, "heat_tmax_1_c"), P.get(crop, "heat_tmax_2_c")
    basis, a, b = P.get(crop, "heat_basis", str), P.get(crop, "heat_start"), P.get(crop, "heat_end")
    if t1 is None or basis is None or a is None or b is None:
        return None
    if basis == "days":
        w0, w1 = sow + timedelta(days=int(a) - 1), sow + timedelta(days=int(b) - 1)
    else:
        base = P.get(crop, "gdd_base_c")
        g = daily_gdd(clim.df["T2M_MAX"], clim.df["T2M_MIN"], base)
        win = gdd_window(sow, g, a, b)
        if win is None:
            return None
        w0, w1 = win
    tmax = clim.df["T2M_MAX"]
    return (stress.heat_days(tmax, w0, w1, t1), stress.heat_days(tmax, w0, w1, t2) if t2 is not None else None)


def compute_pair(prev, cur, year, clim: Climate, bare_kc: pd.Series, soil: dict, P: Params, ze: float):
    """Metrics for `cur` in harvest year `year` after `prev`. soil: awc (mm/m). Returns (record, daily) or None."""
    sp = season(prev, year - 1, clim, P)
    if sp is None:
        return None
    sow_p, harv_p = sp
    sc = season(cur, year, clim, P, prev_harvest=harv_p)
    if sc is None or pd.Timestamp(sc[1]) > clim.df.index[-1]:
        return None
    sow_c, harv_c = sc
    idx = pd.date_range(sow_p, harv_c)
    df = clim.df.loc[idx]
    kc, zr, p = bare_kc.loc[idx].copy(), pd.Series(P.get(FALLOW, "zr_max_m"), index=idx), pd.Series(1.0, index=idx)
    crop_days = pd.Series(False, index=idx)
    for crop, (s, h) in ((prev, (sow_p, harv_p)), (cur, (sow_c, harv_c))):
        if crop == FALLOW:
            continue
        c = _crop_kc(crop, s, clim, P)
        c = c.loc[c.index.intersection(idx)]
        kc.loc[c.index], zr.loc[c.index], p.loc[c.index] = c, P.get(crop, "zr_max_m"), P.get(crop, "p")
        crop_days.loc[c.index] = True
    out = run_bucket(clim.snow["water_in"].loc[idx], clim.snow["snow"].loc[idx], df["ETO_PM"], kc, zr, p, soil["awc"])
    s, e = pd.Timestamp(sow_c), pd.Timestamp(harv_c)
    cs = out.loc[s:e]
    rec = {"year": year, "sowing": sow_c.isoformat(), "harvest": harv_c.isoformat(), "prev_harvest": harv_p.isoformat(),
           "et_mm": float(cs["et"].sum()), "dp_mm": float(cs["dp"].sum()),
           "water_in_mm": float(clim.snow["water_in"].loc[s:e].sum()),
           "bare_months": len(stress.bare_soil_months(~crop_days.loc[pd.Timestamp(harv_p) + pd.Timedelta(days=1):])),
           "soil_water_at_sowing_mm": float(out.loc[s, "storage"]),
           "soil_water_at_sowing_frac": float(out.loc[s, "storage"] / out.loc[s, "taw"]),
           "mean_ks_mid": None, "water_stress_days": None, "heat_days_1": None, "heat_days_2": None,
           "min_winter_tmin_no_snow": None}
    if cur != FALLOW:
        st = stage_dates(sow_c, *[P.get(cur, x, int) for x in STAGES])
        rec["mean_ks_mid"] = stress.mean_ks(out, st["mid"], st["late"] - timedelta(days=1))
        rec["water_stress_days"] = stress.water_stress_days(out, sow_c, harv_c)
        h = _heat(cur, sow_c, harv_c, clim, P)
        if h is not None:
            rec["heat_days_1"], rec["heat_days_2"] = h
        if cur in WINTER_CROPS:
            w = stress.min_winter_tmin_no_snow(df["T2M_MIN"], clim.snow["snow"].loc[idx], date(year - 1, 12, 1), date(year, 2, 28))
            rec["min_winter_tmin_no_snow"] = None if np.isnan(w) else w
    # monthly storage fraction and cover label for the 24 months Jan (year-1) .. Dec (year)
    frac = (out["storage"] / out["taw"]).groupby([out.index.year, out.index.month]).mean()
    lab = pd.Series("bare", index=idx)
    for crop, (a, b) in ((prev, (sow_p, harv_p)), (cur, (sow_c, harv_c))):
        if crop != FALLOW:
            lab.loc[pd.Timestamp(a):pd.Timestamp(b)] = crop
    labm = lab.groupby([lab.index.year, lab.index.month]).agg(lambda x: x.value_counts().index[0])
    daily = {"frac": frac, "label": labm}
    return rec, daily
