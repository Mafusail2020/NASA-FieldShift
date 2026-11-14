"""Soil texture per grid cell from ISRIC SoilGrids 2.0 (no oblast split) and the light/medium/heavy preset it maps to.

For every NASA POWER cell centre: clay, sand and silt (g/kg, mean prediction) at 0-5, 5-15 and 15-30 cm, averaged over
0-30 cm by layer thickness, classified with the USDA texture triangle, then mapped to the three presets of params/soils.csv.
SoilGrids is a machine-learning prediction at 250 m, read at the cell centre (or, if the centre is built-up or water,
at the first of 12 other points inside the cell): it is not a field analysis.
Raw answers are cached in data/raw/soilgrids/ (not committed), so the script is re-runnable.
Writes frontend/public/data/grid_soil.json (+ copy in data/processed/).
Run by hand from backend/: python -m pipeline.fetch_soil   (adds only cells missing from grid_soil.json)
"""
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

from pipeline.build_grid import ROOT, ukraine_cells

API = "https://rest.isric.org/soilgrids/v2.0/properties/query"
RAW_DIR = ROOT / "backend" / "data" / "raw" / "soilgrids"
OUT_FILES = [ROOT / "backend" / "data" / "processed" / "grid_soil.json", ROOT / "frontend" / "public" / "data" / "grid_soil.json"]
DEPTHS = {"0-5cm": 5, "5-15cm": 10, "15-30cm": 15}  # label -> thickness, cm
WORKERS = 4

# Our choice (status estimate): coarse textures -> light, clay-rich textures -> heavy, the rest -> medium.
PRESET = {"sand": "light", "loamy sand": "light", "sandy loam": "light",
          "clay": "heavy", "silty clay": "heavy", "sandy clay": "heavy"}


def usda_texture(sand: float, silt: float, clay: float) -> str:
    """USDA texture class from percentages (sum about 100)."""
    if silt + 1.5 * clay < 15:
        return "sand"
    if silt + 2 * clay < 30:
        return "loamy sand"
    if (7 <= clay < 20 and sand > 52) or (clay < 7 and silt < 50):
        return "sandy loam"
    if 7 <= clay < 27 and 28 <= silt < 50 and sand <= 52:
        return "loam"
    if (silt >= 50 and 12 <= clay < 27) or (50 <= silt < 80 and clay < 12):
        return "silt loam"
    if silt >= 80 and clay < 12:
        return "silt"
    if 20 <= clay < 35 and silt < 28 and sand > 45:
        return "sandy clay loam"
    if 27 <= clay < 40 and sand <= 20:
        return "silty clay loam"
    if 27 <= clay < 40 and 20 < sand <= 45:
        return "clay loam"
    if clay >= 35 and sand > 45:
        return "sandy clay"
    if clay >= 40 and silt >= 40:
        return "silty clay"
    if clay >= 40:
        return "clay"
    return "loam"  # remaining gaps of the triangle at class edges


# SoilGrids has no value on built-up or water pixels. When the cell centre has none, the first of these points (all inside the cell) that has a prediction is used.
OFFSETS = [(0.0, 0.0), (0.12, 0.0), (-0.12, 0.0), (0.0, 0.15), (0.0, -0.15),
           (0.2, 0.25), (0.2, -0.25), (-0.2, 0.25), (-0.2, -0.25), (0.22, 0.0), (-0.22, 0.0), (0.0, 0.28), (0.0, -0.28)]


def query(lat: float, lon: float) -> dict:
    lat, lon = round(lat, 3), round(lon, 3)
    path = RAW_DIR / f"{lat}_{lon}.json"
    if path.exists():
        return json.loads(path.read_text())
    q = [("lon", lon), ("lat", lat), ("value", "mean")] + [("property", p) for p in ("clay", "sand", "silt")] + [("depth", d) for d in DEPTHS]
    for attempt in range(6):
        try:
            r = requests.get(API, params=q, timeout=120)
            if r.status_code in (429, 500, 502, 503, 504):
                raise requests.RequestException(str(r.status_code))
            r.raise_for_status()
            doc = r.json()
            path.write_text(json.dumps(doc))
            return doc
        except requests.RequestException:
            time.sleep(5 * 2 ** attempt)
    raise RuntimeError(f"SoilGrids failed for ({lat}, {lon})")


def values(doc) -> dict | None:
    """Thickness-weighted 0-30 cm means in %, or None when any depth has no prediction."""
    vals = {}
    for layer in doc["properties"]["layers"]:
        got = [(DEPTHS[d["label"]], d["values"]["mean"]) for d in layer["depths"] if d["values"]["mean"] is not None]
        if len(got) != len(DEPTHS):
            return None
        vals[layer["name"]] = sum(t * v for t, v in got) / sum(t for t, _ in got) / 10  # g/kg -> %
    return vals


def fetch(cell):
    """First point (centre, then the offsets) that has a prediction: (values, (lat, lon)); (None, None) when none has."""
    for dlat, dlon in OFFSETS:
        point = (cell[0] + dlat, cell[1] + dlon)
        vals = values(query(*point))
        if vals:
            return vals, point
    return None, None


def summarize(cell, found) -> dict:
    vals, point = found
    if vals is None:
        return {"id": f"{cell[0]}_{cell[1]}", "texture": None, "preset": None, "reason": "no SoilGrids prediction nearby (sea, water or built-up)"}
    total = vals["clay"] + vals["sand"] + vals["silt"]
    sand, silt, clay = (vals[k] * 100 / total for k in ("sand", "silt", "clay"))  # normalise the small rounding gap
    tex = usda_texture(sand, silt, clay)
    out = {"id": f"{cell[0]}_{cell[1]}", "clay_pct": round(clay, 1), "sand_pct": round(sand, 1), "silt_pct": round(silt, 1),
           "texture": tex, "preset": PRESET.get(tex, "medium")}
    if abs(point[0] - cell[0]) > 1e-9 or abs(point[1] - cell[1]) > 1e-9:
        out["sampled_at"] = [round(point[0], 3), round(point[1], 3)]  # not the centre: the centre had no prediction
    return out


SOURCE = ("ISRIC SoilGrids 2.0 (Poggio et al. 2021, SOIL 7:217-240), 250 m machine-learning prediction read at the cell centre, or at the first of "
          "12 other points inside the cell when the centre is built-up or water (marked sampled_at); "
          "USDA texture triangle; preset mapping is our rule (sand, loamy sand, sandy loam -> light; clay, silty clay, sandy clay -> heavy; "
          "other classes -> medium)")


def update(cells: list[tuple[float, float]]) -> int:
    """Add soil for cells that are not in grid_soil.json yet (no change for cells already there). Returns how many were added."""
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    doc = json.loads(OUT_FILES[0].read_text()) if OUT_FILES[0].exists() else {
        "depth": "0-30 cm, thickness-weighted mean of 0-5, 5-15, 15-30 cm", "source": SOURCE, "status": "estimate", "cells": []}
    have = {c["id"] for c in doc["cells"]}
    new = [c for c in cells if f"{c[0]}_{c[1]}" not in have]
    with ThreadPoolExecutor(WORKERS) as ex:
        found = list(ex.map(fetch, new))
    doc["cells"] += [summarize(c, f) for c, f in zip(new, found)]
    doc["cells"].sort(key=lambda c: c["id"])
    for f in OUT_FILES:
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(doc, separators=(",", ":")))
    return len(new)


def main():
    """Default: only cells that are in the grid but missing from grid_soil.json. Never enumerates new cells."""
    grid = json.loads((ROOT / "frontend" / "public" / "data" / "grid.json").read_text())
    n = update([(c["lat"], c["lon"]) for c in grid["cells"]])
    print(f"{n} cells added to grid_soil.json")


if __name__ == "__main__":
    main()
