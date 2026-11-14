"""Climate-tab payload of one oblast: climate series plus stress series per crop (shared by the API and the export)."""
from core.rotations import crop_series

CROPS = ["winter_wheat", "maize"]


def _thr(crop_rows: list[dict], crop: str, n: int):
    for r in crop_rows:
        if r["crop"] == crop and r["parameter"] == f"heat_tmax_{n}_c" and r["value"] != "":
            return float(r["value"]), r["status"]
    return None, "todo"


def climate_doc(region_doc: dict, soil: str, crop_rows: list[dict]) -> dict:
    stress = {}
    for crop, s in crop_series(region_doc["pairs"][soil], CROPS).items():
        t1, st1 = _thr(crop_rows, crop, 1)
        t2, _ = _thr(crop_rows, crop, 2)
        stress[crop] = {**s, "heat_threshold_1_c": t1, "heat_threshold_2_c": t2, "heat_status": st1,
                        "source": "Water-balance model (FAO-56 Ch. 8) on NASA POWER data; mean over predecessors",
                        "status": "estimate"}
    return {"region": region_doc["id"], **region_doc["climate"], "stress": stress, "frost_status": "todo",
            "frost_note": "Frost days are not computed: frost thresholds are todo in crops.csv."}
