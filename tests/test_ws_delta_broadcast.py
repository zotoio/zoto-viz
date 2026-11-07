"""broadcast_loop: legacy sockets get full frames; ?proto=delta sockets get one full frame then small deltas."""
import asyncio
import copy
import json

import pytest
from aiohttp import web

from service import monitor, state_delta


class FakeWs:
    def __init__(self):
        self.sent = []

    async def send_str(self, s):
        self.sent.append(json.loads(s))


class Stop(Exception):
    pass


def test_delta_and_legacy_clients(monkeypatch):
    snaps = []
    base = {"ts": 0, "devices": [{"ip": f"10.0.0.{i}", "bytes": i, "pad": "x" * 100} for i in range(200)]}
    for t in range(4):
        s = copy.deepcopy(base)
        s["ts"] = t
        s["devices"][3]["bytes"] = 100 + t
        snaps.append(s)
    it = iter(snaps)
    monkeypatch.setattr(monitor, "publish_state", lambda state, refresh=False: next(it))
    from service import signals
    monkeypatch.setattr(signals, "observe_capture", lambda state: None)
    ticks = {"n": 0}

    async def fake_sleep(_):
        ticks["n"] += 1
        if ticks["n"] >= 4:
            raise Stop

    monkeypatch.setattr(monitor.asyncio, "sleep", fake_sleep)
    app = web.Application()
    legacy, delta, paused = FakeWs(), FakeWs(), FakeWs()
    app["state"] = object()
    app["clients"] = {legacy, delta, paused}
    app["ws_meta"] = {
        legacy: {"delta": False, "paused": False, "need_full": True},
        delta: {"delta": True, "paused": False, "need_full": True},
        paused: {"delta": True, "paused": True, "need_full": True},
    }
    with pytest.raises(Stop):
        asyncio.run(monitor.broadcast_loop(app))

    assert [m["type"] for m in legacy.sent] == ["state"] * 4
    assert [m["type"] for m in delta.sent] == ["state", "delta", "delta", "delta"]
    assert paused.sent == []
    # client-side reconstruction equals the server snapshot at every seq
    cur = {k: v for k, v in delta.sent[0].items() if k not in ("type", "seq")}
    for i, m in enumerate(delta.sent[1:], start=1):
        assert m["base"] == m["seq"] - 1
        cur = state_delta.apply(cur, m["patch"])
        assert cur == snaps[i]
        assert len(json.dumps(m)) < 300
