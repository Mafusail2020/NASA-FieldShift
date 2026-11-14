"""Expected values: FAO-56 Chapter 4, Example 18 (daily ETo, Uccle, Brussels, 6 July),
https://www.fao.org/3/x0490e/x0490e08.htm. Tolerance = half a unit of the last published digit.
"""
import numpy as np
import pytest

from core.eto import (
    extraterrestrial_radiation,
    hargreaves_eto,
    net_radiation,
    penman_monteith_eto,
    pressure,
    psychrometric_constant,
    sat_vapour_pressure,
    slope_vapour_pressure,
)

TMAX, TMIN = 21.5, 12.3
LAT = np.radians(50.80)  # 50°48'N
DOY = 187
Z = 100
U2 = 2.078  # published, converted from 10 m
RS = 22.07  # published, from sunshine hours (not used by our pipeline)
EA = 1.409  # published, from RHmax/RHmin (Eq. 17)
TMEAN = (TMAX + TMIN) / 2


def test_pressure_and_gamma():
    assert pressure(Z) == pytest.approx(100.1, abs=0.05)  # Eq. 7
    assert psychrometric_constant(100.1) == pytest.approx(0.0666, abs=0.00005)  # Eq. 8


def test_slope_and_saturation():
    assert TMEAN == pytest.approx(16.9, abs=0.05)
    assert slope_vapour_pressure(16.9) == pytest.approx(0.122, abs=0.0005)  # Eq. 13
    assert sat_vapour_pressure(TMAX) == pytest.approx(2.564, abs=0.0005)  # Eq. 11
    assert sat_vapour_pressure(TMIN) == pytest.approx(1.431, abs=0.0005)
    es = (sat_vapour_pressure(TMAX) + sat_vapour_pressure(TMIN)) / 2
    assert es == pytest.approx(1.997, abs=0.0005)


def test_extraterrestrial_radiation():
    assert extraterrestrial_radiation(LAT, DOY) == pytest.approx(41.09, abs=0.005)  # Eq. 21


def test_net_radiation():
    # Rns = 0.77 * 22.07 = 17.00; Rnl = 3.71; Rn = 13.28
    assert net_radiation(RS, TMAX, TMIN, EA, LAT, DOY, Z) == pytest.approx(13.28, abs=0.015)


def test_eto_daily():
    eto = penman_monteith_eto(TMAX, TMIN, EA, U2, RS, LAT, DOY, Z)
    assert eto == pytest.approx(3.88, abs=0.015)
    assert round(float(eto), 1) == 3.9


def test_works_on_arrays():
    t = np.array([TMAX, TMAX])
    eto = penman_monteith_eto(t, TMIN, EA, U2, RS, LAT, DOY, Z)
    assert eto.shape == (2,)
    assert eto[0] == pytest.approx(3.88, abs=0.015)


def test_hargreaves_is_in_plausible_range_of_pm():
    # FAO-56 gives no worked daily Hargreaves example; this only guards against a gross error.
    hg = hargreaves_eto(TMAX, TMIN, LAT, DOY)
    assert 0.7 * 3.88 < hg < 1.3 * 3.88
