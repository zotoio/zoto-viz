"""Named walls, stored beside profiles at ~/.zoto-viz/walls.yml.

A profile may name a wall by id. The wall itself (layout, defaults, tile
overrides) lives here, so switching profiles does not swap the wall unless
that profile names one.
"""
from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path
from typing import Any

import yaml
from aiohttp import web

from . import paths

ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
DEFAULT_ID = "default"
DEFAULT_NAME = "Default"


def walls_path() -> Path:
    override = os.environ.get("ZOTO_VIZ_WALLS")
    if override:
        return Path(override)
    directory = paths.user_dir()
    directory.mkdir(parents=True, exist_ok=True)
    return directory / "walls.yml"


def empty_file() -> dict[str, Any]:
    wall = {"id": DEFAULT_ID, "name": DEFAULT_NAME, "layout": {}, "defaults": {}, "tiles": {}}
    return {"active": DEFAULT_ID, "walls": {DEFAULT_ID: wall}}


def _read() -> dict[str, Any]:
    path = walls_path()
    if not path.is_file():
        return empty_file()
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(raw, dict) or not isinstance(raw.get("walls"), dict) or not raw["walls"]:
        return empty_file()
    return raw


def _write(doc: dict[str, Any]) -> None:
    path = walls_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    text = yaml.safe_dump(doc, sort_keys=False, allow_unicode=True)
    fd, tmp = tempfile.mkstemp(prefix="walls.", suffix=".yml", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def migrate_current(layout: dict[str, Any], defaults: dict[str, Any], tiles: dict[str, Any]) -> dict[str, Any]:
    """First save: today's wall becomes Default, with the same layout."""
    doc = _read()
    if walls_path().is_file() and doc["walls"].get(DEFAULT_ID, {}).get("layout"):
        return doc
    doc["walls"][DEFAULT_ID] = {
        "id": DEFAULT_ID,
        "name": DEFAULT_NAME,
        "layout": dict(layout),
        "defaults": dict(defaults),
        "tiles": dict(tiles),
    }
    doc["active"] = doc.get("active") or DEFAULT_ID
    _write(doc)
    return doc


def save_as(name: str) -> dict[str, Any]:
    doc = _read()
    base = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-") or "wall"
    ident = base
    n = 2
    while ident in doc["walls"]:
        ident = f"{base}-{n}"
        n += 1
    src = doc["walls"].get(doc.get("active") or DEFAULT_ID) or empty_file()["walls"][DEFAULT_ID]
    doc["walls"][ident] = {
        "id": ident,
        "name": name.strip() or DEFAULT_NAME,
        "layout": dict(src.get("layout") or {}),
        "defaults": dict(src.get("defaults") or {}),
        "tiles": dict(src.get("tiles") or {}),
    }
    doc["active"] = ident
    _write(doc)
    return doc


def rename(ident: str, name: str) -> dict[str, Any] | None:
    doc = _read()
    wall = doc["walls"].get(ident)
    if not wall:
        return None
    wall["name"] = name.strip() or wall.get("name") or ident
    _write(doc)
    return doc


def delete(ident: str) -> dict[str, Any] | None:
    doc = _read()
    if ident not in doc["walls"] or len(doc["walls"]) < 2:
        return None
    del doc["walls"][ident]
    if doc.get("active") == ident:
        doc["active"] = next(iter(doc["walls"]))
    _write(doc)
    return doc


async def api_list(_request: web.Request) -> web.Response:
    return web.json_response(_read())


async def api_save(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "json body required"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "json body required"}, status=400)
    name = str(body.get("name") or "").strip()
    if body.get("migrate"):
        doc = migrate_current(
            body.get("layout") if isinstance(body.get("layout"), dict) else {},
            body.get("defaults") if isinstance(body.get("defaults"), dict) else {},
            body.get("tiles") if isinstance(body.get("tiles"), dict) else {},
        )
        return web.json_response(doc)
    if not name:
        return web.json_response({"error": "name required"}, status=400)
    return web.json_response(save_as(name), status=201)


async def api_one(request: web.Request) -> web.Response:
    ident = request.match_info["id"]
    if not ID_RE.match(ident):
        return web.json_response({"error": "bad id"}, status=400)
    if request.method == "DELETE":
        doc = delete(ident)
        if doc is None:
            return web.json_response({"error": "cannot delete"}, status=409)
        return web.json_response(doc)
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "json body required"}, status=400)
    name = str(body.get("name") or "").strip() if isinstance(body, dict) else ""
    doc = rename(ident, name)
    if doc is None:
        return web.json_response({"error": "not found"}, status=404)
    return web.json_response(doc)
