import pytest

from core.generate import Rules, canonical, enumerate_rotations, primitive, rotation_stats, shortlist


def test_canonical_and_primitive():
    assert canonical(("b", "c", "a")) == ("a", "b", "c")
    assert primitive(("a", "b", "c")) and not primitive(("a", "b", "a", "b")) and not primitive(("a", "a"))


def test_no_rules_counts_distinct_cycles():
    crops = ["a", "b", "c"]
    assert enumerate_rotations(crops, Rules(), [2]) == [("a", "b"), ("a", "c"), ("b", "c")]
    # length 3, three different crops: the two cyclic orders abc and acb
    assert sorted(enumerate_rotations(crops, Rules(min_distinct=3), [3])) == [("a", "b", "c"), ("a", "c", "b")]


def test_no_rotation_is_a_shift_of_another():
    rots = enumerate_rotations(list("abcd"), Rules(min_gap={"a": 2}), range(2, 6))
    assert len({canonical(r) for r in rots}) == len(rots)


def test_return_gap_is_cyclic():
    rules = Rules(min_gap={"w": 2})
    got = enumerate_rotations(["w", "m"], rules, [2, 3])
    assert ("m", "w") in got or ("w", "m") in got        # w returns after 2 years
    assert ("m", "w", "w") not in got and ("w", "w", "m") not in got  # adjacent in the cycle (wraps around)
    assert ("w", "m", "m") in got or ("m", "m", "w") in got


def test_sunflower_needs_seven_years():
    rules = Rules(min_gap={"s": 7}, min_distinct=2)
    crops = ["s", "x", "y"]
    assert not any("s" in r for r in enumerate_rotations(crops, rules, [3, 4, 5, 6]))
    assert any("s" in r for r in enumerate_rotations(crops, rules, [7]))


def test_max_run_and_default():
    crops = ["m", "x"]
    assert ("m", "m", "m", "m", "x") not in enumerate_rotations(crops, Rules(max_run={"m": 3}), [5])
    assert ("m", "m", "m", "x") in enumerate_rotations(crops, Rules(max_run={"m": 3}), [4])
    assert ("m", "m", "m", "x") not in enumerate_rotations(crops, Rules(default_max_run=2), [4])
    assert ("m", "m", "m", "x") in enumerate_rotations(crops, Rules(max_run={"m": 3}, default_max_run=2), [4])
    # the run wraps around the end of the cycle: x m m m is the same cycle as m m m x
    assert not any(r.count("m") == 3 and r[0] == "m" and r[-1] == "m" for r in enumerate_rotations(crops, Rules(max_run={"m": 2}), [4]))


def test_max_count():
    got = enumerate_rotations(["f", "a", "b"], Rules(max_count={"f": 1}), [4])
    assert got and all(r.count("f") <= 1 for r in got)


def pair(ks, bare, wsd=None, years=(2000, 2001)):
    return {"year": list(years), "mean_ks_mid": ks, "bare_months": bare, "water_stress_days": wsd or [10, 10]}


PAIRS = {
    "a>b": pair([0.9, 0.7], [2, 2]), "b>a": pair([0.5, 0.6], [4, 4]),
    "a>a": pair([0.2, 0.2], [1, 1]), "b>b": pair([0.8, 0.8], [3, 3]),
    "f>a": pair([0.9, 0.9], [9, 9]), "a>f": pair([None, None], [9, 9]),
}


def test_rotation_stats_pools_crop_years_and_skips_fallow_ks():
    s = rotation_stats(("a", "b"), PAIRS)
    assert s["ks_med"] == pytest.approx(0.65) and s["bare_med"] == 3 and s["n"] == 2
    f = rotation_stats(("a", "black_fallow"), {"a>black_fallow": pair([None, None], [6, 6]), "black_fallow>a": pair([0.9, 0.7], [6, 6])})
    assert f["ks_med"] == pytest.approx(0.8)  # fallow years carry no Ks; bare months still count
    assert rotation_stats(("a", "z"), PAIRS) is None  # pair not computed


def test_shortlist_orders_by_priority_and_drops_near_duplicates():
    pairs = {f"{p}>{c}": pair([k, k], [b, b]) for p, c, k, b in [
        ("a", "a", 0.5, 1), ("b", "b", 0.9, 5), ("a", "b", 0.7, 3), ("b", "a", 0.6, 3)]}
    rots = [("a", "b"), ("a", "a"), ("b", "b")]
    assert [r["crops"] for r in shortlist(rots, pairs, "water", k=3, min_distance=1)][0] == ["b", "b"]
    assert [r["crops"] for r in shortlist(rots, pairs, "cover", k=3, min_distance=1)][0] == ["a", "a"]
    # ('a','b') differs from ('b','b') in one position: with min_distance=2 it is dropped as a near-duplicate
    got = [r["crops"] for r in shortlist(rots, pairs, "water", k=3, min_distance=2)]
    assert ["b", "b"] in got and ["a", "b"] not in got


def test_no_adjacent_group_is_cyclic():
    rules = Rules(no_adjacent=[frozenset({"p", "s"})], min_distinct=2)
    got = enumerate_rotations(["p", "s", "x"], rules, [3, 4])
    assert ("p", "s", "x") not in got and ("p", "x", "s") not in got   # s and p are neighbours around the end
    assert ("p", "x", "p", "s") not in got                             # p, s adjacent
    assert ("p", "x", "s", "x") in got
    assert ("p", "p", "x") in got                                      # the group rule is about different crops; same-crop runs are max_run


def test_rules_from_params():
    from core.generate import rules_from_params
    cfg = {"kmu_164": [{"crop": "w", "min_return_years": 2}, {"crop": "z", "min_return_years": 9}],
           "suggest_rules": {"max_run": {"m": 3}, "max_count": {"f": 1}, "default_max_run": 2, "no_adjacent": [["p", "s"]]}}
    r = rules_from_params(cfg, ["w", "m"])
    assert r.min_gap == {"w": 2} and r.max_run == {"m": 3} and r.max_count == {"f": 1} and r.no_adjacent == [frozenset({"p", "s"})]
