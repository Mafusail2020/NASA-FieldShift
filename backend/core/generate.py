"""Enumerate cyclic crop rotations that respect the legal return norms (KMU No. 164) and rank them from pair metrics.

A rotation is a cyclic tuple of crops, one per year. Rotations that are the same cycle shifted are one rotation
(canonical form = the smallest shift). No agronomic rule that is not in `Rules` is applied here: legume share,
diseases and nitrogen are not modelled (no source yet), so they are not used to filter or rank.
"""
from dataclasses import dataclass, field

import numpy as np

FALLOW = "black_fallow"


@dataclass
class Rules:
    """min_gap[c]: years between two appearances of c (cyclic; a crop that appears once returns after n years).
    max_run[c]: most consecutive years of c (cyclic). max_count[c]: most appearances per cycle."""
    min_gap: dict[str, int] = field(default_factory=dict)
    max_run: dict[str, int] = field(default_factory=dict)
    max_count: dict[str, int] = field(default_factory=dict)
    min_distinct: int = 1  # fewest different crops in a cycle (project choice, not a legal norm)
    default_max_run: int | None = None  # most consecutive years for crops without their own max_run (project choice)
    no_adjacent: list[frozenset] = field(default_factory=list)  # crops of one group never follow each other (legumes: project choice)


def canonical(rot) -> tuple:
    r = tuple(rot)
    return min(r[i:] + r[:i] for i in range(len(r)))


def primitive(rot) -> bool:
    """False for a cycle that is a shorter cycle repeated (a-b-c-a-b-c is a-b-c)."""
    n = len(rot)
    return not any(n % p == 0 and tuple(rot) == tuple(rot[:p]) * (n // p) for p in range(1, n))


def _adjacent_bad(a: str, b: str, rules: Rules) -> bool:
    return a != b and any(a in g and b in g for g in rules.no_adjacent)


def cyclic_ok(rot, rules: Rules) -> bool:
    n = len(rot)
    if any(_adjacent_bad(rot[i], rot[(i + 1) % n], rules) for i in range(n)):
        return False
    for c in set(rot):
        pos = [i for i, x in enumerate(rot) if x == c]
        g = rules.min_gap.get(c)
        if g is not None:
            gaps = [(pos[(k + 1) % len(pos)] - pos[k]) % n or n for k in range(len(pos))]
            if min(gaps) < g:
                return False
        m = rules.max_run.get(c, rules.default_max_run)
        if m is not None and len(pos) < n:
            run, best, d = 0, 0, list(rot) * 2
            for x in d:
                run = run + 1 if x == c else 0
                best = max(best, min(run, n))
            if best > m:
                return False
    return True


def enumerate_rotations(crops: list[str], rules: Rules, lengths=range(2, 9)) -> list[tuple]:
    """All distinct valid cycles of the given lengths. `crops` order defines the canonical order."""
    order = {c: i for i, c in enumerate(crops)}
    out = []
    for n in lengths:
        def rec(seq, last):
            if len(seq) == n:
                if (len(set(seq)) >= rules.min_distinct and primitive(seq) and cyclic_ok(seq, rules)
                        and canonical_by(seq, order) == tuple(order[c] for c in seq)):
                    out.append(tuple(seq))
                return
            i = len(seq)
            for c in crops:
                if seq and order[c] < order[seq[0]]:
                    continue  # the cycle starts at its smallest crop: kills n-fold duplicates early
                if seq and _adjacent_bad(seq[-1], c, rules):
                    continue
                g = rules.min_gap.get(c)
                if g is not None and c in last and i - last[c] < g:
                    continue
                m = rules.max_count.get(c)
                if m is not None and seq.count(c) >= m:
                    continue
                mr = rules.max_run.get(c, rules.default_max_run)
                if mr is not None and i >= mr and all(x == c for x in seq[i - mr:]):
                    continue
                prev = last.get(c)
                last[c] = i
                seq.append(c)
                rec(seq, last)
                seq.pop()
                if prev is None:
                    del last[c]
                else:
                    last[c] = prev
        rec([], {})
    return out


def canonical_by(seq, order: dict) -> tuple:
    r = tuple(order[c] for c in seq)
    return min(r[i:] + r[:i] for i in range(len(r)))


def rotation_stats(rot, pairs: dict) -> dict | None:
    """Pooled statistics over crop-years of one rotation, for one cell and soil.

    pairs: {'prev>cur': {'year': [...], 'mean_ks_mid': [...], 'bare_months': [...], ...}} (columnar, as in rotations/<cell>.json).
    Same rule as frontend/src/components/fields/rotation/model.ts: Ks over crop years only (fallow years excluded), bare months over all.
    Returns None when a pair is missing."""
    n = len(rot)
    ks, wsd, bare = [], [], []
    for j, cur in enumerate(rot):
        p = pairs.get(f"{rot[j - 1]}>{cur}")
        if p is None:
            return None
        bare += [v for v in p["bare_months"] if v is not None]
        if cur != FALLOW:
            ks += [v for v in p["mean_ks_mid"] if v is not None]
            wsd += [v for v in p["water_stress_days"] if v is not None]
    if not ks or not bare:
        return None
    ks_a = np.array(ks)
    return {"n": n, "ks_med": float(np.median(ks_a)), "ks_p10": float(np.percentile(ks_a, 10)),
            "wsd_med": float(np.median(wsd)), "bare_med": float(np.median(bare))}


PRIORITY_KEY = {  # smaller is better, same as sortKey in model.ts
    "water": lambda s: -s["ks_med"],
    "cover": lambda s: s["bare_med"],
    "stress": lambda s: -s["ks_p10"],
}


def shortlist(rotations: list[tuple], pairs: dict, priority: str, k: int = 6, min_distance: int = 2) -> list[dict]:
    """Best `k` rotations by one priority, skipping near-duplicates: a rotation is dropped if it differs from an
    already chosen one of the same length in fewer than `min_distance` positions (best shift)."""
    scored = []
    for r in rotations:
        s = rotation_stats(r, pairs)
        if s is not None:
            scored.append((PRIORITY_KEY[priority](s), r, s))
    scored.sort(key=lambda t: (t[0], len(t[1]), t[1]))
    chosen: list[tuple] = []
    for _, r, s in scored:
        if any(len(r) == len(q) and _distance(r, q) < min_distance for q, _ in chosen):
            continue
        chosen.append((r, s))
        if len(chosen) == k:
            break
    return [{"crops": list(r), **s} for r, s in chosen]


def _distance(a, b) -> int:
    n = len(a)
    return min(sum(x != y for x, y in zip(a, b[i:] + b[:i])) for i in range(n))


def rules_from_params(cfg: dict, crops: list[str]) -> Rules:
    """Rules for suggested rotations from data/params/rotations.yaml (`kmu_164` and `suggest_rules`).
    Only KMU rows for `crops` are used. Everything in `suggest_rules` is a project choice, not a legal norm."""
    sr = cfg["suggest_rules"]
    return Rules(
        min_gap={k["crop"]: k["min_return_years"] for k in cfg["kmu_164"] if k["crop"] in crops},
        max_run=dict(sr.get("max_run", {})),
        max_count=dict(sr.get("max_count", {})),
        min_distinct=sr.get("min_distinct", 2),
        default_max_run=sr.get("default_max_run"),
        no_adjacent=[frozenset(g) for g in sr.get("no_adjacent", [])],
    )
