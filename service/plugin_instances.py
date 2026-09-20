"""User plugin instances: extra catalog rows that reuse a shipped plugin tree.

Config lives at ``~/.zoto-viz/plugin-instances.yml``. Shipped instances stay on
``plugin.yml``; this file only stores operator extras (and overrides).
"""
from __future__ import annotations

import json
import re
from typing import Any

import yaml
from aiohttp import web

from . import paths

ID_RE = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")


def instances_file() -> Any:
    d = paths.user_dir()
    d.mkdir(parents=True, exist_ok=True)
    return d / "plugin-instances.yml"


_rows: list[dict[str, str]] = []
_loaded = False


def reset_for_tests() -> None:
    global _rows, _loaded
    _rows = []
    _loaded = False


def normalize(raw: Any, *, taken: set[str] | None = None) -> dict[str, str]:
    if not isinstance(raw, dict):
        raise ValueError("instance object required")
    plugin = str(raw.get("plugin") or "").strip()
    iid = str(raw.get("id") or "").strip()
    if not ID_RE.match(plugin):
        raise ValueError("plugin id required")
    if not ID_RE.match(iid):
        raise ValueError("instance id required")
    key = f"{plugin}:{iid}"
    owned = taken if taken is not None else set()
    if key in owned:
        raise ValueError(f"duplicate instance {key}")
    row: dict[str, str] = {"plugin": plugin, "id": iid}
    for key_name in ("name", "hint", "source", "title", "caption", "image", "link", "filter"):
        val = str(raw.get(key_name) or "").strip()
        if val:
            row[key_name] = val[:280] if key_name == "hint" else val[:64]
    return row


def load() -> list[dict[str, str]]:
    global _rows, _loaded
    p = instances_file()
    if not p.is_file():
        _rows = []
        _loaded = True
        return []
    try:
        raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError):
        raw = {}
    items = raw.get("instances") if isinstance(raw, dict) else None
    if not isinstance(items, list):
        items = []
    out: list[dict[str, str]] = []
    taken: set[str] = set()
    for item in items:
        try:
            row = normalize(item, taken=taken)
        except ValueError:
            continue
        taken.add(f"{row['plugin']}:{row['id']}")
        out.append(row)
    _rows = out
    _loaded = True
    return list(_rows)


def ensure() -> list[dict[str, str]]:
    if not _loaded:
        return load()
    return list(_rows)


def save(rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    taken: set[str] = set()
    out: list[dict[str, str]] = []
    for item in rows:
        row = normalize(item, taken=taken)
        taken.add(f"{row['plugin']}:{row['id']}")
        out.append(row)
    instances_file().write_text(
        yaml.safe_dump({"instances": out}, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    global _rows, _loaded
    _rows = out
    _loaded = True
    return list(_rows)


def upsert(raw: dict[str, Any]) -> dict[str, str]:
    rows = [r for r in ensure() if not (r["plugin"] == raw.get("plugin") and r["id"] == raw.get("id"))]
    taken = {f"{r['plugin']}:{r['id']}" for r in rows}
    row = normalize(raw, taken=taken)
    rows.append(row)
    save(rows)
    return row


def delete(plugin: str, iid: str) -> bool:
    rows = ensure()
    keep = [r for r in rows if not (r["plugin"] == plugin and r["id"] == iid)]
    if len(keep) == len(rows):
        return False
    save(keep)
    return True


def attach(plugins: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge user instances onto catalog plugin rows."""
    extra = ensure()
    by_plugin: dict[str, list[dict[str, str]]] = {}
    for row in extra:
        by_plugin.setdefault(row["plugin"], []).append(row)
    out: list[dict[str, Any]] = []
    for spec in plugins:
        pid = str(spec.get("id") or "")
        shipped = [i for i in (spec.get("instances") or []) if isinstance(i, dict) and i.get("id")]
        merged: dict[str, dict[str, Any]] = {str(i["id"]): dict(i) for i in shipped}
        if pid and pid not in merged and shipped:
            merged[pid] = {"id": pid}
        for row in by_plugin.get(pid, []):
            cur = dict(merged.get(row["id"]) or {"id": row["id"]})
            for key in ("name", "hint", "source", "title", "caption", "image", "link", "filter"):
                if row.get(key):
                    cur[key] = row[key]
            merged[row["id"]] = cur
        if not shipped and not by_plugin.get(pid):
            out.append(spec)
            continue
        if pid and pid not in merged:
            merged = {pid: {"id": pid}, **merged}
        rows = list(merged.values())
        out.append({**spec, "instances": rows})
    return out


def config_payload() -> dict[str, Any]:
    return {"instances": ensure()}


async def api_instances(request: web.Request) -> web.Response:
    if request.method == "GET":
        return web.json_response(config_payload())
    if request.method == "PUT":
        try:
            body = await request.json()
        except (json.JSONDecodeError, TypeError):
            return web.json_response({"error": "json required"}, status=400)
        rows = body.get("instances") if isinstance(body, dict) else None
        if not isinstance(rows, list):
            return web.json_response({"error": "instances list required"}, status=400)
        try:
            save(rows)
        except ValueError as e:
            return web.json_response({"error": str(e)}, status=400)
        return web.json_response(config_payload())
    try:
        body = await request.json()
    except (json.JSONDecodeError, TypeError):
        return web.json_response({"error": "json required"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "object required"}, status=400)
    try:
        row = upsert(body)
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=400)
    return web.json_response({"ok": True, "instance": row, **config_payload()})


async def api_instance(request: web.Request) -> web.Response:
    plugin = request.match_info.get("plugin", "").strip()
    iid = request.match_info.get("id", "").strip()
    if not plugin or not iid:
        return web.json_response({"error": "plugin and id required"}, status=400)
    if request.method == "DELETE":
        if not delete(plugin, iid):
            return web.json_response({"error": "unknown instance"}, status=404)
        return web.json_response({"ok": True, **config_payload()})
    try:
        body = await request.json()
    except (json.JSONDecodeError, TypeError):
        body = {}
    if not isinstance(body, dict):
        body = {}
    try:
        row = upsert({**body, "plugin": plugin, "id": iid})
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=400)
    return web.json_response({"ok": True, "instance": row, **config_payload()})
