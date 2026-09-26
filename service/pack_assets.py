"""Serve consented plugin files and sandbox bootstrap under ``/pack-assets/<token>/…``."""
from __future__ import annotations

import asyncio
import mimetypes
import re
from pathlib import Path
from typing import Any

from aiohttp import web

from . import access, plugins

PACK_ID_SANDBOX = "_sandbox"
_REPO = Path(__file__).resolve().parents[1]
WEB_DIST = _REPO / "web" / "dist"
_RELPATH_SAFE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._/-]*$")


def _sandbox_bootstrap_file(tail: str) -> bool:
    if tail == "plugin-sandbox.html":
        return True
    return bool(re.fullmatch(r"plugin-sandbox-[\w-]+\.js", tail)) or bool(
        re.fullmatch(r"preload-helper-[\w-]+\.js", tail)
    )


def _plugin_home(row: dict[str, Any]) -> Path | None:
    raw = str(row.get("file") or "")
    if not raw:
        return None
    home = Path(raw)
    if home.name in {"plugin.yml", "plugin.yaml"}:
        return home.parent
    return home


def _resolve_plugin_file(home: Path, relpath: str) -> Path | None:
    if not relpath or not _RELPATH_SAFE.match(relpath):
        return None
    rel = Path(relpath)
    if ".." in rel.parts:
        return None
    target = (home / rel).resolve()
    try:
        target.relative_to(home.resolve())
    except ValueError:
        return None
    return target if target.is_file() else None


def apply_pack_asset_headers(resp: web.StreamResponse) -> None:
    access.attach_sandbox_referrer_policy(resp)
    resp.headers["X-Content-Type-Options"] = "nosniff"


async def api_pack_assets(request: web.Request) -> web.StreamResponse:
    parsed = access.parse_pack_assets_path(request.path or "")
    if not parsed:
        return web.json_response({"error": "not found"}, status=404)
    if not access.sandbox_asset_token_ok(request):
        return web.json_response({"error": "forbidden origin"}, status=403)

    _token, pack_id, tail = parsed

    if pack_id == PACK_ID_SANDBOX:
        if not _sandbox_bootstrap_file(tail):
            return web.json_response({"error": "not found"}, status=404)
        if tail == "plugin-sandbox.html":
            return await _sandbox_html(request, _token)
        asset = WEB_DIST / "assets" / tail
        if not asset.is_file():
            return web.json_response({"error": "not found"}, status=404)
        resp = web.FileResponse(asset)
        apply_pack_asset_headers(resp)
        return resp

    row = plugins._plugin_row(pack_id)
    if not row or not plugins.consented(row):
        return web.json_response({"error": "forbidden origin"}, status=403)

    if tail == "module.js":
        mod = await asyncio.to_thread(plugins.module_response, pack_id)
        apply_pack_asset_headers(mod)
        return mod

    home = _plugin_home(row)
    if not home:
        return web.json_response({"error": "not found"}, status=404)

    target = _resolve_plugin_file(home, tail)
    if not target:
        target = _resolve_plugin_file(home, f"frontend/{tail}")

    if not target:
        return web.json_response({"error": "not found"}, status=404)

    ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
    if target.suffix in {".js", ".mjs"}:
        ctype = "text/javascript"
    elif target.suffix == ".json":
        ctype = "application/json"
    resp = web.FileResponse(target, headers={"Content-Type": f"{ctype}; charset=utf-8"})
    apply_pack_asset_headers(resp)
    resp.headers["Cache-Control"] = "private, no-store"
    return resp


async def _sandbox_html(request: web.Request, token: str) -> web.Response:
    path = WEB_DIST / "plugin-sandbox.html"
    if not path.is_file():
        return web.Response(status=404, text="plugin-sandbox.html missing (run pnpm build)")
    body = path.read_text(encoding="utf-8")
    m = re.search(r'src="(/assets/(plugin-sandbox-[^"]+\.js))"', body)
    if m:
        rel = m.group(2)
        src = access.pack_asset_url(token, PACK_ID_SANDBOX, rel)
        body = body.replace(m.group(0), f'src="{src}"', 1)
    resp = web.Response(text=body, content_type="text/html", charset="utf-8")
    apply_pack_asset_headers(resp)
    return resp
