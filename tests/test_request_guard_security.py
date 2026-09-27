"""Host allowlist security mutants: each row reverts one guard in request_guard."""
from __future__ import annotations

import asyncio

from aiohttp import ClientSession

from service import request_guard
from service.request_guard import HOST_REJECT_BODY, validate_allowed_host_entry
from tests.monitor_app_test_util import host_header, make_app_server


def test_escape_log_host_sanitizes_control_characters() -> None:
    raw = "evil\r\ninjected"
    assert request_guard.escape_log_host(raw) == "evil\\r\\ninjected"
    assert "\n" not in request_guard.escape_log_host(raw)
    assert "\r" not in request_guard.escape_log_host(raw)


def test_validate_allowed_host_rejects_out_of_range_port() -> None:
    try:
        validate_allowed_host_entry("lan.example:99999")
    except ValueError as exc:
        assert "invalid allowed_hosts" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_validate_allowed_host_rejects_forbidden_characters() -> None:
    try:
        validate_allowed_host_entry("bad;host")
    except ValueError as exc:
        assert "invalid allowed_hosts" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_validate_allowed_host_rejects_invalid_hostname_syntax() -> None:
    try:
        validate_allowed_host_entry("-bad-hostname")
    except ValueError as exc:
        assert "invalid allowed_hosts" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_multiple_host_headers_rejected() -> None:
    async def run() -> None:
        async with make_app_server() as (ip, port, _runner):
            url = f"http://{ip}:{port}/api/session"
            async with ClientSession() as session:
                async with session.get(
                    url,
                    headers=[("Host", f"127.0.0.1:{port}"), ("Host", f"evil.example:{port}")],
                ) as resp:
                    assert resp.status == 400
                    assert await resp.text() == HOST_REJECT_BODY

    asyncio.run(run())
