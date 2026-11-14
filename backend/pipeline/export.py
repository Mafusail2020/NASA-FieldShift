"""Write data/processed/<oblast>.json and meta.json, and copy them to frontend/public/data/ (offline fallback).

Every value block carries `source` and `status`. Run by hand: python -m pipeline.export
"""
import json
import shutil
from pathlib import Path

from itertools import product

import pandas as pd
import yaml

from core.climate import climate_doc
from core.crops import load_crops
from core.params import load_params
from core.rotations import evaluate
from pipeline.add_eto import OUT_DIR
from pipeline.fetch_power import OBLASTS

NAMES = {"vinnytska": ("Vinnytsia oblast", "Вінницька область"), "poltavska": ("Poltava oblast", "Полтавська область"),
         "kirovohradska": ("Kirovohrad oblast", "Кіровоградська область"), "odeska": ("Odesa oblast", "Одеська область")}
OFFLINE_CROPS = ("winter_wheat", "maize", "black_fallow")
FRONT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "data"
PARAMS = OUT_DIR.parent / "params"
VALIDATION = OUT_DIR / "validation.json"

DATASETS = [
    {"name": "NASA POWER daily point data", "detail_en": "Community AG, 1991-2025; T2M_MAX, T2M_MIN, T2MDEW, WS2M, ALLSKY_SFC_SW_DWN, PRECTOTCORR, SNODP. Grid cell about 0.5 x 0.625 degrees (about 55 x 46 km); 3-4 cropland points per oblast, averaged.",
     "detail_uk": "Спільнота AG, 1991-2025; T2M_MAX, T2M_MIN, T2MDEW, WS2M, ALLSKY_SFC_SW_DWN, PRECTOTCORR, SNODP. Клітинка сітки близько 0,5 x 0,625 градуса (приблизно 55 x 46 км); 3-4 точки на ріллі в області, усереднені.",
     "source": "https://power.larc.nasa.gov", "status": "data"},
    {"name": "FAO-56 (Allen et al. 1998)", "detail_en": "Penman-Monteith ETo, Kc tables 11, 12 and 22, soil table 19, Annex 7 (bare-soil Kc), water balance (Ch. 8).",
     "detail_uk": "ETo за Пенманом-Монтейтом, таблиці Kc 11, 12 і 22, таблиця ґрунтів 19, Annex 7 (Kc голого ґрунту), водний баланс (розд. 8).",
     "source": "https://www.fao.org/3/x0490e/x0490e00.htm", "status": "literature"},
    {"name": "Snow melt factor", "detail_en": "4 mm/degC/day, estimate from the 3-5 range typical of temperate climates (HESS 30, 2613-2636, 2026); not calibrated to Ukraine.",
     "detail_uk": "4 мм/°C/добу, оцінка з діапазону 3-5, типового для помірного клімату (HESS 30, 2613-2636, 2026); не відкалібровано для України.",
     "source": "https://hess.copernicus.org/articles/30/2613/2026/", "status": "estimate"},
    {"name": "Black-fallow storage check", "detail_en": "Nielsen & Vigil 2010, Agron. J. 102:537: fallow precipitation storage efficiency 10-53%.",
     "detail_uk": "Nielsen & Vigil 2010, Agron. J. 102:537: ефективність накопичення опадів під паром 10-53%.",
     "source": "Nielsen & Vigil 2010", "status": "literature"},
    {"name": "Predecessor effect k (wheat)", "detail_en": "Solodushko 2024 via the project brief: after fallow 1.08, pea 1.13, sunflower 0.79. All other pairs 1.0 (estimate).",
     "detail_uk": "Solodushko 2024 за описом проєкту: після пару 1,08, гороху 1,13, соняшнику 0,79. Решта пар 1,0 (оцінка).",
     "source": "Solodushko 2024 (full citation pending)", "status": "literature"},
    {"name": "Oblast boundaries", "detail_en": "geoBoundaries ADM1 (ODbL), used only for the map.",
     "detail_uk": "geoBoundaries ADM1 (ODbL), лише для карти.", "source": "https://www.geoboundaries.org", "status": "data"},
    {"name": "Derzhstat enterprise yields, prices, costs", "detail_en": "Not loaded yet: the Money tab and the validation cannot run without them.",
     "detail_uk": "Ще не завантажено: вкладка «Гроші» та валідація без них не працюють.", "source": "Derzhstat (to be supplied)", "status": "todo"},
]
FORMULAS = [
    {"name": "Reference ET", "text_en": "FAO-56 Penman-Monteith, daily (Eq. 6); Hargreaves (Eq. 52) kept as a fallback.", "text_uk": "FAO-56 Penman-Monteith, добовий (Eq. 6); Hargreaves (Eq. 52) як запасний варіант.", "source": "FAO-56 Ch. 3-4"},
    {"name": "Crop coefficient", "text_en": "ETc = Kc x Ks x ETo. Kc mid and end adjusted for wind and RHmin (Eq. 62, 65); RHmin from dew point and Tmax (Eq. 63); daily curve by Eq. 66.", "text_uk": "ETc = Kc x Ks x ETo. Kc mid і end коригуються на вітер і RHmin (Eq. 62, 65); RHmin з точки роси й Tmax (Eq. 63); добова крива за Eq. 66.", "source": "FAO-56 Ch. 6"},
    {"name": "Bare soil and fallow", "text_en": "Monthly Kc of bare soil from Annex 7 (Eq. 7-1, 7-3 to 7-10): one wetting-interval model per month.", "text_uk": "Місячний Kc голого ґрунту за Annex 7 (Eq. 7-1, 7-3...7-10): модель інтервалу зволоження на кожен місяць.", "source": "FAO-56 Annex 7"},
    {"name": "Water balance", "text_en": "One daily single-layer bucket across the whole rotation: TAW = AWC x Zr, RAW = p x TAW, Ks = (TAW - Dr) / ((1 - p) TAW) beyond RAW; deep percolation when the bucket overfills; no surface runoff.", "text_uk": "Одне добове однорівневе «відро» через усю сівозміну: TAW = AWC x Zr, RAW = p x TAW, Ks = (TAW - Dr) / ((1 - p) TAW) понад RAW; глибока фільтрація при переповненні; без поверхневого стоку.", "source": "FAO-56 Ch. 8"},
    {"name": "Snow", "text_en": "Precipitation at Tmean < 0 degC goes to a snow store that melts by degree-days.", "text_uk": "Опади при Tmean < 0 °C потрапляють у сніговий запас, що тане за градусо-днями.", "source": "Degree-day method"},
    {"name": "Phenology", "text_en": "Stage lengths from FAO-56 Table 11; sowing by the FAO-56 temperature rule (wheat, maize); growing degree days (max(Tmean - base, 0)) only set the clock.", "text_uk": "Довжини стадій з FAO-56 Table 11; посів за температурним правилом FAO-56 (пшениця, кукурудза); градусо-дні (max(Tmean - base, 0)) лише задають годинник.", "source": "FAO-56 Table 11"},
    {"name": "Gross margin", "text_en": "margin(c | a, y) = Yhat(c, y) x k(c | a) x P(c) - C(c). k drives money; the water balance drives the risk panel; they never penalise the same yield.", "text_uk": "margin(c | a, y) = Yhat(c, y) x k(c | a) x P(c) - C(c). k впливає на гроші; водний баланс на панель ризиків; вони ніколи не знижують той самий урожай двічі.", "source": "Project method"},
    {"name": "Validation", "text_en": "Panel regression of detrended oblast yield on mean Ks in the crop's critical window (pre-registered in the README), oblast fixed effects, standard errors clustered by year, leave-one-year-out. The result is reported whatever it is.", "text_uk": "Панельна регресія детрендованої урожайності області на середній Ks у критичному вікні культури (зафіксовано в README), фіксовані ефекти областей, стандартні похибки кластеризовані за роками, leave-one-year-out. Результат наводиться яким би він не був.", "source": "Project method"},
]
NOT_MODELLED = [
    {"en": "Effects of crops two or more years back", "uk": "Вплив культур дворічної та давнішої давності"},
    {"en": "Nutrients", "uk": "Поживні речовини"},
    {"en": "Disease, beyond the broomrape note for sunflower", "uk": "Хвороби, окрім примітки про вовчок для соняшнику"},
    {"en": "Microclimate", "uk": "Мікроклімат"},
    {"en": "Irrigation", "uk": "Зрошення"},
    {"en": "Runoff from frozen ground (and surface runoff)", "uk": "Стік з мерзлого ґрунту (і поверхневий стік)"},
    {"en": "Extreme rainfall", "uk": "Екстремальні опади"},
]
LIMITATIONS_UK = [
    "Вплив культур дворічної та давнішої давності не моделюється.",
    "Стік з мерзлого ґрунту й поверхневий стік не моделюються.",
    "Клімат — середнє 3-4 точок NASA POWER на область (клітинки близько 0,5 x 0,625 градуса); аналіз для області, а не для поля.",
    "Соняшник і горох ще не рахуються: немає перевірених правил посіву.",
    "Тепловий стрес рахується лише там, де задано вікно спеки; заморозки не рахуються (пороги todo).",
    "Озима пшениця використовує 335-денний рядок FAO-56 Table 11 (Idaho); дати жнив пізніші, ніж типові українські.",
    "Водний баланс кожної пари починається на польовій вологоємності в день посіву попередньої культури.",
]
AI_DISCLOSURE = {"en": "Code written by Claude (Anthropic); the idea, data choices and scientific method are by Ivan.",
                 "uk": "Код написав Claude (Anthropic); ідея, вибір даних і наукова методика належать Івану."}

LIMITATIONS = [
    "Effects of crops two or more years back are not modelled.",
    "Runoff from frozen ground and surface runoff are not modelled.",
    "Climate is the mean of 3-4 NASA POWER grid points per oblast (cells about 0.5 x 0.625 degrees); analysis is for the oblast, not a field.",
    "Sunflower and pea are not computed yet: no verified sowing rules.",
    "Heat stress is only computed where a heat window is set; frost is not computed (thresholds todo).",
    "Winter wheat uses the 335-day FAO-56 Table 11 row (Idaho); harvest dates are later than typical Ukrainian harvest.",
    "Water balance starts each pair at field capacity at the previous crop's sowing.",
]


def main():
    FRONT.mkdir(parents=True, exist_ok=True)
    pts = pd.read_csv(OUT_DIR.parent / "raw" / "power" / "points.csv")
    for name in OBLASTS:
        df = pd.read_csv(OUT_DIR / f"{name}_climate.csv", index_col=0, parse_dates=True)
        g = df.groupby(df.index.year)
        jul = df[df.index.month == 7].groupby(df[df.index.month == 7].index.year)["T2M_MAX"].mean()
        climate = {"years": [int(y) for y in g.size().index], "precip_mm": g["PRECTOTCORR"].sum().round(1).tolist(),
                   "eto_mm": g["ETO_PM"].sum().round(1).tolist(), "july_tmax_c": jul.round(2).tolist(),
                   "source": "NASA POWER daily, community AG, 1991-2025; mean of grid points; ETo FAO-56 Penman-Monteith",
                   "status": "data"}
        doc = {"id": name, "name_en": NAMES[name][0], "name_uk": NAMES[name][1],
               "points": pts[pts.oblast == name][["lat", "lon", "elevation_m"]].to_dict("records"),
               "climate": climate, "pairs": json.loads((OUT_DIR / "pairs" / f"{name}.json").read_text())}
        (OUT_DIR / f"{name}.json").write_text(json.dumps(doc))
        shutil.copy(OUT_DIR / f"{name}.json", FRONT / f"{name}.json")
        # offline fallback: every rotation of up to 3 crops, so the frontend needs no model code
        rot0 = yaml.safe_load((PARAMS / "rotations.yaml").read_text())
        kmu = {k["crop"]: k for k in rot0["kmu_164"]}
        evals = {soil: {",".join(r): evaluate(list(r), doc["pairs"][soil], kmu)
                        for n in (1, 2, 3) for r in product(OFFLINE_CROPS, repeat=n)} for soil in doc["pairs"]}
        clim = {soil: climate_doc(doc, soil, load_crops().to_dict("records")) for soil in doc["pairs"]}
        (FRONT / f"{name}_eval.json").write_text(json.dumps({"evaluations": evals, "climate": clim}, separators=(",", ":")))
    crops = load_crops()
    rot = yaml.safe_load((PARAMS / "rotations.yaml").read_text())
    meta = {"crops": crops.to_dict("records"), "soils": load_params(PARAMS / "soils.csv", ["soil", "parameter"]).to_dict("records"),
            "model": load_params(PARAMS / "model.csv", ["parameter"]).to_dict("records"),
            "prices_costs": pd.read_csv(PARAMS / "prices.csv", dtype=str, keep_default_na=False).to_dict("records"),
            "k": pd.read_csv(PARAMS / "k_predecessor.csv", dtype=str, keep_default_na=False).to_dict("records"),
            "rotations": rot["rotations"], "kmu_164": rot["kmu_164"], "limitations": LIMITATIONS, "limitations_uk": LIMITATIONS_UK, "datasets": DATASETS, "formulas": FORMULAS, "not_modelled": NOT_MODELLED,
            "ai_disclosure": AI_DISCLOSURE,
            "validation": json.loads(VALIDATION.read_text()) if VALIDATION.exists() else {
                "status": "todo", "note": "Not run: needs Derzhstat enterprise yields (data/raw/yields is empty)."},
            "regions": [{"id": k, "name_en": v[0], "name_uk": v[1]} for k, v in NAMES.items()]}
    (OUT_DIR / "meta.json").write_text(json.dumps(meta))
    shutil.copy(OUT_DIR / "meta.json", FRONT / "meta.json")
    print("exported", list(NAMES), "->", FRONT)


if __name__ == "__main__":
    main()
