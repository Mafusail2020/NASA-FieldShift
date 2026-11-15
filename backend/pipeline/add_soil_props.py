"""Add soil pH (water) and organic carbon / humus to ONE grid cell of grid_soil.json (prefill for the soil analysis inputs).

Not a bulk job: like add_cell, it works on the cell that contains the given location and does nothing when that cell already has
the values. SoilGrids 2.0 phh2o (pH in water, pH*10) and soc (dg/kg), 0-30 cm thickness-weighted mean of 0-5, 5-15 and 15-30 cm,
read at the point the texture was read (`sampled_at`, else the cell centre, else the same fallback points as fetch_soil).
Humus % = organic carbon % x 1.724 (van Bemmelen factor, the usual conversion; an assumption, status estimate).
SoilGrids cannot give salinity (ECe): that stays for the farmer to enter.
Raw answers are cached in data/raw/soilgrids_props/ (not committed). Run by hand from backend/: python -m pipeline.add_soil_props LAT LON
"""
import json
import sys
import time

import requests

from pipeline import build_grid
from pipeline.fetch_soil import API, DEPTHS, OFFSETS, OUT_FILES, ROOT

RAW_DIR = ROOT / "backend" / "data" / "raw" / "soilgrids_props"
VAN_BEMMELEN = 1.724
SOURCE = ("ISRIC SoilGrids 2.0 (Poggio et al. 2021, SOIL 7:217-240), phh2o (pH in water) and soc (organic carbon), 250 m machine-learning "
          "prediction, 0-30 cm thickness-weighted mean; humus % = organic carbon % x 1.724 (van Bemmelen factor, assumption). "
          "Not a field analysis: SoilGrids pH and carbon have large errors, and salinity is not predicted at all.")


def query(lat: float, lon: float) -> dict:
    lat, lon = round(lat, 3), round(lon, 3)
    path = RAW_DIR / f"{lat}_{lon}.json"
    if path.exists():
        return json.loads(path.read_text())
    q = [("lon", lon), ("lat", lat), ("value", "mean")] + [("property", p) for p in ("phh2o", "soc")] + [("depth", d) for d in DEPTHS]
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
    """{'ph': pH, 'soc_g_kg': g/kg} as 0-30 cm thickness-weighted means, or None when any depth has no prediction."""
    out = {}
    for layer in doc["properties"]["layers"]:
        got = [(DEPTHS[d["label"]], d["values"]["mean"]) for d in layer["depths"] if d["values"]["mean"] is not None]
        if len(got) != len(DEPTHS):
            return None
        out[layer["name"]] = sum(t * v for t, v in got) / sum(t for t, _ in got) / layer["unit_measure"]["d_factor"]
    return {"ph": out["phh2o"], "soc_g_kg": out["soc"]} if {"phh2o", "soc"} <= out.keys() else None


def summarize(vals: dict) -> dict:
    return {"ph": round(vals["ph"], 1), "soc_g_kg": round(vals["soc_g_kg"], 1), "humus_pct": round(vals["soc_g_kg"] / 10 * VAN_BEMMELEN, 2)}


def fill(lat: float, lon: float) -> str:
    cell = build_grid.cell_center(lat, lon)
    cid = f"{cell[0]}_{cell[1]}"
    if not build_grid.is_covered(build_grid.load_grid_doc(), lat, lon):
        return f"cell {cid} is not in the grid: run pipeline.add_cell first"
    doc = json.loads(OUT_FILES[0].read_text())
    rec = next((c for c in doc["cells"] if c["id"] == cid), None)
    if rec is None:
        return f"cell {cid} has no soil record: run pipeline.fetch_soil first"
    if "ph" in rec:
        return f"cell {cid} already has pH and humus, nothing fetched"
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    first = tuple(rec["sampled_at"]) if "sampled_at" in rec else cell
    points = [first] + [(cell[0] + a, cell[1] + b) for a, b in OFFSETS if (cell[0] + a, cell[1] + b) != first]
    found = None
    for p in points:
        vals = values(query(*p))
        if vals:
            found = (p, vals)
            break
    if found is None:
        rec.update(ph=None, humus_pct=None, props_reason="no SoilGrids prediction nearby")
    else:
        rec.update(summarize(found[1]))
        if abs(found[0][0] - cell[0]) > 1e-9 or abs(found[0][1] - cell[1]) > 1e-9:
            rec["props_sampled_at"] = [round(found[0][0], 3), round(found[0][1], 3)]
    doc["props_source"], doc["props_status"] = SOURCE, "estimate"
    for f in OUT_FILES:
        f.write_text(json.dumps(doc, separators=(",", ":")))
    return f"cell {cid}: " + (f"pH {rec['ph']}, humus {rec['humus_pct']} %" if found else "no prediction nearby")


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    print(fill(float(sys.argv[1]), float(sys.argv[2])))


if __name__ == "__main__":
    main()
