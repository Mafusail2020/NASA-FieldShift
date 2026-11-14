import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.store import store

client = TestClient(app)
PRICES = {"winter_wheat": 5000, "maize": 4000}
COSTS = {"winter_wheat": 15000, "maize": 18000, "black_fallow": 3000}


def yields():
    y = {f"odeska|{c}": {str(yr): v for yr in (2000, 2001, 2002)} for c, v in (("winter_wheat", 4.0), ("maize", 6.0))}
    return {"yhat": y, "ratio": {}}


def test_defaults_show_todo_as_null():
    d = client.get("/api/defaults").json()
    wheat_price = [r for r in d["prices_costs"] if r["crop"] == "winter_wheat" and r["parameter"] == "price_uah_per_t"][0]
    assert wheat_price["value"] is None and wheat_price["status"] == "todo"
    k = [r for r in d["k"] if r["crop"] == "winter_wheat" and r["parameter"] == "k after black_fallow"][0]
    assert k["value"] == 1.08 and k["status"] == "literature"


def test_economics_without_yields_is_503(monkeypatch):
    monkeypatch.setattr(store, "yields", None)
    r = client.post("/api/economics", json={"region": "odeska", "rotation": ["winter_wheat"], "price": PRICES, "cost": COSTS})
    assert r.status_code == 503


def test_economics_missing_inputs_named(monkeypatch):
    monkeypatch.setattr(store, "yields", yields())
    r = client.post("/api/economics", json={"region": "odeska", "rotation": ["winter_wheat", "maize"]})
    assert r.status_code == 422 and "price of winter_wheat" in r.json()["detail"]


def test_economics_by_hand_and_k_switch(monkeypatch):
    monkeypatch.setattr(store, "yields", yields())
    body = {"region": "odeska", "rotation": ["winter_wheat", "maize"], "price": PRICES, "cost": COSTS}
    d = client.post("/api/economics", json={**body, "use_k": True}).json()
    # wheat 4 * 5000 - 15000 = 5000; maize 6 * 4000 - 18000 = 6000; mean 5500 (k = 1.0 for both predecessors)
    assert d["farmer"]["summary"]["median"] == pytest.approx(5500)
    assert d["farmer"]["summary"]["loss_years"] == 0
    # B = wheat after fallow: with k 1.08: (4*1.08*5000 - 15000 + (-3000)) / 2 = 1800; without k: 1000
    assert d["alternatives"]["B"]["summary"]["median"] == pytest.approx(1800)
    off = client.post("/api/economics", json={**body, "use_k": False}).json()
    assert off["alternatives"]["B"]["summary"]["median"] == pytest.approx(1000)
    assert d["best_alternative_with_k"] == "A" and d["best_alternative_without_k"] == "A"
