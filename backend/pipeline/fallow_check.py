"""Sanity check: share of fallow-period water input stored in the soil, per oblast (expected 10-53%).

Each year a black-fallow window starts on fallow_start_mmdd and lasts fallow_length_months. The soil starts the window
fully depleted (Dr = TAW, after a crop), Zr = black_fallow.zr_max_m, medium soil, Ks = 1 (bare soil, Annex 7 Kc).
Run by hand: python -m pipeline.fallow_check
"""
import numpy as np
import pandas as pd

from core.bucket import run_bucket, snow_store
from core.crops import load_crops
from core.kc import bare_kc_daily
from core.params import get_value, load_params
from core.stress import fallow_storage_share
from pipeline.add_eto import OUT_DIR
from pipeline.fetch_power import OBLASTS

PARAMS = OUT_DIR.parent / "params"


def main(soil: str = "medium"):
    model = load_params(PARAMS / "model.csv", ["parameter"])
    soils = load_params(PARAMS / "soils.csv", ["soil", "parameter"])
    crops = load_crops()
    g = lambda n: get_value(model, {"parameter": n})
    s = lambda n: get_value(soils, {"soil": soil, "parameter": n})
    zr = get_value(crops, {"crop": "black_fallow", "parameter": "zr_max_m"})
    mm, dd = (int(x) for x in model[model.parameter == "fallow_start_mmdd"].iloc[0].value.split("-"))
    months, lo, hi = int(g("fallow_length_months")), g("fallow_storage_min"), g("fallow_storage_max")
    awc = s("awc_m3m3") * 1000
    print(f"soil={soil} awc={awc:.0f} mm/m zr={zr} m ddf={g('snow_ddf')}; window {months} months from {mm:02d}-{dd:02d}")
    print(f"{'oblast':14s} {'years':>5s} {'median':>7s} {'p10':>6s} {'p90':>6s} {'in 10-53%':>10s}")
    for name in OBLASTS:
        df = pd.read_csv(OUT_DIR / f"{name}_climate.csv", index_col=0, parse_dates=True)
        sn = snow_store(df["PRECTOTCORR"], (df["T2M_MAX"] + df["T2M_MIN"]) / 2, g("snow_ddf"))
        kc = bare_kc_daily(df["ETO_PM"], sn["water_in"], s("theta_fc"), s("theta_wp"), s("rew_mm"), g("ze_m"))
        shares = []
        for y in range(df.index.year.min(), df.index.year.max()):
            a = pd.Timestamp(year=y, month=mm, day=dd)
            b = a + pd.DateOffset(months=months) - pd.Timedelta(days=1)
            if b > df.index[-1]:
                break
            w = slice(a, b)
            one = pd.Series(1.0, index=df.loc[w].index)
            out = run_bucket(sn["water_in"][w], sn["snow"][w], df["ETO_PM"][w], kc[w], one * zr, one, awc, dr0=awc * zr)
            # first day has no previous storage in `out`; storage before the window is 0 (Dr = TAW)
            ds = out["storage"].iloc[-1] - out["rezone"].sum()
            shares.append(ds / sn["water_in"][w].sum())
        x = np.array(shares)
        print(f"{name:14s} {len(x):5d} {np.median(x):7.2f} {np.percentile(x, 10):6.2f} {np.percentile(x, 90):6.2f} {((x >= lo) & (x <= hi)).mean():10.0%}")


if __name__ == "__main__":
    main()
