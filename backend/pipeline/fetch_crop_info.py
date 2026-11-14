"""Download crop information from open sources and write source-stamped CSVs (national, no oblast split).

Sources, all downloadable without an account:
- FAOSTAT bulk files: Ukraine yield, area, production (Production_Crops_Livestock) and producer prices (Prices).
- USDA FAS PSD bulk file: Ukraine yield, area, production up to the current forecast year (wheat, maize, sunflower).
- FAO EcoCrop database (temperature, rainfall, crop cycle ranges), read from the OpenCLIM mirror of the FAO file.
- SAGE crop calendar (Sacks et al. 2010): planting and harvest dates on a 0.5 degree grid.
- UGA Index (Ukrainian Grain Association): latest public export prices in USD/t, scraped from the public page.

Output goes to data/raw/crops/. It does not touch data/params/: Ivan decides which values are promoted there.
Run by hand from backend/: python -m pipeline.fetch_crop_info [--refresh]
"""
import gzip
import io
import re
import sys
import tempfile
import zipfile
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from scipy.io import netcdf_file

OUT_DIR = Path(__file__).resolve().parents[1] / "data" / "raw" / "crops"
CACHE_DIR = OUT_DIR / "_cache"

FAOSTAT = "https://bulks-faostat.fao.org/production/"
PRODUCTION_ZIP = "Production_Crops_Livestock_E_All_Data_(Normalized).zip"
PRICES_ZIP = "Prices_E_All_Data_(Normalized).zip"
ECOCROP_URL = "https://raw.githubusercontent.com/OpenCLIM/ecocrop/main/EcoCrop_DB.csv"

PSD_URL = "https://apps.fas.usda.gov/psdonline/downloads/psd_alldata_csv.zip"
SAGE_URL = "https://sage-public-files.s3.amazonaws.com/crop-calendar-dataset/netcdf0.5deg/{}.crop.calendar.nc.gz"
UGA_URL = "https://index.uga.ua/en/media-hub"
PSD_COMMODITY = {"winter_wheat": "Wheat", "maize": "Corn", "sunflower": "Oilseed, Sunflowerseed"}  # PSD has no dry pea
SAGE_NAME = {"winter_wheat": "Wheat.Winter", "maize": "Maize", "sunflower": "Sunflower", "pea": "Pulses"}  # Pulses: no Ukraine cells
SAGE_VARS = {"plant.start": "plant_start_doy", "plant": "plant_doy", "plant.end": "plant_end_doy",
             "harvest.start": "harvest_start_doy", "harvest": "harvest_doy", "harvest.end": "harvest_end_doy"}
LAT_RANGE, LON_RANGE = (44.0, 53.0), (22.0, 41.0)  # box around Ukraine
UGA_ITEMS = {"Corn": "maize", "Wheat 11.5% protein": "winter_wheat (food, 11.5% protein)", "Feed wheat": "winter_wheat (feed)"}

AREA = "Ukraine"
# FAOSTAT does not separate winter and spring wheat; "Wheat" is all wheat.
FAOSTAT_ITEM = {"winter_wheat": "Wheat", "maize": "Maize (corn)", "sunflower": "Sunflower seed", "pea": "Peas, dry"}
ECOCROP_NAME = {"winter_wheat": "Triticum aestivum", "maize": "Zea mays", "sunflower": "Helianthus annuus", "pea": "Pisum sativum"}
ECOCROP_PARAMS = {  # column -> (parameter name, unit)
    "TOPMN": ("t_opt_min_c", "C"), "TOPMX": ("t_opt_max_c", "C"),
    "TMIN": ("t_abs_min_c", "C"), "TMAX": ("t_abs_max_c", "C"),
    "KTMP": ("t_kill_early_growth_c", "C"), "KTMPR": ("t_kill_rest_c", "C"),
    "ROPMN": ("rain_opt_min_mm", "mm/cycle"), "ROPMX": ("rain_opt_max_mm", "mm/cycle"),
    "RMIN": ("rain_abs_min_mm", "mm/cycle"), "RMAX": ("rain_abs_max_mm", "mm/cycle"),
    "GMIN": ("cycle_min_d", "days"), "GMAX": ("cycle_max_d", "days"),
}


def download(url: str, refresh: bool) -> Path:
    path = CACHE_DIR / url.rsplit("/", 1)[-1]
    if path.exists() and not refresh:
        return path
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    print(f"downloading {url}")
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(path, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    return path


def read_faostat_ukraine(zip_path: Path) -> pd.DataFrame:
    """Rows for Ukraine from a FAOSTAT 'All Data (Normalized)' zip, read in chunks."""
    with zipfile.ZipFile(zip_path) as z:
        name = next(n for n in z.namelist() if n.endswith("All_Data_(Normalized).csv"))
        with z.open(name) as f:
            chunks = pd.read_csv(io.TextIOWrapper(f, encoding="latin1"), chunksize=200_000, low_memory=False)
            return pd.concat(c[c["Area"] == AREA] for c in chunks)


def parse_production(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for crop, item in FAOSTAT_ITEM.items():
        d = df[df["Item"] == item]
        wide = d.pivot_table(index="Year", columns="Element", values="Value", aggfunc="first")
        out = pd.DataFrame({
            "crop": crop,
            "year": wide.index,
            "area_harvested_ha": wide["Area harvested"].to_numpy(),
            "yield_t_ha": (wide["Yield"] / 1000).to_numpy(),  # FAOSTAT gives kg/ha
            "production_t": wide["Production"].to_numpy(),
        })
        rows.append(out)
    res = pd.concat(rows, ignore_index=True)
    res["source"] = "FAOSTAT, Crops and livestock products (QCL), Ukraine, national total, all farm categories; " + PRODUCTION_ZIP
    res["status"] = "data"
    return res


def parse_prices(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for crop, item in FAOSTAT_ITEM.items():
        d = df[(df["Item"] == item) & df["Element"].isin(["Producer Price (LCU/tonne)", "Producer Price (USD/tonne)"])]
        # one value per year: annual average rows only
        d = d[d["Months"] == "Annual value"]
        wide = d.pivot_table(index="Year", columns="Element", values="Value", aggfunc="first")
        flags = d[d["Element"] == "Producer Price (LCU/tonne)"].set_index("Year")["Flag"]
        out = pd.DataFrame({
            "crop": crop,
            "year": wide.index,
            "price_uah_per_t": wide.get("Producer Price (LCU/tonne)"),
            "price_usd_per_t": wide.get("Producer Price (USD/tonne)"),
        })
        out["flag"] = out["year"].map(flags)
        rows.append(out)
    res = pd.concat(rows, ignore_index=True)
    res["source"] = "FAOSTAT, Prices (PP), Ukraine, producer price, current prices of the year; " + PRICES_ZIP
    res["status"] = "data"
    return res


def parse_ecocrop(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for crop, sci in ECOCROP_NAME.items():
        rec = df[df["ScientificName"] == sci].iloc[0]
        for col, (param, unit) in ECOCROP_PARAMS.items():
            if pd.isna(rec[col]):
                continue
            rows.append({
                "crop": crop, "parameter": param, "value": float(rec[col]), "unit": unit,
                "source": f"FAO EcoCrop database, record {sci} (EcoPort {rec['EcoPortCode']}), via {ECOCROP_URL}; "
                          "global species range, not a Ukraine-specific or winter-wheat-specific value",
                "status": "literature",
            })
    return pd.DataFrame(rows)


def parse_psd(zip_path: Path) -> pd.DataFrame:
    """USDA PSD: Ukraine area, yield and production per market year. The current and later years are forecasts."""
    with zipfile.ZipFile(zip_path) as z:
        with z.open(z.namelist()[0]) as f:
            d = pd.read_csv(f, encoding="latin1", low_memory=False)
    d = d[d["Country_Name"] == AREA]
    names = {"Area Harvested": "area_harvested_ha", "Yield": "yield_t_ha", "Production": "production_t"}
    rows = []
    for crop, com in PSD_COMMODITY.items():
        g = d[(d["Commodity_Description"] == com) & d["Attribute_Description"].isin(names)]
        wide = g.pivot_table(index="Market_Year", columns="Attribute_Description", values="Value", aggfunc="first")
        rows.append(pd.DataFrame({
            "crop": crop, "market_year": wide.index,
            "area_harvested_ha": wide["Area Harvested"].to_numpy() * 1000,  # PSD: 1000 HA
            "yield_t_ha": wide["Yield"].to_numpy(),                         # PSD: MT/HA
            "production_t": wide["Production"].to_numpy() * 1000,           # PSD: 1000 MT
        }))
    res = pd.concat(rows, ignore_index=True)
    res["source"] = "USDA FAS PSD Online, Ukraine, " + PSD_URL + "; market year; the current and later years are USDA forecasts"
    res["status"] = np.where(res["market_year"] < date.today().year, "data", "estimate")
    return res


def parse_sage(crop: str, nc_gz: Path) -> pd.DataFrame:
    """Planting and harvest dates (day of year) per 0.5 degree cell inside the Ukraine box. 'Unfilled' file: observed regions only."""
    with tempfile.NamedTemporaryFile(suffix=".nc") as tmp:
        tmp.write(gzip.open(nc_gz).read())
        tmp.flush()
        nc = netcdf_file(tmp.name, mmap=False)
        lat, lon = (nc.variables[k][:].astype("=f8") for k in ("latitude", "longitude"))
        li, lj = np.where((lat >= LAT_RANGE[0]) & (lat <= LAT_RANGE[1]))[0], np.where((lon >= LON_RANGE[0]) & (lon <= LON_RANGE[1]))[0]
        cols = {}
        for var, name in SAGE_VARS.items():
            a = nc.variables[var][:][np.ix_(li, lj)].astype("=f8")
            fill = getattr(nc.variables[var], "_FillValue", None)
            if fill is not None:
                a[np.isclose(a, fill)] = np.nan
            cols[name] = a.ravel()
        level = nc.variables["political.level"][:][np.ix_(li, lj)].astype("=f8").ravel()
        nc.close()
    la, lo = np.meshgrid(lat[li], lon[lj], indexing="ij")
    df = pd.DataFrame({"crop": crop, "lat": np.round(la.ravel(), 2), "lon": np.round(lo.ravel(), 2), **cols, "political_level": level})
    df = df.dropna(subset=["plant_doy"]).reset_index(drop=True)
    df["source"] = ("SAGE Crop Calendar Dataset, Sacks et al. 2010, Global Ecology and Biogeography 19:607-620, "
                    f"{SAGE_NAME[crop]} 0.5 degree unfilled netCDF; observations painted over whole administrative units")
    df["status"] = "literature"
    return df


def parse_uga(html: str) -> pd.DataFrame:
    """UGA Index public block: last 3 publication days, CPT UA Black Sea, USD/t."""
    text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", re.sub(r"<(script|style).*?</\1>", "", html, flags=re.S)))
    today = date.today()
    rows = []
    for m in re.finditer(r"([A-Z][a-z]{2} \d{1,2}) \d+ positions(.*?)(?=[A-Z][a-z]{2} \d{1,2} \d+ positions|$)", text):
        day = pd.to_datetime(f"{m.group(1)} {today.year}", format="%b %d %Y").date()
        if day > today:
            day = day.replace(year=today.year - 1)
        for item, crop in UGA_ITEMS.items():
            v = re.search(re.escape(item) + r" CPT UA Black Sea ([\d.]+) ", m.group(2))
            if v:
                rows.append({"date": day.isoformat(), "item": item, "crop": crop, "price_usd_per_t": float(v.group(1))})
    res = pd.DataFrame(rows)
    res["source"] = "UGA Index (Ukrainian Grain Association), public page " + UGA_URL + "; CPT UA Black Sea export basis, not a farm-gate price"
    res["status"] = "data"
    return res


def report(prod: pd.DataFrame, price: pd.DataFrame, eco: pd.DataFrame, psd: pd.DataFrame, sage: pd.DataFrame, uga: pd.DataFrame) -> str:
    lines = [
        "# Crop information (national, from open sources)",
        "",
        f"Generated by `pipeline/fetch_crop_info.py` on {date.today().isoformat()}. National values for Ukraine: there is no oblast split.",
        "Not copied into `data/params/`: Ivan decides which values to promote.",
        "",
        "## FAOSTAT yield, area, production (`faostat_ukraine_crops.csv`)",
        "",
    ]
    for crop, g in prod.groupby("crop"):
        g = g.dropna(subset=["yield_t_ha"]).sort_values("year")
        lines.append(f"- {crop}: {int(g['year'].min())}-{int(g['year'].max())}, {len(g)} years, "
                     f"yield {g['yield_t_ha'].min():.2f}-{g['yield_t_ha'].max():.2f} t/ha, last {g['yield_t_ha'].iloc[-1]:.2f} ({int(g['year'].iloc[-1])})")
    lines += ["", "## FAOSTAT producer prices (`faostat_ukraine_prices.csv`)", ""]
    for crop, g in price.groupby("crop"):
        g = g.dropna(subset=["price_uah_per_t"]).sort_values("year")
        lines.append(f"- {crop}: {int(g['year'].min())}-{int(g['year'].max())}, {len(g)} years, "
                     f"last {g['price_uah_per_t'].iloc[-1]:.0f} UAH/t ({int(g['year'].iloc[-1])})")
    lines += ["", "## USDA PSD yields, latest years (`psd_ukraine_crops.csv`)", ""]
    for crop, g in psd.groupby("crop"):
        g = g.sort_values("market_year").tail(3)
        lines.append(f"- {crop}: " + "; ".join(f"{int(r.market_year)} {r.yield_t_ha:.2f} t/ha ({r.status})" for r in g.itertuples()))
    lines += ["", "## SAGE crop calendar, Ukraine cells (`sage_calendar_grid.csv`)", ""]
    for crop, g in sage.groupby("crop"):
        lines.append(f"- {crop}: {len(g)} cells, planting day-of-year {g['plant_doy'].min():.0f}-{g['plant_doy'].max():.0f}, "
                     f"harvest {g['harvest_doy'].min():.0f}-{g['harvest_doy'].max():.0f}")
    lines += ["", "## UGA Index export prices (`uga_index_prices.csv`)", ""]
    for r in uga[uga["date"] == uga["date"].max()].itertuples():
        lines.append(f"- {r.date} {r.item}: {r.price_usd_per_t:.0f} USD/t (CPT Black Sea)")
    lines += ["", "## EcoCrop ranges (`ecocrop_crops.csv`)", ""]
    for crop, g in eco.groupby("crop"):
        v = dict(zip(g["parameter"], g["value"]))
        lines.append(f"- {crop}: {len(g)} parameters; optimum {v.get('t_opt_min_c')}-{v.get('t_opt_max_c')} C, "
                     f"absolute {v.get('t_abs_min_c')}-{v.get('t_abs_max_c')} C")
    lines += [
        "",
        "## What these files do NOT contain",
        "",
        "- Sowing soil temperature, heat-stress thresholds and windows, frost thresholds by stage, Kc, root depth: not in these sources.",
        "- SAGE dates are old observations painted over whole administrative units (a mix of national and regional units), not per-field or recent. SAGE 'Pulses' has no cells in the Ukraine box, so pea has no calendar.",
        "- Costs per hectare: no open machine-readable source found.",
        "- Pea: FAOSTAT only (PSD has no dry pea). UGA Index has no sunflower or pea; it is an export price, not a farm-gate price.",
        "- Prices after 2023: only the UGA Index, last 3 days. FAOSTAT prices end in 2023.",
        "- Winter and spring wheat are not separated (FAOSTAT 'Wheat', EcoCrop 'Triticum aestivum').",
        "- Yields are all farm categories, not enterprises, and national, not by oblast.",
        "- The `flag` column is FAOSTAT's own flag, kept as received (A = official figure).",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    refresh = "--refresh" in sys.argv
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    prod = parse_production(read_faostat_ukraine(download(FAOSTAT + PRODUCTION_ZIP, refresh)))
    price = parse_prices(read_faostat_ukraine(download(FAOSTAT + PRICES_ZIP, refresh)))
    eco = parse_ecocrop(pd.read_csv(download(ECOCROP_URL, refresh), encoding="latin1", low_memory=False))
    psd = parse_psd(download(PSD_URL, refresh))
    sage = pd.concat([parse_sage(c, download(SAGE_URL.format(n), refresh)) for c, n in SAGE_NAME.items()], ignore_index=True)
    uga_html = requests.get(UGA_URL, timeout=60).text
    uga = parse_uga(uga_html)
    prod.to_csv(OUT_DIR / "faostat_ukraine_crops.csv", index=False)
    psd.to_csv(OUT_DIR / "psd_ukraine_crops.csv", index=False)
    sage.to_csv(OUT_DIR / "sage_calendar_grid.csv", index=False)
    uga.to_csv(OUT_DIR / "uga_index_prices.csv", index=False)
    price.to_csv(OUT_DIR / "faostat_ukraine_prices.csv", index=False)
    eco.to_csv(OUT_DIR / "ecocrop_crops.csv", index=False)
    text = report(prod, price, eco, psd, sage, uga)
    (OUT_DIR / "README.md").write_text(text)
    print(text)


if __name__ == "__main__":
    main()
