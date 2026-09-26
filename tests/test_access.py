from __future__ import annotations

from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase

from service import access
from service.forensics import location_allowed
from tests.pack_asset_test_util import SECRET, SESSION, mint


def test_bind_is_loopback() -> None:
    assert access.bind_is_loopback("127.0.0.1")
    assert access.bind_is_loopback("::1")
    assert access.bind_is_loopback("localhost")
    assert access.bind_is_loopback("127.0.0.2")
    assert not access.bind_is_loopback("0.0.0.0")
    assert not access.bind_is_loopback("192.168.1.5")
    assert not access.bind_is_loopback("nope")
    assert access.new_token()
    secret = access.new_pack_asset_secret()
    assert len(secret) >= 16
    sat = mint("pulse-ts")
    url = access.pack_asset_url(sat, "pulse-ts", "module.js")
    assert url.startswith("/pack-assets/")
    assert sat in url
    assert "?" not in url


def test_header_hostname() -> None:
    assert access.header_hostname("127.0.0.1:7020") == "127.0.0.1"
    assert access.header_hostname("[::1]:7020") == "::1"
    assert access.is_loopback_name("localhost")
    assert access.origin_hostname("http://127.0.0.1:5173") == "127.0.0.1"
    assert access.origin_hostname("null") == ""


def test_location_allowed() -> None:
    ip = "192.168.86.20"
    assert location_allowed(f"http://{ip}/desc.xml", ip)
    assert location_allowed(f"https://{ip}:8443/d", ip)
    assert not location_allowed("http://127.0.0.1/meta", ip)
    assert not location_allowed("http://169.254.169.254/latest", ip)
    assert not location_allowed("file:///etc/passwd", ip)
    assert not location_allowed("http://192.168.86.1/x", ip)
    assert not location_allowed("javascript:alert(1)", ip)
    assert location_allowed(f"http://{ip}/x", ip)
    assert not location_allowed("http:///", ip)
    assert location_allowed("http://printer.local/d", "printer.local")
    assert not location_allowed("http://other.local/d", "printer.local")


class FakeReq:
    def __init__(
        self,
        *,
        method="GET",
        host="127.0.0.1:7020",
        origin="",
        cookie="",
        header="",
        lan=False,
        csrf="tok",
        pack_asset_secret=SECRET,
        path="/poke",
        query=None,
    ):
        self.method = method
        self.path = path
        self.path_qs = path
        self.query = query or {}
        self.headers = {}
        if host:
            self.headers["Host"] = host
        if origin:
            self.headers["Origin"] = origin
        if header:
            self.headers[access.HEADER] = header
        self.cookies = {access.COOKIE: cookie} if cookie else {}
        self.app = {"csrf": csrf, "insecure_lan": lan, "pack_asset_secret": pack_asset_secret}


def test_host_origin_csrf_helpers() -> None:
    assert access.host_ok(FakeReq())
    assert not access.host_ok(FakeReq(host="evil.example"))
    assert access.host_ok(FakeReq(host="lan.box:7020", lan=True))
    assert access.origin_ok(FakeReq(origin=""))
    assert access.origin_ok(FakeReq(origin="http://127.0.0.1:5173"))
    assert not access.origin_ok(FakeReq(origin="http://evil.example"))
    assert not access.origin_ok(FakeReq(origin="null"))
    assert not access.origin_ok(FakeReq(origin="null", path="/api/profiles"))
    tok = mint("_sandbox")
    assert access.origin_ok(FakeReq(
        origin="null",
        path=access.pack_asset_url(tok, "_sandbox", "plugin-sandbox.html"),
        csrf=SESSION,
    ))
    assert access.parse_pack_assets_path("/pack-assets/tok/pid/module.js")
    assert access.origin_ok(FakeReq(host="lan.box:7020", origin="http://lan.box:7020", lan=True))
    assert not access.origin_ok(FakeReq(host="lan.box:7020", origin="http://other.box", lan=True))
    assert access.csrf_ok(FakeReq(cookie="tok", header="tok"))
    assert access.csrf_ok(FakeReq(cookie="", header="tok"))
    assert access.csrf_ok(FakeReq(cookie="stale", header="tok"))
    assert not access.csrf_ok(FakeReq(cookie="tok", header="nope"))
    assert not access.csrf_ok(FakeReq(cookie="tok", header=""))
    assert not access.csrf_ok(FakeReq(cookie="tok", header="tok", csrf=""))
    resp = type("R", (), {"headers": {}, "set_cookie": lambda *a, **k: None})()
    access.attach_csrf(FakeReq(csrf=""), resp)
    assert access.HEADER not in resp.headers
    assert not access.header_hostname("")
    assert not access.is_loopback_name("")
    assert access.header_hostname("[::1]:7020") == "::1"
    assert access.bind_is_loopback("127.0.0.2")



class AccessMiddlewareTests(AioHTTPTestCase):
    async def get_application(self) -> web.Application:
        async def ok(_: web.Request) -> web.Response:
            return web.json_response({"ok": True})

        async def poke(_: web.Request) -> web.Response:
            return web.json_response({"wrote": True})

        app = web.Application(middlewares=[access.middleware])
        app["csrf"] = "token-aaa"
        app["pack_asset_secret"] = SECRET
        app["insecure_lan"] = False
        app.router.add_get("/ok", ok)
        app.router.add_post("/poke", poke)
        app.router.add_post("/mcp", poke)
        return app

    async def test_loopback_get_and_csrf_post(self) -> None:
        resp = await self.client.get("/ok", headers={"Host": "127.0.0.1:7020"})
        assert resp.status == 200
        token = resp.headers.get(access.HEADER)
        assert token == "token-aaa"

        denied = await self.client.post("/poke", headers={"Host": "127.0.0.1:7020"})
        assert denied.status == 403

        ok = await self.client.post(
            "/poke",
            headers={"Host": "127.0.0.1:7020", access.HEADER: token or ""},
        )
        assert ok.status == 200

        stale = await self.client.post(
            "/poke",
            headers={"Host": "127.0.0.1:7020", access.HEADER: "token-aaa", "Cookie": f"{access.COOKIE}=stale"},
        )
        assert stale.status == 200

    async def test_rebinding_host_rejected(self) -> None:
        resp = await self.client.get("/ok", headers={"Host": "evil.example:7020"})
        assert resp.status == 403

    async def test_foreign_origin_rejected(self) -> None:
        resp = await self.client.get(
            "/ok",
            headers={"Host": "127.0.0.1:7020", "Origin": "http://evil.example"},
        )
        assert resp.status == 403

    async def test_null_origin_denied_on_profiles(self) -> None:
        resp = await self.client.get(
            "/ok",
            headers={"Host": "127.0.0.1:7020", "Origin": "null"},
        )
        assert resp.status == 403

    async def test_mcp_skips_csrf(self) -> None:
        resp = await self.client.post("/mcp", headers={"Host": "127.0.0.1:7020"})
        assert resp.status == 200
