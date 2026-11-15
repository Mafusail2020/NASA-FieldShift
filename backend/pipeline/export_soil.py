"""Export the soil tables (salinity, pH, humus) and model constants to soil_params.json for the Fields page.

The page computes the factors in the browser (src/lib/soil.ts) from these tables, same formulas as core/salinity|ph|humus.
`vectors` holds results computed here by core/, so the TypeScript port can be checked against them.
Writes frontend/public/data/soil_params.json and a copy in data/processed/. Run from backend/: python -m pipeline.export_soil
"""
import json
from datetime import date
from pathlib import Path

from core import humus, ph, salinity
from core.params import get_value, load_params
from core.soil_params import (HUMUS_NAMES, PH_NAMES, SPECIES, humus_params, load_humus, load_ph, load_salinity, ph_params,
                              salt_params, todo)

ROOT = Path(__file__).resolve().parents[1]
OUT = [ROOT.parent / "frontend" / "public" / "data" / "soil_params.json", ROOT / "data" / "processed" / "soil_params.json"]
LABELS = {
    "winter_wheat": "Winter wheat", "spring_wheat": "Spring wheat", "winter_barley": "Winter barley", "spring_barley": "Spring barley",
    "winter_rapeseed": "Winter rapeseed", "maize": "Maize", "sunflower": "Sunflower", "soybean": "Soybean", "sugar_beet": "Sugar beet",
    "millet": "Millet", "buckwheat": "Buckwheat", "pea": "Pea", "oats": "Oats", "black_fallow": "Black fallow",
    "winter_rye": "Winter rye", "white_mustard": "White mustard", "oilseed_radish": "Oilseed radish", "spring_vetch": "Spring vetch",
    "hairy_vetch": "Hairy vetch", "narrow_leaf_lupin": "Narrow-leaf lupin", "white_sweet_clover": "White sweet clover", "red_clover": "Red clover",
}
NOTES = [
    "ECe must be the saturated-paste extract (dS/m). EC of a 1:5 water extract or salt % needs a conversion that depends on texture.",
    "pH must be water pH. Salt (KCl) pH is usually lower and cannot be used as is.",
    "FAO salt tables are for chloride soils; on gypsum soils crops tolerate about 2 dS/m more.",
    "pH only warns: ECOCROP limits are expert estimates for the whole world and are probably too narrow for alkaline southern soils.",
    "FAO salt data come mostly from pot and lysimeter trials; in a field the threshold can differ.",
    "Mineralisation norms are not tied to a zone; for southern chernozems check them against zonal norms.",
]


def build() -> dict:
    sal, phd, hum = load_salinity(), load_ph(), load_humus()
    model = load_params(ROOT / "data" / "params" / "model.csv", ["parameter"])
    mv = lambda n: get_value(model, {"parameter": n})
    species = {}
    for sp in sorted(SPECIES):
        has = any(sp in set(df.species) for df in (sal, phd, hum))
        if not has:
            continue
        s, p, h = salt_params(sal, sp), ph_params(phd, sp), humus_params(hum, sp)
        gaps = sorted({f"{n}:{x.parameter}" for n, df in (("salt", sal), ("ph", phd), ("humus", hum)) for x in todo(df).itertuples() if x.species == sp})
        species[sp] = {
            "label": LABELS.get(sp, sp),
            "salt": s,
            "ph": None if p is None else {"limits": list(p["limits"]), "status": p["status"], "source": p["source"]},
            "humus": None if h is None else {**{k: getattr(h[0], k) for k in HUMUS_NAMES}, **h[1]},
            "gaps": gaps,
        }
    vectors = []
    for ece, crop in ((4, "maize"), (6, "maize"), (6, "sunflower"), (6, "soybean"), (2.5, "oats"), (30, "maize")):
        a = salt_params(sal, crop)
        vectors.append({"fn": "f_salt", "args": [ece, a["a"], a["b"], 0], "expected": salinity.f_salt(ece, a["a"], a["b"])})
    vectors.append({"fn": "f_salt", "args": [6, 1.7, 12, 2], "expected": salinity.f_salt(6, 1.7, 12, 2)})
    for value, crop in ((8.2, "soybean"), (8.2, "maize"), (8.2, "sunflower"), (6.5, "white_sweet_clover"), (5.0, "winter_wheat"), (7.0, "oats")):
        lim = ph_params(phd, crop)["limits"]
        vectors.append({"fn": "f_ph", "args": [value, *lim], "expected": ph.f_ph(value, *lim)})
    for crop, y, m, g in (("winter_wheat", 35, 0, 0), ("sunflower", 15, 0, 0), ("winter_wheat", 35, 10, 15), ("maize", 60, 5, 0)):
        c = humus_params(hum, crop)[0]
        vectors.append({"fn": "annual_balance", "args": [crop, y, m, g], "expected": humus.annual_balance(c, y, m, g)["balance"]})
    return {
        "generated": date.today().isoformat(),
        "source": "Field Shift soil-parameters doc: FAO Irrigation and Drainage Paper 61 Annex 1 (salt), ECOCROP via Recocrop (pH), Chesnul humus-balance method; params/salinity.csv, ph.csv, humus.csv",
        "status": "estimate",
        "model": {"salt_exclude_below": mv("salt_exclude_below"), "gypsum_shift_dsm": mv("salt_gypsum_shift_dsm"),
                  "manure_coef": mv("humus_manure_coef"), "green_manure_coef": mv("humus_green_manure_coef"),
                  "plough_layer_mass_t_ha": mv("plough_layer_mass_t_ha")},
        "notes": NOTES,
        "species": species,
        "vectors": vectors,
    }


def main() -> None:
    doc = build()
    for f in OUT:
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    print(f"{len(doc['species'])} species, {len(doc['vectors'])} test vectors -> {OUT[0]}")


if __name__ == "__main__":
    main()
