"""Load and validate data/params/crops.csv (one row per crop parameter, each with source and status)."""
from pathlib import Path

import pandas as pd

CROPS_CSV = Path(__file__).resolve().parents[1] / "data" / "params" / "crops.csv"
COLUMNS = ["crop", "parameter", "value", "unit", "source", "status"]
STATUSES = {"data", "literature", "estimate", "todo"}
CROPS = {"winter_wheat", "maize", "sunflower", "pea", "black_fallow", "green_manure_fallow"}


def load_crops(path: Path = CROPS_CSV) -> pd.DataFrame:
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    missing = [c for c in COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"crops.csv: missing columns {missing}")
    errors = []
    for i, r in df.iterrows():
        where = f"row {i + 2} ({r.crop}.{r.parameter})"
        if r.crop not in CROPS:
            errors.append(f"{where}: unknown crop")
        if r.status not in STATUSES:
            errors.append(f"{where}: invalid status {r.status!r}")
        if r.value == "" and r.status != "todo":
            errors.append(f"{where}: empty value must have status=todo")
        if r.value != "" and r.status != "todo" and r.source == "":
            errors.append(f"{where}: value without source")
    dup = df[df.duplicated(["crop", "parameter"], keep=False)]
    errors += [f"duplicate {c}.{p}" for c, p in dup[["crop", "parameter"]].drop_duplicates().itertuples(index=False)]
    if errors:
        raise ValueError("crops.csv invalid:\n" + "\n".join(errors))
    return df


def todo_cells(df: pd.DataFrame) -> pd.DataFrame:
    return df[df.status == "todo"][["crop", "parameter", "value", "source"]]


if __name__ == "__main__":
    t = todo_cells(load_crops())
    print(t.to_string(index=False))
    print(f"\n{len(t)} todo cells ({(t.value == '').sum()} empty)")
