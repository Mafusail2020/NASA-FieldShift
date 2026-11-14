import numpy as np
import pandas as pd
import pytest

from pipeline.yields import apply_masks, detrend


def test_mask_from_year_by_oblast():
    df = pd.DataFrame({"oblast": ["crimea", "crimea", "poltavska", "poltavska"], "year": [2013, 2014, 2013, 2023]})
    masks = pd.DataFrame({"oblast": ["crimea"], "mask_from_year": [2014]})
    out = apply_masks(df, masks)
    assert list(zip(out.oblast, out.year)) == [("crimea", 2013), ("poltavska", 2013), ("poltavska", 2023)]


def test_detrend_exact_line_gives_ratio_one_and_tech_level():
    # yield = 2.0 + 0.1 * (year - 2000): the trend is the line itself, ratio = 1, Yhat = trend(2021) = 4.1
    years = np.arange(2000, 2022)
    df = pd.DataFrame({"oblast": "o", "crop": "c", "year": years, "yield_t_ha": 2.0 + 0.1 * (years - 2000)})
    out = detrend(df)
    assert out["ratio"].tolist() == pytest.approx([1.0] * len(years))
    assert out["yhat"].tolist() == pytest.approx([4.1] * len(years))


def test_detrend_skips_short_series():
    df = pd.DataFrame({"oblast": "o", "crop": "c", "year": [2000, 2001, 2002], "yield_t_ha": [1.0, 2.0, 3.0]})
    with pytest.raises(ValueError):
        detrend(df)
