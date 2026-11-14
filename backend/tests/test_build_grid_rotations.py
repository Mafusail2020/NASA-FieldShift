import numpy as np
import pandas as pd

from core.crops import load_crops
from core.pairs import Params
from pipeline.build_grid_rotations import SOILS, build_cell, crop_status


def synthetic() -> pd.DataFrame:
    idx = pd.date_range("1991-01-01", "2025-12-31")
    s = np.sin(2 * np.pi * (idx.dayofyear.to_numpy() - 110) / 365.25)
    return pd.DataFrame({"T2M_MAX": 11 + 14 * s, "T2M_MIN": 3 + 12 * s, "T2MDEW": 1 + 11 * s, "WS2M": 2.5,
                         "ALLSKY_SFC_SW_DWN": 12 + 9 * s, "PRECTOTCORR": np.where(idx.day % 3 == 0, 3.0, 0.0)}, index=idx)


def test_build_cell_structure_and_gap_fill():
    df = synthetic()
    df.loc["1991-01-24", "ALLSKY_SFC_SW_DWN"] = np.nan  # the one-day gap seen in real POWER files
    out = build_cell(df, 50.0, 150.0, years=range(1996, 1998))
    assert out["filled_gap_days"] == 1
    assert set(out["soils"]) == set(SOILS)
    pairs = out["soils"]["medium"]
    assert len(pairs) == 9 and "winter_wheat>maize" in pairs and "black_fallow>black_fallow" in pairs
    p = pairs["black_fallow>winter_wheat"]
    assert p["year"] == [1996, 1997]
    assert all(0 <= k <= 1 for k in p["mean_ks_mid"])
    assert all(v is None for v in pairs["winter_wheat>black_fallow"]["mean_ks_mid"])  # fallow has no crop Ks
    assert all(h is not None for h in p["heat_days_1"])  # wheat heat window is set in params


def test_uncomputable_crops_list_missing_parameters():
    st = crop_status(Params(load_crops()))
    assert st["winter_wheat"]["computable"] and st["black_fallow"]["computable"]
    assert not st["sunflower"]["computable"] and "sowing_temp_c" in st["sunflower"]["missing"]
    assert not st["pea"]["computable"]
