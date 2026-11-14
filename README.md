# Field Shift

NASA Space Apps Challenge 2026, Kyiv — "Field Shift: Adapting Farms with NASA Data".

A farmer picks an oblast and enters their current crop rotation. The app compares it with five alternative rotations
over about 35 historical weather years (NASA POWER, 1991-2025) and shows water stress, heat stress, bare-soil months,
winter minimum temperature without snow, the gap from the national rotation norm (KMU Resolution No. 164, shown as a
criterion, not a filter) and a gross-margin range per year where yields depend on the previous crop.

**It is an analysis for the oblast, not for a specific field.** No single score is computed. No language model produces
numbers or conclusions: all explanations are deterministic templates filled from computed values. Every number the API
returns carries `source` and `status` (`data`, `literature`, `estimate`, `todo`).

## Current state (14 Nov 2026)

- Computed: winter wheat, maize, black fallow in four demo oblasts (Vinnytsia, Poltava, Kirovohrad, Odesa), three soil presets.
- Not computed yet: sunflower and pea (no verified sowing rule or heat window), frost (thresholds are `todo`), the Money tab and the
  validation (they need Derzhstat enterprise yields, prices and costs, which have not been supplied).
- Alternative rotations A-E in `backend/data/params/rotations.yaml` are drafts, not recommendations.

## Run

Backend (Python 3.10+):

```
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest
cd .. && make backend        # uvicorn app.main:app on http://localhost:8000
```

Frontend (Node 20+; the dev server proxies `/api` to `localhost:8000`):

```
cd frontend
npm install
npm run dev
npm run build                # type-check and production build
```

For a deployed frontend, set `VITE_API_URL` to the API address at build time. If the API does not answer within 5 seconds,
the frontend reads `frontend/public/data/*.json` instead (offline mode, rotations up to 3 years, no Money tab).

## Data pipeline (offline, run by hand from `backend/`)

```
python -m pipeline.fetch_power       # NASA POWER raw CSVs (slow, needs internet)
python -m pipeline.fetch_elevation   # point elevations
python -m pipeline.add_eto           # daily ETo
python -m pipeline.build_pairs       # every (previous crop -> crop) pair, year, oblast, soil
python -m pipeline.fallow_check      # sanity check: share of fallow rainfall stored in soil (10-53%)
python -m pipeline.yields            # needs data/raw/yields/yields.csv (not supplied yet)
python -m pipeline.validate          # needs yields; writes data/processed/validation.json
python -m pipeline.export            # JSON for the API and frontend/public/data
```

The API never calls NASA at request time. `core/` holds each formula once and is shared by the pipeline and the API.

## Data sources

| What | Source | Status |
|---|---|---|
| Daily weather | NASA POWER, community AG, 1991-2025, mean of 3-4 cropland points per oblast (cell about 0.5 x 0.625 deg, 55 x 46 km) | data |
| ETo, Kc, root depth, depletion fraction, soil water | FAO-56 (Allen et al. 1998), Tables 11, 12, 19, 22, Annex 7, Chapters 3-8 | literature |
| Snow melt factor | 4 mm/degC/day, estimate from the 3-5 range in HESS 30, 2613 (2026) | estimate |
| Fallow check | Nielsen & Vigil 2010, Agron. J. 102:537 | literature |
| Predecessor effect k (wheat) | Solodushko 2024, via the project brief | literature |
| Yields, prices, costs | Derzhstat (to be supplied) | todo |

Parameter files in `backend/data/params/` have a `source` and a `status` on every row. A value that is missing stays empty
with `status=todo` and is shown as such on the Method page.

## Pre-registered validation predictor

Fixed on 2026-11-14, before `pipeline/validate.py` was written or run.

- Outcome: detrended oblast yield of a crop, in a year (ratio of the reported enterprise yield to the 2000-2021 trend).
- Single predictor: **mean Ks in the crop's critical window** (`mean_ks_mid` from `core/pairs.py`: the FAO-56 mid-season stage), for the same crop, oblast and year, taken from the water balance.
- Model: panel regression with oblast fixed effects, standard errors clustered by year. Also leave-one-year-out. The result is reported whatever it is.
- No other predictor, window or specification will be tried after seeing the data.

## Limitations

- Effects of crops two or more years back, nutrients, disease (beyond a broomrape note for sunflower), microclimate,
  irrigation, runoff from frozen ground and surface runoff, and extreme rainfall are not modelled.
- Climate is the mean of 3-4 grid points per oblast. Points were checked for cropland only roughly (OSM farmland count),
  not against a land-cover map.
- Winter wheat uses the 335-day FAO-56 Idaho row, so harvest dates are later than typical in Ukraine.
- Several choices are mine and marked `estimate`: sowing search windows, critical window = mid-season stage, snow melt
  factor, fallow window and start state, linear 2000-2021 yield trend. See `PROGRESS.md`.
- The occupied oblasts on the map are hatched as whole oblasts; real boundaries of occupation change.
- Fallow storage share in Odesa oblast has a median of 9%, slightly below the published 10-53% range; parameters were not tuned.

## AI disclosure

The code was written by Claude (Anthropic) working with Ivan in Claude Code. The idea, the data choices and the scientific
method are Ivan's. Claude looked up some literature values on the web; each one is recorded with its source and status in
`backend/data/params/`.
