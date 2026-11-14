"""Crop coefficients, FAO-56 (Allen et al. 1998): Eq. 62/63/65/66 and Annex 7 (Kc ini for bare soil)."""
from datetime import date, timedelta

import numpy as np
import pandas as pd

from core.eto import sat_vapour_pressure


def rh_min(tdew, tmax):
    """FAO-56 Eq. 63: RHmin = 100 e°(Tdew) / e°(Tmax)."""
    return 100 * sat_vapour_pressure(tdew) / sat_vapour_pressure(tmax)


def adjust_kc(kc_tab, u2, rhmin, h):
    """FAO-56 Eq. 62 (Kc mid) and Eq. 65 (Kc end): same form. Inputs are clipped to the ranges the text gives."""
    u2 = np.clip(u2, 1, 6)
    rhmin = np.clip(rhmin, 20, 80)
    h = np.clip(h, 0.1, 10)
    return kc_tab + (0.04 * (u2 - 2) - 0.004 * (rhmin - 45)) * (h / 3) ** 0.3


def adjust_kc_end(kc_end_tab, u2, rhmin, h):
    """Eq. 65 is applied only when the tabulated Kc end >= 0.45."""
    return adjust_kc(kc_end_tab, u2, rhmin, h) if kc_end_tab >= 0.45 else kc_end_tab


def kc_curve(sowing: date, l_ini, l_dev, l_mid, l_late, kc_ini, kc_mid, kc_end) -> pd.Series:
    """Daily Kc over the season, FAO-56 Eq. 66 (day i of the growing period, sowing day = 1)."""
    total = l_ini + l_dev + l_mid + l_late
    i = np.arange(1, total + 1)
    kc = np.select(
        [i <= l_ini, i <= l_ini + l_dev, i <= l_ini + l_dev + l_mid],
        [kc_ini, kc_ini + (i - l_ini) / l_dev * (kc_mid - kc_ini), kc_mid],
        kc_mid + (i - (l_ini + l_dev + l_mid)) / l_late * (kc_end - kc_mid),
    )
    return pd.Series(kc, index=pd.date_range(sowing, sowing + timedelta(days=total - 1)))


def tew_from_soil(theta_fc, theta_wp, ze, eto):
    """Annex 7 Eq. 7-5 (ETo >= 5 mm/day) and Eq. 7-6 (ETo < 5 mm/day)."""
    tew = 1000 * (theta_fc - 0.5 * theta_wp) * ze
    return tew * np.sqrt(eto / 5) if eto < 5 else tew


def correct_tew_rew(tew, rew, p_mean, w_ini, n_w):
    """Annex 7 Eqs. 7-9 and 7-10. REW is first limited to REW <= TEW."""
    rew = min(rew, tew)
    avail = p_mean + w_ini / n_w
    return min(tew, avail), rew * min(avail / tew, 1)


def kc_ini_bare(eto, tw, tew, rew):
    """Annex 7 Eqs. 7-1, 7-3, 7-4: mean Kc of bare soil with wetting every tw days (capped at 1.15)."""
    eso = 1.15 * eto
    t1 = rew / eso
    if tw <= t1:
        return 1.15
    kc = (tew - (tew - rew) * np.exp(-(tw - t1) * eso * (1 + rew / (tew - rew)) / tew)) / (tw * eto)
    return float(min(kc, 1.15))


def bare_kc_daily(eto: pd.Series, water_in: pd.Series, theta_fc, theta_wp, rew, ze) -> pd.Series:
    """Daily Kc of bare soil: one Annex 7 value per calendar month.

    Wetting events: days with water input >= 0.2 ETo, adjacent days merged (Annex 7). With no event in a month,
    one wetting at the start of the month is assumed. W_ini is taken as TEW (evaporation layer at field capacity).
    """
    out = pd.Series(index=eto.index, dtype=float)
    for _, idx in eto.groupby([eto.index.year, eto.index.month]).groups.items():
        e, w = eto.loc[idx], water_in.loc[idx]
        eto_m = float(e.mean())
        wet = (w >= 0.2 * eto_m).to_numpy()
        n_w = int((wet & ~np.r_[False, wet[:-1]]).sum())
        tew = tew_from_soil(theta_fc, theta_wp, ze, eto_m)
        if n_w == 0:
            tw, tew_c, rew_c = len(idx), tew, min(rew, tew)
        else:
            p_mean = float(np.minimum(w[wet], tew).sum() / n_w)
            tw = len(idx) / n_w
            tew_c, rew_c = correct_tew_rew(tew, rew, p_mean, tew, n_w)
        out.loc[idx] = kc_ini_bare(eto_m, tw, tew_c, min(rew_c, tew_c - 0.01))
    return out
