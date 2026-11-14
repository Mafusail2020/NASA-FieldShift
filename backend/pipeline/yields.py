"""Enterprise yields -> detrended ratio -> Yhat at the current technology level.

Steps (CLAUDE.md): mask war years; fit a linear trend of yield on year over 2000-2021 per (oblast, crop);
ratio = yield / trend; Yhat = ratio * trend(TECH_YEAR). Choices of mine, to be confirmed by Ivan: the trend is
linear, and 'current technology level' is the trend value in 2021 (end of the trend window, no extrapolation).
Run by hand: python -m pipeline.yields   (needs data/raw/yields/yields.csv, see its README)
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1] / "data"
TREND = (2000, 2021)
TECH_YEAR = 2021


def apply_masks(df: pd.DataFrame, masks: pd.DataFrame) -> pd.DataFrame:
    """Drop rows from the oblast's mask year onwards (masks: columns oblast, mask_from_year)."""
    first = masks.set_index("oblast")["mask_from_year"].astype(int)
    from_year = df["oblast"].map(first)
    return df[from_year.isna() | (df["year"] < from_year)]


def detrend(df: pd.DataFrame) -> pd.DataFrame:
    """Adds trend, ratio and yhat. df columns: oblast, crop, year, yield_t_ha (already masked)."""
    parts = []
    for (ob, crop), g in df.groupby(["oblast", "crop"]):
        w = g[(g.year >= TREND[0]) & (g.year <= TREND[1])]
        if len(w) < 5:
            continue
        b, a = np.polyfit(w.year, w.yield_t_ha, 1)
        g = g.assign(trend=a + b * g.year)
        g["ratio"] = g.yield_t_ha / g.trend
        g["yhat"] = g.ratio * (a + b * TECH_YEAR)
        parts.append(g)
    return pd.concat(parts, ignore_index=True)


def main():
    raw = pd.read_csv(ROOT / "raw" / "yields" / "yields.csv")
    masks = pd.read_csv(ROOT / "params" / "war_masks.csv")
    out = detrend(apply_masks(raw, masks))
    doc = {"source": "Derzhstat enterprise yields (see raw/yields/README.md); detrended, rescaled to the 2021 trend level",
           "status": "data", "tech_year": TECH_YEAR, "trend_window": list(TREND),
           "yhat": {f"{ob}|{crop}": {int(y): round(float(v), 4) for y, v in zip(g.year, g.yhat)}
                    for (ob, crop), g in out.groupby(["oblast", "crop"])},
           "ratio": {f"{ob}|{crop}": {int(y): round(float(v), 4) for y, v in zip(g.year, g.ratio)}
                     for (ob, crop), g in out.groupby(["oblast", "crop"])}}
    (ROOT / "processed" / "yields.json").write_text(json.dumps(doc))
    print(f"{len(out)} rows -> data/processed/yields.json")


if __name__ == "__main__":
    main()
