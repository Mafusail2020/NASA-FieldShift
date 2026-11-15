"""Load and validate data/params/crops.csv (one row per crop parameter, each with source and status)."""
from pathlib import Path

import pandas as pd

from core.params import load_params
from core.params import todo_cells as _todo

CROPS_CSV = Path(__file__).resolve().parents[1] / "data" / "params" / "crops.csv"
COLUMNS = ["crop", "parameter", "value", "unit", "source", "status"]
CROPS = {"winter_wheat", "maize", "sunflower", "pea", "soybean", "winter_rapeseed", "winter_barley", "spring_barley",
         "sugar_beet", "buckwheat", "millet", "oats", "black_fallow", "green_manure_fallow", "spring_wheat"}
# Species that appear only in the soil tables (salinity, pH): intermediate green manure or fallow green manure.
GREEN_MANURES = {"winter_rye", "white_mustard", "oilseed_radish", "spring_vetch", "hairy_vetch", "narrow_leaf_lupin",
                 "white_sweet_clover", "red_clover"}


def load_crops(path: Path = CROPS_CSV) -> pd.DataFrame:
    return load_params(path, ["crop", "parameter"], {"crop": CROPS})


def todo_cells(df: pd.DataFrame) -> pd.DataFrame:
    return _todo(df, ["crop", "parameter"])


if __name__ == "__main__":
    t = todo_cells(load_crops())
    print(t.to_string(index=False))
    print(f"\n{len(t)} todo cells ({(t.value == '').sum()} empty)")
