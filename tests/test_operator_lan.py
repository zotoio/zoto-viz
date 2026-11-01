"""Non-loopback clients must not receive the CSRF token, and writes need the operator bearer."""
from __future__ import annotations

import asyncio
import json

from aiohttp import ClientSession

from service import access, logbuf, signals
from tests.monitor_app_test_util import make_app_server


def test_lan_session_hides_csrf_and_writes_need_bearer() -> None:
    async def run() -> None:
        logbuf.reset_for_tests()
        signals.reset_for_tests()
        async with make_app_server(
            bind="0.0.0.0",
            insecure_lan=True,
            allowed_hosts=["viz.example.lan"],
        ) as (ip, port, runner):
            runner.app["operator_token"] = "op-secret"
            lan = {"Host": f"viz.example.lan:{port}"}
            loop = {"Host": f"127.0.0.1:{port}"}
            base = f"http://{ip}:{port}"
            async with ClientSession() as session:
                async with session.get(f"{base}/api/session", headers=lan) as resp:
                    assert resp.status == 200
                    assert access.HEADER not in resp.headers
                    body = await resp.json()
                    assert body.get("csrf", "") == ""
                    assert body["operatorAuth"] is True
                    assert "op-secret" not in json.dumps(body)
                async with session.post(
                    f"{base}/mcp",
                    headers=lan,
                    json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
                ) as resp:
                    assert resp.status == 401
                    assert (await resp.json())["error"] == "operator bearer required"
                async with session.post(
                    f"{base}/mcp",
                    headers={**lan, "Authorization": "Bearer op-secret"},
                    json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
                ) as resp:
                    assert resp.status == 200
                    assert (await resp.json())["result"] == {}
                async with session.post(f"{base}/api/profiles", headers=lan, json={"id": "x"}) as resp:
                    assert resp.status == 401
                async with session.get(f"{base}/api/session", headers=loop) as resp:
                    assert resp.status == 200
                    assert resp.headers.get(access.HEADER)
                    assert (await resp.json()).get("csrf")
            text = " ".join(row["text"] for row in logbuf.since(0)["lines"])
            assert "event=http_denied reason=bearer" in text
            assert "op-secret" not in text
            denied = [
                row for row in signals.snapshot()["counters"]
                if row["name"] == "http_denials_total" and row["labels"].get("reason") == "bearer"
            ]
            assert denied and denied[0]["value"] >= 1

    asyncio.run(run())
