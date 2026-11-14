# Progress

## Phase 0 — Repository skeleton
Done, approved by Ivan.

## Phase 1 — NASA POWER data
Status: in review.

Decisions (with Ivan):
- Oblasts: Vinnytska (4 points), Poltavska, Kirovohradska, Odeska (3 points each). Fewer than the 4-point minimum, chosen by Ivan.
- Points were checked with Nominatim (oblast) and Overpass (OSM `landuse=farmland` count within 3 km). This is a rough heuristic, not a land-cover check.
- Snow parameter: `SNODP` (snow depth, cm). POWER also offers `PRECSNOLAND`, `FRSNO`.
- No two points in one oblast gave identical data, so no duplicated POWER cells.

Open questions: see Phase 1 report.
