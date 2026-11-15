# Field Shift

NASA Space Apps Challenge 2026, Kyiv: "Field Shift: Adapting Farms with NASA Data".

Field Shift helps farmers in Ukraine choose a crop rotation for the climate their land has actually had. A farmer adds a
field by its coordinates and enters the current rotation. The app replays that rotation, and the rotations that follow
Ukraine's legal return rules, through 35 years of daily NASA POWER weather (1991-2025) for that location. It shows water
stress, bare-soil months, the coldest winter temperature without snow cover, local climate trends, soil limits, and a
gross-margin range per weather year.

**It describes the area around a field (a NASA POWER grid cell of about 55 x 46 km), not the field itself.** No single score
is computed. Every number carries a `source` and a `status` (`data`, `literature`, `estimate`, `sample`, `todo`).

## What the app does

The site has four pages: Home, Fields, Finance and Assistant.

**Fields.** The farmer adds field rows (name, coordinates, area, crop, optional sowing date). A small satellite map helps to
read coordinates. The site finds the NASA POWER grid cell (306 cells of 0.5 x 0.625 deg cover Ukraine) and fills each field
with:

- **Field passport**: summary tiles and a short verdict.
- **Climate and risks**: 1991-2025 trends in temperature, yearly, summer and growing-season rain, share of rain in
  heavy-rain days, growing-season water balance (rain minus reference evapotranspiration), hot days (Tmax >= 32 and 35 degC),
  heavy-rain days, last spring frost, first autumn frost and frost-free season. Trends use the Theil-Sen slope and the
  Mann-Kendall test.
- **Crop fit**: how well each crop's water need was met in this cell, with soil checks.
- **Soil**: texture from ISRIC SoilGrids mapped to a light, medium or heavy preset (overridable). Optional salinity (ECe),
  pH and humus inputs give a salt yield factor (Maas-Hoffman), a pH warning (ECOCROP ranges) and a humus balance.
- **Rotation**: the farmer's rotation next to rule-valid alternatives (3,191 rotations of 2-5 years from 9 crops, including
  black fallow, that respect the return intervals of KMU Resolution No. 164). Sorted by a priority the farmer picks
  (water supply, soil cover, dry-year risk), with one-change suggestions and a trade-off table.
- **Season twins** (winter wheat, maize): the three past seasons whose weather since sowing looked most like this one, and
  how they ended. Not a forecast.

**Finance.** Gross and net margin per hectare, Bad/Base/Good scenarios, break-even yield and price, margin per historical
weather year, rotation comparison, and a farm summary. USD by default, UAH switch, print and CSV export. Costs are
illustrative `sample` values until real enterprise costs are supplied.

**Assistant.** A read-only chat assistant that answers questions about the farmer's fields by calling tools over the same
data. It runs a local open-weight model through Ollama (any OpenAI-compatible server). It never produces the app's numbers.

## Methods

- **Crop water use**: FAO-56 (Allen et al. 1998). Daily reference evapotranspiration by Penman-Monteith from NASA POWER
  temperature, dew point, wind and solar radiation; crop coefficients by stage; a daily single-layer soil-water bucket;
  water-stress coefficient Ks. A water-stress day is a day with Ks < 1.
- **Snow**: degree-day snow store (melt factor 4 mm/degC/day, estimate). Evaporation and transpiration are zero under snow.
- **Rotations**: every (previous crop -> crop) pair is computed for every harvest year 1993-2025 and three soil presets,
  then chained into rotations, so every starting year is covered. Criteria are shown side by side, not blended.
- **Economics**: margin = yield x predecessor effect k x price - cost. Yield per weather year is an estimate: the order of
  the years comes from the cell's water balance (mean Ks in the mid-season stage), the size of the swings from the national
  FAOSTAT yield record (quantile mapping). Heat, frost, pests and the war are not in it.
- **Season twins**: 10-day blocks of cumulative rain, cumulative growing degree-days, mean Tmax and mean radiation, z-scored
  against every earlier year; the three closest years are returned.

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

For a deployed frontend, set `VITE_API_URL` to the API address at build time. Fields and Finance read precomputed JSON from
`frontend/public/data/` and work without the API. Season twins need the API (otherwise a saved example is shown). The
Assistant needs the API and a local model: `LOCAL_LLM_URL` (default Ollama `http://localhost:11434/v1`), `LOCAL_LLM_MODEL`
(default: auto-pick).

## Data pipeline (offline, run by hand from `backend/`)

The API never calls NASA at request time. `core/` holds each formula once and is shared by the pipeline and the API.

```
python -m pipeline.add_cell LAT LON         # one new grid cell end to end: NASA POWER, climate, layers, rotations, soil
python -m pipeline.build_layers             # climate-risk statistics for cells missing from grid_layers.json
python -m pipeline.build_grid_rotations     # pair metrics for cells missing from rotations/
python -m pipeline.fetch_soil               # SoilGrids texture for cells missing from grid_soil.json
python -m pipeline.add_soil_props LAT LON   # SoilGrids pH and humus for one cell
python -m pipeline.refresh_season LAT LON   # current-year NASA POWER for one cell (season twins)
python -m pipeline.fetch_kmu164             # KMU No. 164 return intervals
python -m pipeline.fetch_crop_info          # FAOSTAT, USDA PSD, UGA prices (needs scipy)
python -m pipeline.export_finance           # finance_inputs.json
python -m pipeline.export_soil              # soil_params.json for the soil analysis
```

Cells are not bulk-generated: `add_cell` does nothing for a location that is already covered. The earlier oblast pipeline
(`fetch_power`, `fetch_elevation`, `add_eto`, `build_pairs`, `fallow_check`, `yields`, `validate`, `export`) is kept for the
validation and the `/api/regions` endpoints.

## Data sources

| What | Source | Status |
|---|---|---|
| Daily weather 1991-2025: T2M_MAX, T2M_MIN, T2MDEW, WS2M, ALLSKY_SFC_SW_DWN, PRECTOTCORR (SNODP for the oblast points) | NASA POWER daily point API, community AG, MERRA-2 grid 0.5 x 0.625 deg | data |
| Soil texture, pH, organic carbon | ISRIC SoilGrids 2.0 (Poggio et al. 2021), 250 m prediction, 0-30 cm | data (prediction) |
| ETo, Kc, root depth, depletion fraction, soil water | FAO-56 (Allen et al. 1998) | literature |
| Crop salt tolerance | FAO Irrigation and Drainage Paper 61, Annex 1 (Maas and Grattan) | literature |
| Crop pH ranges | FAO ECOCROP via Recocrop | literature |
| Crop return intervals | KMU Resolution No. 164 of 11.02.2010 (zakon.rada.gov.ua) | literature |
| National yields and producer prices | FAOSTAT (QCL, PP); USDA FAS PSD | data |
| Export prices | UGA Index (Ukrainian Grain Association) | data |
| Predecessor effect k (wheat) | Solodushko 2024 | literature |
| Fallow check | Nielsen & Vigil 2010, Agron. J. 102:537 | literature |
| Snow melt factor | 4 mm/degC/day, from the 3-5 range in HESS 30, 2613 (2026) | estimate |
| Production costs | illustrative values in `params/costs.csv` | sample |
| Ukraine outline | geoBoundaries ADM1 (ODbL) | data |
| Satellite base map | Esri World Imagery tiles | data |

Parameter files in `backend/data/params/` have a `source` and a `status` on every row. A missing value stays empty with
`status=todo` and is shown as such.

Not used yet: SRTM slope and MODIS NDVI (NASA Earthdata, AppEEARS). The app shows these layers as "not available yet".

## Pre-registered validation predictor

Fixed on 2026-11-14, before `pipeline/validate.py` was written or run.

- Outcome: detrended oblast yield of a crop, in a year (ratio of the reported enterprise yield to the 2000-2021 trend).
- Single predictor: **mean Ks in the crop's critical window** (`mean_ks_mid` from `core/pairs.py`: the FAO-56 mid-season stage), for the same crop, oblast and year, taken from the water balance.
- Model: panel regression with oblast fixed effects, standard errors clustered by year. Also leave-one-year-out. The result is reported whatever it is.
- No other predictor, window or specification will be tried after seeing the data.

The validation has **not been run**: it needs Derzhstat enterprise yields, which have not been obtained.

## Limitations

- Weather is at grid-cell scale (about 55 x 46 km), not field scale. MERRA-2 is reanalysis, not a station record.
- No yield validation yet (see above). Costs are samples; prices end in 2023.
- Heat windows are set only for winter wheat; per-crop frost thresholds are `todo`. Effects of crops two or more years back,
  nutrients, pests and disease, irrigation, surface runoff and runoff from frozen ground are not modelled.
- Winter wheat uses the 335-day FAO-56 Idaho row, so harvest dates are later than typical in Ukraine.
- SoilGrids pH and humus are a prefill for one cell so far; salinity must be entered by the farmer.
- The draft rotations A-E and the assistant's knowledge base (`backend/data/kb/`) were written by Claude and need review by
  an agronomist.
- Several choices are marked `estimate` (sowing search windows, critical window = mid-season stage, snow melt factor, linear
  yield trend). See `PROGRESS.md`.

## AI disclosure

The idea is Ivan's: the challenge choice, the concept of testing rotations against decades of NASA weather, and the market
and economics layer. The code, data pipelines and tests were written by Claude (Anthropic) in Claude Code, directed by
Ivan, who made the scientific and design decisions and reviewed the results. Claude was also used for domain research,
checking scientific validity and reviewing the architecture. Literature values it found are recorded with their source and
status in `backend/data/params/`. AI-written content in the app is labelled ("Draft by Claude" rotations, the assistant's
knowledge base). The in-app assistant uses a local open-weight model and does not produce the app's numbers.

## License

MIT (code). Data keeps the license of each source.
