"""Helpers for pack-asset security tests."""
from __future__ import annotations

import uuid
from urllib.parse import quote

from aiohttp import web

from service import access, pack_asset_frames, pack_asset_tokens, pack_assets

SESSION = "test-session-csrf-token-aaa"
SECRET = b"test-pack-asset-secret-32bytes!!"
DEFAULT_FRAME = "11111111-1111-4111-8111-111111111111"


def test_app() -> web.Application:
    app = web.Application(middlewares=[access.middleware])
    app["csrf"] = SESSION
    app["pack_asset_secret"] = SECRET
    app["insecure_lan"] = False
    app["pack_asset_frame_registry"] = pack_asset_frames.PackAssetFrameRegistry()
    app.router.add_get(r"/pack-assets/{token}/{pack_id}/{tail:.+}", pack_assets.api_pack_assets)
    app.router.add_post("/api/pack-assets/frames", pack_assets.api_pack_asset_register_frame)
    app.router.add_delete("/api/pack-assets/frames/{frame_id}", pack_assets.api_pack_asset_unregister_frame)
    app.router.add_post("/api/pack-assets/token/{pack_id}", pack_assets.api_pack_asset_token)
    register_frame(app, SESSION, DEFAULT_FRAME)
    return app


def register_frame(app: web.Application, session_id: str = SESSION, frame_id: str = DEFAULT_FRAME) -> str:
    pack_asset_frames.registry_for_app(app).register(session_id, frame_id)
    return frame_id


def mint(
    pack_id: str,
    session_id: str = SESSION,
    frame_id: str = DEFAULT_FRAME,
    *,
    app: web.Application | None = None,
) -> str:
    if app is not None:
        register_frame(app, session_id, frame_id)
    return pack_asset_tokens.mint_pack_asset_token(SECRET, session_id, pack_id, frame_id)


def new_frame_id() -> str:
    return str(uuid.uuid4())


def pack_url(
    pack_id: str,
    tail: str,
    token: str | None = None,
    session_id: str = SESSION,
    frame_id: str = DEFAULT_FRAME,
) -> str:
    tok = token if token is not None else mint(pack_id, session_id, frame_id)
    return access.pack_asset_url(tok, pack_id, *tail.split("/"))


def pack_url_raw(pack_id: str, tail: str, token: str | None = None, session_id: str = SESSION) -> str:
    """Build a pack-assets path without re-encoding ``%`` in ``tail`` (traversal probes)."""
    tok = token if token is not None else mint(pack_id, session_id)
    return f"/pack-assets/{quote(tok, safe='')}/{quote(pack_id, safe='')}/{tail}"
