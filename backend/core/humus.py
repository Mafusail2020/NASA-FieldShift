"""Humus balance, Chesnul method. All masses t/ha, yields c/ha (y = yield of the main product).

Surface residues X = a*y + b, root residues X1 = c*y + d (c/ha); Q = (X + X1) / 10 t/ha.
P1 = Q*K (humus from residues), P2 = manure*0.058, P3 = green mass*0.029, P = mineralisation. Balance B = P1+P2+P3-P.
An intermediate green manure adds P3 in the year it is ploughed in and has no mineralisation of its own.
"""
from dataclasses import dataclass

MANURE_COEF = 0.058        # params/model.csv humus_manure_coef (0.25 * 0.23)
GREEN_MANURE_COEF = 0.029  # params/model.csv humus_green_manure_coef (0.5 * 0.058)


@dataclass(frozen=True)
class HumusCrop:
    res_a: float
    res_b: float
    root_c: float
    root_d: float
    k_humif: float
    mineral_t_ha: float


def residues_t_ha(c: HumusCrop, yield_c_ha: float) -> float:
    return ((c.res_a * yield_c_ha + c.res_b) + (c.root_c * yield_c_ha + c.root_d)) / 10.0


def annual_balance(c: HumusCrop, yield_c_ha: float, manure_t_ha: float = 0.0, green_t_ha: float = 0.0,
                   manure_coef: float = MANURE_COEF, green_coef: float = GREEN_MANURE_COEF) -> dict:
    if min(yield_c_ha, manure_t_ha, green_t_ha) < 0:
        raise ValueError("yield, manure and green mass cannot be negative")
    p1 = residues_t_ha(c, yield_c_ha) * c.k_humif
    p2 = manure_t_ha * manure_coef
    p3 = green_t_ha * green_coef
    return {"p1": p1, "p2": p2, "p3": p3, "p": c.mineral_t_ha, "balance": p1 + p2 + p3 - c.mineral_t_ha}


def rotation_balance(years: list[dict]) -> float:
    """Mean yearly balance over the rotation: (sum P1 + sum P2 + sum P3 - sum P) / years."""
    if not years:
        raise ValueError("empty rotation")
    return sum(y["balance"] for y in years) / len(years)


def manure_norm(current_manure_t_ha: float, mean_balance: float, manure_coef: float = MANURE_COEF) -> float:
    """Manure for a non-negative balance: Nm = N1 + |Bs| / 0.058 when Bs < 0, else the current amount.

    Per year, as in the source formula (see PROGRESS.md: the doc says input is t/ha per rotation, the formula is per year).
    """
    return current_manure_t_ha + (abs(mean_balance) / manure_coef if mean_balance < 0 else 0.0)
