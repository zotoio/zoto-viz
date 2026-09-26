"""Helpers for pack-asset security tests."""
from __future__ import annotations

from aiohttp import web

from service import access, pack_asset_tokens, pack_assets

SESSION = "test-session-csrf-token-aaa"
SECRET = b"test-pack-asset-secret-32bytes!!"


def test_app() -> web.Application:
    app = web.Application(middlewares=[access.middleware])
    app["csrf"] = SESSION
    app["pack_asset_secret"] = SECRET
    app["insecure_lan"] = False
    app.router.add_get(r"/pack-assets/{token}/{pack_id}/{tail:.+}", pack_assets.api_pack_assets)
    app.router.add_post("/api/pack-assets/token/{pack_id}", pack_assets.api_pack_asset_token)
    return app


def mint(pack_id: str, session_id: str = SESSION) -> str:
    return pack_asset_tokens.mint_pack_asset_token(SECRET, session_id, pack_id)


def pack_url(pack_id: str, tail: str, token: str | None = None, session_id: str = SESSION) -> str:
    tok = token if token is not None else mint(pack_id, session_id)
    return access.pack_asset_url(tok, pack_id, *tail.split("/"))
