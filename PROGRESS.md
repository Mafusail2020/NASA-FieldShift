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
