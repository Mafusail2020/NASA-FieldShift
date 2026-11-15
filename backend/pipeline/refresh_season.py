"""Fetch the CURRENT year of NASA POWER daily data for ONE existing grid cell (the archive covers 1991-2025 only).

The season twin needs the weather since sowing. This is the only place that fetches a recent season; the API never calls
NASA. It writes data/raw/power_season/<cell>.csv (same columns as the archive) and does nothing for a cell that is already
up to date (last day within MAX_AGE_DAYS). It never touches the archive and never creates a grid cell.

Run by hand from backend/: python -m pipeline.refresh_season LAT LON [--force]
"""
import sys
from datetime import date
from pathlib import Path

import pandas as pd
import requests

from core.twin import COLS, DATA, cell_center
from pipeline.fetch_power import API, PARAMS, parse_power

MAX_AGE_DAYS = 4  # NASA POWER lags real time by about 2-3 days


def refresh(lat: float, lon: float, force: bool = False, today: date | None = None, raw: Path = DATA) -> str:
    la, lo = cell_center(lat, lon)
    cid = f"{la}_{lo}"
    if not (raw / "power_grid" / f"{cid}.csv").exists():
        return f"cell {cid} has no archive: run python -m pipeline.add_cell {lat} {lon} first"
    today = today or date.today()
    out = raw / "power_season" / f"{cid}.csv"
    if out.exists() and not force:
        last = pd.read_csv(out, comment="#", index_col=0, parse_dates=True).index.max().date()
        if (today - last).days <= MAX_AGE_DAYS:
            return f"cell {cid} up to date (last day {last}), nothing fetched"
    start = date(max(today.year, 2026), 1, 1)
    q = dict(parameters=",".join(PARAMS), community="ag", latitude=la, longitude=lo,
             start=start.strftime("%Y%m%d"), end=today.strftime("%Y%m%d"), format="json")
    r = requests.get(API, params=q, timeout=120)
    r.raise_for_status()
    df, units = parse_power(r.json())
    df = df[COLS].dropna()
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    with open(tmp, "w") as f:
        f.write(f"# lat={la} lon={lo} fetched={today} units={units}\n")
        df.to_csv(f)
    tmp.rename(out)
    return f"cell {cid}: {len(df)} days, {df.index.min().date()} to {df.index.max().date()}"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 2:
        sys.exit(__doc__)
    print(refresh(float(args[0]), float(args[1]), force="--force" in sys.argv))


if __name__ == "__main__":
    main()
