"""Shared loader for data/params/*.csv: long format, one value per row, each with source and status."""
from pathlib import Path

import pandas as pd

STATUSES = {"data", "literature", "estimate", "todo"}
TAIL = ["value", "unit", "source", "status"]


def load_params(path: Path, key_cols: list[str], allowed: dict[str, set] | None = None) -> pd.DataFrame:
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    cols = key_cols + TAIL
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise ValueError(f"{Path(path).name}: missing columns {missing}")
    errors = []
    for i, r in df.iterrows():
        where = f"row {i + 2} ({'.'.join(r[k] for k in key_cols)})"
        for k, ok in (allowed or {}).items():
            if r[k] not in ok:
                errors.append(f"{where}: unknown {k}")
        if r.status not in STATUSES:
            errors.append(f"{where}: invalid status {r.status!r}")
        if r.value == "" and r.status != "todo":
            errors.append(f"{where}: empty value must have status=todo")
        if r.value != "" and r.status != "todo" and r.source == "":
            errors.append(f"{where}: value without source")
    dup = df[df.duplicated(key_cols, keep=False)]
    errors += ["duplicate " + ".".join(k) for k in dup[key_cols].drop_duplicates().itertuples(index=False)]
    if errors:
        raise ValueError(f"{Path(path).name} invalid:\n" + "\n".join(errors))
    return df


def todo_cells(df: pd.DataFrame, key_cols: list[str]) -> pd.DataFrame:
    return df[df.status == "todo"][key_cols + ["value", "source"]]


def get_value(df: pd.DataFrame, key: dict[str, str]) -> float:
    """Numeric value of one row; raises if the row is missing or still todo/empty."""
    m = df
    for k, v in key.items():
        m = m[m[k] == v]
    if len(m) != 1 or m.iloc[0].value == "":
        raise ValueError(f"parameter {key} is missing or empty (status todo)")
    return float(m.iloc[0].value)
