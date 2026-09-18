"""Host data sources: RSS, public HTTPS JSON/text, and local files.

Config lives at ``~/.zoto-viz/sources.yml``. Poll results ride the 1 Hz snapshot
as ``sources``. Remote URLs reuse the agent-asset HTTPS / public-IP gate.
Local files must resolve under the home directory or ``~/.zoto-viz``.
"""
from __future__ import annotations

import json
import re
import time
import xml.etree.ElementTree as ET
from html import unescape
from pathlib import Path
from typing import Any

import yaml
from aiohttp import ClientError, ClientSession, ClientTimeout, web

from . import agent_assets
from . import paths

KINDS = ("rss", "http", "file")
ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
MAX_BODY = 256_000
MAX_ITEMS = 20
MAX_SUMMARY = 240
MIN_INTERVAL = 15
MAX_INTERVAL = 86_400
DEFAULT_INTERVAL = 300
FETCH_S = 12

DEFAULT_SOURCES: list[dict[str, Any]] = [
    {
        "id": "hn",
        "type": "rss",
        "label": "Hacker News",
        "url": "https://hnrss.org/frontpage",
        "interval": 300,
        "enabled": True,
        "feed": True,
    },
    {
        "id": "nasa",
        "type": "rss",
        "label": "NASA image of the day",
        "url": "https://www.nasa.gov/rss/dyn/lg_image_of_the_day.rss",
        "interval": 3600,
        "enabled": True,
        "feed": True,
    },
]

_rows: list[dict[str, Any]] = []
_live: dict[str, dict[str, Any]] = {}
_due: dict[str, float] = {}
_session: ClientSession | None = None
_loaded = False


def reset_for_tests() -> None:
    global _rows, _live, _due, _loaded
    _rows = []
    _live = {}
    _due = {}
    _loaded = False


def sources_file() -> Path:
    d = paths.user_dir()
    d.mkdir(parents=True, exist_ok=True)
    return d / "sources.yml"


def sources_dir(*, create: bool = False) -> Path:
    d = paths.user_dir() / "sources"
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return d


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def check_file(path: str) -> Path:
    """Resolve a local file the operator may publish. Raises ValueError."""
    raw = (path or "").strip()
    if not raw or len(raw) > 500:
        raise ValueError("path required")
    resolved = Path(raw).expanduser().resolve()
    roots = [paths.user_dir().resolve(), Path.home().resolve()]
    if not any(_is_relative_to(resolved, root) for root in roots):
        raise ValueError("path not allowed")
    if not resolved.is_file():
        raise ValueError("file not found")
    if resolved.stat().st_size > MAX_BODY:
        raise ValueError("file too large")
    return resolved


def slug_id(raw: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (raw or "").strip().lower()).strip("-")
    if not s or not s[0].isalpha():
        s = f"src-{s}" if s else "src"
    return s[:32]


def unique_id(want: str, taken: set[str]) -> str:
    base = slug_id(want)
    if not ID_RE.match(base):
        base = "src"
    if base not in taken:
        return base
    n = 2
    while True:
        cand = f"{base}-{n}"[:32]
        if cand not in taken:
            return cand
        n += 1


def normalize(raw: Any, *, taken: set[str] | None = None) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("source object required")
    owned = taken if taken is not None else set()
    sid = str(raw.get("id") or "").strip()
    sid = unique_id(sid or str(raw.get("label") or raw.get("url") or raw.get("path") or "src"), owned)
    kind = str(raw.get("type") or raw.get("kind") or "").strip().lower()
    if kind not in KINDS:
        raise ValueError("type must be rss, http, or file")
    interval = raw.get("interval", DEFAULT_INTERVAL)
    try:
        interval = int(interval)
    except (TypeError, ValueError) as e:
        raise ValueError("interval must be a number") from e
    interval = max(MIN_INTERVAL, min(MAX_INTERVAL, interval))
    enabled = raw.get("enabled") is not False
    feed = raw.get("feed") is not False
    label = str(raw.get("label") or sid).strip()[:80]
    row: dict[str, Any] = {
        "id": sid,
        "type": kind,
        "label": label,
        "interval": interval,
        "enabled": enabled,
        "feed": feed,
    }
    if kind == "file":
        path = str(raw.get("path") or "").strip()
        if not path:
            raise ValueError("path required")
        row["path"] = path
    else:
        url = agent_assets.check_url(str(raw.get("url") or ""))
        row["url"] = url
    return row


def _dump(rows: list[dict[str, Any]]) -> None:
    sources_file().write_text(
        yaml.safe_dump({"sources": rows}, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )


def load(*, seed: bool = True) -> list[dict[str, Any]]:
    """Load ``sources.yml``. Seeds public defaults once when the file is missing."""
    global _rows, _loaded
    p = sources_file()
    if not p.is_file():
        rows = [normalize(r, taken=set()) for r in DEFAULT_SOURCES] if seed else []
        if seed:
            _dump(rows)
        _rows = rows
        _loaded = True
        return list(_rows)
    try:
        raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError):
        raw = {}
    items = raw.get("sources") if isinstance(raw, dict) else None
    if not isinstance(items, list):
        items = []
    out: list[dict[str, Any]] = []
    taken: set[str] = set()
    for item in items:
        try:
            row = normalize(item, taken=taken)
        except ValueError:
            continue
        taken.add(row["id"])
        out.append(row)
    _rows = out
    _loaded = True
    return list(_rows)


def ensure() -> list[dict[str, Any]]:
    if not _loaded:
        return load()
    return list(_rows)


def save(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    taken: set[str] = set()
    out: list[dict[str, Any]] = []
    for item in rows:
        row = normalize(item, taken=taken)
        taken.add(row["id"])
        out.append(row)
    _dump(out)
    global _rows, _loaded
    _rows = out
    _loaded = True
    keep = {r["id"] for r in out}
    for sid in list(_live):
        if sid not in keep:
            _live.pop(sid, None)
            _due.pop(sid, None)
    return list(_rows)


def upsert(raw: dict[str, Any]) -> dict[str, Any]:
    rows = ensure()
    want = str(raw.get("id") or "").strip()
    rest = [r for r in rows if r["id"] != want]
    taken = {r["id"] for r in rest}
    row = normalize({**raw, "id": want or raw.get("id")}, taken=taken)
    rest.append(row)
    save(rest)
    _due.pop(row["id"], None)
    return row


def delete(sid: str) -> bool:
    rows = ensure()
    keep = [r for r in rows if r["id"] != sid]
    if len(keep) == len(rows):
        return False
    save(keep)
    _live.pop(sid, None)
    _due.pop(sid, None)
    return True


_TAG_RE = re.compile(r"<[^>]+>")


def _text(el: ET.Element | None) -> str:
    if el is None or el.text is None:
        return ""
    return " ".join(el.text.split())


def _plain(s: str) -> str:
    return " ".join(unescape(_TAG_RE.sub(" ", s or "")).split())


def _inner(el: ET.Element | None) -> str:
    if el is None:
        return ""
    return " ".join("".join(el.itertext()).split())


def _child(el: ET.Element, *names: str) -> ET.Element | None:
    for n in names:
        hit = el.find(n)
        if hit is not None:
            return hit
        if "}" in (el.tag or ""):
            ns = el.tag.split("}", 1)[0] + "}"
            hit = el.find(ns + n.split("}")[-1])
            if hit is not None:
                return hit
    return None


def parse_rss(body: str) -> dict[str, Any]:
    """RSS 2.0 or Atom → ``{title, items[]}``."""
    root = ET.fromstring(body)
    tag = root.tag.split("}")[-1].lower()
    items: list[dict[str, str]] = []
    title = ""
    if tag == "rss" or root.find("channel") is not None:
        ch = root.find("channel") if root.find("channel") is not None else root
        title = _text(_child(ch, "title"))
        for it in list(ch.findall("item"))[:MAX_ITEMS]:
            items.append({
                "title": _text(_child(it, "title"))[:160],
                "link": _text(_child(it, "link"))[:500],
                "published": _text(_child(it, "pubDate", "published"))[:80],
                "summary": _plain(_inner(_child(it, "description", "summary")))[:MAX_SUMMARY],
            })
    else:
        title = _text(_child(root, "title"))
        for it in list(root.findall("{http://www.w3.org/2005/Atom}entry") or root.findall("entry"))[:MAX_ITEMS]:
            link_el = _child(it, "link")
            href = ""
            if link_el is not None:
                href = (link_el.attrib.get("href") or _text(link_el))[:500]
            items.append({
                "title": _text(_child(it, "title"))[:160],
                "link": href,
                "published": _text(_child(it, "updated", "published"))[:80],
                "summary": _plain(_inner(_child(it, "summary", "content")))[:MAX_SUMMARY],
            })
    return {"title": title[:120], "items": [i for i in items if i.get("title") or i.get("link")]}


def _file_payload(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8", errors="replace")
    if len(text.encode("utf-8")) > MAX_BODY:
        raise ValueError("file too large")
    try:
        data = json.loads(text)
        return {"json": data}
    except json.JSONDecodeError:
        return {"text": text[:MAX_BODY]}


async def _http_body(url: str) -> tuple[str, str]:
    sess = await session()
    async with sess.get(url, allow_redirects=True, max_redirects=2) as r:
        if r.status >= 400:
            raise ValueError(f"http {r.status}")
        raw = await r.read()
        if len(raw) > MAX_BODY:
            raise ValueError("response too large")
        ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        return raw.decode("utf-8", errors="replace"), ctype


async def session() -> ClientSession:
    global _session
    if _session is None or _session.closed:
        _session = ClientSession(timeout=ClientTimeout(total=FETCH_S))
    return _session


async def close() -> None:
    global _session
    if _session is not None and not _session.closed:
        await _session.close()
    _session = None


def _record(row: dict[str, Any], *, ok: bool, payload: dict[str, Any] | None = None, error: str | None = None) -> None:
    live: dict[str, Any] = {
        "id": row["id"],
        "kind": row["type"],
        "label": row["label"],
        "ok": ok,
        "ts": time.time(),
        "feed": bool(row.get("feed", True)),
    }
    if row["type"] != "file":
        live["url"] = row.get("url")
    else:
        live["path"] = row.get("path")
    if payload:
        live.update(payload)
    if error:
        live["error"] = error[:160]
    _live[row["id"]] = live


async def fetch_one(row: dict[str, Any]) -> dict[str, Any]:
    kind = row["type"]
    try:
        if kind == "file":
            path = check_file(str(row.get("path") or ""))
            _record(row, ok=True, payload=_file_payload(path))
        elif kind == "rss":
            body, _ = await _http_body(str(row["url"]))
            _record(row, ok=True, payload=parse_rss(body))
        else:
            body, ctype = await _http_body(str(row["url"]))
            if "json" in ctype or body.lstrip().startswith(("{", "[")):
                try:
                    data = json.loads(body)
                except json.JSONDecodeError as e:
                    raise ValueError("invalid json") from e
                _record(row, ok=True, payload={"json": data})
            else:
                _record(row, ok=True, payload={"text": body[:MAX_BODY]})
    except (ValueError, ClientError, OSError, ET.ParseError) as e:
        _record(row, ok=False, error=str(e))
    return _live[row["id"]]


async def poll(now: float | None = None) -> dict[str, dict[str, Any]]:
    """Fetch sources whose interval has elapsed. Safe to call often."""
    t = time.time() if now is None else now
    for row in ensure():
        if not row.get("enabled", True):
            _live.setdefault(row["id"], {
                "id": row["id"], "kind": row["type"], "label": row["label"],
                "ok": True, "ts": t, "feed": bool(row.get("feed", True)), "paused": True,
            })
            continue
        due = _due.get(row["id"], 0)
        if t < due:
            continue
        await fetch_one(row)
        _due[row["id"]] = t + int(row.get("interval") or DEFAULT_INTERVAL)
    return snapshot()


def snapshot() -> dict[str, dict[str, Any]]:
    ensure()
    return {r["id"]: _live.get(r["id"], {
        "id": r["id"],
        "kind": r["type"],
        "label": r["label"],
        "ok": True,
        "ts": 0,
        "pending": True,
        "feed": bool(r.get("feed", True)),
    }) for r in _rows}


def apply(msg: dict[str, Any]) -> dict[str, Any]:
    msg["sources"] = snapshot()
    return msg


def headlines(limit: int = 12) -> list[dict[str, str]]:
    """Feed-ready rows from enabled sources that opted into the ticker."""
    out: list[dict[str, str]] = []
    for row in ensure():
        live = _live.get(row["id"])
        if not live or not row.get("feed", True) or not row.get("enabled", True):
            continue
        label = str(live.get("label") or row["label"])
        for item in live.get("items") or []:
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            out.append({
                "id": f"{row['id']}:{len(out)}",
                "source": row["id"],
                "label": label,
                "text": title,
                "link": str(item.get("link") or ""),
            })
            if len(out) >= limit:
                return out
        if live.get("text") and not live.get("items"):
            out.append({
                "id": row["id"],
                "source": row["id"],
                "label": label,
                "text": str(live["text"]).splitlines()[0][:160],
                "link": str(live.get("url") or ""),
            })
        if len(out) >= limit:
            break
    return out


def config_payload() -> dict[str, Any]:
    return {"sources": ensure(), "live": snapshot(), "kinds": list(KINDS)}


async def api_sources(request: web.Request) -> web.Response:
    if request.method == "GET":
        return web.json_response(config_payload())
    if request.method == "PUT":
        try:
            body = await request.json()
        except (json.JSONDecodeError, TypeError):
            return web.json_response({"error": "json required"}, status=400)
        rows = body.get("sources") if isinstance(body, dict) else None
        if not isinstance(rows, list):
            return web.json_response({"error": "sources list required"}, status=400)
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
    return web.json_response({"ok": True, "source": row, **config_payload()})


async def api_source(request: web.Request) -> web.Response:
    sid = request.match_info.get("id", "").strip()
    if not sid:
        return web.json_response({"error": "id required"}, status=400)
    if request.method == "DELETE":
        if not delete(sid):
            return web.json_response({"error": "unknown source"}, status=404)
        return web.json_response({"ok": True, **config_payload()})
    try:
        body = await request.json()
    except (json.JSONDecodeError, TypeError):
        body = {}
    if not isinstance(body, dict):
        body = {}
    try:
        row = upsert({**body, "id": sid})
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=400)
    return web.json_response({"ok": True, "source": row, **config_payload()})
