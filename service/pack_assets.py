"""Serve consented plugin files and sandbox bootstrap under ``/pack-assets/<token>/…``."""
from __future__ import annotations

import asyncio
import mimetypes
import re
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from aiohttp import web

from . import access, plugins

PACK_ID_SANDBOX = "_sandbox"
_REPO = Path(__file__).resolve().parents[1]
WEB_DIST = _REPO / "web" / "dist"
_FRONTEND_ONLY = frozenset({".js", ".mjs", ".json", ".css", ".wasm", ".map", ".txt", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2"})
_BLOCKED_BASENAMES = frozenset({"plugin.yml", "plugin.yaml", "service.py"})
_BACKEND_MARKERS = frozenset({"backend", "service", "collector", "datasource"})


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


def _frontend_root(home: Path) -> Path:
    fe = home / "frontend"
    return fe if fe.is_dir() else home


def _normalize_tail(raw_tail: str) -> str | None:
    """Decode traversal attempts; return safe relative path or None."""
    if not raw_tail or raw_tail.startswith("/") or raw_tail.startswith("\\"):
        return None
    if "\\" in raw_tail:
        return None
    t = raw_tail
    for _ in range(4):
        prev = t
        t = unquote(t)
        if t == prev:
            break
    if t.startswith("/") or t.startswith("//"):
        return None
    if ".." in t.split("/"):
        return None
    if any(part.startswith(".") for part in t.split("/") if part):
        return None
    return t


def _pack_id_ok(pack_id: str) -> bool:
    if not pack_id or pack_id in {".", ".."}:
        return False
    if ".." in pack_id or "/" in pack_id or "\\" in pack_id:
        return False
    if pack_id.startswith("."):
        return False
    return True


def _resolve_under_root(root: Path, relpath: str) -> Path | None:
    rel = Path(relpath)
    if rel.is_absolute():
        return None
    target = (root / rel).resolve()
    root_res = root.resolve()
    try:
        target.relative_to(root_res)
    except ValueError:
        return None
    if not target.is_file():
        return None
    if target.is_symlink():
        real = target.resolve()
        try:
            real.relative_to(root_res)
        except ValueError:
            return None
    return target


def _allowed_plugin_file(home: Path, relpath: str) -> Path | None:
    if not relpath:
        return None
    base = Path(relpath).name
    if base in _BLOCKED_BASENAMES or base.startswith("."):
        return None
    if any(part in _BACKEND_MARKERS for part in Path(relpath).parts):
        return None
    fe_root = _frontend_root(home)
    target = _resolve_under_root(fe_root, relpath)
    if not target:
        return None
    if target.suffix.lower() not in _FRONTEND_ONLY and target.suffix:
        return None
    return target


def _content_type(path: Path) -> str:
    ctype = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    if path.suffix in {".js", ".mjs"}:
        return "text/javascript; charset=utf-8"
    if path.suffix == ".json":
        return "application/json; charset=utf-8"
    if ctype.startswith("image/") or ctype.startswith("font/"):
        return ctype
    if ctype.startswith("text/"):
        return f"{ctype}; charset=utf-8"
    return ctype


def _no_store(resp: web.StreamResponse) -> None:
    resp.headers["Cache-Control"] = "no-store"
    resp.headers.pop("ETag", None)
    resp.headers.pop("Last-Modified", None)


def apply_pack_asset_headers(resp: web.StreamResponse) -> None:
    access.attach_sandbox_referrer_policy(resp)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    _no_store(resp)


def _sandbox_csp(_request: web.Request) -> str:
    return (
        f"default-src 'none'; "
        f"script-src 'self' blob:; "
        f"connect-src 'none'; "
        f"img-src data:; style-src 'none'; "
        f"base-uri 'none'; "
        f"form-action 'none'"
    )


def _attach_sandbox_frame_policy(resp: web.Response, request: web.Request) -> None:
    csp = _sandbox_csp(request)
    resp.headers["Content-Security-Policy"] = csp
    resp.headers["X-Frame-Options"] = "SAMEORIGIN"


def _pack_forbidden() -> web.Response:
    resp = web.json_response({"error": "forbidden origin"}, status=403)
    access.attach_pack_asset_json_headers(resp)
    return resp


def _pack_not_found() -> web.Response:
    resp = web.json_response({"error": "not found"}, status=404)
    access.attach_pack_asset_json_headers(resp)
    return resp


async def api_pack_assets(request: web.Request) -> web.StreamResponse:
    parsed = access.parse_pack_assets_path(request.path or "")
    if not parsed:
        return _pack_not_found()
    if not access.pack_asset_token_ok(request):
        return _pack_forbidden()

    _token, pack_id, raw_tail = parsed
    if not _pack_id_ok(pack_id):
        return _pack_not_found()
    tail = _normalize_tail(raw_tail)
    if tail is None:
        return _pack_not_found()

    if pack_id == PACK_ID_SANDBOX:
        if not _sandbox_bootstrap_file(tail):
            return _pack_not_found()
        if tail == "plugin-sandbox.html":
            return await _sandbox_html(request, _token)
        asset = WEB_DIST / "assets" / tail
        if not asset.is_file():
            return _pack_not_found()
        body = asset.read_bytes()
        resp = web.Response(body=body, headers={"Content-Type": _content_type(asset)})
        apply_pack_asset_headers(resp)
        _attach_sandbox_frame_policy(resp, request)
        return resp

    row = plugins._plugin_row(pack_id)
    if not row or not plugins.consented(row):
        return _pack_forbidden()

    if tail == "module.js":
        mod = await asyncio.to_thread(plugins.module_response, pack_id)
        apply_pack_asset_headers(mod)
        return mod

    home = _plugin_home(row)
    if not home:
        return _pack_not_found()

    target = _allowed_plugin_file(home, tail)
    if not target:
        target = _allowed_plugin_file(home, f"frontend/{tail}") if not tail.startswith("frontend/") else None

    if not target:
        return _pack_not_found()

    resp = web.Response(body=target.read_bytes(), headers={"Content-Type": _content_type(target)})
    apply_pack_asset_headers(resp)
    return resp


def _rewrite_sandbox_html(body: str, token: str) -> str:
    def repl_asset(m: re.Match[str]) -> str:
        attr, path = m.group(1), m.group(2)
        name = path.rsplit("/", 1)[-1]
        url = access.pack_asset_url(token, PACK_ID_SANDBOX, name)
        return f'{attr}="{url}"'

    body = re.sub(
        r'(?P<attr>src|href)="(?P<path>/assets/(?:plugin-sandbox|preload-helper)-[\w-]+\.js)"',
        repl_asset,
        body,
    )
    return body


async def _sandbox_html(request: web.Request, token: str) -> web.Response:
    path = WEB_DIST / "plugin-sandbox.html"
    if not path.is_file():
        return web.Response(status=404, text="plugin-sandbox.html missing (run pnpm build)")
    body = _rewrite_sandbox_html(path.read_text(encoding="utf-8"), token)
    resp = web.Response(text=body, content_type="text/html", charset="utf-8")
    apply_pack_asset_headers(resp)
    _attach_sandbox_frame_policy(resp, request)
    return resp


async def api_pack_asset_token(request: web.Request) -> web.Response:
    """Mint a pack-scoped asset token for the caller's CSRF session."""
    from . import pack_asset_tokens

    if not access.csrf_ok(request):
        return access._deny("csrf required")
    pack_id = (request.match_info.get("pack_id") or "").strip()
    if not _pack_id_ok(pack_id):
        return web.json_response({"error": "unknown pack"}, status=404)
    if pack_id != PACK_ID_SANDBOX:
        row = plugins._plugin_row(pack_id)
        if not row or not plugins.consented(row):
            return access._deny("forbidden")
    secret = request.app.get("pack_asset_secret")
    if not secret:
        return web.json_response({"error": "unavailable"}, status=503)
    sid = pack_asset_tokens.session_id_from_request(request)
    token = pack_asset_tokens.mint_pack_asset_token(secret, sid, pack_id)
    return web.json_response({"packId": pack_id, "token": token})
