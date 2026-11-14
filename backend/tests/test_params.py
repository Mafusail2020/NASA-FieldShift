import pytest

from core.params import get_value, load_params, todo_cells

PARAMS = "data/params/"


def test_soils_load_and_values():
    s = load_params(PARAMS + "soils.csv", ["soil", "parameter"], {"soil": {"light", "medium", "heavy"}})
    assert get_value(s, {"soil": "medium", "parameter": "awc_m3m3"}) == 0.155
    assert len(todo_cells(s, ["soil", "parameter"])) == 0


def test_todo_value_raises(tmp_path):
    p = tmp_path / "m.csv"
    p.write_text("parameter,value,unit,source,status\nze_m,0.15,m,FAO-56 Annex 7,literature\nsnow_ddf,,mm/degC/day,,todo\n")
    m = load_params(p, ["parameter"])
    assert get_value(m, {"parameter": "ze_m"}) == 0.15
    with pytest.raises(ValueError, match="snow_ddf"):
        get_value(m, {"parameter": "snow_ddf"})


def test_model_csv_loads():
    m = load_params(PARAMS + "model.csv", ["parameter"])
    assert get_value(m, {"parameter": "fallow_length_months"}) == 14
