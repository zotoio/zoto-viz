import copy
import json
import random

from service import state_delta as sd


def roundtrip(old, new):
    patch = sd.diff(old, new)
    patch = json.loads(json.dumps(patch))  # what the wire carries
    got = sd.apply(copy.deepcopy(old), patch)
    assert got == new
    return patch


def test_equal_is_none():
    assert sd.diff({"a": [1, {"b": 2}]}, {"a": [1, {"b": 2}]}) is None


def test_nested_leaf_change_is_small():
    old = {"devices": [{"ip": f"10.0.0.{i}", "bytes_in": i, "vendor": "x" * 200} for i in range(300)], "ts": 1}
    new = copy.deepcopy(old)
    new["devices"][7]["bytes_in"] += 99
    new["ts"] = 2
    patch = roundtrip(old, new)
    assert len(json.dumps(patch)) < 200
    assert len(json.dumps(new)) > 50_000


def test_add_delete_keys_and_resize_lists():
    old = {"a": 1, "gone": True, "l": [1, 2, 3], "n": None}
    new = {"a": 1, "added": {"x": [1]}, "l": [1, 2], "n": 0}
    roundtrip(old, new)
    roundtrip({"l": [1]}, {"l": [1, 2, 3]})


def test_type_change_and_mostly_changed_list_replaces():
    assert sd.diff({"a": 1}, {"a": "1"}) == {"$o": {"a": {"$r": "1"}}}
    p = sd.diff([1, 2, 3, 4], [5, 6, 7, 4])
    assert p == {"$r": [5, 6, 7, 4]}


def test_random_fuzz_roundtrip():
    rnd = random.Random(7)

    def gen(d=0):
        r = rnd.random()
        if d > 3 or r < 0.3:
            return rnd.choice([None, True, 1, 2.5, "s", "t"])
        if r < 0.65:
            return {rnd.choice("abcdef"): gen(d + 1) for _ in range(rnd.randint(0, 4))}
        return [gen(d + 1) for _ in range(rnd.randint(0, 4))]

    for _ in range(400):
        roundtrip(gen(), gen())


def test_wants_delta():
    assert sd.wants_delta({"proto": "delta"})
    assert not sd.wants_delta({})
    assert not sd.wants_delta(None)
