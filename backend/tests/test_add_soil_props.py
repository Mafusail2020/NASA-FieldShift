import json

import pytest

from pipeline import add_soil_props as m


def layer(name, d_factor, vals):
    return {"name": name, "unit_measure": {"d_factor": d_factor}, "depths": [{"label": l, "values": {"mean": v}} for l, v in zip(("0-5cm", "5-15cm", "15-30cm"), vals)]}


def doc(*layers):
    return {"properties": {"layers": list(layers)}}


def test_values_thickness_weighted_and_scaled():
    v = m.values(doc(layer("phh2o", 10, [70, 72, 76]), layer("soc", 10, [200, 150, 100])))
    assert v["ph"] == pytest.approx((5 * 7.0 + 10 * 7.2 + 15 * 7.6) / 30)
    assert v["soc_g_kg"] == pytest.approx((5 * 20 + 10 * 15 + 15 * 10) / 30)


def test_values_none_when_any_depth_missing():
    assert m.values(doc(layer("phh2o", 10, [70, None, 76]), layer("soc", 10, [200, 150, 100]))) is None
    assert m.values(doc(layer("phh2o", 10, [70, 72, 76]))) is None  # soc missing


def test_humus_is_carbon_times_van_bemmelen():
    s = m.summarize({"ph": 7.24, "soc_g_kg": 20.0})
    assert s == {"ph": 7.2, "soc_g_kg": 20.0, "humus_pct": pytest.approx(3.45, abs=0.005)}  # 2 % C x 1.724


def test_fill_does_nothing_for_a_cell_that_has_values(tmp_path, monkeypatch):
    f = tmp_path / "grid_soil.json"
    f.write_text(json.dumps({"cells": [{"id": "46.5_30.625", "ph": 7.2, "humus_pct": 3.5}]}))
    monkeypatch.setattr(m, "OUT_FILES", [f])
    monkeypatch.setattr(m, "query", lambda *a: pytest.fail("must not call SoilGrids"))
    assert "already has" in m.fill(46.6, 30.7)
