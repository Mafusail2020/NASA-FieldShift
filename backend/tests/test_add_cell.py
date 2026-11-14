import pytest

from pipeline.add_cell import add
from pipeline.build_grid import cell_center, is_covered


def test_cell_center_is_the_cell_containing_the_point():
    # lat steps of 0.5, lon steps of 0.625; centres at multiples of those
    assert cell_center(49.84, 24.03) == (50.0, 23.75)
    assert cell_center(49.0, 28.125) == (49.0, 28.125)
    assert cell_center(49.1, 28.3) == (49.0, 28.125)
    assert cell_center(49.4, 28.5) == (49.5, 28.75)
    assert cell_center(-33.9, 18.4) == (-34.0, 18.125)


def test_is_covered_only_for_cells_in_the_grid():
    doc = {"cells": [{"id": "49.0_28.125"}, {"id": "50.0_23.75"}]}
    assert is_covered(doc, 49.1, 28.3)
    assert is_covered(doc, 49.84, 24.03)
    assert not is_covered(doc, 55.0, 37.6)
    assert not is_covered(None, 49.1, 28.3)


def test_dry_run_generates_nothing_and_reports_the_cell():
    assert add(49.1, 28.3, dry_run=True).startswith("covered")          # cell 49.0_28.125 exists in the real grid
    assert add(52.0, 10.0, dry_run=True).startswith("not covered")      # outside the grid: dry run only


def test_rejects_impossible_coordinates():
    with pytest.raises(ValueError):
        add(95, 10, dry_run=True)
