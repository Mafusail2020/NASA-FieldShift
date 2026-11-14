"""Loads the processed JSON once at startup. The API never calls NASA."""
import json
from pathlib import Path

import yaml

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


store = Store()
