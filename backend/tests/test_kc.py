"""Expected values: FAO-56 Example 27 (Eq. 62), Example 18 (e° values for Eq. 63), the Kcb example in Chapter 7
(Eq. 66) and Annex 7 Example 7-1 (Eq. 7-3). Source: https://www.fao.org/3/x0490e/
"""
from datetime import date

import pytest

from core.kc import adjust_kc, adjust_kc_end, kc_curve, kc_ini_bare, rh_min, tew_from_soil


def test_eq62_example27():
    assert adjust_kc(1.20, 1.3, 75, 2) == pytest.approx(1.07, abs=0.005)  # Taipei
    assert adjust_kc(1.20, 4.6, 44, 2) == pytest.approx(1.30, abs=0.005)  # Mocha


def test_eq65_not_applied_below_045():
    assert adjust_kc_end(0.35, 4.0, 20, 2.0) == 0.35


def test_eq63_with_example18_vapour_pressures():
    # Example 18: e°(Tmin = 12.3) = 1.431 kPa, e°(Tmax = 21.5) = 2.564 kPa; here Tdew = 12.3
    assert rh_min(12.3, 21.5) == pytest.approx(100 * 1.431 / 2.564, abs=0.05)


def test_kc_curve_eq66_chapter7_example():
    # Lini 25, Ldev 25, Lmid 30, Llate 20; Kcb ini 0.15, mid 1.14, end 0.25.
    # Published values: day 12 -> 0.15, day 37 -> 0.63, day 65 -> 1.14, day 90 -> 0.70.
    s = kc_curve(date(2020, 5, 1), 25, 25, 30, 20, 0.15, 1.14, 0.25)
    assert len(s) == 100
    assert s.iloc[11] == pytest.approx(0.15)
    assert s.iloc[36] == pytest.approx(0.63, abs=0.005)
    assert s.iloc[64] == pytest.approx(1.14)
    assert s.iloc[89] == pytest.approx(0.70, abs=0.005 + 1e-9)  # exact 0.695, published rounded to 0.70
    assert s.index[0].date() == date(2020, 5, 1) and s.index[-1].date() == date(2020, 8, 8)


def test_annex7_example_7_1_fig30a():
    # ETo = 5 mm/day, tw = 3.5 days, TEWcor 15, REWcor 6: published 0.75
    assert kc_ini_bare(5, 3.5, 15, 6) == pytest.approx(0.75, abs=0.005)


@pytest.mark.xfail(strict=True, reason="FAO text prints 0.57; Eq. 7-3 with the printed inputs gives 0.533. Open question for Ivan.")
def test_annex7_example_7_1_fig29():
    # ETo = 5 mm/day, tw = 3.5 days, TEWcor 10, REWcor 2.7: published 0.57
    assert kc_ini_bare(5, 3.5, 10, 2.7) == pytest.approx(0.57, abs=0.005)


def test_kc_ini_stage1_only_is_115():
    # wetting more often than stage 1 lasts (t1 = REW / (1.15 ETo) = 8 / 5.75 = 1.4 days) -> Kc = 1.15 (Eq. 7-4)
    assert kc_ini_bare(5, 1.0, 20, 8) == 1.15


def test_tew_eq75_eq76():
    # Eq. 7-5 by hand: 1000 (0.25 - 0.5 * 0.12) * 0.15 = 28.5 mm for ETo >= 5; Eq. 7-6 scales by sqrt(ETo / 5)
    assert tew_from_soil(0.25, 0.12, 0.15, 6) == pytest.approx(28.5)
    assert tew_from_soil(0.25, 0.12, 0.15, 1.25) == pytest.approx(14.25)
