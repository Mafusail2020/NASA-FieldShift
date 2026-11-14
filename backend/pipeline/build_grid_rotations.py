"""Pair metrics for every grid cell that has a raw POWER file, for the rotation panel of the Map page.

For each cell: ETo (FAO-56 PM, as in add_eto), snow from the degree-day store (snow depth is not downloaded for the grid),
then core.pairs.compute_pair for every (previous crop -> crop, harvest year, soil preset). The frontend chains the pairs
into rotations (same rule as core/rotations.py: slot j = pair rotation[j-1] -> rotation[j]).
Only crops whose parameters are complete in data/params/crops.csv are computed; the others are listed with the missing
parameters. Nothing is invented.

Output: <out>/rotations_grid.json (index) and <out>/rotations/<cell id>.json, in frontend/public/data and
backend/data/processed. Incremental: a cell that already has an output file is skipped (no cell is recomputed unless --force).
Run from backend/: python -m pipeline.build_grid_rotations [--force] [--workers N] [--limit N]
"""
import argparse
import json
import time
from concurrent.futures import ProcessPoolExecutor
from itertools import product
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

from core.bucket import snow_store
from core.crops import load_crops
from core.kc import bare_kc_daily
from core.pairs import FALLOW, STAGES, Climate, Params, compute_pair
from core.params import get_value, load_params
from pipeline.add_eto import point_eto
from pipeline.build_grid import RAW_DIR

ROOT = Path(__file__).resolve().parents[2]
PARAMS = ROOT / "backend" / "data" / "params"
OUT_DIRS = [ROOT / "frontend" / "public" / "data", ROOT / "backend" / "data" / "processed"]
YEARS = range(1993, 2026)
SOILS = ("light", "medium", "heavy")
# Demo crops (agreed scope). A crop is computed only if its parameters are complete (Params.supported); the rest are listed
# with the missing parameters. Winter barley, winter rapeseed, oats and buckwheat are left out: no grid sowing date or stages.
ALL_CROPS = ("winter_wheat", "maize", "sunflower", "pea", "soybean", "sugar_beet", "spring_barley", "millet", "black_fallow")
NEED = list(STAGES) + ["kc_ini", "kc_mid", "kc_end", "zr_max_m", "p", "h_m"]
METRICS = ("mean_ks_mid", "water_stress_days", "heat_days_1", "heat_days_2", "bare_months",
           "soil_water_at_sowing_frac", "min_winter_tmin_no_snow")
FULL_DAYS = 12784  # 1991-01-01 .. 2025-12-31


def crop_status(P: Params) -> dict:
    """Per crop: computable or the list of missing parameters (empty cells with status todo)."""
    out = {}
    for c in ALL_CROPS:
        need = ["zr_max_m"] if c == FALLOW else NEED
        miss = [n for n in need if P.get(c, n) is None]
        if c != FALLOW:
            miss += P.sowing_missing(c)
        heat = [n for n in ("heat_tmax_1_c", "heat_basis", "heat_start", "heat_end") if P.get(c, n, str) is None]
        out[c] = {"computable": P.supported(c), "missing": miss, "heat_missing": [] if c == FALLOW else heat}
    return out


def read_cell(path: Path) -> tuple[pd.DataFrame, float, float]:
    head = path.read_text().split("\n", 1)[0]
    lat = float(head.split("lat=")[1].split()[0])
    elev = float(head.split("elevation_m=")[1].split()[0])
    df = pd.read_csv(path, comment="#", index_col=0, parse_dates=True)
    return df, lat, elev


def build_cell(df: pd.DataFrame, lat: float, elev: float, years=YEARS) -> dict:
    """Pair metrics of one cell: {soil: {'prev>cur': {'year': [...], metric: [...]}}}."""
    gaps = int(df.isna().any(axis=1).sum())
    df = df.interpolate(limit=3, limit_area="inside")  # isolated missing days only (1 day of radiation, 1991-01-24, seen)
    if df.isna().any().any():
        raise ValueError("missing data that cannot be filled")
    P = Params(load_crops())
    model = load_params(PARAMS / "model.csv", ["parameter"])
    soils = load_params(PARAMS / "soils.csv", ["soil", "parameter"])
    ze, ddf = get_value(model, {"parameter": "ze_m"}), get_value(model, {"parameter": "snow_ddf"})
    crops = [c for c in ALL_CROPS if P.supported(c)]
    df = df.join(point_eto(df, lat, elev))
    clim = Climate(df, snow_store(df["PRECTOTCORR"], (df["T2M_MAX"] + df["T2M_MIN"]) / 2, ddf))
    res = {}
    for soil in SOILS:
        g = lambda n: get_value(soils, {"soil": soil, "parameter": n})
        bare = bare_kc_daily(df["ETO_PM"], clim.snow["water_in"], g("theta_fc"), g("theta_wp"), g("rew_mm"), ze)
        for prev, cur in product(crops, crops):
            cols = {"year": [], **{m: [] for m in METRICS}}
            for y in years:
                r = compute_pair(prev, cur, y, clim, bare, {"awc": g("awc_m3m3") * 1000}, P, ze)
                if r is None:
                    continue
                cols["year"].append(y)
                for m in METRICS:
                    v = r[0][m]
                    cols[m].append(None if v is None else round(float(v), 3))
            res.setdefault(soil, {})[f"{prev}>{cur}"] = cols
    return {"soils": res, "filled_gap_days": gaps}


def _stale(out: Path, raw: Path, deps: list[Path]) -> bool:
    return not out.exists() or out.stat().st_mtime < max(p.stat().st_mtime for p in [raw, *deps])


def _job(args):
    raw, = args
    t = time.time()
    df, lat, elev = read_cell(raw)
    cid = raw.stem
    if len(df) != FULL_DAYS:
        return cid, None, f"incomplete ({len(df)} days)"
    try:
        res = build_cell(df, lat, elev)
    except ValueError as e:
        return cid, None, str(e)
    res.update(id=cid, lat=lat, lon=float(cid.split("_")[1]), elevation_m=elev)
    for d in OUT_DIRS:
        (d / "rotations").mkdir(parents=True, exist_ok=True)
        (d / "rotations" / f"{cid}.json").write_text(json.dumps(res, separators=(",", ":")))
    return cid, time.time() - t, None


def index_doc(cells: list[str], P: Params) -> dict:
    soils = load_params(PARAMS / "soils.csv", ["soil", "parameter"])
    cfg = yaml.safe_load((PARAMS / "rotations.yaml").read_text())
    soil_rows = [{"soil": r.soil, "parameter": r.parameter, "value": r.value, "unit": r.unit, "source": r.source, "status": r.status}
                 for r in soils.itertuples()]
    return {
        "generated": time.strftime("%Y-%m-%d"),
        "cells": sorted(cells),
        "years": [YEARS[0], YEARS[-1]],
        "soils": list(SOILS),
        "crops": crop_status(P),
        "candidates": cfg["rotations"],
        "kmu_164": cfg["kmu_164"],
        "soil_params": soil_rows,
        "snow": "Snow from the temperature-based degree-day store (snow_ddf in params/model.csv, estimate); POWER snow depth is not downloaded for the grid.",
        "source": "NASA POWER daily 1991-2025 (cell centre), FAO-56 Penman-Monteith ETo, FAO-56 Ch. 8 single bucket; parameters in data/params/",
        "status": "estimate",
    }


def write_index() -> int:
    done = sorted(p.stem for p in (OUT_DIRS[0] / "rotations").glob("*.json")) if (OUT_DIRS[0] / "rotations").exists() else []
    doc = index_doc(done, Params(load_crops()))
    for d in OUT_DIRS:
        (d / "rotations_grid.json").write_text(json.dumps(doc, indent=1))
    return len(done)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    raws = sorted(RAW_DIR.glob("*.csv"))
    todo = [r for r in raws if a.force or not (OUT_DIRS[0] / "rotations" / f"{r.stem}.json").exists()]
    if a.limit:
        todo = todo[: a.limit]
    print(f"{len(raws)} raw files, {len(todo)} to compute")
    t0 = time.time()
    with ProcessPoolExecutor(a.workers) as ex:
        for cid, sec, err in ex.map(_job, [(r,) for r in todo]):
            print(f"{cid}: " + (f"skipped, {err}" if err else f"{sec:.1f} s"), flush=True)
    print(f"index: {write_index()} cells; total {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
