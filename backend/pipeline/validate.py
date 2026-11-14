"""Validation of the water balance against reported yields (pre-registered in README).

Outcome: ratio of reported enterprise yield to its 2000-2021 trend. Single predictor: mean Ks in the crop's critical
window (`mean_ks_mid`), same crop, oblast and year; medium soil, mean over predecessors (reported yields mix
predecessors). Panel OLS with oblast fixed effects, standard errors clustered by year, one regression per crop, plus
leave-one-year-out. Results are written to data/processed/meta.json under "validation", whatever they are.
Run by hand: python -m pipeline.validate
"""
import json

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf

from pipeline.add_eto import OUT_DIR
from pipeline.fetch_power import OBLASTS


def fit(d: pd.DataFrame):
    m = smf.ols("ratio ~ ks + C(oblast)", data=d).fit(cov_type="cluster", cov_kwds={"groups": d["year"]})
    return m


def validate_crop(d: pd.DataFrame) -> dict:
    m = fit(d)
    loyo = []
    for y in sorted(d.year.unique()):
        s = fit(d[d.year != y])
        loyo.append({"left_out": int(y), "coef": float(s.params["ks"])})
    c = [x["coef"] for x in loyo]
    return {"n": int(len(d)), "years": [int(d.year.min()), int(d.year.max())], "coef_ks": float(m.params["ks"]),
            "se_clustered": float(m.bse["ks"]), "p_value": float(m.pvalues["ks"]), "r2": float(m.rsquared),
            "loyo_coef_min": float(min(c)), "loyo_coef_max": float(max(c)), "loyo": loyo}


def build_frame(crop: str, ratios: dict, pairs_by_oblast: dict) -> pd.DataFrame:
    rows = []
    for ob in OBLASTS:
        r = ratios.get(f"{ob}|{crop}", {})
        ks = {}
        for key, p in pairs_by_oblast[ob]["medium"].items():
            prev, cur = key.split(">")
            if cur != crop:
                continue
            for rec in p["records"]:
                if rec["mean_ks_mid"] is not None:
                    ks.setdefault(rec["year"], []).append(rec["mean_ks_mid"])
        for y, v in r.items():
            if int(y) in ks:
                rows.append({"oblast": ob, "year": int(y), "ratio": v, "ks": float(np.mean(ks[int(y)]))})
    return pd.DataFrame(rows)


def main():
    yields = json.loads((OUT_DIR / "yields.json").read_text())
    pairs = {ob: json.loads((OUT_DIR / f"{ob}.json").read_text())["pairs"] for ob in OBLASTS}
    result = {"predictor": "mean_ks_mid (pre-registered in README)", "crops": {}}
    for crop in ("winter_wheat", "maize"):
        d = build_frame(crop, yields["ratio"], pairs)
        if len(d) < 10:
            result["crops"][crop] = {"status": "todo", "note": f"only {len(d)} oblast-years with yield data"}
            continue
        result["crops"][crop] = {**validate_crop(d), "status": "data"}
    meta = json.loads((OUT_DIR / "meta.json").read_text())
    meta["validation"] = result
    (OUT_DIR / "meta.json").write_text(json.dumps(meta))
    print(json.dumps({c: {k: v for k, v in r.items() if k != "loyo"} for c, r in result["crops"].items()}, indent=1))


if __name__ == "__main__":
    main()
