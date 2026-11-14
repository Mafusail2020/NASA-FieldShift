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
