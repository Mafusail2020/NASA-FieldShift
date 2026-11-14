# Field Shift

NASA Space Apps Challenge 2026 — "Field Shift: Adapting Farms with NASA Data".

## Run

Backend (from repo root, after the venv below exists):
```
make backend
```
Setup:
```
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest
uvicorn app.main:app --reload
```

Frontend (dev server proxies `/api` to `localhost:8000`):
```
cd frontend
npm install
npm run dev
npm run build
```

## Data pipeline (run by hand, from `backend/`)

```
python -m pipeline.fetch_power       # NASA POWER raw CSVs (slow, needs internet)
python -m pipeline.fetch_elevation   # point elevations
python -m pipeline.add_eto           # daily ETo
python -m pipeline.build_pairs       # all (previous crop -> crop) pairs
python -m pipeline.export            # JSON for the API and frontend/public/data
```

## Pre-registered validation predictor

Fixed on 2026-11-14, before `pipeline/validate.py` was written or run.

- Outcome: detrended oblast yield of a crop, in a year (ratio of the reported enterprise yield to the 2000-2021 trend).
- Single predictor: **mean Ks in the crop's critical window** (`mean_ks_mid` from `core/pairs.py`: the FAO-56 mid-season stage), for the same crop, oblast and year, taken from the water balance.
- Model: panel regression with oblast fixed effects, standard errors clustered by year. Also leave-one-year-out. The result is reported whatever it is.
- No other predictor, window or specification will be tried after seeing the data.
