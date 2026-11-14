import pytest

from core.params import get_value, load_params, todo_cells

PARAMS = "data/params/"


def test_soils_load_and_values():
    s = load_params(PARAMS + "soils.csv", ["soil", "parameter"], {"soil": {"light", "medium", "heavy"}})
    assert get_value(s, {"soil": "medium", "parameter": "awc_m3m3"}) == 0.155
    assert len(todo_cells(s, ["soil", "parameter"])) == 0


def test_todo_value_raises():
    m = load_params(PARAMS + "model.csv", ["parameter"])
    assert get_value(m, {"parameter": "ze_m"}) == 0.15
    with pytest.raises(ValueError, match="snow_ddf"):
        get_value(m, {"parameter": "snow_ddf"})
