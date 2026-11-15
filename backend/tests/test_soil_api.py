import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from pipeline.export_soil import build

client = TestClient(app)
ROT = ["winter_wheat", "sunflower", "winter_wheat", "sunflower"]


def post(**kw):
    return client.post("/api/soil/evaluate", json={"rotation": ROT, "yields_c_ha": {"winter_wheat": 35, "sunflower": 15}, **kw})


def test_humus_matches_doc():
    d = post().json()
    assert d["humus"]["mean_balance"] == pytest.approx(-0.69, abs=0.01)
    assert post(green_t_ha=15, green_after=["winter_wheat"]).json()["humus"]["mean_balance"] == pytest.approx(-0.47, abs=0.01)


def test_manure_per_rotation_is_spread_over_years():
    d = post(manure_t_ha_rotation=40).json()  # 10 t/ha per year -> +0.58
    assert d["humus"]["mean_balance"] == pytest.approx(-0.69 + 0.58, abs=0.01)


def test_salt_and_ph_factors_for_unique_crops():
    d = client.post("/api/soil/evaluate", json={"rotation": ["maize", "sunflower", "maize"], "ece": 6, "ph": 8.2}).json()
    by = {c["crop"]: c for c in d["crops"]}
    assert len(by) == 2
    assert by["maize"]["f_salt"] == pytest.approx(0.484) and by["maize"]["excluded"] and by["maize"]["ph_warning"]
    assert by["sunflower"]["f_ph"] == 0 and not by["sunflower"]["excluded"]
    assert d["humus"]["mean_balance"] is None and d["humus"]["missing"] == ["maize", "sunflower"]


def test_humus_percent_projection():
    d = post(humus_pct=3.0).json()["humus"]
    assert d["humus_pct_after_10y"] == pytest.approx(3.0 + 10 * -0.69 / 3900 * 100, abs=0.02)


def test_gaps_reported_not_hidden():
    d = client.post("/api/soil/evaluate", json={"rotation": ["millet"], "ece": 5, "ph": 6.5, "yields_c_ha": {"millet": 20}}).json()
    assert d["crops"][0]["f_salt"] is None and "no salt-tolerance data for this crop" in d["crops"][0]["notes"]
    assert d["crops"][0]["f_ph"] == 1.0


def test_bad_input_422():
    assert client.post("/api/soil/evaluate", json={"rotation": ["potato"]}).status_code == 422
    assert client.post("/api/soil/evaluate", json={"rotation": ["maize"], "ece": -1}).status_code == 422
    assert client.post("/api/soil/evaluate", json={"rotation": []}).status_code == 422


def test_export_is_current_and_complete():
    doc = build()
    on_disk = json.loads((Path(__file__).resolve().parents[2] / "frontend/public/data/soil_params.json").read_text())
    assert {k: v for k, v in doc.items() if k != "generated"} == {k: v for k, v in on_disk.items() if k != "generated"}
    assert doc["species"]["millet"]["salt"] is None and "salt:a" in doc["species"]["millet"]["gaps"]
    assert len(doc["vectors"]) >= 15
