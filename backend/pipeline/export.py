"""Write data/processed/<oblast>.json and meta.json, and copy them to frontend/public/data/ (offline fallback).

Every value block carries `source` and `status`. Run by hand: python -m pipeline.export
"""
import json
import shutil
from pathlib import Path

import pandas as pd
import yaml

from core.crops import load_crops
from core.params import load_params
from pipeline.add_eto import OUT_DIR
from pipeline.fetch_power import OBLASTS

NAMES = {"vinnytska": ("Vinnytsia oblast", "Вінницька область"), "poltavska": ("Poltava oblast", "Полтавська область"),
         "kirovohradska": ("Kirovohrad oblast", "Кіровоградська область"), "odeska": ("Odesa oblast", "Одеська область")}
FRONT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "data"
PARAMS = OUT_DIR.parent / "params"

LIMITATIONS = [
    "Effects of crops two or more years back are not modelled.",
    "Runoff from frozen ground and surface runoff are not modelled.",
    "Climate is the mean of 3-4 NASA POWER grid points per oblast (cells about 0.5 x 0.625 degrees); analysis is for the oblast, not a field.",
    "Sunflower and pea are not computed yet: no verified sowing rules.",
    "Heat stress is only computed where a heat window is set; frost is not computed (thresholds todo).",
    "Winter wheat uses the 335-day FAO-56 Table 11 row (Idaho); harvest dates are later than typical Ukrainian harvest.",
    "Water balance starts each pair at field capacity at the previous crop's sowing.",
]


def main():
    FRONT.mkdir(parents=True, exist_ok=True)
    pts = pd.read_csv(OUT_DIR.parent / "raw" / "power" / "points.csv")
    for name in OBLASTS:
        df = pd.read_csv(OUT_DIR / f"{name}_climate.csv", index_col=0, parse_dates=True)
        g = df.groupby(df.index.year)
        jul = df[df.index.month == 7].groupby(df[df.index.month == 7].index.year)["T2M_MAX"].mean()
        climate = {"years": [int(y) for y in g.size().index], "precip_mm": g["PRECTOTCORR"].sum().round(1).tolist(),
                   "eto_mm": g["ETO_PM"].sum().round(1).tolist(), "july_tmax_c": jul.round(2).tolist(),
                   "source": "NASA POWER daily, community AG, 1991-2025; mean of grid points; ETo FAO-56 Penman-Monteith",
                   "status": "data"}
        doc = {"id": name, "name_en": NAMES[name][0], "name_uk": NAMES[name][1],
               "points": pts[pts.oblast == name][["lat", "lon", "elevation_m"]].to_dict("records"),
               "climate": climate, "pairs": json.loads((OUT_DIR / "pairs" / f"{name}.json").read_text())}
        (OUT_DIR / f"{name}.json").write_text(json.dumps(doc))
        shutil.copy(OUT_DIR / f"{name}.json", FRONT / f"{name}.json")
    crops = load_crops()
    rot = yaml.safe_load((PARAMS / "rotations.yaml").read_text())
    meta = {"crops": crops.to_dict("records"), "soils": load_params(PARAMS / "soils.csv", ["soil", "parameter"]).to_dict("records"),
            "model": load_params(PARAMS / "model.csv", ["parameter"]).to_dict("records"),
            "rotations": rot["rotations"], "kmu_164": rot["kmu_164"], "limitations": LIMITATIONS,
            "regions": [{"id": k, "name_en": v[0], "name_uk": v[1]} for k, v in NAMES.items()]}
    (OUT_DIR / "meta.json").write_text(json.dumps(meta))
    shutil.copy(OUT_DIR / "meta.json", FRONT / "meta.json")
    print("exported", list(NAMES), "->", FRONT)


if __name__ == "__main__":
    main()
