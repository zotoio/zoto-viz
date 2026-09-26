"""LAN Host allowlist table (one pytest per room row; bind 0.0.0.0, stub OS only)."""
from __future__ import annotations

import asyncio

import pytest
from aiohttp import ClientSession

from service.request_guard import HOST_REJECT_BODY
from tests.lan_guard_test_util import LAN_STUB_IFACE_IP, LAN_STUB_OTHER_IP, stub_lan_os_interfaces
from tests.monitor_app_test_util import make_app_server


async def _session_get(ip: str, port: int, headers: dict[str, str]) -> tuple[int, str]:
    async with ClientSession() as session:
        async with session.get(f"http://{ip}:{port}/api/session", headers=headers) as resp:
            return resp.status, await resp.text()


def test_lan_box_interface_address_on_bound_port_returns_200(stub_lan_os_interfaces) -> None:
    async def run() -> None:
        async with make_app_server(bind="0.0.0.0", insecure_lan=True) as (ip, port, _runner):
            status, _body = await _session_get(ip, port, {"Host": f"{LAN_STUB_IFACE_IP}:{port}"})
            assert status == 200

    asyncio.run(run())


def test_lan_box_interface_address_wrong_port_returns_400(stub_lan_os_interfaces) -> None:
    async def run() -> None:
        async with make_app_server(bind="0.0.0.0", insecure_lan=True) as (ip, port, _runner):
            status, body = await _session_get(ip, port, {"Host": f"{LAN_STUB_IFACE_IP}:{port + 1}"})
            assert status == 400
            assert body == HOST_REJECT_BODY

    asyncio.run(run())


def test_lan_non_interface_address_returns_400(stub_lan_os_interfaces) -> None:
    async def run() -> None:
        async with make_app_server(bind="0.0.0.0", insecure_lan=True) as (ip, port, _runner):
            status, body = await _session_get(ip, port, {"Host": f"{LAN_STUB_OTHER_IP}:{port}"})
            assert status == 400
            assert body == HOST_REJECT_BODY

    asyncio.run(run())
