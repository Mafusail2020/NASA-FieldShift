from datetime import date

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app
from core.twin import COLS, find_twins


def synth(years=range(1990, 2027), seed=0, last=date(2026, 12, 31)):
    rng = np.random.default_rng(seed)
    idx = pd.date_range(f"{years[0]}-01-01", last)
    doy = idx.dayofyear.to_numpy()
    base = 10 + 12 * np.sin((doy - 110) / 365 * 2 * np.pi)
    return pd.DataFrame({"T2M_MAX": base + 5 + rng.normal(0, 1, len(idx)), "T2M_MIN": base - 5 + rng.normal(0, 1, len(idx)),
                         "ALLSKY_SFC_SW_DWN": 12 + 8 * np.sin((doy - 80) / 365 * 2 * np.pi) + rng.normal(0, 1, len(idx)),
                         "PRECTOTCORR": rng.exponential(1.5, len(idx))}, index=idx)[COLS]


def test_planted_twin_is_found():
    df = synth()
    # make 2026 spring an exact copy of 2007 spring: 2007 must be the best match
    a, b = df.loc["2026-04-25":"2026-07-04"].index, df.loc["2007-04-25":"2007-07-04"]
    df.loc[a, COLS] = b.to_numpy()
    r = find_twins(df, "maize", "04-25", 2026, as_of=date(2026, 7, 4))
    assert r["status"] == "ok" and r["twins"][0]["year"] == 2007 and r["twins"][0]["distance"] < 0.05


def test_current_year_excluded_and_k_results():
    r = find_twins(synth(), "maize", "04-25", 2026, as_of=date(2026, 7, 4))
    assert 2026 not in [t["year"] for t in r["twins"]] and len(r["twins"]) == 3
    assert r["twins"][0]["distance"] <= r["twins"][1]["distance"] <= r["twins"][2]["distance"]


def test_too_early():
    r = find_twins(synth(), "maize", "04-25", 2026, as_of=date(2026, 5, 10))
    assert r["status"] == "too_early"


def test_winter_crop_crosses_year_boundary():
    r = find_twins(synth(), "winter_wheat", "10-01", 2026, as_of=date(2026, 4, 1))
    assert r["status"] == "ok" and r["twins"][0]["sowing"].endswith("-10-01") and int(r["twins"][0]["sowing"][:4]) == r["twins"][0]["year"] - 1


def test_season_complete_has_no_next30():
    r = find_twins(synth(), "maize", "04-25", 2026, as_of=date(2026, 12, 1))
    assert r["twins"][0]["next30_rain_mm"] is None


def test_api_errors():
    c = TestClient(app)
    assert c.get("/api/twin", params={"lat": 49.8, "lon": 24, "crop": "sunflower", "sowing": "2026-04-25"}).status_code == 422
    assert c.get("/api/twin", params={"lat": 10, "lon": 10, "crop": "maize", "sowing": "2026-04-25"}).status_code == 404
