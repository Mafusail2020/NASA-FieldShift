from fastapi import APIRouter, HTTPException

from app.schemas import SoilRequest, SoilResponse
from app.store import store
from core.crops import CROPS, GREEN_MANURES
from core.soil import yield_factor, crop_factors, rotation_humus

router = APIRouter(prefix="/api/soil")
SRC = "Field Shift soil-parameters doc: FAO-61 Annex 1 (salt), ECOCROP (pH), Chesnul method (humus)"
NOTES = ["Salinity and pH are for the whole field as entered; a single ECe or pH value is an average of the field.",
         "pH only warns: ECOCROP limits are probably too narrow for alkaline southern soils.",
         "Missing table data is reported as no data, never as a factor of 1.",
         "Manure is entered per rotation and spread evenly over its years."]


@router.post("/evaluate", response_model=SoilResponse)
def evaluate(req: SoilRequest):
    unknown = sorted({c for c in [*req.rotation, *req.green_after, *req.yields_c_ha] if c not in CROPS | GREEN_MANURES})
    if unknown:
        raise HTTPException(422, f"unknown crop: {', '.join(unknown)}")
    m = store.soil_model
    crops = []
    for c in dict.fromkeys(req.rotation):
        if c == "black_fallow":
            continue
        f = crop_factors(c, req.ece, req.ph, store.salt, store.ph, req.gypsum, m["gypsum_shift"], m["exclude_below"])
        crops.append({**f, "factor": yield_factor(f)})
    green = {c: req.green_t_ha for c in req.green_after if c in req.rotation}
    h = rotation_humus(req.rotation, req.yields_c_ha, store.humus, req.manure_t_ha_rotation / len(req.rotation), green)
    after = None
    if req.humus_pct is not None and h["mean_balance"] is not None:
        after = max(0.0, req.humus_pct + 10 * h["mean_balance"] / m["layer_mass"] * 100)
    return SoilResponse(crops=crops, humus={**h, "humus_pct_after_10y": after}, source=SRC, status="estimate", notes=NOTES)
