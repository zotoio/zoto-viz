"""Structural deltas for the /ws state stream.

The full state is ~1 MB of JSON and was re-sent to every client every second, while only a
few leaves change per tick (counters, rates, a handful of devices/flows). Clients that opt in
(``/ws?proto=delta``) get one full ``state`` frame, then ``delta`` frames carrying a patch
against the previous sequence number. Legacy clients keep receiving full frames.

Patch encoding (all JSON):
  {"$r": value}                       replace the value
  {"$o": {key: patch}, "$d": [keys]}  object: patch these keys, delete those
  {"$a": length, "$i": {"idx": patch}} array: resize to length, patch these indices
``None`` (JSON null) as a whole patch means "unchanged".
"""
from __future__ import annotations

from typing import Any

# A list whose changed items exceed this share is replaced instead of patched.
LIST_REPLACE_RATIO = 0.5
MAX_DEPTH = 12


def diff(old: Any, new: Any, depth: int = 0) -> Any:
    """Patch turning ``old`` into ``new``, or None when equal."""
    if old is new:
        return None
    if type(old) is not type(new):
        return {"$r": new}
    if isinstance(new, dict):
        if depth >= MAX_DEPTH:
            return None if old == new else {"$r": new}
        sub: dict[str, Any] = {}
        for k, v in new.items():
            if k not in old:
                sub[k] = {"$r": v}
                continue
            p = diff(old[k], v, depth + 1)
            if p is not None:
                sub[k] = p
        dels = [k for k in old if k not in new]
        if not sub and not dels:
            return None
        out: dict[str, Any] = {"$o": sub}
        if dels:
            out["$d"] = dels
        return out
    if isinstance(new, list):
        if depth >= MAX_DEPTH:
            return None if old == new else {"$r": new}
        idx: dict[str, Any] = {}
        n = min(len(old), len(new))
        for i in range(n):
            p = diff(old[i], new[i], depth + 1)
            if p is not None:
                idx[str(i)] = p
        for i in range(n, len(new)):
            idx[str(i)] = {"$r": new[i]}
        if not idx and len(old) == len(new):
            return None
        if new and len(idx) > LIST_REPLACE_RATIO * len(new):
            return {"$r": new}
        return {"$a": len(new), "$i": idx}
    return None if old == new else {"$r": new}


def apply(base: Any, patch: Any) -> Any:
    """Apply ``patch`` to ``base`` (mutates containers in place where possible)."""
    if patch is None:
        return base
    if "$r" in patch:
        return patch["$r"]
    if "$o" in patch:
        obj = base if isinstance(base, dict) else {}
        for k in patch.get("$d", []):
            obj.pop(k, None)
        for k, p in patch["$o"].items():
            obj[k] = apply(obj.get(k), p)
        return obj
    if "$a" in patch:
        arr = base if isinstance(base, list) else []
        n = int(patch["$a"])
        del arr[n:]
        while len(arr) < n:
            arr.append(None)
        for i, p in patch["$i"].items():
            arr[int(i)] = apply(arr[int(i)], p)
        return arr
    return base


def wants_delta(query: Any) -> bool:
    try:
        return str(query.get("proto", "")).lower() == "delta"
    except AttributeError:
        return False
