from datetime import date

import pandas as pd

from core.pairs import Climate, Params, season

STAGES = {"L_ini_d": 10, "L_dev_d": 20, "L_mid_d": 30, "L_late_d": 40}  # 100 days


def params(rows: dict) -> Params:
    """rows: {crop: {parameter: value}}, values as the string cells of crops.csv."""
    recs = [(c, k, str(v)) for c, d in rows.items() for k, v in d.items()]
    return Params(pd.DataFrame(recs, columns=["crop", "parameter", "value"]))


def clim(oblast=None, tmean=20.0) -> Climate:
    idx = pd.date_range("1999-01-01", "2001-12-31")
    df = pd.DataFrame({"T2M_MAX": tmean + 2, "T2M_MIN": tmean - 2}, index=idx)
    return Climate(df, df, oblast=oblast)


CAL = {"sowing_rule": "calendar", "sowing_mmdd_poltavska": "09-20", **STAGES}
P = params({
    "winter_barley": CAL,
    "spring_oats": {**CAL, "sowing_mmdd_poltavska": "04-10"},
    "maize": {"sowing_rule": "temperature", "sowing_temp_c": 13, "sowing_temp_dir": "rising",
              "sowing_window_start_mmdd": "03-01", "sowing_latest_mmdd": "06-01", **STAGES},
})


def test_calendar_winter_crop_is_sown_in_previous_year():
    sow, harv = season("winter_barley", 2000, clim("poltavska"), P)
    assert sow == date(1999, 9, 20)
    assert harv == date(1999, 9, 20) + pd.Timedelta(days=99)  # stages sum to 100 days, sowing day counts


def test_calendar_spring_crop_is_sown_in_harvest_year():
    assert season("spring_oats", 2000, clim("poltavska"), P)[0] == date(2000, 4, 10)


def test_calendar_needs_oblast_with_a_date():
    assert season("winter_barley", 2000, clim(None), P) is None          # grid cell, no oblast
    assert season("winter_barley", 2000, clim("odeska"), P) is None      # no date for that oblast


def test_calendar_sowing_waits_for_previous_harvest():
    sow, _ = season("winter_barley", 2000, clim("poltavska"), P, prev_harvest=date(1999, 9, 25))
    assert sow == date(1999, 9, 26)


def test_temperature_rule_is_unchanged():
    # constant 20 C: the 10-day mean (which also uses days before the window) is already >= 13 C on the window start
    assert season("maize", 2000, clim("poltavska"), P)[0] == date(2000, 3, 1)


def test_sowing_missing_and_supported():
    full = {"kc_ini": 0.3, "kc_mid": 1.1, "kc_end": 0.25, "zr_max_m": 1.5, "p": 0.55, "h_m": 1.0}
    q = params({"a": {**full, **STAGES, "sowing_rule": "calendar"},
                "b": {**full, **STAGES, "sowing_rule": "calendar", "sowing_mmdd_odeska": "09-25"},
                "c": {**full, **STAGES},  # no rule: temperature, empty
                "d": {**full, **STAGES, "sowing_temp_c": 5, "sowing_temp_dir": "rising",
                      "sowing_window_start_mmdd": "03-01"}})  # no latest date: still supported, as before
    assert q.sowing_missing("a") == ["sowing_mmdd_<oblast>"] and not q.supported("a")
    assert q.sowing_missing("b") == [] and q.supported("b")
    assert "sowing_temp_c" in q.sowing_missing("c") and not q.supported("c")
    assert q.supported("d")
