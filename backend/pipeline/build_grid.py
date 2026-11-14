"""Fetch NASA POWER for every 0.5 x 0.625 degree cell that touches Ukraine and write annual climate per cell.

No oblast split: cells are the native POWER (MERRA-2) grid. Raw daily files go to data/raw/power_grid/ (not committed,
resumable). The summary goes to data/processed/grid.json and frontend/public/data/grid.json.
POLICY: cells are NOT bulk-generated any more. A cell is generated only when a location is not covered by the existing
grid: use `python -m pipeline.add_cell LAT LON`, which calls add_to_grid() below for that one cell.
The old bulk run over every Ukraine cell needs the explicit flag: python -m pipeline.build_grid --all [--limit N] [--reverse]
(existing raw files are skipped, so it only fetches missing cells).
"""
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

from pipeline.add_eto import point_eto
from pipeline.fetch_power import PARAMS, fetch_point, parse_power

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "backend" / "data" / "raw" / "power_grid"
OUT_FILES = [ROOT / "backend" / "data" / "processed" / "grid.json", ROOT / "frontend" / "public" / "data" / "grid.json"]
OUTLINES = ROOT / "frontend" / "public" / "data" / "ua_oblasts.geojson"
LAT_STEP, LON_STEP = 0.5, 0.625  # MERRA-2 grid: cell centres at multiples of these (checked against POWER responses)
GRID_PARAMS = [p for p in PARAMS if p != "SNODP"]  # snow depth is not needed for annual climate
WORKERS = 4


def _inside(ring, x, y):
    ok = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            ok = not ok
    return ok


def _in_ukraine(polys, lon, lat):
    return any(_inside(ring, lon, lat) for poly in polys for ring in poly[:1])


def ukraine_cells() -> list[tuple[float, float]]:
    """Centres (lat, lon) of cells with at least one of 9 sample points inside the Ukraine outlines (incl. occupied oblasts)."""
    polys = []
    for f in json.loads(OUTLINES.read_text())["features"]:
        g = f["geometry"]
        polys += g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    cells = []
    for i in range(int(43 / LAT_STEP), int(54 / LAT_STEP) + 1):
        for j in range(int(21 / LON_STEP), int(42 / LON_STEP) + 1):
            lat, lon = i * LAT_STEP, j * LON_STEP
            samples = [(lon + dx * LON_STEP / 2.2, lat + dy * LAT_STEP / 2.2) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]
            if any(_in_ukraine(polys, x, y) for x, y in samples):
                cells.append((round(lat, 3), round(lon, 3)))
    return cells


def raw_path(lat, lon) -> Path:
    return RAW_DIR / f"{lat}_{lon}.csv"


def fetch_cell(cell):
    lat, lon = cell
    path = raw_path(lat, lon)
    if path.exists():
        return
    payload = fetch_point(lat, lon, params=GRID_PARAMS)
    df, units = parse_power(payload)
    elev = payload["geometry"]["coordinates"][2]
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w") as f:
        f.write(f"# lat={lat} lon={lon} elevation_m={elev} units={units}\n")
        df.to_csv(f)
    tmp.rename(path)


def annual(cell) -> dict:
    lat, lon = cell
    path = raw_path(lat, lon)
    elev = float(path.read_text().split("\n", 1)[0].split("elevation_m=")[1].split()[0])
    df = pd.read_csv(path, comment="#", index_col=0, parse_dates=True)
    df = df.join(point_eto(df, lat, elev))
    df["TMEAN"] = (df["T2M_MAX"] + df["T2M_MIN"]) / 2  # approximation of the daily mean
    years = list(range(1991, 2026))

    def per_year(series, how):
        g = series.groupby(series.index.year)
        out = getattr(g, how)()
        n = g.count()
        full = n.index.map(lambda y: n[y] == (366 if y % 4 == 0 else 365))
        return [round(float(out[y]), 1) if y in out.index and full[list(n.index).index(y)] else None for y in years]

    july = df.loc[df.index.month == 7, "T2M_MAX"]
    jg = july.groupby(july.index.year)
    return {
        "id": f"{lat}_{lon}", "lat": lat, "lon": lon, "elevation_m": round(elev, 1),
        "precip_mm": per_year(df["PRECTOTCORR"], "sum"),
        "eto_mm": per_year(df["ETO_PM"], "sum"),
        "tmean_c": per_year(df["TMEAN"], "mean"),
        "july_tmax_c": [round(float(jg.mean()[y]), 1) if y in jg.mean().index and jg.count()[y] == 31 else None for y in years],
    }


def cell_center(lat: float, lon: float) -> tuple[float, float]:
    """Centre of the POWER cell that contains (lat, lon): cells are centred on multiples of 0.5 and 0.625 degrees."""
    return round(round(lat / LAT_STEP) * LAT_STEP, 3), round(round(lon / LON_STEP) * LON_STEP, 3)


def load_grid_doc() -> dict | None:
    return json.loads(OUT_FILES[0].read_text()) if OUT_FILES[0].exists() else None


def is_covered(doc: dict | None, lat: float, lon: float) -> bool:
    """True when an existing grid cell contains the point."""
    if not doc:
        return False
    la, lo = cell_center(lat, lon)
    return any(c["id"] == f"{la}_{lo}" for c in doc["cells"])


def add_to_grid(cells: list[tuple[float, float]]) -> None:
    """Fetch the raw POWER series of the given cells (skipped when already on disk) and merge them into grid.json."""
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    doc = load_grid_doc() or {
        "cell_size_deg": [LAT_STEP, LON_STEP], "years": list(range(1991, 2026)), "cells": [],
        "source": "NASA POWER daily, community AG, 1991-2025 (MERRA-2 grid, 0.5 x 0.625 deg); ETo = FAO-56 Penman-Monteith (core/eto.py); "
                  "tmean = (Tmax+Tmin)/2; a year with any missing day is null",
        "status": "data",
    }
    have = {c["id"] for c in doc["cells"]}
    for cell in cells:
        if f"{cell[0]}_{cell[1]}" in have:
            continue
        fetch_cell(cell)
        doc["cells"].append(annual(cell))
    doc["cells"].sort(key=lambda c: (c["lat"], c["lon"]))
    for out in OUT_FILES:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(doc, separators=(",", ":")))


def main():
    if "--all" not in sys.argv:
        print("Bulk generation is switched off: cells are only generated for locations the grid does not cover.\n"
              "Add one with: python -m pipeline.add_cell LAT LON   (or pass --all to fetch every missing Ukraine cell)")
        return
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    cells = ukraine_cells()
    print(f"{len(cells)} cells touch Ukraine")
    todo = cells[:limit] if limit else cells
    fetch_order = todo[::-1] if "--reverse" in sys.argv else todo
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    start, done = time.time(), 0
    with ThreadPoolExecutor(WORKERS) as ex:
        for _ in ex.map(fetch_cell, fetch_order):
            done += 1
            if done % 10 == 0:
                print(f"{done}/{len(todo)} fetched, {(time.time() - start) / 60:.1f} min", flush=True)
    doc = {
        "cell_size_deg": [LAT_STEP, LON_STEP], "years": list(range(1991, 2026)),
        "cells": [annual(c) for c in todo],
        "source": "NASA POWER daily, community AG, 1991-2025 (MERRA-2 grid, 0.5 x 0.625 deg); ETo = FAO-56 Penman-Monteith (core/eto.py); "
                  "tmean = (Tmax+Tmin)/2; a year with any missing day is null",
        "status": "data",
    }
    for out in OUT_FILES:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(doc, separators=(",", ":")))
    print(f"wrote grid.json with {len(doc['cells'])} cells")


if __name__ == "__main__":
    main()
