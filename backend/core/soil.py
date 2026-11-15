"""Soil effects for one field: per-crop salt and pH factors, exclusion flag and humus balance of a rotation.

Pure logic. Inputs come from the farmer (ECe, pH, yields, manure, green mass); tables from params/salinity|ph|humus.csv.
Missing table data gives factor None and a `no_data` note, never a silent 1.0.
"""
from core import humus, ph, salinity
from core.soil_params import humus_params, ph_params, salt_params

SALT_EXCLUDE_BELOW = 0.5  # params/model.csv salt_exclude_below


def crop_factors(species: str, ece: float | None, ph_value: float | None, salt_df, ph_df,
                 gypsum: bool = False, gypsum_shift: float = 2.0, exclude_below: float = SALT_EXCLUDE_BELOW) -> dict:
    """f_salt, f_ph and flags for one crop. A factor is None when the input or the table value is missing."""
    out = {"crop": species, "f_salt": None, "f_ph": None, "excluded": False, "ph_warning": False,
           "low_confidence": False, "notes": []}
    sp = salt_params(salt_df, species)
    if ece is None:
        out["notes"].append("ECe not entered")
    elif sp is None:
        out["notes"].append("no salt-tolerance data for this crop")
    else:
        out["f_salt"] = salinity.f_salt(ece, sp["a"], sp["b"], gypsum_shift if gypsum else 0.0)
        out["excluded"] = salinity.is_excluded(out["f_salt"], exclude_below)
        out["low_confidence"] = sp["low_confidence"]
        out["salt_source"], out["salt_status"] = sp["source"], sp["status"]
    pp = ph_params(ph_df, species)
    if ph_value is None:
        out["notes"].append("pH not entered")
    elif pp is None:
        out["notes"].append("no pH data for this crop")
    else:
        out["f_ph"] = ph.f_ph(ph_value, *pp["limits"])
        out["ph_warning"] = ph.needs_warning(out["f_ph"])
        out["ph_source"], out["ph_status"] = pp["source"], pp["status"]
    return out


def yield_factor(f: dict) -> float:
    """Multiplier for the yield: f_salt only. pH only warns (team decision: ECOCROP limits are too narrow for alkaline soils,
    so f_ph = 0 for sunflower or barley at pH 8.2 would wipe out crops that grow there). Missing f_salt counts as 1; the notes say so."""
    return f["f_salt"] if f["f_salt"] is not None else 1.0


def rotation_humus(rotation: list[str], yields_c_ha: dict[str, float], humus_df, manure_t_ha_year: float = 0.0,
                   green_t_ha_by_crop: dict[str, float] | None = None, humus_start_pct: float | None = None) -> dict:
    """Yearly balances, mean balance and manure norm for a cyclic rotation (one crop per year).

    `green_t_ha_by_crop`: green mass ploughed in the year of that crop (intermediate green manure after it).
    Crops with missing humus data or yield are listed in `missing`; the mean then covers only the other years.
    """
    green = green_t_ha_by_crop or {}
    years, missing = [], []
    for i, crop in enumerate(rotation):
        hp = humus_params(humus_df, crop)
        y = yields_c_ha.get(crop)
        if hp is None or y is None:
            missing.append(crop)
            continue
        b = humus.annual_balance(hp[0], y, manure_t_ha_year, green.get(crop, 0.0))
        years.append({"year": i + 1, "crop": crop, **b, "status": hp[1]["status"], "source": hp[1]["source"]})
    out = {"years": years, "missing": sorted(set(missing)), "mean_balance": None, "manure_norm": None, "per_rotation": None}
    if years:
        mean = humus.rotation_balance(years)
        out.update(mean_balance=mean, per_rotation=sum(y["balance"] for y in years),
                   manure_norm=humus.manure_norm(manure_t_ha_year, mean))
    return out
