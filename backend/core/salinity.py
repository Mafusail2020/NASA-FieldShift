"""Salt tolerance, Maas-Hoffman model: Yr = 100 - b * (ECe - a) above the threshold a, else 100.

ECe is the electrical conductivity of the saturated-paste extract in dS/m (not EC 1:5, not % salts).
FAO tables are for chloride-dominated soils; on gypsiferous soils crops tolerate about 2 dS/m more (`gypsum_shift`).
"""


def relative_yield_pct(ece: float, a: float, b: float) -> float:
    """Relative yield in % (0..100)."""
    if ece < 0:
        raise ValueError("ECe cannot be negative")
    return max(0.0, min(100.0, 100.0 - b * (ece - a))) if ece > a else 100.0


def f_salt(ece: float, a: float | None, b: float | None, gypsum_shift: float = 0.0) -> float | None:
    """Yield multiplier 0..1. None when the crop has no a/b (status todo): the caller must say 'no data', not 1.0."""
    if a is None or b is None:
        return None
    return relative_yield_pct(max(ece - gypsum_shift, 0.0), a, b) / 100.0


def is_excluded(f: float | None, below: float) -> bool:
    """Team rule: a crop whose f_salt is below `below` (0.5) is marked red and not offered as optimal."""
    return f is not None and f < below
