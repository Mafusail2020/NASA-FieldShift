"""Add daily ETo (Penman-Monteith and Hargreaves) to each oblast series.

ETo is computed per point, then averaged (the formula is nonlinear).
Run by hand: python -m pipeline.add_eto
"""
import numpy as np
import pandas as pd

from core.eto import actual_vapour_pressure_from_dewpoint, hargreaves_eto, penman_monteith_eto
from pipeline.fetch_power import OBLASTS, RAW_DIR

OUT_DIR = RAW_DIR.parents[1] / "processed"


def point_eto(df: pd.DataFrame, lat_deg: float, z: float) -> pd.DataFrame:
    doy = df.index.dayofyear.to_numpy()
    lat = np.radians(lat_deg)
    pm = penman_monteith_eto(df["T2M_MAX"].to_numpy(), df["T2M_MIN"].to_numpy(), actual_vapour_pressure_from_dewpoint(df["T2MDEW"].to_numpy()),
                             df["WS2M"].to_numpy(), df["ALLSKY_SFC_SW_DWN"].to_numpy(), lat, doy, z)
    hg = hargreaves_eto(df["T2M_MAX"].to_numpy(), df["T2M_MIN"].to_numpy(), lat, doy)
    return pd.DataFrame({"ETO_PM": pm, "ETO_HG": hg}, index=df.index)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    pts = pd.read_csv(RAW_DIR / "points.csv")
    print(f"{'oblast':14s} {'PM year':>8s} {'PM Jul':>7s} {'HG year':>8s} {'HG Jul':>7s}  (mm; year = mean annual sum, Jul = mean July sum)")
    for name in OBLASTS:
        etos = []
        for _, p in pts[pts.oblast == name].iterrows():
            df = pd.read_csv(RAW_DIR / f"{name}_{p.i}.csv", comment="#", index_col=0, parse_dates=True)
            etos.append(point_eto(df, p.lat, p.elevation_m))
        eto = sum(etos) / len(etos)
        out = pd.read_csv(RAW_DIR / f"{name}_mean.csv", index_col=0, parse_dates=True).join(eto)
        out.to_csv(OUT_DIR / f"{name}_climate.csv")
        yr = out[["ETO_PM", "ETO_HG"]].groupby(out.index.year).sum().mean()
        jul = out[out.index.month == 7][["ETO_PM", "ETO_HG"]].groupby(out[out.index.month == 7].index.year).sum().mean()
        print(f"{name:14s} {yr.ETO_PM:8.0f} {jul.ETO_PM:7.0f} {yr.ETO_HG:8.0f} {jul.ETO_HG:7.0f}")


if __name__ == "__main__":
    main()
