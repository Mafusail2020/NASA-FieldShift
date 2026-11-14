"""Save lat, lon and POWER elevation (m) per point to data/raw/power/points.csv.

Run by hand: python -m pipeline.fetch_elevation
"""
import time

import pandas as pd
import requests

from pipeline.fetch_power import API, OBLASTS, RAW_DIR


def main():
    rows = []
    for name, points in OBLASTS.items():
        for i, (lat, lon) in enumerate(points, 1):
            q = dict(parameters="T2M", community="ag", latitude=lat, longitude=lon,
                     start="20200101", end="20200101", format="json")
            r = requests.get(API, params=q, timeout=60)
            r.raise_for_status()
            elev = r.json()["geometry"]["coordinates"][2]
            rows.append(dict(oblast=name, i=i, lat=lat, lon=lon, elevation_m=elev))
            time.sleep(1)
    df = pd.DataFrame(rows)
    df.to_csv(RAW_DIR / "points.csv", index=False)
    print(df.to_string(index=False))


if __name__ == "__main__":
    main()
