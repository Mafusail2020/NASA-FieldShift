"""Per-cell map layers (trends and extremes) from the raw daily NASA POWER series of the Ukraine grid.

Reads every file that exists in data/raw/power_grid/ (safe to re-run while the download is still going), writes
frontend/public/data/grid_layers.json and data/processed/grid_layers.json.
Run by hand from backend/:  .venv/bin/python -m pipeline.build_layers

All layers are HISTORICAL statistics of MERRA-2 reanalysis (via NASA POWER), 1991-2025. Not a forecast.
Trend = Theil-Sen slope; p-value = Mann-Kendall test (normal approximation, tie-corrected), two-sided.
A year with any missing day in the window it needs is skipped (never filled). A trend needs >= MIN_YEARS valid years.
"""
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

from pipeline.add_eto import point_eto

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "backend" / "data" / "raw" / "power_grid"
OUT_FILES = [ROOT / "backend" / "data" / "processed" / "grid_layers.json", ROOT / "frontend" / "public" / "data" / "grid_layers.json"]
YEARS = list(range(1991, 2026))
MIN_YEARS = 20
ALPHA = 0.05
WET_DAY_MM = 1.0       # a "wet day" has at least 1 mm
HEAVY_PCTL = 95        # heavy day = above the cell's own 95th percentile of wet-day rain
SOURCE = "NASA POWER daily, community AG, 1991-2025 (MERRA-2 reanalysis); ETo = FAO-56 Penman-Monteith (core/eto.py)"
NASA_NOTE = "Historical statistic of reanalysis data (MERRA-2 via NASA POWER), not a forecast."


def mann_kendall_theil_sen(years, values) -> tuple[float | None, float | None]:
    """Return (Theil-Sen slope per year, two-sided Mann-Kendall p-value); None, None if fewer than MIN_YEARS valid points."""
    x = np.asarray(years, float)
    y = np.asarray(values, float)
    ok = ~np.isnan(y)
    x, y = x[ok], y[ok]
    n = len(y)
    if n < MIN_YEARS:
        return None, None
    i, j = np.triu_indices(n, 1)
    slope = float(np.median((y[j] - y[i]) / (x[j] - x[i])))
    s = float(np.sign(y[j] - y[i]).sum())
    _, counts = np.unique(y, return_counts=True)
    var = (n * (n - 1) * (2 * n + 5) - (counts * (counts - 1) * (2 * counts + 5)).sum()) / 18
    if var <= 0:
        return slope, 1.0
    z = 0.0 if s == 0 else (s - math.copysign(1, s)) / math.sqrt(var)
    return slope, math.erfc(abs(z) / math.sqrt(2))


def per_year(df: pd.DataFrame, series: pd.Series, how: str, months: tuple[int, ...] | None = None, start=None, end=None) -> list[float]:
    """Aggregate per year over a window (months, or (month, day) start/end inclusive); NaN if any day of the window is missing."""
    out = []
    for y in YEARS:
        lo, hi = (pd.Timestamp(y, *start), pd.Timestamp(y, *end)) if start else (
            (pd.Timestamp(y, months[0], 1), pd.Timestamp(y, months[-1], 1) + pd.offsets.MonthEnd(0)) if months else (pd.Timestamp(y, 1, 1), pd.Timestamp(y, 12, 31)))
        w = series.reindex(pd.date_range(lo, hi))
        out.append(float("nan") if w.isna().any() else float(getattr(w, how)()))
    return out


FROST_THRESHOLDS = {"t0": 0.0, "t2": -2.2, "t4": -4.4}  # NOAA freeze classes in C: 32 F light, 28 F hard, 24 F severe (rounded)
FROST_PCTLS = (10, 50, 90)


CENSOR_LAST, CENSOR_FIRST = 0.0, 367.0  # no frost in the window: last frost "before" it (earliest rank), first frost "after" it (latest rank)


def frost_doy(tmin: pd.Series, year: int, thr: float, kind: str) -> float:
    """Day of year (non-leap calendar, 29 Feb counts as 28 Feb) of the LAST spring (kind='last', search 1 Jan-31 Jul) or FIRST autumn
    (kind='first', search 1 Aug-31 Dec) day with Tmin <= thr. NaN if the window has a missing day (year skipped).
    A year with no such day is a valid observation, censored: CENSOR_LAST (before the window) or CENSOR_FIRST (after it)."""
    lo, hi = ((f"{year}-01-01", f"{year}-07-31") if kind == "last" else (f"{year}-08-01", f"{year}-12-31"))
    w = tmin.reindex(pd.date_range(lo, hi))
    if w.isna().any():
        return float("nan")
    hits = w[w <= thr]
    if hits.empty:
        return CENSOR_LAST if kind == "last" else CENSOR_FIRST
    d = hits.index[-1] if kind == "last" else hits.index[0]
    return float(pd.Timestamp(2001, d.month, min(d.day, 28) if d.month == 2 else d.day).dayofyear)  # 29 Feb counts as 28 Feb


def frost_percentiles(doys, kind: str = "last") -> dict | None:
    """Dates (day of year) at 10/50/90 % of ALL years with complete data (no-frost years included as censored ranks).
    Linear interpolation between ranked years; if either neighbouring rank is a censored year the date is None (no frost by then /
    frost-free through December). None overall if < MIN_YEARS valid years. n_frost = years with a real frost date."""
    v = np.sort(np.asarray(doys, float)[~np.isnan(np.asarray(doys, float))])
    n = len(v)
    if n < MIN_YEARS:
        return None
    censored = (lambda x: x <= CENSOR_LAST) if kind == "last" else (lambda x: x >= CENSOR_FIRST)
    out = {}
    for q in FROST_PCTLS:
        pos = q / 100 * (n - 1)
        lo, hi = v[int(math.floor(pos))], v[int(math.ceil(pos))]
        out[f"d{q}"] = None if censored(lo) or censored(hi) else int(round(float(np.percentile(v, q))))
    out["n_frost"] = int(sum(not censored(x) for x in v))
    out["n_years"] = int(n)
    return out


def frost_cell(df: pd.DataFrame) -> dict:
    out = {}
    for key, thr in FROST_THRESHOLDS.items():
        last = frost_percentiles([frost_doy(df["T2M_MIN"], y, thr, "last") for y in YEARS], "last")
        first = frost_percentiles([frost_doy(df["T2M_MIN"], y, thr, "first") for y in YEARS], "first")
        out.setdefault("frost_last", {})[key] = last
        out.setdefault("frost_first", {})[key] = first
        out.setdefault("frost_season", {})[key] = frost_season(last, first)
    return out


def frost_season(last: dict | None, first: dict | None) -> dict | None:
    """Days between the 50 % dates. A censored 50 % date counts as the window edge (1 Jan / 31 Dec), flagged by capped=True."""
    if not last or not first:
        return None
    a, b = last["d50"], first["d50"]
    return {"days": (365 if b is None else b) - (0 if a is None else a), "capped": a is None or b is None, "n_years": min(last["n_years"], first["n_years"])}


def heavy_threshold(precip: pd.Series) -> float:
    wet = precip[precip >= WET_DAY_MM].dropna()
    return float(np.percentile(wet, HEAVY_PCTL))


def cell_layers(df: pd.DataFrame, lat: float, elev: float) -> dict[str, list[float]]:
    """Yearly series (35 values, NaN = skipped) per layer id."""
    df = df.join(point_eto(df, lat, elev))
    df = df.replace(-999, np.nan)
    tmean = (df["T2M_MAX"] + df["T2M_MIN"]) / 2
    p = df["PRECTOTCORR"]
    thr = heavy_threshold(p)
    heavy_rain = p.where(p > thr, 0.0).where(p.notna())
    annual_p = per_year(df, p, "sum")
    heavy_sum = per_year(df, heavy_rain, "sum")
    share = [100 * h / a if a and not math.isnan(a) and not math.isnan(h) else float("nan") for h, a in zip(heavy_sum, annual_p)]
    season = (4, 9)
    wb = [a - b for a, b in zip(per_year(df, p, "sum", season), per_year(df, df["ETO_PM"], "sum", season))]
    summer = (6, 8)
    return {
        "temp": per_year(df, tmean, "mean"),
        "precip": annual_p,
        "precip_summer": per_year(df, p, "sum", summer),
        "heavy_share": share,
        "water_balance": wb,
        "hot32": per_year(df, (df["T2M_MAX"] >= 32).where(df["T2M_MAX"].notna()), "sum", summer),
        "hot35": per_year(df, (df["T2M_MAX"] >= 35).where(df["T2M_MAX"].notna()), "sum", summer),
        "heavy_days": per_year(df, (p > thr).where(p.notna()), "sum"),
    }


def summarise(values: list[float], decimals: int) -> dict:
    v = np.asarray(values, float)
    valid = ~np.isnan(v)
    if valid.sum() < MIN_YEARS:
        return {"value": None, "trend": None, "p_value": None, "n_years": int(valid.sum())}
    slope, p = mann_kendall_theil_sen(YEARS, v)
    return {"value": round(float(np.nanmean(v)), decimals), "trend": round(slope * 10, decimals + 1), "p_value": round(p, 4), "n_years": int(valid.sum())}


DISABLED_REASON = ("NASA POWER cannot measure this. It needs SRTM terrain slope and MODIS NDVI from NASA Earthdata (AppEEARS), "
                   "which requires an account and has not been downloaded yet. No proxy is shown on purpose.")

# id -> (series key, group, label, unit (value), trend unit, decimals, description, status)
LAYERS = [
    ("temp_trend", "temp", "Shifting temperatures", "Warming", "°C", "°C per decade", 1, "diverging",
     "How fast the yearly mean air temperature changed over 1991-2025 in this cell. Mean temperature is (daily Tmax + Tmin) / 2, "
     "an approximation of the true daily mean.", "data"),
    ("precip_trend", "precip", "Changing rainfall patterns", "Yearly rain", "mm per year", "mm per decade", 0, "diverging",
     "How the total rain per calendar year changed over 1991-2025.", "data"),
    ("precip_summer_trend", "precip_summer", "Changing rainfall patterns", "Summer rain (Jun-Aug)", "mm per summer", "mm per decade", 0, "diverging",
     "How the rain falling in June-August changed over 1991-2025.", "data"),
    ("heavy_share", "heavy_share", "Changing rainfall patterns", "Rain in heavy-rain days", "% of yearly rain", "% points per decade", 1, "sequential",
     f"Share of the yearly rain that fell on heavy-rain days. A heavy-rain day is defined relative to the cell itself: a wet day (at least "
     f"{WET_DAY_MM:g} mm) with more rain than this cell's own {HEAVY_PCTL}th percentile of wet-day rain over 1991-2025. This is our own definition, not a standard.", "estimate"),
    ("water_balance", "water_balance", "Water shortages", "Growing-season water balance", "mm (Apr-Sep rain minus ETo)", "mm per decade", 0, "diverging",
     "Rain minus reference evapotranspiration (ETo, the water a well-watered grass surface would use) from April to September. "
     "Negative means the atmosphere asks for more water than rain supplies. The Apr-Sep season is our choice; it is not crop-specific.", "estimate"),
    ("hot32", "hot32", "Extreme weather", "Hot days, Tmax >= 32 °C", "days per summer (Jun-Aug)", "days per decade", 1, "sequential",
     "Days per summer with maximum air temperature of at least 32 °C, the heat threshold fixed by the project owner for maize.", "data"),
    ("hot35", "hot35", "Extreme weather", "Very hot days, Tmax >= 35 °C", "days per summer (Jun-Aug)", "days per decade", 1, "sequential",
     "Days per summer with maximum air temperature of at least 35 °C, the severe-heat threshold fixed by the project owner for maize.", "data"),
    ("heavy_days", "heavy_days", "Extreme weather", "Heavy-rain days", "days per year", "days per decade", 1, "sequential",
     f"Days per year with rain above this cell's own {HEAVY_PCTL}th percentile of wet-day rain (wet day = at least {WET_DAY_MM:g} mm). Our own definition.", "estimate"),
]
FROST_NOTE = ("Method follows the usual NOAA frost-date approach: for each year, the date of the {which} with daily minimum air temperature at or below the "
              "chosen threshold ({search}); then the 10 %, 50 % and 90 % dates across years. Thresholds are NOAA conventions: 0 °C (32 °F, light freeze), "
              "-2.2 °C (28 °F, hard freeze), -4.4 °C (24 °F, severe freeze). Only years with a missing day in the search window are skipped, never filled. A year with no frost at or below the threshold in the window still counts as an observation (its last frost is before 1 Jan, or its first frost after 31 Dec); if a percentile falls on such a year, no date is given (no frost by then / frost-free through December). "
              "Reanalysis 1991-2025 stands in for station records, and a 50 km MERRA-2 cell is smoother than a weather station, so real local frosts are more frequent "
              "and happen later in spring / earlier in autumn than shown here.")
PCT_NOTE = ("Reading the dates: the 90 % date = by this date, 9 in 10 years have seen their last spring frost (conservative planting date); "
            "the 10 % date = only 1 in 10 years has had its last frost by then. The same percentile convention is used for first autumn frost.")
FROST_LAYERS = {
    "frost_last": ("Last spring frost", "Typical date of the last spring frost (50 % date, 1991-2025). " + FROST_NOTE.format(which="LAST spring frost", search="searched 1 Jan-31 Jul") + " " + PCT_NOTE, "date"),
    "frost_first": ("First autumn frost", "Typical date of the first autumn frost (50 % date, 1991-2025). " + FROST_NOTE.format(which="FIRST autumn frost", search="searched 1 Aug-31 Dec") + " " + PCT_NOTE, "date"),
    "frost_season": ("Frost-free season", "Days between the 50 % last-spring-frost date and the 50 % first-autumn-frost date. " + FROST_NOTE.format(which="last spring / first autumn frost", search="searched 1 Jan-31 Jul and 1 Aug-31 Dec"), "days"),
}
TREND_LAYERS = {"temp_trend", "precip_trend", "precip_summer_trend", "water_balance"}  # coloured by trend; the others by their mean level


def layer_meta() -> dict:
    meta = {}
    for lid, key, group, label, unit, tunit, dec, ramp, desc, status in LAYERS:
        meta[lid] = {
            "label": label, "group": group, "unit": unit, "trend_unit": tunit,
            "color_by": "trend" if lid in TREND_LAYERS else "value", "ramp": ramp, "description": f"{desc} {NASA_NOTE}",
            "source": SOURCE, "status": status, "disabled": False, "reason": None, "key": key, "decimals": dec,
        }
    for lid, (label, desc, unit) in FROST_LAYERS.items():
        meta[lid] = {"label": label, "group": "Frost dates", "unit": unit, "trend_unit": "", "color_by": "value", "ramp": "sequential",
                     "description": f"{desc} {NASA_NOTE}", "source": SOURCE, "status": "estimate", "disabled": False, "reason": None,
                     "kind": "frost", "thresholds": {"t0": "0 °C", "t2": "-2.2 °C", "t4": "-4.4 °C"}}
    for lid, label in (("soil_health", "Declining soil health"), ("ndvi", "Crop health (NDVI)")):
        meta[lid] = {"label": label, "group": label, "unit": "", "trend_unit": "", "color_by": "value", "ramp": "sequential", "description": DISABLED_REASON,
                     "source": "none", "status": "todo", "disabled": True, "reason": DISABLED_REASON, "key": None, "decimals": 0}
    return meta


def main():
    cells = {}
    for path in sorted(RAW_DIR.glob("*.csv")):
        header = path.read_text().split("\n", 1)[0]
        lat = float(header.split("lat=")[1].split()[0])
        lon = float(header.split("lon=")[1].split()[0])
        elev = float(header.split("elevation_m=")[1].split()[0])
        df = pd.read_csv(path, comment="#", index_col=0, parse_dates=True).replace(-999, np.nan)
        series = cell_layers(df, lat, elev)
        cells[f"{lat}_{lon}"] = {lid: summarise(series[key], dec) for lid, key, _g, _l, _u, _t, dec, *_ in LAYERS} | frost_cell(df)
    meta = layer_meta()
    for m in meta.values():
        m.pop("key", None), m.pop("decimals", None)
    doc = {"years": [YEARS[0], YEARS[-1]], "alpha": ALPHA, "min_years": MIN_YEARS, "layers": meta, "cells": cells,
           "note": NASA_NOTE + " Trend = Theil-Sen slope, p-value = Mann-Kendall test; trends with p >= 0.05 are called not significant. "
                   "Years with missing days are skipped, never filled."}
    for out in OUT_FILES:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(doc, separators=(",", ":")))
    print(f"wrote grid_layers.json with {len(cells)} cells")


if __name__ == "__main__":
    main()
