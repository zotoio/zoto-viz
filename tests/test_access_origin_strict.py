"""Strict Origin parsing and loopback policy rows (one test per revert-proof row)."""
from __future__ import annotations

from service import access

PORT = 7020


class _FakeReq:
    def __init__(
        self,
        *,
        origin: str,
        host: str = f"127.0.0.1:{PORT}",
        lan: bool = False,
        path: str = "/poke",
        method: str = "GET",
    ):
        self.method = method
        self.path = path
        self.headers = {"Host": host, "Origin": origin}
        self.app = {"insecure_lan": lan}


def test_origin_ok_denies_userinfo_evil_com_at_localhost_port() -> None:
    origin = f"http://evil.com@localhost:{PORT}"
    assert not access.origin_ok(_FakeReq(origin=origin, host=f"localhost:{PORT}"))


def test_origin_ok_denies_localhost_port_with_path_suffix() -> None:
    origin = f"http://localhost:{PORT}/x"
    assert not access.origin_ok(_FakeReq(origin=origin, host=f"localhost:{PORT}"))


def test_origin_ok_denies_127_0_0_2_origin_in_default_mode() -> None:
    origin = f"http://127.0.0.2:{PORT}"
    assert not access.origin_ok(_FakeReq(origin=origin, host=f"127.0.0.2:{PORT}", lan=False))


def test_origin_ok_allows_127_0_0_2_origin_in_insecure_lan_mode() -> None:
    origin = f"http://127.0.0.2:{PORT}"
    assert access.origin_ok(_FakeReq(origin=origin, host=f"127.0.0.2:{PORT}", lan=True))


def test_origin_null_denied_without_token_on_api_path() -> None:
    req = _FakeReq(origin="null", path="/api/profiles")
    assert not access.origin_ok(req)


def test_sandbox_null_origin_branch_was_dead_on_api_path() -> None:
    """Restoring sandbox_null_origin_allowed in origin_ok still denies null on non-pack paths."""
    req = _FakeReq(origin="null", path="/api/profiles")
    assert not access.sandbox_null_origin_allowed(req)
    assert not access.origin_ok(req)
