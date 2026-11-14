import numpy as np
import pandas as pd
import pytest

from pipeline.validate import fit, validate_crop


def frame():
    rng = np.random.default_rng(0)
    rows = []
    for ob, a in (("o1", 0.9), ("o2", 1.0), ("o3", 1.1)):
        for y in range(2000, 2012):
            ks = float(rng.uniform(0.3, 1.0))
            rows.append({"oblast": ob, "year": y, "ks": ks, "ratio": a + 0.5 * ks})  # exact: slope 0.5, no noise
    return pd.DataFrame(rows)


def test_fixed_effects_slope_recovered():
    m = fit(frame())
    assert m.params["ks"] == pytest.approx(0.5, abs=1e-9)


def test_leave_one_year_out_runs_for_each_year():
    r = validate_crop(frame())
    assert len(r["loyo"]) == 12 and r["n"] == 36
    assert r["loyo_coef_min"] == pytest.approx(0.5, abs=1e-9) and r["loyo_coef_max"] == pytest.approx(0.5, abs=1e-9)
