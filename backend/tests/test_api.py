import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_regions():
    r = client.get("/api/regions")
    assert r.status_code == 200
    ids = {x["id"] for x in r.json()}
    assert ids == {"vinnytska", "poltavska", "kirovohradska", "odeska"}
    assert all(x["source"] and x["status"] for x in r.json())


def test_climate_matches_json():
    r = client.get("/api/regions/odeska/climate")
    assert r.status_code == 200
    c = r.json()
    assert c["years"][0] == 1991 and c["years"][-1] == 2025
    assert len(c["precip_mm"]) == len(c["years"]) == len(c["eto_mm"])
    assert c["status"] == "data"


def test_unknown_region():
    assert client.get("/api/regions/nowhere/climate").status_code == 404
    assert client.post("/api/regions/nowhere/rotations/evaluate", json={"rotation": ["maize"]}).status_code == 404


def test_evaluate_farmer_and_alternatives():
    r = client.post("/api/regions/poltavska/rotations/evaluate", json={"rotation": ["winter_wheat", "maize"], "soil": "medium"})
    assert r.status_code == 200
    d = r.json()
    assert [a["id"] for a in d["alternatives"]] == list("ABCDE")
    assert d["farmer"]["rotation"] == ["winter_wheat", "maize"]
    assert len(d["farmer"]["strip"]) == 2 and len(d["farmer"]["strip"][0]["months"]) == 12
    for c in d["farmer"]["criteria"]:
        assert c["source"] and c["status"] in {"data", "literature", "estimate", "todo"}
    # rotation A is the same as the farmer's: identical numbers
    assert d["alternatives"][0]["evaluation"]["criteria"] == d["farmer"]["criteria"]


def test_unsupported_crop_is_rejected():
    r = client.post("/api/regions/poltavska/rotations/evaluate", json={"rotation": ["sunflower"]})
    assert r.status_code == 422


def test_empty_rotation_is_rejected():
    assert client.post("/api/regions/poltavska/rotations/evaluate", json={"rotation": []}).status_code == 422


def test_climate_has_stress_series_and_frost_todo():
    c = client.get("/api/regions/poltavska/climate?soil=medium").json()
    w = c["stress"]["winter_wheat"]
    assert len(w["years"]) == len(w["mean_ks_mid"]) == 33
    assert w["heat_threshold_1_c"] == 30.0 and w["heat_status"] == "estimate"
    assert c["stress"]["maize"]["heat_threshold_1_c"] == 32.0 and all(v is None for v in c["stress"]["maize"]["heat_days_1"])
    assert c["frost_status"] == "todo"
    assert client.get("/api/regions/poltavska/climate?soil=mud").status_code == 422
