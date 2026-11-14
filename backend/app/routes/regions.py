from fastapi import APIRouter, HTTPException

from app.schemas import Alternative, Climate, EvaluateResponse, Region, RotationRequest
from app.store import store
from core.climate import climate_doc
from core.rotations import evaluate

router = APIRouter(prefix="/api/regions")
SRC = "NASA POWER daily, community AG, 1991-2025; mean of grid points on cropland (rough OSM check)"


def _region(rid: str) -> dict:
    if rid not in store.regions:
        raise HTTPException(404, f"unknown region {rid}")
    return store.regions[rid]


@router.get("", response_model=list[Region])
def regions():
    return [Region(id=r["id"], name_en=r["name_en"], name_uk=r["name_uk"], n_points=len(r["points"]), source=SRC, status="data")
            for r in store.regions.values()]


@router.get("/{rid}/climate", response_model=Climate)
def climate(rid: str, soil: str = "medium"):
    reg = _region(rid)
    if soil not in reg["pairs"]:
        raise HTTPException(422, f"unknown soil {soil}")
    return Climate(**climate_doc(reg, soil, store.meta["crops"]))


@router.post("/{rid}/rotations/evaluate", response_model=EvaluateResponse)
def evaluate_rotations(rid: str, req: RotationRequest):
    pairs = _region(rid)["pairs"][req.soil]
    farmer = evaluate(list(req.rotation), pairs, store.kmu)
    alts = [Alternative(id=a["id"], name=a["name"], source=a["source"], status=a["status"],
                        evaluation=evaluate(a["crops"], pairs, store.kmu)) for a in store.alternatives]
    return EvaluateResponse(region=rid, soil=req.soil, farmer=farmer, alternatives=alts)
