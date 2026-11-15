"""Season twins: the historical seasons (NASA POWER, 1991-2025) whose weather since sowing looks most like this season.

Pure logic, no web. A season runs from the sowing date for the crop's cycle length. For every earlier year the same
calendar window is compared with the current one, dekad by dekad (10 days). Matching uses four groups of features,
each z-scored over the historical years: cumulative rain, cumulative growing degree-days (GDD), mean Tmax and mean
radiation. The result is a distance per year; the best few are returned with what happened in the rest of their season.

This is not a forecast. It shows seasons that looked like this one so far and how they ended.
"""
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path(__file__).resolve().parents[1] / "data" / "raw"
LAT_STEP, LON_STEP = 0.5, 0.625
COLS = ["T2M_MAX", "T2M_MIN", "ALLSKY_SFC_SW_DWN", "PRECTOTCORR"]
MIN_DAYS = 30        # fewer days since sowing than this is too little to match
DEKAD = 10
DRY_DAY_MM = 1.0     # a day below this rain is a dry day
WEIGHTS = {"rain": 2.0, "gdd": 2.0, "tmax": 1.0, "rad": 0.5}


@dataclass(frozen=True)
class CropSeason:
    """cycle_d: days from sowing to harvest (FAO-56 Table 11 stage lengths, crops.csv). gdd_base: GDD base temperature.
    sow_year_offset: 0 = harvest in the sowing year (spring crop), 1 = harvest the year after sowing (winter crop).
    heat_*: days after sowing of the heat window and the Tmax threshold. late_*: days after sowing of the late-drought window."""
    cycle_d: int
    gdd_base: float
    sow_year_offset: int
    heat_from: int
    heat_to: int
    heat_tmax: float
    late_from: int
    late_to: int
    default_sowing: str  # MM-DD
    note: str


# Only winter wheat and maize for now. Windows and thresholds marked "estimate" are the project's, not a standard.
SEASONS: dict[str, CropSeason] = {
    "winter_wheat": CropSeason(335, 0.0, 1, 310, 335, 30.0, 275, 335, "10-01",
                               "cycle 160/75/75/25 days (FAO-56 Table 11); grain-fill window and 30 °C: estimate (crops.csv)"),
    "maize": CropSeason(170, 10.0, 0, 70, 120, 32.0, 110, 170, "04-25",
                        "cycle 30/40/50/50 days (FAO-56 Table 11); flowering window and 32 °C: estimate (crops.csv)"),
}


def cell_center(lat: float, lon: float) -> tuple[float, float]:
    return round(round(lat / LAT_STEP) * LAT_STEP, 3), round(round(lon / LON_STEP) * LON_STEP, 3)


def load_daily(cell_id: str, raw: Path = DATA) -> pd.DataFrame | None:
    """Archive (1991-2025) plus the optional current-season file (power_season/). None if the cell has no archive."""
    arch = raw / "power_grid" / f"{cell_id}.csv"
    if not arch.exists():
        return None
    df = pd.read_csv(arch, comment="#", index_col=0, parse_dates=True)[COLS]
    cur = raw / "power_season" / f"{cell_id}.csv"
    if cur.exists():
        s = pd.read_csv(cur, comment="#", index_col=0, parse_dates=True)[COLS]
        df = pd.concat([df[df.index < s.index.min()], s]) if len(s) else df
    return df[~df.index.duplicated(keep="last")].sort_index()


def _on(sowing: date, year: int) -> date:
    try:
        return sowing.replace(year=year)
    except ValueError:  # 29 Feb
        return sowing.replace(year=year, day=28)


def _window(df: pd.DataFrame, start: date, days: int) -> pd.DataFrame | None:
    w = df.loc[pd.Timestamp(start):pd.Timestamp(start + timedelta(days=days - 1))]
    return w if len(w) == days and not w.isna().any().any() else None


def _features(w: pd.DataFrame, base: float, n: int) -> dict[str, np.ndarray]:
    k = n // DEKAD
    cut = w.iloc[: k * DEKAD]
    gdd = np.maximum((cut["T2M_MAX"] + cut["T2M_MIN"]) / 2 - base, 0).to_numpy().cumsum()
    rain = cut["PRECTOTCORR"].to_numpy().cumsum()
    ends = np.arange(DEKAD - 1, k * DEKAD, DEKAD)
    blocks = lambda s: s.to_numpy().reshape(k, DEKAD).mean(axis=1)
    return {"rain": rain[ends], "gdd": gdd[ends], "tmax": blocks(cut["T2M_MAX"]), "rad": blocks(cut["ALLSKY_SFC_SW_DWN"])}


def _cum(w: pd.DataFrame, base: float, col: str) -> np.ndarray:
    if col == "gdd":
        return np.maximum((w["T2M_MAX"] + w["T2M_MIN"]) / 2 - base, 0).to_numpy().cumsum()
    return w["PRECTOTCORR"].to_numpy().cumsum()


def _longest_dry(rain: np.ndarray) -> int:
    best = run = 0
    for r in rain:
        run = run + 1 if r < DRY_DAY_MM else 0
        best = max(best, run)
    return best


def _outcome(w: pd.DataFrame, c: CropSeason, sow: date, gdd_target: float, n_now: int) -> dict:
    gdd = _cum(w, c.gdd_base, "gdd")
    hit = np.nonzero(gdd >= gdd_target)[0]
    harvest_i = int(hit[0]) if len(hit) else c.cycle_d - 1
    rain, tmax, tmin = w["PRECTOTCORR"].to_numpy(), w["T2M_MAX"].to_numpy(), w["T2M_MIN"].to_numpy()
    hw, lw = slice(c.heat_from - 1, c.heat_to), slice(c.late_from - 1, c.late_to)
    after = slice(n_now, n_now + 30)
    return {
        "harvest_date": (sow + timedelta(days=harvest_i)).isoformat(),
        "heat_days": int((tmax[hw] >= c.heat_tmax).sum()),
        "late_rain_mm": round(float(rain[lw].sum()), 0),
        "late_dry_spell_days": _longest_dry(rain[lw]),
        "cycle_rain_mm": round(float(rain.sum()), 0),
        "frost_days": int((tmin[(150 if c.sow_year_offset else 0):] < 0).sum()),
        "next30_rain_mm": round(float(rain[after].sum()), 0) if n_now < c.cycle_d else None,
        "next30_heat_days": int((tmax[after] >= c.heat_tmax).sum()) if n_now < c.cycle_d else None,
    }


def find_twins(df: pd.DataFrame, crop: str, sowing_mmdd: str, harvest_year: int, as_of: date | None = None, k: int = 3) -> dict:
    """Match the season of `harvest_year` (sown in harvest_year - offset) to earlier years.

    Returns {status: 'ok' | 'too_early' | 'no_data', ...}. `as_of` defaults to the last day with data."""
    c = SEASONS[crop]
    mm, dd = (int(x) for x in sowing_mmdd.split("-"))
    sow_now = date(harvest_year - c.sow_year_offset, mm, dd)
    sowing = date(2001, mm, dd)  # leap-safe template; _on() moves it to the right year
    last = df.dropna().index.max().date()
    as_of = min(as_of or last, last)
    n = (as_of - sow_now).days + 1
    if n < MIN_DAYS:
        return {"status": "too_early", "days_since_sowing": max(n, 0), "min_days": MIN_DAYS, "as_of": as_of.isoformat()}
    n = min(n, c.cycle_d)
    now_w = _window(df, sow_now, n)
    if now_w is None:
        return {"status": "no_data", "as_of": as_of.isoformat()}
    now_f = _features(now_w, c.gdd_base, n)

    years = [y for y in range(1991 + c.sow_year_offset, 2026) if y != harvest_year]
    full, feats = {}, {}
    for y in years:
        s = _on(sowing, y - c.sow_year_offset)
        w = _window(df, s, c.cycle_d)
        if w is not None:
            full[y] = w
            feats[y] = _features(w.iloc[:n], c.gdd_base, n)
    if len(full) < 8:
        return {"status": "no_data", "as_of": as_of.isoformat()}

    ys = sorted(full)
    dist, parts = {}, {}
    sd = {g: np.maximum(np.std([feats[y][g] for y in ys], axis=0), 1e-6) for g in WEIGHTS}
    for y in ys:
        d = {g: float(np.sqrt(np.mean(((now_f[g] - feats[y][g]) / sd[g]) ** 2))) for g in WEIGHTS}
        dist[y] = sum(WEIGHTS[g] * d[g] for g in WEIGHTS) / sum(WEIGHTS.values())
        parts[y] = {"rain_mm": round(float(feats[y]["rain"][-1] - now_f["rain"][-1]), 0),
                    "gdd": round(float(feats[y]["gdd"][-1] - now_f["gdd"][-1]), 0),
                    "tmax_c": round(float(feats[y]["tmax"].mean() - now_f["tmax"].mean()), 1)}
    ranked = sorted(ys, key=dist.get)

    gdd_target = float(np.mean([_cum(full[y], c.gdd_base, "gdd")[-1] for y in ys]))
    sows = {y: _on(sowing, y - c.sow_year_offset) for y in ys}
    outcomes = {y: _outcome(full[y], c, sows[y], gdd_target, n) for y in ys}
    med = {m: float(np.median([o[m] for o in outcomes.values()])) for m in ("late_rain_mm", "heat_days", "cycle_rain_mm")}

    def flags(o: dict) -> list[str]:
        f = []
        if o["late_rain_mm"] < 0.6 * med["late_rain_mm"]: f.append("late drought")
        if o["heat_days"] >= max(3, med["heat_days"] + 2): f.append("heat in grain fill")
        if o["late_rain_mm"] > 1.5 * med["late_rain_mm"]: f.append("wet finish")
        return f

    twins = [{"year": y, "distance": round(dist[y], 2), "diff": parts[y], "sowing": sows[y].isoformat(), **outcomes[y], "flags": flags(outcomes[y])}
             for y in ranked[:k]]
    step = 5
    days = list(range(0, c.cycle_d, step))
    series = {
        "days": days,
        "now_rain": [round(float(v), 1) for v in _cum(now_w, c.gdd_base, "rain")[::step]],
        "now_gdd": [round(float(v), 0) for v in _cum(now_w, c.gdd_base, "gdd")[::step]],
        "twins": {str(t["year"]): {"rain": [round(float(v), 1) for v in _cum(full[t["year"]], c.gdd_base, "rain")[::step]],
                                   "gdd": [round(float(v), 0) for v in _cum(full[t["year"]], c.gdd_base, "gdd")[::step]]} for t in twins},
        "rain_min": [round(float(v), 1) for v in np.min([_cum(full[y], c.gdd_base, "rain")[::step] for y in ys], axis=0)],
        "rain_max": [round(float(v), 1) for v in np.max([_cum(full[y], c.gdd_base, "rain")[::step] for y in ys], axis=0)],
        "gdd_min": [round(float(v), 0) for v in np.min([_cum(full[y], c.gdd_base, "gdd")[::step] for y in ys], axis=0)],
        "gdd_max": [round(float(v), 0) for v in np.max([_cum(full[y], c.gdd_base, "gdd")[::step] for y in ys], axis=0)],
    }
    return {
        "status": "ok", "crop": crop, "sowing": sow_now.isoformat(), "as_of": as_of.isoformat(), "days_since_sowing": n,
        "cycle_d": c.cycle_d, "years_compared": len(ys), "twins": twins, "series": series,
        "reference": {"late_rain_mm_median": round(med["late_rain_mm"], 0), "heat_days_median": med["heat_days"], "cycle_rain_mm_median": round(med["cycle_rain_mm"], 0)},
        "windows": {"heat_from": c.heat_from, "heat_to": c.heat_to, "heat_tmax_c": c.heat_tmax, "late_from": c.late_from, "late_to": c.late_to},
        "note": c.note,
    }
