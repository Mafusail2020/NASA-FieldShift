"""Loads the processed JSON once at startup. The API never calls NASA."""
import json
from pathlib import Path

import yaml
import pandas as pd

from core.soil_params import load_humus, load_ph, load_salinity
from core.params import get_value, load_params

DATA = Path(__file__).resolve().parents[1] / "data"
PROCESSED = DATA / "processed"
SUPPORTED_CROPS = ("winter_wheat", "maize", "black_fallow")


class Store:
    def __init__(self, processed: Path = PROCESSED, params: Path = DATA / "params"):
        self.meta = json.loads((processed / "meta.json").read_text())
        self.regions = {r["id"]: json.loads((processed / f"{r['id']}.json").read_text()) for r in self.meta["regions"]}
        rot = yaml.safe_load((params / "rotations.yaml").read_text())
        self.alternatives = rot["rotations"]
        self.kmu = {k["crop"]: k for k in rot["kmu_164"]}
        yf = processed / "yields.json"
        self.yields = json.loads(yf.read_text()) if yf.exists() else None
        self.prices = pd.read_csv(params / "prices.csv", dtype=str, keep_default_na=False)
        self.k = pd.read_csv(params / "k_predecessor.csv", dtype=str, keep_default_na=False)
        self.salt, self.ph, self.humus = load_salinity(params / "salinity.csv"), load_ph(params / "ph.csv"), load_humus(params / "humus.csv")
        model = load_params(params / "model.csv", ["parameter"])
        self.soil_model = {n: get_value(model, {"parameter": p}) for n, p in (
            ("exclude_below", "salt_exclude_below"), ("gypsum_shift", "salt_gypsum_shift_dsm"), ("layer_mass", "plough_layer_mass_t_ha"))}

    def yhat(self, region: str, crop: str) -> dict[int, float]:
        return {int(y): v for y, v in (self.yields or {}).get("yhat", {}).get(f"{region}|{crop}", {}).items()}


store = Store()
