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
