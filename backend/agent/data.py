"""Read-only access to the processed data for the agent tools. Loaded lazily and cached; never calls NASA."""
from __future__ import annotations

import json
from functools import cached_property
from pathlib import Path

import pandas as pd

DATA = Path(__file__).resolve().parents[1] / "data"
PROCESSED = DATA / "processed"
PARAMS = DATA / "params"
RAW_CROPS = DATA / "raw" / "crops"


class DataAccess:
    @cached_property
    def grid(self) -> dict:
        d = json.loads((PROCESSED / "grid.json").read_text())
        return {"years": d["years"], "source": d["source"], "status": d["status"], "cells": {c["id"]: c for c in d["cells"]}}

    @cached_property
    def layers(self) -> dict:
        return json.loads((PROCESSED / "grid_layers.json").read_text())

    @cached_property
    def soil(self) -> dict:
        d = json.loads((PROCESSED / "grid_soil.json").read_text())
        return {"source": d["source"], "status": d["status"], "cells": {c["id"]: c for c in d["cells"]}}

    @cached_property
    def rotations_grid(self) -> dict:
        return json.loads((PROCESSED / "rotations_grid.json").read_text())

    def rotation_cell(self, cell_id: str) -> dict | None:
        f = PROCESSED / "rotations" / f"{cell_id}.json"
        return json.loads(f.read_text()) if f.exists() else None

    @cached_property
    def crops_csv(self) -> pd.DataFrame:
        return pd.read_csv(PARAMS / "crops.csv", dtype=str, keep_default_na=False)

    @cached_property
    def ecocrop(self) -> pd.DataFrame:
        return pd.read_csv(RAW_CROPS / "ecocrop_crops.csv", dtype=str, keep_default_na=False)

    @cached_property
    def faostat(self) -> pd.DataFrame:
        return pd.read_csv(RAW_CROPS / "faostat_ukraine_crops.csv")

    @cached_property
    def kmu(self) -> dict[str, dict]:
        import yaml
        return {k["crop"]: k for k in yaml.safe_load((PARAMS / "rotations.yaml").read_text())["kmu_164"]}


data = DataAccess()
