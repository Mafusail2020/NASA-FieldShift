"""Load params/salinity.csv, ph.csv, humus.csv (long format, one value per row, with source and status).

Missing or todo values read as None: the caller reports 'no data' and never substitutes 1.0 silently.
"""
from pathlib import Path

import pandas as pd

from core.crops import CROPS, GREEN_MANURES
from core.humus import HumusCrop
from core.params import load_params, todo_cells

PARAMS = Path(__file__).resolve().parents[1] / "data" / "params"
SPECIES = CROPS | GREEN_MANURES
KEY = ["species", "parameter"]
PH_NAMES = ("ph_min", "ph_opt_low", "ph_opt_high", "ph_max")
HUMUS_NAMES = ("res_a", "res_b", "root_c", "root_d", "k_humif", "mineral_t_ha")


def _load(name: str, path: Path | None) -> pd.DataFrame:
    return load_params(path or PARAMS / name, KEY, {"species": SPECIES})


def load_salinity(path: Path | None = None) -> pd.DataFrame:
    return _load("salinity.csv", path)


def load_ph(path: Path | None = None) -> pd.DataFrame:
    return _load("ph.csv", path)


def load_humus(path: Path | None = None) -> pd.DataFrame:
    return _load("humus.csv", path)


def todo(df: pd.DataFrame) -> pd.DataFrame:
    return todo_cells(df, KEY)


def _row(df: pd.DataFrame, species: str, name: str):
    m = df[(df.species == species) & (df.parameter == name)]
    return m.iloc[0] if len(m) else None


def _num(df, species, name):
    r = _row(df, species, name)
    return None if r is None or r.value == "" else float(r.value)


def _meta(df, species, names) -> dict:
    """Worst status and the source of the first row of a parameter group."""
    rows = [r for n in names if (r := _row(df, species, n)) is not None]
    order = {"data": 0, "literature": 1, "estimate": 2, "todo": 3}
    return {"status": max((r.status for r in rows), key=order.get) if rows else "todo",
            "source": rows[0].source if rows else "No row in the table"}


def salt_params(df: pd.DataFrame, species: str) -> dict | None:
    """{'a', 'b', 'low_confidence', 'status', 'source'} or None when a/b are not set."""
    a, b = _num(df, species, "a"), _num(df, species, "b")
    if a is None or b is None:
        return None
    return {"a": a, "b": b, "low_confidence": bool(_num(df, species, "low_confidence")), **_meta(df, species, ("a", "b"))}


def ph_params(df: pd.DataFrame, species: str) -> dict | None:
    v = [_num(df, species, n) for n in PH_NAMES]
    if any(x is None for x in v):
        return None
    return {"limits": tuple(v), **_meta(df, species, PH_NAMES)}


def humus_params(df: pd.DataFrame, species: str) -> tuple[HumusCrop, dict] | None:
    v = [_num(df, species, n) for n in HUMUS_NAMES]
    if any(x is None for x in v):
        return None
    return HumusCrop(*v), _meta(df, species, HUMUS_NAMES)
