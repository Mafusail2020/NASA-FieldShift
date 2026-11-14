"""Export the inputs of the Finance page to finance_inputs.json (national, source-stamped, no invented values).

Reads data/raw/crops/*.csv (written by pipeline.fetch_crop_info) and data/params/k_predecessor.csv, prices.csv.
Writes frontend/public/data/finance_inputs.json and a copy in data/processed/.
Run from backend/: python -m pipeline.export_finance
"""
import json
import sys
from datetime import date
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "crops"
PARAMS = ROOT / "data" / "params"
OUT = [ROOT.parent / "frontend" / "public" / "data" / "finance_inputs.json", ROOT / "data" / "processed" / "finance_inputs.json"]
NEEDED = ["faostat_ukraine_crops.csv", "faostat_ukraine_prices.csv", "psd_ukraine_crops.csv", "uga_index_prices.csv"]
LABELS = {"winter_wheat": "Winter wheat", "maize": "Maize", "sunflower": "Sunflower", "pea": "Pea", "soybean": "Soybean",
          "winter_rapeseed": "Winter rapeseed", "winter_barley": "Winter barley", "spring_barley": "Spring barley",
          "sugar_beet": "Sugar beet", "buckwheat": "Buckwheat", "millet": "Millet", "oats": "Oats", "black_fallow": "Black fallow"}
# FAOSTAT prices before 1996 are in karbovanets (pre-redenomination, hyperinflation), not comparable with UAH.
FIRST_UAH_YEAR = 1996


def num(x):
    return None if pd.isna(x) else float(x)


def implied_rate(prices: pd.DataFrame) -> dict:
    """UAH per USD implied by FAOSTAT's two price columns (same price, FAO annual conversion): median over crops, latest year."""
    p = prices[(prices.year >= FIRST_UAH_YEAR) & prices.price_uah_per_t.notna() & prices.price_usd_per_t.notna()].copy()
    p["rate"] = p.price_uah_per_t / p.price_usd_per_t
    per_year = p.groupby("year").rate.median()
    year = int(per_year.index.max())
    return {
        "uah_per_usd": round(float(per_year[year]), 2), "year": year,
        "per_year": {int(y): round(float(v), 2) for y, v in per_year.items()},
        "source": f"Implied by FAOSTAT Prices (PP): producer price UAH/t divided by USD/t, median over crops, year {year}. FAO annual-average rate, not today's market rate.",
        "status": "estimate",
    }


def build(raw: Path = RAW, params: Path = PARAMS) -> dict:
    missing = [n for n in NEEDED if not (raw / n).exists()]
    if missing:
        raise FileNotFoundError(f"missing {missing} in {raw}; run `python -m pipeline.fetch_crop_info` first")
    yields = pd.read_csv(raw / "faostat_ukraine_crops.csv")
    prices = pd.read_csv(raw / "faostat_ukraine_prices.csv")
    psd = pd.read_csv(raw / "psd_ukraine_crops.csv")
    uga = pd.read_csv(raw / "uga_index_prices.csv")
    k = pd.read_csv(params / "k_predecessor.csv")
    cost = pd.read_csv(params / "prices.csv")

    crops = {}
    for crop in sorted(yields.crop.unique()):
        y = yields[yields.crop == crop].sort_values("year")
        p = prices[(prices.crop == crop) & (prices.year >= FIRST_UAH_YEAR)].sort_values("year")
        s = psd[(psd.crop == crop) & (psd.market_year >= 2024)].sort_values("market_year")
        crops[crop] = {
            "label": LABELS.get(crop, crop),
            "yields": [{"year": int(r.year), "value": num(r.yield_t_ha)} for r in y.itertuples() if pd.notna(r.yield_t_ha)],
            "yield_source": y.source.iloc[0], "yield_status": y.status.iloc[0],
            "prices": [{"year": int(r.year), "value": num(r.price_uah_per_t), "usd": num(r.price_usd_per_t)} for r in p.itertuples() if pd.notna(r.price_uah_per_t)],
            "price_source": p.source.iloc[0] if len(p) else None, "price_status": p.status.iloc[0] if len(p) else "todo",
            "psd": [{"year": int(r.market_year), "value": num(r.yield_t_ha), "status": r.status, "source": r.source} for r in s.itertuples() if pd.notna(r.yield_t_ha)],
            "cost_uah_per_ha": None, "cost_status": "todo",
        }
    for r in cost[cost.parameter == "cost_uah_per_ha"].itertuples():
        if r.crop in crops and pd.notna(r.value):
            crops[r.crop]["cost_uah_per_ha"] = float(r.value)
            crops[r.crop]["cost_status"] = r.status
    return {
        "generated": date.today().isoformat(),
        "fx": implied_rate(prices),
        "crops": crops,
        "uga": [{"date": r.date, "item": r.item, "crop": r.crop, "usd_per_t": num(r.price_usd_per_t), "source": r.source, "status": r.status} for r in uga.itertuples()],
        "k": [{"crop": r.crop, "predecessor": r.predecessor, "value": float(r.value), "source": r.source, "status": r.status} for r in k.itertuples()],
        "notes": {
            "yields": "National FAOSTAT yields, all farm categories (not enterprises), no oblast split.",
            "prices": f"FAOSTAT producer prices, nominal UAH/t, current prices of each year, last year 2023. Years before {FIRST_UAH_YEAR} dropped (karbovanets).",
            "missing": "Costs per hectare, prices after 2023, UAH/USD rate and local market prices are not available from open sources; the user enters them.",
        },
    }


def main() -> None:
    try:
        data = build()
    except FileNotFoundError as e:
        sys.exit(f"export_finance: {e}")
    for path in OUT:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=1))
        print("wrote", path)


if __name__ == "__main__":
    main()
