"""pH suitability, ECOCROP trapezoid: (min, optimum low, optimum high, max) -> factor 0..1. pH is water pH, not KCl."""


def f_ph(ph: float, p_min: float, opt_low: float, opt_high: float, p_max: float) -> float:
    if not p_min <= opt_low <= opt_high <= p_max:
        raise ValueError("pH limits must satisfy min <= optimum low <= optimum high <= max")
    if ph < p_min or ph > p_max:
        return 0.0
    if opt_low <= ph <= opt_high:
        return 1.0
    if ph < opt_low:
        return (ph - p_min) / (opt_low - p_min)
    return (p_max - ph) / (p_max - opt_high)


def needs_warning(f: float | None) -> bool:
    """pH only warns (team decision): ECOCROP limits are likely too narrow for alkaline southern soils."""
    return f is not None and f < 1.0
