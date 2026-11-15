"""Add ONE grid cell, and only when the location is not covered by the existing grid.

Cells are not bulk-generated any more. When a farmer's location falls outside every existing cell, this command generates
just that cell end to end: raw NASA POWER series (about 80 s), annual climate (grid.json), climate-risk statistics
(grid_layers.json), rotation metrics (rotations/<cell>.json + index) and soil (grid_soil.json, with SoilGrids pH and humus). It does nothing for a
location that is already covered. Everything it writes goes to frontend/public/data and backend/data/processed.

Run by hand from backend/: python -m pipeline.add_cell LAT LON [--dry-run]
"""
import sys

from pipeline import add_soil_props, build_grid, build_grid_rotations, build_layers, fetch_soil


def add(lat: float, lon: float, dry_run: bool = False) -> str:
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("latitude must be within -90..90 and longitude within -180..180")
    cell = build_grid.cell_center(lat, lon)
    cid = f"{cell[0]}_{cell[1]}"
    if build_grid.is_covered(build_grid.load_grid_doc(), lat, lon):
        return f"covered: cell {cid} already exists, nothing generated"
    if dry_run:
        return f"not covered: would generate cell {cid} (dry run, nothing generated)"
    build_grid.add_to_grid([cell])
    raw = build_grid.raw_path(*cell)
    build_layers.update_cells([raw])
    _, _, err = build_grid_rotations._job((raw,))
    build_grid_rotations.write_index()
    fetch_soil.update([cell])
    try:
        add_soil_props.fill(*cell)  # pH and humus suggestion for the soil panel; the cell stays usable without it
    except RuntimeError as e:
        err = f"{err}; SoilGrids pH/humus skipped: {e}" if err else f"SoilGrids pH/humus skipped: {e}"
    return f"generated cell {cid}" + (f" ({err})" if err else "")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 2:
        sys.exit(__doc__)
    print(add(float(args[0]), float(args[1]), dry_run="--dry-run" in sys.argv))


if __name__ == "__main__":
    main()
