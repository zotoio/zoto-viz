"""UI settings profiles stored at ~/.zoto-viz/profiles.yml.

`zoto-viz` (label "zoto viz") is the shipped default: the file always
contains it, the UI treats it as read-only, and each boot refreshes its
settings blob from the frontend. A leftover `netviz` id is migrated on
read. Other profiles (starting with `user`) are writable.

`global` sits beside the profiles. It is the same for every look: the
agent model choice, and whether the operator has accepted the microphone
or camera. It is not a profile id and it is not in the agent settings
whitelist.
"""
from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path
from typing import Any

from . import paths
import yaml
from aiohttp import web

DIR = paths.user_dir()
FILE = paths.profiles_file()
SHIPPED_ID = "zoto-viz"
SHIPPED_LABEL = "zoto viz"
LEGACY_SHIPPED_ID = "netviz"
ID_RE = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
HEADER = (
    "# zoto-viz UI profiles.\n"
    "# `zoto-viz` is the shipped default: the UI will not overwrite it.\n"
    "# `default` is the profile loaded on startup.\n"
    "# `global` is shared across profiles: model choice, and mic / camera acceptance.\n"
)
RESERVED_IDS = frozenset({SHIPPED_ID, LEGACY_SHIPPED_ID, "global"})


def _empty(fresh: bool = False) -> dict[str, Any]:
    return {
        "default": "user",
        "global": _empty_global(),
        "profiles": {
            SHIPPED_ID: {"shipped": True, "label": SHIPPED_LABEL, "settings": {}},
        },
        "fresh": fresh,
    }


def _empty_global() -> dict[str, Any]:
    return {"ai": {}, "media": {}}


def _normalize_ai(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    backend = raw.get("backend")
    if backend in ("cursor", "ollama", ""):
        out["backend"] = backend
    model = raw.get("model")
    if isinstance(model, str):
        out["model"] = model.strip()[:64]
    cursor = raw.get("cursorModel")
    if isinstance(cursor, str):
        out["cursorModel"] = cursor.strip()[:64]
    if "cycle" in raw:
        out["cycle"] = raw.get("cycle") is True
    return out


def _normalize_media(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    if raw.get("mic") is True:
        out["mic"] = True
    if raw.get("cam") is True:
        out["cam"] = True
    return out


def _normalize_global(raw: Any) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    return {"ai": _normalize_ai(src.get("ai")), "media": _normalize_media(src.get("media"))}


def _ai_meaningful(ai: dict[str, Any]) -> bool:
    if ai.get("backend") in ("cursor", "ollama"):
        return True
    if str(ai.get("model") or "").strip() or str(ai.get("cursorModel") or "").strip():
        return True
    return ai.get("cycle") is True


def _seed_ai(profiles: dict[str, Any], default_id: str) -> dict[str, Any]:
    seen: set[str] = set()
    for pid in (default_id, *profiles.keys()):
        if pid in seen:
            continue
        seen.add(pid)
        body = profiles.get(pid)
        settings = body.get("settings") if isinstance(body, dict) else None
        ai = _normalize_ai(settings.get("ai") if isinstance(settings, dict) else None)
        if _ai_meaningful(ai):
            return ai
    return {}


def _merge_global(cur: Any, patch: dict[str, Any]) -> dict[str, Any]:
    base = _normalize_global(cur)
    out = {"ai": dict(base["ai"]), "media": dict(base["media"])}
    if "ai" in patch:
        out["ai"] = _normalize_ai(patch.get("ai"))
    if "media" in patch:
        out["media"] = _normalize_media(patch.get("media"))
    return out


def _is_shipped(pid: str) -> bool:
    return pid == SHIPPED_ID or pid == LEGACY_SHIPPED_ID


def _canon_id(pid: str) -> str:
    return SHIPPED_ID if pid == LEGACY_SHIPPED_ID else pid


def _read() -> dict[str, Any]:
    if not FILE.exists():
        return _empty(fresh=True)
    try:
        raw = yaml.safe_load(FILE.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError) as e:
        raise ValueError(f"could not read {FILE}: {e}") from e
    if not isinstance(raw, dict):
        raise ValueError(f"{FILE} must be a mapping")
    had_global = "global" in raw
    profiles: dict[str, Any] = {}
    src = raw.get("profiles") or {}
    if not isinstance(src, dict):
        raise ValueError("profiles must be a mapping")
    for pid, body in src.items():
        pid = str(pid)
        if not ID_RE.match(pid) or not isinstance(body, dict):
            continue
        settings = body.get("settings")
        item: dict[str, Any] = {
            "shipped": _is_shipped(pid) or bool(body.get("shipped")),
            "label": str(body.get("label") or pid),
            "settings": settings if isinstance(settings, dict) else {},
        }
        model = _opt_model(body)
        if model:
            item["model"] = model
        profiles[pid] = item
    migrated = False
    if LEGACY_SHIPPED_ID in profiles:
        legacy = profiles.pop(LEGACY_SHIPPED_ID)
        if SHIPPED_ID not in profiles:
            profiles[SHIPPED_ID] = legacy
        migrated = True
    if SHIPPED_ID not in profiles:
        profiles[SHIPPED_ID] = {"shipped": True, "label": SHIPPED_LABEL, "settings": {}}
        migrated = True
    else:
        profiles[SHIPPED_ID]["shipped"] = True
        profiles[SHIPPED_ID]["label"] = SHIPPED_LABEL
        profiles[SHIPPED_ID].setdefault("settings", {})
    default = _canon_id(str(raw.get("default") or SHIPPED_ID))
    if default not in profiles:
        default = SHIPPED_ID
    global_block = _normalize_global(raw.get("global"))
    if not had_global:
        seeded = _seed_ai(profiles, default)
        if seeded:
            global_block = {"ai": seeded, "media": global_block["media"]}
        migrated = True
    doc = {"default": default, "global": global_block, "profiles": profiles, "fresh": False}
    if migrated:
        try:
            _write(doc)
        except OSError:
            pass
    return doc


def _write(doc: dict[str, Any]) -> None:
    DIR.mkdir(mode=0o700, exist_ok=True)
    out = {
        "default": doc["default"],
        "global": _normalize_global(doc.get("global")),
        "profiles": {
            pid: _body_out(pid, p)
            for pid, p in doc["profiles"].items()
        },
    }
    text = HEADER + yaml.safe_dump(out, sort_keys=False, allow_unicode=True)
    fd, tmp = tempfile.mkstemp(prefix="profiles.", suffix=".yml", dir=DIR)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.chmod(tmp, 0o600)
        os.replace(tmp, FILE)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _meta(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "default": doc["default"],
        "fresh": bool(doc.get("fresh")),
        "file": str(FILE),
        "profiles": [_meta_one(pid, p) for pid, p in doc["profiles"].items()],
    }


def _opt_model(body: Any) -> str | None:
    if not isinstance(body, dict):
        return None
    raw = body.get("model")
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    return text[:64] if text else None


def _body_out(pid: str, p: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {
        "shipped": bool(p.get("shipped")),
        "label": p.get("label") or pid,
        "settings": p.get("settings") or {},
    }
    model = p.get("model")
    if isinstance(model, str) and model.strip():
        out["model"] = model.strip()[:64]
    return out


def _meta_one(pid: str, p: dict[str, Any]) -> dict[str, Any]:
    item: dict[str, Any] = {"id": pid, "label": p["label"], "shipped": bool(p["shipped"])}
    model = p.get("model")
    if isinstance(model, str) and model.strip():
        item["model"] = model.strip()[:64]
    return item


def _settings(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text='{"error":"settings object required"}', content_type="application/json")
    raw = body.get("settings")
    if not isinstance(raw, dict):
        raise web.HTTPBadRequest(text='{"error":"settings object required"}', content_type="application/json")
    return raw


def _id(raw: str) -> str:
    pid = (raw or "").strip()
    if not ID_RE.match(pid):
        raise web.HTTPBadRequest(
            text='{"error":"id must be a slug: start with a letter, then letters, digits, _ or - (max 32)"}',
            content_type="application/json",
        )
    return pid


def current_settings() -> dict[str, Any]:
    """Default profile's settings blob (empty mapping when missing)."""
    doc = _read()
    pid = str(doc.get("default") or SHIPPED_ID)
    p = doc["profiles"].get(pid) or {}
    settings = p.get("settings")
    return settings if isinstance(settings, dict) else {}


def current_id() -> str:
    doc = _read()
    return str(doc.get("default") or SHIPPED_ID)


def list_meta() -> dict[str, Any]:
    """Profile ids/labels for MCP / operators."""
    return _meta(_read())


def profile_entry(pid: str) -> dict[str, Any] | None:
    """One profile including its settings blob, or None."""
    pid = _canon_id((pid or "").strip())
    doc = _read()
    p = doc["profiles"].get(pid)
    if not p:
        return None
    return {"id": pid, "default": doc["default"], **_body_out(pid, p)}


async def api_global_get(_request: web.Request) -> web.Response:
    try:
        doc = _read()
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=500)
    return web.json_response(_normalize_global(doc.get("global")))


async def api_global_put(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "json body required"}, status=400)
    if not isinstance(body, dict) or not any(k in body for k in ("ai", "media")):
        return web.json_response({"error": "ai or media object required"}, status=400)
    try:
        doc = _read()
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=500)
    doc["global"] = _merge_global(doc.get("global"), body)
    try:
        _write(doc)
    except OSError as e:
        return web.json_response({"error": str(e)}, status=500)
    return web.json_response(doc["global"])


async def api_list(_request: web.Request) -> web.Response:
    try:
        doc = _read()
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=500)
    return web.json_response(_meta(doc))


async def api_get(request: web.Request) -> web.Response:
    pid = _canon_id(_id(request.match_info["id"]))
    try:
        doc = _read()
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=500)
    p = doc["profiles"].get(pid)
    if not p:
        return web.json_response({"error": "unknown profile"}, status=404)
    out = {"id": pid, "label": p["label"], "shipped": bool(p["shipped"]), "settings": p["settings"]}
    if p.get("model"):
        out["model"] = p["model"]
    return web.json_response(out)


def _put_profile(pid: str, body: dict[str, Any]) -> web.Response:
    settings = _settings(body)
    try:
        doc = _read()
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=500)
    p = doc["profiles"].get(pid)
    if not p:
        return web.json_response({"error": "unknown profile"}, status=404)
    if p["shipped"] or _is_shipped(pid):
        return web.json_response({"error": "shipped profile is read-only; save as a new profile"}, status=403)
    p["settings"] = settings
    if isinstance(body.get("label"), str) and body["label"].strip():
        p["label"] = body["label"].strip()[:48]
    if "model" in body:
        model = _opt_model(body)
        if model:
            p["model"] = model
        else:
            p.pop("model", None)
    try:
        _write(doc)
    except OSError as e:
        return web.json_response({"error": str(e)}, status=500)
    return web.json_response({"id": pid, "label": p["label"], "shipped": False, "ok": True})


async def api_put(request: web.Request) -> web.Response:
    pid = _canon_id(_id(request.match_info["id"]))
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "json body required"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "json body required"}, status=400)
    return _put_profile(pid, body)


async def api_create(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "json body required"}, status=400)
    pid = _canon_id(_id(str(body.get("id") or "")))
    if pid in RESERVED_IDS:
        return web.json_response({"error": "that id is reserved"}, status=403)
    settings = _settings(body)
    try:
        doc = _read()
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=500)
    if pid in doc["profiles"]:
        return web.json_response({"error": f"profile {pid!r} already exists"}, status=409)
    label = str(body.get("label") or pid).strip()[:48] or pid
    entry: dict[str, Any] = {"shipped": False, "label": label, "settings": settings}
    model = _opt_model(body)
    if model:
        entry["model"] = model
    doc["profiles"][pid] = entry
    if body.get("make_default"):
        doc["default"] = pid
    try:
        _write(doc)
    except OSError as e:
        return web.json_response({"error": str(e)}, status=500)
    out = {"id": pid, "label": label, "shipped": False, "default": doc["default"]}
    if model:
        out["model"] = model
    return web.json_response(out, status=201)


async def api_shipped(request: web.Request) -> web.Response:
    """Refresh the read-only `zoto-viz` blob from the UI's current shipped defaults."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "json body required"}, status=400)
    settings = _settings(body)
    try:
        doc = _read()
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=500)
    doc["profiles"][SHIPPED_ID] = {"shipped": True, "label": SHIPPED_LABEL, "settings": settings}
    try:
        _write(doc)
    except OSError as e:
        return web.json_response({"error": str(e)}, status=500)
    return web.json_response({"id": SHIPPED_ID, "shipped": True, "ok": True})


async def api_default(request: web.Request) -> web.Response:
    """Set the startup profile, or save the profile named `default`.

    `PUT /api/profiles/default` is both the startup-default route and a valid
    profile id. A settings blob writes that profile; `{id}` still picks startup.
    """
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "json body required"}, status=400)
    if isinstance(body, dict) and isinstance(body.get("settings"), dict):
        return _put_profile("default", body)
    pid = _canon_id(_id(str(body.get("id") or "")))
    try:
        doc = _read()
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=500)
    if pid not in doc["profiles"]:
        return web.json_response({"error": "unknown profile"}, status=404)
    doc["default"] = pid
    try:
        _write(doc)
    except OSError as e:
        return web.json_response({"error": str(e)}, status=500)
    return web.json_response({"default": pid, "ok": True})


async def api_delete(request: web.Request) -> web.Response:
    pid = _canon_id(_id(request.match_info["id"]))
    try:
        doc = _read()
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=500)
    if pid == "global":
        return web.json_response({"error": "that id is reserved"}, status=403)
    p = doc["profiles"].get(pid)
    if not p:
        return web.json_response({"error": "unknown profile"}, status=404)
    if p["shipped"] or _is_shipped(pid):
        return web.json_response({"error": "cannot delete the shipped default"}, status=403)
    del doc["profiles"][pid]
    if doc["default"] == pid:
        doc["default"] = SHIPPED_ID
    try:
        _write(doc)
    except OSError as e:
        return web.json_response({"error": str(e)}, status=500)
    return web.json_response({"ok": True, "default": doc["default"]})
