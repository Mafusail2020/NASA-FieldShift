import pytest

from pipeline.export_finance import build


def test_real_export_values():
    d = build()
    w = d["crops"]["winter_wheat"]
    assert w["prices"][-1] == {"year": 2023, "value": 5343.0, "usd": 146.1}
    assert w["yields"][-1]["year"] == 2024 and abs(w["yields"][-1]["value"] - 4.595) < 0.01
    assert w["cost_uah_per_ha"] is None and w["cost_status"] == "todo"
    assert min(p["year"] for p in w["prices"]) >= 1996
    assert {i["kind"] for i in w["cost_items"]} == {"variable", "fixed"} and w["cost_items_status"] == "sample"
    assert all(d["crops"][c]["cost_items"] for c in d["crops"])
    assert all(r["source"] and r["status"] for r in d["k"])


def test_missing_raw_fails_clearly(tmp_path):
    with pytest.raises(FileNotFoundError, match="fetch_crop_info"):
        build(raw=tmp_path)


def test_implied_rate():
    import pandas as pd

    from pipeline.export_finance import implied_rate

    df = pd.DataFrame({"year": [2022, 2023, 2023], "price_uah_per_t": [3000.0, 3600.0, 7300.0], "price_usd_per_t": [100.0, 100.0, 200.0]})
    fx = implied_rate(df)
    assert fx["year"] == 2023 and fx["uah_per_usd"] == 36.25 and fx["status"] == "estimate"  # median of 36.0 and 36.5
    real = build()["fx"]
    assert real["year"] == 2023 and 36.4 < real["uah_per_usd"] < 36.7
