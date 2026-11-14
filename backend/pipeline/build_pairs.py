"""Precompute every (previous crop -> crop) pair for every oblast, soil preset and harvest year.

Output: data/processed/pairs/<oblast>.json. Run by hand: python -m pipeline.build_pairs
"""
import json
from itertools import product

import numpy as np
import pandas as pd

from core.bucket import snow_store
from core.crops import load_crops
from core.kc import bare_kc_daily
from core.pairs import FALLOW, Climate, Params, compute_pair
from core.params import get_value, load_params
from pipeline.add_eto import OUT_DIR
from pipeline.fetch_power import OBLASTS

PARAMS = OUT_DIR.parent / "params"
PAIRS_DIR = OUT_DIR / "pairs"
YEARS = range(1993, 2026)
SOILS = ("light", "medium", "heavy")


def build(name: str):
    P = Params(load_crops())
    model = load_params(PARAMS / "model.csv", ["parameter"])
    soils = load_params(PARAMS / "soils.csv", ["soil", "parameter"])
    ze, ddf = get_value(model, {"parameter": "ze_m"}), get_value(model, {"parameter": "snow_ddf"})
    crops = [c for c in ("winter_wheat", "maize", FALLOW) if P.supported(c)]
    df = pd.read_csv(OUT_DIR / f"{name}_climate.csv", index_col=0, parse_dates=True)
    clim = Climate(df, snow_store(df["PRECTOTCORR"], (df["T2M_MAX"] + df["T2M_MIN"]) / 2, ddf))
    result = {}
    for soil in SOILS:
        g = lambda n: get_value(soils, {"soil": soil, "parameter": n})
        bare = bare_kc_daily(df["ETO_PM"], clim.snow["water_in"], g("theta_fc"), g("theta_wp"), g("rew_mm"), ze)
        for prev, cur in product(crops, crops):
            recs, fr, lb = [], {}, {}
            for y in YEARS:
                r = compute_pair(prev, cur, y, clim, bare, {"awc": g("awc_m3m3") * 1000}, P, ze)
                if r is None:
                    continue
                rec, daily = r
                recs.append(rec)
                for (yy, mm), v in daily["frac"].items():
                    k = (yy - (y - 1)) * 12 + mm - 1
                    fr.setdefault(k, []).append(float(v))
                    lb.setdefault(k, []).append(daily["label"][(yy, mm)])
            timeline = [{"m": k, "frac": float(np.median(fr[k])), "label": max(set(lb[k]), key=lb[k].count)} for k in sorted(fr)]
            result.setdefault(soil, {})[f"{prev}>{cur}"] = {"records": recs, "timeline": timeline}
    PAIRS_DIR.mkdir(parents=True, exist_ok=True)
    (PAIRS_DIR / f"{name}.json").write_text(json.dumps(result))
    n = sum(len(v["records"]) for s in result.values() for v in s.values())
    print(f"{name}: {n} pair-years, crops {crops}")


if __name__ == "__main__":
    for o in OBLASTS:
        build(o)
