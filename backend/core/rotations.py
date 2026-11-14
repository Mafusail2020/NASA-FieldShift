"""Chain precomputed pairs into a rotation and compute its criteria.

A rotation is a cyclic list of crops, one per year. Each position j is the pair (previous position -> crop) for every
harvest year in the data, so all phase offsets are covered. There is no single weighted score. Effects of crops two or
more years back are not modelled.
"""
import numpy as np

FALLOW = "black_fallow"
NOTE = "Pairs are computed from NASA POWER daily data 1991-2025 averaged over 3-4 grid points per oblast."

# metric id -> label, unit, source, status (statuses follow the weakest input)
METRICS = {
    "mean_ks_mid": ("Mean Ks in the mid-season stage", "", "FAO-56 Ch. 8 Ks; window = FAO-56 mid-season stage (my choice)", "estimate"),
    "water_stress_days": ("Days with Ks < 1 in the season", "days", "FAO-56 Ch. 8; Ks < 1 = depletion beyond RAW", "estimate"),
    "heat_days_1": ("Days at or above the first heat threshold in the heat window", "days", "crops.csv heat_tmax_1_c and window", "estimate"),
    "heat_days_2": ("Days at or above the second heat threshold in the heat window", "days", "crops.csv heat_tmax_2_c and window", "estimate"),
    "bare_months": ("Bare-soil months", "months", "Months with at least half of days without a crop (fallow, gaps)", "estimate"),
    "soil_water_at_sowing_frac": ("Soil water at sowing, share of TAW", "", "Bucket model, FAO-56 Ch. 8; medium soil unless chosen", "estimate"),
    "min_winter_tmin_no_snow": ("Lowest winter Tmin on days without snow", "degC", "NASA POWER T2M_MIN; snow from the degree-day store", "estimate"),
    "return_years": ("Years until the crop returns to the field", "years", "Rotation length", "data"),
}


def _vals(recs, key):
    return np.array([r[key] for r in recs if r.get(key) is not None], dtype=float)


def _month(date_str):
    return int(date_str[5:7]) - 1


def _crit(cid, value, text, status=None, source=None, extra=None):
    label, unit, src, st = METRICS.get(cid, (cid, "", "", "estimate"))
    d = {"id": cid, "label": label, "value": value, "unit": unit, "text": text, "source": source or src, "status": status or st}
    return {**d, **(extra or {})}


def return_gap(rotation, crop):
    """Shortest number of years between two appearances of `crop` in the cyclic rotation."""
    n = len(rotation)
    pos = [i for i, c in enumerate(rotation) if c == crop]
    if len(pos) == 1:
        return n
    return min((pos[(k + 1) % len(pos)] - pos[k]) % n or n for k in range(len(pos)))


def evaluate(rotation: list[str], pairs: dict, kmu: dict[str, dict]) -> dict:
    """pairs: {'prev>cur': {'records': [...], 'timeline': [...]}} for one oblast and soil."""
    n = len(rotation)
    slots = []
    for j, cur in enumerate(rotation):
        key = f"{rotation[j - 1]}>{cur}"
        slots.append((key, cur, pairs[key]["records"]))
    years = sorted({r["year"] for _, _, recs in slots for r in recs})
    crit, per_crop = [], []
    for j, (key, cur, recs) in enumerate(slots):
        ks = _vals(recs, "mean_ks_mid")
        stat = {"slot": j, "crop": cur, "n_years": len(recs)}
        if len(ks):
            stat.update(mean_ks_mid=float(ks.mean()), mean_ks_mid_p10=float(np.percentile(ks, 10)),
                        water_stress_days=float(_vals(recs, "water_stress_days").mean()))
        for h in ("heat_days_1", "heat_days_2"):
            v = _vals(recs, h)
            stat[h] = float(v.mean()) if len(v) else None
            stat[h + "_n_years"] = len(v)
        stat["soil_water_at_sowing_frac"] = float(_vals(recs, "soil_water_at_sowing_frac").mean())
        stat["bare_months"] = float(_vals(recs, "bare_months").mean())
        t = _vals(recs, "min_winter_tmin_no_snow")
        stat["min_winter_tmin_no_snow"] = float(t.min()) if len(t) else None
        per_crop.append(stat)

    all_recs = [r for _, cur, recs in slots if cur != FALLOW for r in recs]
    ks_all = _vals(all_recs, "mean_ks_mid")
    if len(ks_all):
        p10 = float(np.percentile(ks_all, 10))
        crit.append(_crit("mean_ks_mid", float(ks_all.mean()),
                          f"Mean Ks in the mid-season stage is {ks_all.mean():.2f}; in the driest 10% of crop-years it is {p10:.2f}.",
                          extra={"p10": p10}))
        days = _vals(all_recs, "water_stress_days")
        crit.append(_crit("water_stress_days", float(days.mean()),
                          f"On average {days.mean():.0f} days per crop-year have Ks below 1."))
    bare = float(np.mean([s["bare_months"] for s in per_crop]))
    crit.append(_crit("bare_months", bare, f"The soil is bare for {bare:.1f} months per year on average."))
    for h, label in (("heat_days_1", "first"), ("heat_days_2", "second")):
        parts = [(s["crop"], s[h], s[h + "_n_years"]) for s in per_crop if s[h] is not None]
        if parts:
            txt = "; ".join(f"{c}: {v:.1f} days" for c, v, _ in parts)
            crit.append(_crit(h, float(np.mean([v for _, v, _ in parts])), f"Mean days at the {label} heat threshold in the heat window ({txt}).",
                              extra={"by_crop": {c: v for c, v, _ in parts}}))
    missing = sorted({s["crop"] for s in per_crop if s["crop"] != FALLOW and s["heat_days_1"] is None})
    if missing:
        crit.append(_crit("heat_days_1", None, f"Heat-stress window is not set for: {', '.join(missing)}.", status="todo",
                          source="crops.csv heat_start/heat_end are todo for these crops"))
    cold = [s["min_winter_tmin_no_snow"] for s in per_crop if s["min_winter_tmin_no_snow"] is not None]
    if cold:
        crit.append(_crit("min_winter_tmin_no_snow", float(min(cold)),
                          f"Lowest winter Tmin on days without snow cover: {min(cold):.1f} °C (modelled snow store)."))
    for crop in dict.fromkeys(rotation):
        gap = return_gap(rotation, crop)
        norm = kmu.get(crop)
        if norm:
            text = f"{crop} returns after {gap} years (norm: {norm['min_return_years']})."
            crit.append(_crit("return_years", gap, text, extra={"crop": crop, "norm": norm["min_return_years"]},
                              source=f"Rotation length; norm: {norm['source']}"))
        else:
            crit.append(_crit("return_years", gap, f"{crop} returns after {gap} years (norm: not set).",
                              extra={"crop": crop, "norm": None}, source="Rotation length; no KMU No. 164 norm entered for this crop"))
    return {"rotation": rotation, "years": [years[0], years[-1]] if years else [], "criteria": crit,
            "per_crop": per_crop, "strip": strip(rotation, pairs), "note": NOTE}


def strip(rotation: list[str], pairs: dict) -> list[dict]:
    """Per rotation year, 12 months: cover label and median soil-water share of TAW.

    Months up to the median harvest month come from the pair ending that year, later months from the next pair.
    """
    n = len(rotation)
    out = []
    for j, cur in enumerate(rotation):
        a = pairs[f"{rotation[j - 1]}>{cur}"]
        b = pairs[f"{cur}>{rotation[(j + 1) % n]}"]
        hm = int(np.median([_month(r["harvest"]) for r in a["records"]]))
        ta = {t["m"]: t for t in a["timeline"]}
        tb = {t["m"]: t for t in b["timeline"]}
        months = []
        for m in range(12):
            t = ta.get(12 + m) if m <= hm else tb.get(m)
            months.append({"month": m + 1, "label": t["label"] if t else None, "frac": t["frac"] if t else None})
        out.append({"slot": j, "crop": cur, "months": months})
    return out
