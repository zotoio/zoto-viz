"""Per-host consent for source-backed views (RSS and HTTP).

Pack code consent is separate. A host that has not been granted is not fetched.
The file is ``~/.zoto-viz/source-consent.yml``. Until that file exists, today's
sources keep fetching. The first poll writes the file from the hosts already
configured, so nothing already on the wall goes blank.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import yaml
from aiohttp import web

from . import paths


def consent_path() -> Path:
    override = os.environ.get("ZOTO_VIZ_SOURCE_CONSENT")
    if override:
        return Path(override)
    directory = paths.user_dir()
    directory.mkdir(parents=True, exist_ok=True)
    return directory / "source-consent.yml"


def _read() -> dict[str, Any]:
    path = consent_path()
    if not path.is_file():
        return {"seeded": False, "hosts": []}
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    hosts = raw.get("hosts") if isinstance(raw, dict) else []
    if not isinstance(hosts, list):
        hosts = []
    return {"seeded": True, "hosts": [str(h).lower() for h in hosts if h]}


def _write(doc: dict[str, Any]) -> None:
    path = consent_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    text = yaml.safe_dump({"seeded": True, "hosts": list(doc.get("hosts") or [])}, sort_keys=False)
    fd, tmp = tempfile.mkstemp(prefix="source-consent.", suffix=".yml", dir=path.parent)
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


def host_of(row: dict[str, Any]) -> str | None:
    if row.get("type") not in ("rss", "http"):
        return None
    url = str(row.get("url") or "")
    host = (urlparse(url).hostname or "").lower()
    return host or None


def file_active() -> bool:
    return consent_path().is_file()


def allowed(host: str) -> bool:
    """Missing file means the grant list has not been introduced yet."""
    if not file_active():
        return True
    return host.lower() in set(_read()["hosts"])


def allow(host: str) -> dict[str, Any]:
    doc = _read()
    name = host.lower()
    if name and name not in doc["hosts"]:
        doc["hosts"].append(name)
    doc["seeded"] = True
    _write(doc)
    return doc


def remove(host: str) -> dict[str, Any]:
    doc = _read()
    name = host.lower()
    doc["hosts"] = [h for h in doc["hosts"] if h != name]
    doc["seeded"] = True
    _write(doc)
    return doc


def seed_from_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if file_active():
        return _read()
    hosts: list[str] = []
    for row in rows:
        host = host_of(row)
        if host and host not in hosts:
            hosts.append(host)
    doc = {"seeded": True, "hosts": hosts}
    _write(doc)
    return doc


def prompt(view: str, host: str) -> str:
    return f"{view} wants to load data from {host}."


async def api_list(_request: web.Request) -> web.Response:
    return web.json_response(_read())


async def api_allow(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "json body required"}, status=400)
    host = str(body.get("host") or "").strip() if isinstance(body, dict) else ""
    if not host:
        return web.json_response({"error": "host required"}, status=400)
    return web.json_response(allow(host))


async def api_remove(request: web.Request) -> web.Response:
    host = request.match_info["host"]
    return web.json_response(remove(host))
