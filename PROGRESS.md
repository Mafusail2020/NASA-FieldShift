# Progress

## Phase 0 — Repository skeleton
Done, approved.

## Phase 1 — NASA POWER data
Done, approved. Oblasts: Vinnytska (4 points), Poltavska, Kirovohradska, Odeska (3 each; fewer than the 4-point minimum, Ivan's choice). Snow parameter: SNODP. Points checked with Nominatim + Overpass farmland count (rough heuristic, not land cover).

## Phase 2 — Reference evapotranspiration
Done. FAO-56 Penman-Monteith + Hargreaves fallback in `core/eto.py`. Tests use FAO-56 Chapter 4, Example 18 (text fetched from fao.org at Ivan's request). `penman_monteith_eto` takes `ea`; dew point is converted by `actual_vapour_pressure_from_dewpoint`. Elevation from POWER cell (`points.csv`). Hargreaves kept as fallback only, uncalibrated.

## Phase 3 — Crop parameters and phenology
Status: in review.
- `crops.csv` is long format: one row per (crop, parameter) with its own source and status.
- Only values from CLAUDE.md are filled: GDD base (wheat 0, maize 10, sunflower 6.7), maize heat thresholds 32/35, wheat heat threshold 30 (estimate). Everything else is empty with status=todo.
- GDD = max(Tmean - base, 0), no upper cap. Heat/GDD windows: see open questions.

### Phase 3 follow-up (Ivan's decisions)
- Sunflower heat: only the window is shared with maize, thresholds not set. GDD formula and `heat_basis` accepted. Winter wheat stages left as FAO.
- FAO-56 Tables 11, 12, 22 filled from fao.org text (status=literature, row/region named in `source`). Row choices and range choices (lower/upper) are mine, listed in each `source`; Ivan to review.
- Still todo: maize kc_end, zr_min_m, sowing rules/dates, heat windows, frost thresholds, fallows.

## Phase 4 — Water balance and stress metrics
Status: code and synthetic tests done; real-data run blocked (see open questions).
- `core/kc.py`: Eq. 62/63/65/66, Annex 7 Kc ini for bare soil (monthly). `core/bucket.py`: snow store + daily bucket. `core/stress.py`: metrics.
- `params/soils.csv`: light = sandy loam, medium = loam, heavy = clay; FAO-56 Table 19 midpoints. `params/model.csv`: snow_ddf (todo), Ze 0.15 m.
- Approved by Ivan: Dr kept in mm when Zr grows, cut to new TAW when it shrinks; no surface runoff; AWC from Table 19; Kc ini via Annex 7.
- Assumptions of mine: W_ini = TEW in Annex 7 corrections; with no wetting event in a month one wetting at month start is assumed; ET = 0 under snow; Ks < 1 counts as a water-stress day; bare month = at least half of days without crop; dr0 = 0 (field capacity) at series start.
- Annex 7 Example 7-1, Fig. 29 case: FAO prints 0.57, Eq. 7-3 gives 0.533 (Fig. 30a case matches, 0.75). Test is xfail until Ivan decides.

### Phase 4 follow-up (Ivan: look up snow/fallow values yourself, use FAO sowing rule, fill the rest accordingly)
- Found and entered: `snow_ddf` = 4 mm/degC/day (estimate; HESS 2026, melt factors cluster at 3-5 in temperate climates, not calibrated to Ukraine); black-fallow depth 1.8 m and 14-month window (Nielsen & Vigil, Nielsen/Vigil/Benjamin 2009 poster; read via search summaries); maize Kc end 0.35 (my choice of the lower FAO value).
- Sowing: wheat and maize by FAO-56 Table 11 fn 2 temperature rule; search-window starts (15 Aug, 1 Mar) are my estimates. Sunflower and pea: no verified source, left todo.
- Not entered (sources unverified or ambiguous, noted in `source`): maize/sunflower heat windows, frost thresholds, sunflower/pea sowing temperature, zr_min, green-manure fallow.
- Fallow storage share (medium soil, Dr = TAW at window start, 34 windows/oblast, window 1 Jul + 14 months): median Vinnytska 0.19, Poltavska 0.21, Kirovohradska 0.16, Odeska 0.09. Odeska median is below 10%; parameters not tuned. Window start state (Dr = TAW) is my assumption.

## Phase 5 — Vertical slice
Status: built and tested locally; not deployed (needs Ivan's decision on hosts/accounts).
- Pairs: `core/pairs.py`, `pipeline/build_pairs.py` (3 crops x 3 soils x 4 oblasts x 33 harvest years 1993-2025), `pipeline/export.py`, `core/rotations.py`, `data/params/rotations.yaml` (A-E are Claude's drafts from wheat/maize/fallow, status estimate, Ivan to approve), API `/api/regions`, `/climate`, `/rotations/evaluate`, rough page in `frontend/src/Results.tsx`.
- Only winter wheat, maize and black fallow are computed; sunflower and pea have no verified sowing rule or heat window.
- My calendar choices: harvest year Y; wheat sown autumn Y-1, maize spring Y by FAO-56 temperature rule, sowing delayed until the day after the previous harvest; fallow slot 1 Sep Y-1 .. 31 Aug Y; critical window for mean Ks = FAO-56 mid-season stage; water balance of a pair starts at field capacity on the previous crop's sowing.
- Wheat uses the 335-day FAO Idaho row, so wheat harvest is mid-Aug to Sep (later than real Ukrainian harvest); wheat after maize is sown late (Oct) and the heat window falls later, so heat days differ by predecessor partly because of the calendar.
- KMU No. 164 norm only for sunflower (7 years, from CLAUDE.md); other crops show "norm: not set".

## Phase 6 — Yields, prices, economics, validation
Status: code and tests done; no real run, the inputs are not provided.
- README: pre-registered predictor (mean Ks in the crop's critical window), committed before `validate.py` existed.
- Built: `core/economics.py`, `pipeline/yields.py` (masks, linear 2000-2021 trend, Yhat = ratio x trend(2021)), `pipeline/validate.py` (FE, clustered by year, leave-one-year-out; medium soil, mean over predecessors), `GET /api/defaults`, `POST /api/economics` (k on/off, overrides, best alternative with and without k).
- Params: `k_predecessor.csv` (wheat after fallow 1.08, pea 1.13, sunflower 0.79 from Solodushko 2024; everything else 1.0 estimate), `prices.csv` (price, price year, cost per ha: all todo), `war_masks.csv` (2014 rule for Crimea/Donetsk/Luhansk; the 2022 list is not entered).
- Blocked: `data/raw/yields/yields.csv` (Derzhstat enterprise yields), prices, costs. `www.ukrstat.gov.ua` has an expired SSL certificate (2026-11-14); I did not bypass certificate checks.
- Open: whether the 4 demo oblasts need a 2022+ mask; linear trend and 2021 technology level are my choices.

## Phase 7 — Full frontend
Status: built, checked in a browser; Method page is a placeholder (Phase 8); not deployed.
- Routes `/`, `/results/:region`, `/method`. Start: Leaflet map (geoBoundaries ADM1 2017, ODbL; demo oblasts green; Crimea, Sevastopol, Donetsk, Luhansk, Zaporizhzhia, Kherson hatched as WHOLE oblasts: a simplification, real occupied areas are not drawn), form (rotation, soil, area), label "Analysis for the oblast, not your specific field".
- Results tabs: Climate (trends, Ks, water-stress days, heat days, frost = todo), Rotations (strip + criteria table), Money (inputs with source/status, 300 ms debounce, dot chart, median, break-even, loss years, k switch, best alternative with/without k).
- Every number has an ℹ source tooltip; `estimate` and `todo` values are marked. Texts are templates in `src/locales/{en,uk}.json` filled from computed values. The Ukrainian wording is mine: Ivan to review.
- Offline: if the API does not answer in 5 s (or answers 5xx) the app reads `public/data/*.json`, disables the price/cost inputs and shows "Offline mode — default prices". Offline rotations are limited to 3 years (precomputed `<oblast>_eval.json`); the Money tab needs the API.
- Backend additions: `core/climate.py`, per-crop break-even in `/api/economics`, `?soil=` on `/climate`, offline export.
- Checks: type-check + build; headless Chrome (puppeteer-core) on Start, Rotations (uk), Climate, Money, offline mode; three numbers compared with the JSON. Money chart was only seen with SYNTHETIC yields (not committed).

## Phase 8 — Method page, README, final checks
Status: done locally. Not deployed.
- `GET /api/meta` and `/method` (datasets with POWER cell ~55 x 46 km, formulas, crops/soils/model tables with source and status, validation block, not modelled, limitations, AI disclosure). Validation shows "todo, not run" until yields exist; `pipeline/validate.py` now writes `validation.json`, merged into `meta.json` by the export.
- README rewritten: what it is, run, pipeline order, data sources, pre-registered predictor (unchanged), limitations, AI disclosure.
- Final checks run: `pytest` 67 passed, 1 xfailed; `npm run build` ok; headless Chrome on /method, /, results (rotations) and money, with the API running and with it stopped: no console errors; no value with status todo is shown without a marker (only explanatory text mentions the word).
- Not done: deployed URLs (Render/Vercel accounts are Ivan's), `docker build`, mobile layout check, a real validation run.

## Phase 9 — Soil analysis (salinity, pH, humus)
Status: built and tested locally; browser-checked at 1280 and 360 px (headless Chrome, no console errors, no horizontal scroll).
- Source: the team doc "Field Shift: soil parameters (salinity, pH, humus)". Tables went to `params/salinity.csv`, `ph.csv`, `humus.csv` (long format, source and status per row) plus four rows in `model.csv`.
- `core/salinity.py` (Maas-Hoffman), `ph.py` (ECOCROP trapezoid), `humus.py` (Chesnul), `soil_params.py` (loaders; empty = None), `soil.py` (per-crop factors, humus of a rotation). Tests: `tests/test_soil.py`, `test_soil_api.py` use the doc's worked examples.
- `pipeline/export_soil.py` -> `soil_params.json` (tables, constants, 17 test vectors computed by `core/`). `POST /api/soil/evaluate` uses the same core.
- Frontend: `lib/soil.ts` (TypeScript port, same vectors checked with `checkVectors`), `components/fields/FieldSoil.tsx` in each field row, `FieldItem.analysis`. The default yield of the Finance summaries is scaled by the salt factor of the row's crop only (pH only warns: scaling by pH gave 0 for sunflower at pH 8.2, found in the browser check); a yield typed by the user is not scaled.
- Decisions: salt below 0.5 marks the crop red, pH only warns (team rule). Missing table data shows "no data", never 1.0.
- Assumptions of mine: manure is entered per rotation and divided by the rotation length (the doc says "t/ha per rotation" but its formulas are per year; the manure norm is per year as in the source formula); humus after 10 years uses a 0-30 cm layer mass of 3,900 t/ha (estimate, not in the doc); yields default to the FAOSTAT median (t/ha x 10) when the farmer enters none; buckwheat added as todo rows; `spring_wheat` added to the crop list.
- Gaps (todo): salinity of millet, buckwheat, white mustard, narrow-leaf lupin; humus of winter rapeseed, buckwheat, black-fallow mineralisation; pH of buckwheat. Proxies (estimate): oilseed radish, hairy vetch salinity; soybean and spring-wheat humus. Low confidence: oats, white sweet clover salinity.
- Alternatives A-E: `FieldSoil` has a soil check table (crops ruled out by salt, humus per year) read from the candidates of `rotations_grid.json`. A rotation with black fallow shows the humus mean without the fallow year (no mineralisation norm yet), so its mean is too high. `Compare.tsx` is untouched.
- SoilGrids prefill: `python -m pipeline.add_soil_props LAT LON` adds pH (water) and humus (organic carbon x 1.724, assumption) to ONE cell of `grid_soil.json`; it skips cells that already have them. The panel shows them as a suggestion with a "Use these values" button (never applied silently). Only the cell 46.5_30.625 (test field near Odesa) has values so far: the other 305 cells would need 300+ new SoilGrids requests, which I did not run because of the no-bulk-fetch rule. Salinity is not predicted by SoilGrids.
- Not done: salt and pH are not in the weather comparison table itself.

## Open items for Ivan
1. Derzhstat enterprise yields, prices, costs (Phase 6) -> then run `yields`, `validate`, `export`.
2. Sunflower and pea: sowing rule, heat windows, frost thresholds; maize heat window.
3. Approve or replace the A-E drafts; review `uk.json`; decide the occupied-area map; Annex 7 Fig. 29 xfail.
4. Deployment: accounts and `VITE_API_URL`.

## Season twins (winter wheat, maize)
Done for the demo. The farmer enters a sowing date; `core/twin.py` compares the weather since sowing with the same window in each of 35 past years (10-day blocks of cumulative rain, cumulative GDD, Tmax, radiation, z-scored) and returns the 3 closest years with how they ended (ripe date by GDD, late-stage rain and dry spell, hot days in the grain-fill window, frost days, next 30 days). API: `GET /api/twin?lat&lon&crop&sowing[&as_of]`. UI: sowing-date input in the field form and a "Season twins" section in the field page, with a saved-example fallback `public/data/twin_sample.json`.
- The archive ends in 2025. `python -m pipeline.refresh_season LAT LON` fetches the current year for one existing cell into `data/raw/power_season/` (the only NASA call outside the archive pipelines; the API never calls NASA).
- Not a forecast; outcomes come from weather only (no yield data). Heat/late-stage windows and 30/32 °C thresholds are estimates (`SEASONS` in core/twin.py). Other crops: not covered yet.
- Tests: `tests/test_twin.py`.
