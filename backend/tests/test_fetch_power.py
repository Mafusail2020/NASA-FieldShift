import numpy as np

from pipeline.fetch_power import parse_power


def payload(rad_units, rad_values):
    return {
        "parameters": {
            "T2M_MAX": {"units": "C"},
            "ALLSKY_SFC_SW_DWN": {"units": rad_units},
        },
        "properties": {"parameter": {
            "T2M_MAX": {"20200101": 5.0, "20200102": -999.0},
            "ALLSKY_SFC_SW_DWN": dict(zip(["20200101", "20200102"], rad_values)),
        }},
    }


def test_minus_999_becomes_nan():
    df, _ = parse_power(payload("MJ/m^2/day", [10.0, -999.0]))
    assert df["T2M_MAX"].iloc[0] == 5.0
    assert np.isnan(df["T2M_MAX"].iloc[1])
    assert np.isnan(df["ALLSKY_SFC_SW_DWN"].iloc[1])


def test_kwh_converted_to_mj():
    df, units = parse_power(payload("kW-hr/m^2/day", [2.0, -999.0]))
    assert df["ALLSKY_SFC_SW_DWN"].iloc[0] == 7.2
    assert np.isnan(df["ALLSKY_SFC_SW_DWN"].iloc[1])  # -999 must not become -3596.4
    assert units["ALLSKY_SFC_SW_DWN"] == "kW-hr/m^2/day"


def test_mj_not_converted():
    df, _ = parse_power(payload("MJ/m^2/day", [20.0, 21.0]))
    assert df["ALLSKY_SFC_SW_DWN"].iloc[0] == 20.0
