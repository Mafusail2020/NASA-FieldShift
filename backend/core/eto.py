"""Reference evapotranspiration, FAO-56 (Allen et al. 1998). All functions work on floats or numpy arrays.

Units: T in °C, Rs/Ra/Rn in MJ m-2 day-1, u2 in m s-1, e in kPa, z in m, lat in radians, ETo in mm day-1.
"""
import numpy as np

GSC = 0.0820  # solar constant, MJ m-2 min-1
SIGMA = 4.903e-9  # Stefan-Boltzmann, MJ K-4 m-2 day-1


def sat_vapour_pressure(t):
    """FAO-56 Eq. 11."""
    return 0.6108 * np.exp(17.27 * t / (t + 237.3))


def slope_vapour_pressure(t):
    """FAO-56 Eq. 13."""
    return 4098 * sat_vapour_pressure(t) / (t + 237.3) ** 2


def pressure(z):
    """FAO-56 Eq. 7."""
    return 101.3 * ((293.0 - 0.0065 * z) / 293.0) ** 5.26


def psychrometric_constant(p):
    """FAO-56 Eq. 8."""
    return 0.000665 * p


def extraterrestrial_radiation(lat, doy):
    """FAO-56 Eq. 21, with dr (Eq. 23), declination (Eq. 24), sunset angle (Eq. 25)."""
    dr = 1 + 0.033 * np.cos(2 * np.pi * doy / 365)
    delta = 0.409 * np.sin(2 * np.pi * doy / 365 - 1.39)
    ws = np.arccos(np.clip(-np.tan(lat) * np.tan(delta), -1, 1))
    return (24 * 60 / np.pi) * GSC * dr * (
        ws * np.sin(lat) * np.sin(delta) + np.cos(lat) * np.cos(delta) * np.sin(ws)
    )


def actual_vapour_pressure_from_dewpoint(tdew):
    """FAO-56 Eq. 14: ea = e°(Tdew)."""
    return sat_vapour_pressure(tdew)


def net_radiation(rs, tmax, tmin, ea, lat, doy, z):
    """FAO-56 Eqs. 37-40 (Rs/Rso capped at 1 as in the text)."""
    ra = extraterrestrial_radiation(lat, doy)
    rso = (0.75 + 2e-5 * z) * ra
    rns = (1 - 0.23) * rs
    ratio = np.minimum(rs / rso, 1.0)
    rnl = SIGMA * ((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2 * (0.34 - 0.14 * np.sqrt(ea)) * (1.35 * ratio - 0.35)
    return rns - rnl


def penman_monteith_eto(tmax, tmin, ea, u2, rs, lat, doy, z):
    """FAO-56 Eq. 6 daily, soil heat flux G = 0. u2 is wind at 2 m; ea is actual vapour pressure (kPa)."""
    tmean = (tmax + tmin) / 2
    delta = slope_vapour_pressure(tmean)
    gamma = psychrometric_constant(pressure(z))
    es = (sat_vapour_pressure(tmax) + sat_vapour_pressure(tmin)) / 2
    rn = net_radiation(rs, tmax, tmin, ea, lat, doy, z)
    num = 0.408 * delta * rn + gamma * 900 / (tmean + 273) * u2 * (es - ea)
    return num / (delta + gamma * (1 + 0.34 * u2))


def hargreaves_eto(tmax, tmin, lat, doy):
    """FAO-56 Eq. 52. Needs only temperature."""
    tmean = (tmax + tmin) / 2
    ra_mm = 0.408 * extraterrestrial_radiation(lat, doy)
    return 0.0023 * (tmean + 17.8) * np.sqrt(np.maximum(tmax - tmin, 0)) * ra_mm
