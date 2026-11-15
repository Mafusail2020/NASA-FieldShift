from datetime import date

from fastapi import APIRouter, HTTPException, Query

from core.twin import SEASONS, cell_center, find_twins, load_daily

router = APIRouter(prefix="/api/twin")
SRC = ("NASA POWER daily, community AG: archive 1991-2025 plus the current season fetched by pipeline.refresh_season; "
       "match = dekad trajectories of cumulative rain, cumulative GDD, Tmax and radiation (core/twin.py)")
NOTES = ["Seasons that looked like this one so far, not a forecast.",
         "Three matches out of about 35 years is a small sample: a large distance means a weak match.",
         "One 0.5 x 0.625 degree cell; MERRA-2 rain is smoothed, so single storms are not seen.",
         "Outcomes come from the weather alone (no yield data); windows and thresholds are estimates."]


@router.get("")
def twin(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180), crop: str = "winter_wheat",
         sowing: date = Query(description="this season's sowing date, YYYY-MM-DD"), as_of: date | None = None):
    if crop not in SEASONS:
        raise HTTPException(422, f"season twin supports only: {', '.join(SEASONS)}")
    la, lo = cell_center(lat, lon)
    df = load_daily(f"{la}_{lo}")
    if df is None:
        raise HTTPException(404, f"no NASA POWER archive for cell {la}_{lo}; run python -m pipeline.add_cell {lat} {lon}")
    c = SEASONS[crop]
    r = find_twins(df, crop, f"{sowing.month:02d}-{sowing.day:02d}", sowing.year + c.sow_year_offset, as_of)
    last = df.dropna().index.max().date()
    return {**r, "cell": f"{la}_{lo}", "data_last_day": last.isoformat(), "source": SRC, "data_status": "estimate", "notes": NOTES}
