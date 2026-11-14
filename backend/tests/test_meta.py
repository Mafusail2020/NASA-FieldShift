from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_meta_blocks_and_honest_validation_status():
    m = client.get("/api/meta").json()
    for k in ("datasets", "formulas", "crops", "soils", "model", "limitations", "not_modelled", "ai_disclosure", "validation"):
        assert m[k]
    assert all(d["source"] and d["status"] for d in m["datasets"])
    assert all(r["status"] in {"data", "literature", "estimate", "todo"} for r in m["crops"])
    assert m["validation"]["status"] == "todo"  # no yield data yet: must not claim a result
    assert any("55 x 46" in d["detail_en"] for d in m["datasets"])
    assert "Claude" in m["ai_disclosure"]["en"]
