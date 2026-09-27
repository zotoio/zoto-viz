"""NASA api.nasa.gov key — host env only (never browser / pack frames)."""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

from aiohttp import web

from . import access
from . import paths

ENV_KEY = "NASA_API_KEY"
DEMO_KEY = "DEMO_KEY"
DEMO_NOTE = "demo key, rate-limited"
_HOST_ENV = paths.user_dir() / "host.env"
_REPO_ENV = Path(__file__).resolve().parents[1] / ".env"
_APOD = "api.nasa.gov/planetary/apod"
_KEY_Q = re.compile(r"([?&]api_key=)[^&#]*", re.I)


def host_env_file() -> Path:
    return _HOST_ENV


def load_dotenv() -> None:
    """Load NASA_API_KEY from repo ``.env`` then ``~/.zoto-viz/host.env`` (shell env wins)."""
    from . import typesafe_proxy

    typesafe_proxy.load_dotenv(_REPO_ENV)
    typesafe_proxy.load_dotenv(_HOST_ENV)


def read_key() -> str:
    return os.environ.get(ENV_KEY, "").strip()


def configured() -> bool:
    return bool(read_key())


def fetch_key() -> str:
    return read_key() or DEMO_KEY


def using_demo_key() -> bool:
    return not configured()


def _write_host_env(key: str | None) -> None:
    path = _HOST_ENV
    path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    if path.is_file():
        lines = path.read_text(encoding="utf-8").splitlines()
    out: list[str] = []
    found = False
    for line in lines:
        if not line.strip() or line.strip().startswith("#"):
            out.append(line)
            continue
        name, sep, _ = line.partition("=")
        if not sep:
            out.append(line)
            continue
        if name.strip() == ENV_KEY:
            found = True
            if key:
                out.append(f"{ENV_KEY}={key}")
        else:
            out.append(line)
    if key and not found:
        out.append(f"{ENV_KEY}={key}")
    text = "\n".join(out).rstrip()
    if text:
        path.write_text(text + "\n", encoding="utf-8")
    elif path.is_file():
        path.unlink()
    if path.is_file():
        os.chmod(path, 0o600)


def write_key(key: str) -> None:
    val = key.strip()
    if not val:
        raise ValueError("key required")
    _write_host_env(val)
    os.environ[ENV_KEY] = val


def clear_key() -> None:
    _write_host_env(None)
    os.environ.pop(ENV_KEY, None)


def redact_string(value: str) -> str:
    key = read_key()
    out = value
    if key:
        out = out.replace(key, "[redacted]")
    if DEMO_KEY in out and _APOD in out:
        out = _KEY_Q.sub(r"\1DEMO_KEY", out)
    return out


def strip_apod_key_from_url(url: str) -> str:
    raw = (url or "").strip()
    if _APOD not in raw:
        return raw
    parsed_key = raw
    return _KEY_Q.sub("", parsed_key).replace("?&", "?").rstrip("?")


def public_url(url: str) -> str:
    return strip_apod_key_from_url(url)


def sanitize(value: Any, depth: int = 0) -> Any:
    if value is None or isinstance(value, (int, float, bool)):
        return value
    if depth > 10:
        return None
    if isinstance(value, str):
        return redact_string(value)
    if isinstance(value, list):
        return [sanitize(item, depth + 1) for item in value]
    if not isinstance(value, dict):
        return None
    out: dict[str, Any] = {}
    for raw_k, raw_v in value.items():
        k = str(raw_k)
        if k in {ENV_KEY, "nasaApiKey"}:
            continue
        out[k] = sanitize(raw_v, depth + 1)
    return out


def public_source_row(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    if str(out.get("id") or "") == "apod" or _APOD in str(out.get("url") or ""):
        url = str(out.get("url") or "")
        if url:
            out["url"] = public_url(url)
    return out


def public_sources(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [public_source_row(r) for r in rows]


def public_live_row(live: dict[str, Any]) -> dict[str, Any]:
    out = sanitize(dict(live))
    if isinstance(out, dict) and out.get("url"):
        out["url"] = public_url(str(out["url"]))
    return out if isinstance(out, dict) else {}


def public_snapshot(live: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {sid: public_live_row(row) for sid, row in live.items()}


def _deny_settings_mutate(request: web.Request) -> web.Response | None:
    """Origin + CSRF for PUT/DELETE — same contract as other Settings writes."""
    if request.method not in access.MUTATE:
        return None
    if not access.origin_ok(request):
        return access._deny("forbidden origin")
    if not access.csrf_ok(request):
        return access._deny("csrf required")
    return None


async def api_nasa_key(request: web.Request) -> web.Response:
    denied = _deny_settings_mutate(request)
    if denied is not None:
        return denied
    if request.method == "DELETE":
        if os.environ.get(ENV_KEY, "").strip() and not _host_has_key():
            return web.json_response({"ok": False, "error": f"{ENV_KEY} env wins"}, status=400)
        clear_key()
        return web.json_response({"ok": True, "configured": False, "nasaApiKeyConfigured": False})
    if request.method == "PUT":
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "invalid json"}, status=400)
        if not isinstance(body, dict):
            return web.json_response({"error": "object required"}, status=400)
        key = str(body.get("key") or body.get("nasaApiKey") or "").strip()
        if not key:
            return web.json_response({"error": "key required"}, status=400)
        write_key(key)
        return web.json_response({"ok": True, "configured": True, "nasaApiKeyConfigured": True})
    return web.json_response({
        "ok": True,
        "configured": configured(),
        "nasaApiKeyConfigured": configured(),
        "usingDemoKey": using_demo_key(),
        "demoNote": DEMO_NOTE if using_demo_key() else None,
    })


def _host_has_key() -> bool:
    if not _HOST_ENV.is_file():
        return False
    for line in _HOST_ENV.read_text(encoding="utf-8").splitlines():
        name, sep, val = line.partition("=")
        if sep and name.strip() == ENV_KEY and val.strip():
            return True
    return False
