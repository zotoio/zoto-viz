"""Host data sources: RSS, public HTTPS JSON/text, and local files.

Config lives at ``~/.zoto-viz/sources.yml``. Poll results ride the 1 Hz snapshot
as ``sources``. Remote URLs reuse the agent-asset HTTPS / public-IP gate.
Local files must resolve under the home directory or ``~/.zoto-viz``.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import threading
import time
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlencode, urljoin, urlparse, urlunparse

import yaml
from aiohttp import ClientError, ClientSession, ClientTimeout, web
from yarl import URL

from . import agent_assets
from . import nasa_api
from . import paths
from . import source_fields

KINDS = ("rss", "http", "file", "journal", "kmsg")
SYS_KINDS = ("journal", "kmsg")
ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
MAX_BODY = 1_500_000
MAX_ITEMS = 80
MAX_TITLE = 240
MAX_SUMMARY = 400
MIN_INTERVAL = 15
MAX_INTERVAL = 86_400
DEFAULT_INTERVAL = 300
FETCH_S = 12
APOD_COUNT = 40
GUARDIAN_PAGE = 50
MET_EXPAND = 40
PREFETCH_STILLS = 48
HEADLINE_LIMIT = 64
_COUNT_Q = re.compile(r"([?&]count=)(\d+)")
_PAGE_Q = re.compile(r"([?&]page-size=)(\d+)")

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
        "url": "https://www.nasa.gov/feeds/iotd-feed",
        "interval": 3600,
        "enabled": True,
        "feed": True,
    },
    {
        "id": "apod",
        "type": "http",
        "label": "Astronomy Picture of the Day",
        "url": "https://api.nasa.gov/planetary/apod",
        "interval": 3600,
        "enabled": True,
        "feed": True,
        "fields": {
            "title": "title",
            "caption": "explanation",
            "image": "hdurl",
            "imageFallback": "url",
            "link": "url",
            "filter": "media_type=image",
        },
    },
    {
        "id": "earth-iotd",
        "type": "rss",
        "label": "Earth Observatory",
        "url": "https://science.nasa.gov/feed/earth-observatory/image-of-the-day",
        "interval": 3600,
        "enabled": True,
        "feed": True,
    },
    {
        "id": "commons-potd",
        "type": "rss",
        "label": "Commons picture of the day",
        "url": "https://commons.wikimedia.org/w/api.php?action=featuredfeed&feed=potd&feedformat=atom",
        "interval": 3600,
        "enabled": True,
        "feed": True,
    },
    {
        "id": "met",
        "type": "http",
        "label": "Met highlights",
        "url": "https://collectionapi.metmuseum.org/public/collection/v1/search?isHighlight=true&hasImages=true&q=art",
        "interval": 3600,
        "enabled": True,
        "feed": True,
        "fields": {
            "list": "objectIDs",
            "expand": "https://collectionapi.metmuseum.org/public/collection/v1/objects/{id}",
            "expandCap": MET_EXPAND,
            "title": "title",
            "caption": "artistDisplayName",
            "image": "primaryImage",
            "link": "objectURL",
            "filter": "has-image",
        },
    },
    {
        "id": "lobsters",
        "type": "rss",
        "label": "Lobsters",
        "url": "https://lobste.rs/rss",
        "interval": 300,
        "enabled": True,
        "feed": True,
    },
    {
        "id": "guardian",
        "type": "rss",
        "label": "Guardian world",
        "url": "https://www.theguardian.com/world/rss",
        "interval": 600,
        "enabled": True,
        "feed": True,
    },
    {
        "id": "mastodon",
        "type": "rss",
        "label": "Mastodon #space",
        "url": "https://mastodon.social/tags/space.rss",
        "interval": 300,
        "enabled": True,
        "feed": True,
    },
    {
        "id": "journal",
        "type": "journal",
        "label": "User journal",
        "interval": 15,
        "enabled": True,
        "feed": True,
    },
    {
        "id": "kmsg",
        "type": "kmsg",
        "label": "Kernel ring",
        "interval": 15,
        "enabled": True,
        "feed": True,
    },
]
# Re-add these ids on registries that predate them. hn / nasa stay operator-owned.
SEED_SOURCE_IDS = frozenset({
    "journal", "kmsg",
    "apod", "earth-iotd", "commons-potd", "met", "lobsters", "guardian", "mastodon",
})
TICKER_NEWS_IDS = frozenset({
    "hn", "nasa", "apod", "earth-iotd", "commons-potd", "met",
    "lobsters", "guardian", "mastodon",
})

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
        raise ValueError("type must be rss, http, file, journal, or kmsg")
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
    elif kind == "journal":
        unit = str(raw.get("unit") or "").strip()
        if unit:
            row["unit"] = unit[:80]
    elif kind == "kmsg":
        pass
    else:
        url = agent_assets.check_url(str(raw.get("url") or ""))
        row["url"] = nasa_api.public_url(url)
    fields = source_fields.normalize_fields(raw.get("fields"))
    if fields:
        expand = str(fields.get("expand") or "")
        if expand:
            sample = source_fields.subst(expand, {"id": "1"})
            agent_assets.check_url(sample)
        row["fields"] = fields
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
    out = _seed_missing(out, taken, persist=p.is_file())
    raised = _raise_feed_depth(out)
    refreshed = _refresh_shipped(out)
    if (raised or refreshed) and p.is_file():
        _dump(out)
        if refreshed:
            for row in out:
                _due.pop(row["id"], None)
    _rows = out
    _loaded = True
    return list(_rows)


def _raise_feed_depth(rows: list[dict[str, Any]]) -> bool:
    """Lift shipped pictured feeds that still carry the old thin caps."""
    changed = False
    for row in rows:
        sid = row.get("id")
        url = str(row.get("url") or "")
        if sid == "apod":
            m = _COUNT_Q.search(url)
            if m and int(m.group(2)) < APOD_COUNT:
                row["url"] = _COUNT_Q.sub(rf"\g<1>{APOD_COUNT}", url, count=1)
                changed = True
        elif sid == "guardian":
            m = _PAGE_Q.search(url)
            if m and int(m.group(2)) < GUARDIAN_PAGE:
                row["url"] = _PAGE_Q.sub(rf"\g<1>{GUARDIAN_PAGE}", url, count=1)
                changed = True
        elif sid == "met":
            fields = row.get("fields")
            if not isinstance(fields, dict):
                continue
            try:
                cap = int(fields.get("expandCap") or 0)
            except (TypeError, ValueError):
                cap = 0
            if cap < MET_EXPAND:
                fields["expandCap"] = MET_EXPAND
                changed = True
    return changed


def _seed_missing(rows: list[dict[str, Any]], taken: set[str], *, persist: bool) -> list[dict[str, Any]]:
    """Add journal / kmsg / content feeds once on registries that predate them."""
    added = False
    for raw in DEFAULT_SOURCES:
        if raw["id"] not in SEED_SOURCE_IDS or raw["id"] in taken:
            continue
        try:
            row = normalize(raw, taken=taken)
        except ValueError:
            continue
        rows.append(row)
        taken.add(row["id"])
        added = True
    if added and persist:
        _dump(rows)
    return rows


def _refresh_shipped(rows: list[dict[str, Any]]) -> bool:
    """Rewrite known-stale default URLs. Operator-customized rows stay put."""
    changed = False
    for row in rows:
        sid = str(row.get("id") or "")
        url = str(row.get("url") or "")
        if sid == "apod" and "api.nasa.gov/planetary/apod" in url and (
            "count=" in url or "api_key=" in url.lower()
        ):
            row["url"] = "https://api.nasa.gov/planetary/apod"
            changed = True
        if (
            sid == "guardian"
            and "content.guardianapis.com" in url
            and "api-key=test" in url
        ):
            row["type"] = "rss"
            row["url"] = "https://www.theguardian.com/world/rss"
            row.pop("fields", None)
            changed = True
        if sid in TICKER_NEWS_IDS and row.get("feed") is False:
            row["feed"] = True
            changed = True
    return changed


def resolve_fetch_url(url: str) -> str:
    """APOD ``count=`` is a random archive draw — prefer the last eight days."""
    raw = (url or "").strip()
    if "api.nasa.gov/planetary/apod" not in raw:
        return raw
    parsed = urlparse(raw)
    q = {k: (v[-1] if v else "") for k, v in parse_qs(parsed.query, keep_blank_values=True).items()}
    if q.get("start_date") or q.get("date"):
        q.pop("count", None)
        return urlunparse(parsed._replace(query=urlencode(q)))
    key = nasa_api.fetch_key()
    end = date.today()
    start = end - timedelta(days=7)
    return urlunparse(parsed._replace(query=urlencode({
        "api_key": key,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
    })))


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


_IMG_HREF = re.compile(
    r"https://[^\s\"'<>]+?\.(?:jpe?g|png|webp|gif)(?:/\d+px-[^\s\"'<>]+)?(?:\?[^\s\"'<>]*)?",
    re.I,
)
_WIKI_THUMB = re.compile(
    r"^(https://(?:upload|thumb)\.wikimedia\.org/wikipedia/commons/thumb/[0-9a-f]/[0-9a-f]{2}/)"
    r"([^/]+\.(?:jpe?g|png|webp|gif))$",
    re.I,
)
_WIKI_PX = re.compile(r"/(\d+)px-", re.I)
MAX_IMAGE_URL = 2000


def _attr(el: ET.Element, name: str) -> str:
    if el.attrib.get(name):
        return str(el.attrib[name])
    for key, val in el.attrib.items():
        if str(key).split("}")[-1] == name and val:
            return str(val)
    return ""


def clean_image_url(url: str) -> str:
    """Unescape HTML, drop tracker query, finish a truncated Wikimedia thumb."""
    raw = unescape((url or "").strip()).replace("&amp;", "&")
    if not raw.startswith("https://"):
        return ""
    if "?" in raw:
        base, query = raw.split("?", 1)
        if "utm_" in query:
            raw = base
    m = _WIKI_THUMB.match(raw)
    if m:
        name = m.group(2)
        raw = f"{m.group(1)}{name}/1280px-{name}"
    if len(raw) > MAX_IMAGE_URL:
        return ""
    return raw


def _image_score(url: str) -> int:
    m = _WIKI_PX.search(url)
    score = int(m.group(1)) if m else 0
    if "/iotd/" in url or "/eo/images/" in url:
        score += 10_000
    return score


def pick_image_url(*blobs: str) -> str:
    found: list[str] = []
    for blob in blobs:
        raw = (blob or "").strip()
        if raw.startswith("https://") and not any(c in raw for c in " \t\n<>\"'"):
            url = clean_image_url(raw) or raw[:MAX_IMAGE_URL]
            if url and url not in found:
                found.append(url)
            continue
        for hit in _IMG_HREF.finditer(blob or ""):
            url = clean_image_url(hit.group(0))
            if url and url not in found:
                found.append(url)
    if not found:
        return ""
    return max(enumerate(found), key=lambda iv: (_image_score(iv[1]), iv[0]))[1]


def _item_image(it: ET.Element) -> str:
    """enclosure / media:content / img-in-description — NASA IOTD uses enclosure."""
    enclosed: list[str] = []
    for child in list(it):
        local = (child.tag or "").split("}")[-1].lower()
        if local not in {"enclosure", "content", "thumbnail"}:
            continue
        url = _attr(child, "url")
        typ = _attr(child, "type").lower()
        medium = _attr(child, "medium").lower()
        if not url.startswith("https://"):
            continue
        if typ.startswith("image/") or medium == "image" or _IMG_HREF.match(url):
            enclosed.append(url)
        elif not typ and not medium:
            enclosed.append(url)
    blobs: list[str] = []
    for child in list(it):
        local = (child.tag or "").split("}")[-1].lower()
        if local in {"description", "summary", "content", "encoded"}:
            blobs.append(_inner(child))
    if not blobs:
        blobs.append(_inner(_child(it, "description", "summary", "content")))
    return pick_image_url(*enclosed, *blobs)


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
            summary = _plain(_inner(_child(it, "description", "summary")))[:MAX_SUMMARY]
            row = {
                "title": (_text(_child(it, "title")) or summary)[:MAX_TITLE],
                "link": _text(_child(it, "link"))[:500],
                "published": _text(_child(it, "pubDate", "published"))[:80],
                "summary": summary,
            }
            image = _item_image(it)
            if image:
                row["image"] = image
            items.append(row)
    else:
        title = _text(_child(root, "title"))
        entries = list(root.findall("{http://www.w3.org/2005/Atom}entry") or root.findall("entry"))
        for it in entries[-MAX_ITEMS:]:
            link_el = _child(it, "link")
            href = ""
            if link_el is not None:
                href = (link_el.attrib.get("href") or _text(link_el))[:500]
            summary = _plain(_inner(_child(it, "summary", "content")))[:MAX_SUMMARY]
            row = {
                "title": (_text(_child(it, "title")) or summary)[:MAX_TITLE],
                "link": href,
                "published": _text(_child(it, "updated", "published"))[:80],
                "summary": summary,
            }
            image = _item_image(it)
            if image:
                row["image"] = image
            items.append(row)
    return {"title": title[:120], "items": [i for i in items if i.get("title") or i.get("link")]}


_KMSG_RE = re.compile(r"^(\d+),(\d+),(\d+),([^;]*);(.*)$")
_kmsg_lock = threading.Lock()
_kmsg_items: list[dict[str, str]] = []
_kmsg_started = False


def parse_kmsg_line(raw: str) -> dict[str, str] | None:
    """Decode one ``/dev/kmsg`` record into a source item."""
    line = raw.strip()
    if not line:
        return None
    m = _KMSG_RE.match(line)
    text = (m.group(5) if m else line).strip()[:MAX_TITLE]
    if not text:
        return None
    pri = int(m.group(1)) if m else 6
    ident = "err" if pri <= 3 else "warn" if pri <= 4 else "kern"
    return {"title": text, "summary": ident, "published": m.group(3) if m else "", "link": ""}


def read_journal(unit: str | None = None, n: int = MAX_ITEMS) -> list[dict[str, str]]:
    """Recent user-journal lines as RSS-shaped items. No system journal."""
    cmd = ["journalctl", "--user", "-n", str(min(MAX_ITEMS, max(1, n))), "-o", "json", "--no-pager"]
    u = (unit or "").strip()
    if u:
        cmd.extend(["-u", u])
    try:
        raw = subprocess.check_output(cmd, timeout=2.0, stderr=subprocess.DEVNULL, text=True)
    except (OSError, subprocess.SubprocessError):
        return []
    items: list[dict[str, str]] = []
    for line in raw.splitlines():
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(rec, dict):
            continue
        msg = str(rec.get("MESSAGE") or "").strip()
        if not msg:
            continue
        ident = str(rec.get("SYSLOG_IDENTIFIER") or rec.get("_SYSTEMD_USER_UNIT") or rec.get("_COMM") or "journal")
        items.append({
            "title": msg[:MAX_TITLE],
            "summary": ident[:MAX_SUMMARY],
            "published": str(rec.get("__REALTIME_TIMESTAMP") or "")[:20],
            "link": "",
        })
    return items[-MAX_ITEMS:]


def _kmsg_loop() -> None:
    try:
        fd = os.open("/dev/kmsg", os.O_RDONLY | os.O_NONBLOCK)
    except OSError:
        return
    buf = b""
    while True:
        try:
            chunk = os.read(fd, 8192)
        except BlockingIOError:
            time.sleep(0.4)
            continue
        except OSError:
            break
        if not chunk:
            time.sleep(0.4)
            continue
        buf += chunk
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            item = parse_kmsg_line(line.decode("utf-8", errors="replace"))
            if not item:
                continue
            with _kmsg_lock:
                _kmsg_items.append(item)
                del _kmsg_items[:-MAX_ITEMS]


def _prime_kmsg() -> None:
    """Drain whatever is already sitting in the ring so the first poll is not empty."""
    try:
        fd = os.open("/dev/kmsg", os.O_RDONLY | os.O_NONBLOCK)
    except OSError:
        return
    buf = b""
    try:
        for _ in range(80):
            try:
                chunk = os.read(fd, 8192)
            except BlockingIOError:
                break
            if not chunk:
                break
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                item = parse_kmsg_line(line.decode("utf-8", errors="replace"))
                if not item:
                    continue
                _kmsg_items.append(item)
        del _kmsg_items[:-MAX_ITEMS]
    finally:
        os.close(fd)


def _ensure_kmsg() -> None:
    global _kmsg_started
    if _kmsg_started:
        return
    _kmsg_started = True
    with _kmsg_lock:
        _prime_kmsg()
    threading.Thread(target=_kmsg_loop, name="zoto-kmsg", daemon=True).start()


def read_kmsg() -> list[dict[str, str]]:
    """Last kernel-ring lines. Prefers ``/dev/kmsg``; falls back to ``journalctl -k`` when dmesg is restricted."""
    _ensure_kmsg()
    with _kmsg_lock:
        live = list(_kmsg_items)
    return live or _kmsg_from_journal()


def _kmsg_from_journal() -> list[dict[str, str]]:
    try:
        raw = subprocess.check_output(
            ["journalctl", "-k", "-n", str(MAX_ITEMS), "-o", "json", "--no-pager"],
            timeout=2.0,
            stderr=subprocess.DEVNULL,
            text=True,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    items: list[dict[str, str]] = []
    for line in raw.splitlines():
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(rec, dict):
            continue
        msg = str(rec.get("MESSAGE") or "").strip()
        if not msg:
            continue
        items.append({
            "title": msg[:MAX_TITLE],
            "summary": "kern",
            "published": str(rec.get("__REALTIME_TIMESTAMP") or "")[:20],
            "link": "",
        })
    return items[-MAX_ITEMS:]


def _file_payload(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8", errors="replace")
    if len(text.encode("utf-8")) > MAX_BODY:
        raise ValueError("file too large")
    try:
        data = json.loads(text)
        return {"json": data}
    except json.JSONDecodeError:
        return {"text": text[:MAX_BODY]}


async def _projected_items(data: Any, fields: dict[str, Any]) -> list[dict[str, str]]:
    payload = data
    if fields.get("expand"):
        records: list[Any] = []
        for raw in source_fields.expand_ids(data, fields):
            rec = raw if isinstance(raw, dict) else None
            if rec is None:
                rec = await _expand_one(str(fields["expand"]), raw)
            if rec:
                records.append(rec)
        payload = records
        mapped = dict(fields)
        mapped.pop("list", None)
        return source_fields.project_items(payload, mapped)
    return source_fields.project_items(payload, fields)


async def _expand_one(template: str, raw_id: Any) -> dict[str, Any] | None:
    sid = str(raw_id or "").strip()
    if not sid:
        return None
    url = source_fields.subst(template, {"id": sid})
    try:
        agent_assets.check_url(url)
        body, _ = await _http_body(url)
        data = json.loads(body)
    except (ValueError, ClientError, json.JSONDecodeError, OSError):
        return None
    return data if isinstance(data, dict) else None


def _url_key(url: str) -> str:
    return unquote((url or "").strip())


async def _http_body(url: str) -> tuple[str, str]:
    """GET a public URL. Stops on encoding-only redirect loops (NASA WordPress %2C)."""
    sess = await session()
    current = resolve_fetch_url(url)
    seen: set[str] = set()
    for _ in range(6):
        key = _url_key(current)
        if key in seen:
            raise ValueError("too many redirects")
        seen.add(key)
        async with sess.get(URL(current, encoded=True), allow_redirects=False) as r:
            ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            loc = (r.headers.get("Location") or "").strip()
            if r.status in (301, 302, 303, 307, 308) and loc:
                nxt = urljoin(str(r.url), loc)
                if _url_key(nxt) == key:
                    raw = await r.read()
                    if raw:
                        if len(raw) > MAX_BODY:
                            raise ValueError("response too large")
                        return raw.decode("utf-8", errors="replace"), ctype
                    current = nxt
                    continue
                current = nxt
                continue
            if r.status >= 400:
                raise ValueError(f"http {r.status}")
            raw = await r.read()
            if len(raw) > MAX_BODY:
                raise ValueError("response too large")
            return raw.decode("utf-8", errors="replace"), ctype
    raise ValueError("too many redirects")


async def session() -> ClientSession:
    global _session
    if _session is None or _session.closed:
        _session = ClientSession(
            timeout=ClientTimeout(total=FETCH_S),
            headers={"User-Agent": "zoto-viz/1.0", "Accept": "application/rss+xml, application/atom+xml, application/json, text/xml, */*"},
        )
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
    if row["type"] == "file":
        live["path"] = row.get("path")
    elif row["type"] == "journal":
        if row.get("unit"):
            live["unit"] = row["unit"]
    elif row["type"] != "kmsg":
        live["url"] = nasa_api.public_url(str(row.get("url") or ""))
    if payload:
        live.update(payload)
    if error:
        live["error"] = nasa_api.redact_string(error)[:160]
    if row.get("id") == "apod" and nasa_api.using_demo_key():
        live["note"] = nasa_api.DEMO_NOTE
    _live[row["id"]] = live


async def fetch_one(row: dict[str, Any]) -> dict[str, Any]:
    kind = row["type"]
    try:
        if kind == "file":
            path = check_file(str(row.get("path") or ""))
            payload = _file_payload(path)
            fields = row.get("fields") if isinstance(row.get("fields"), dict) else None
            if fields and "json" in payload:
                items = await _projected_items(payload["json"], fields)
                if items:
                    payload["items"] = items
                    _schedule_prefetch(items)
            _record(row, ok=True, payload=payload)
        elif kind == "journal":
            _record(row, ok=True, payload={"items": read_journal(row.get("unit"))})
        elif kind == "kmsg":
            _record(row, ok=True, payload={"items": read_kmsg()})
        elif kind == "rss":
            body, _ = await _http_body(resolve_fetch_url(str(row["url"])))
            parsed = parse_rss(body)
            _record(row, ok=True, payload=parsed)
            _schedule_prefetch(parsed.get("items") or [])
        else:
            body, ctype = await _http_body(resolve_fetch_url(str(row["url"])))
            if "json" in ctype or body.lstrip().startswith(("{", "[")):
                try:
                    data = json.loads(body)
                except json.JSONDecodeError as e:
                    raise ValueError("invalid json") from e
                payload: dict[str, Any] = {"json": data}
                fields = row.get("fields") if isinstance(row.get("fields"), dict) else None
                if fields:
                    items = await _projected_items(data, fields)
                    if items:
                        payload["items"] = items
                        _schedule_prefetch(items)
                _record(row, ok=True, payload=payload)
            else:
                _record(row, ok=True, payload={"text": body[:MAX_BODY]})
    except (ValueError, ClientError, OSError, ET.ParseError) as e:
        _record(row, ok=False, error=str(e))
    return _live[row["id"]]


async def poll(now: float | None = None) -> dict[str, dict[str, Any]]:
    """Fetch sources whose interval has elapsed. Safe to call often."""
    t = time.time() if now is None else now
    due: list[dict[str, Any]] = []
    for row in ensure():
        if not row.get("enabled", True):
            _live.setdefault(row["id"], {
                "id": row["id"], "kind": row["type"], "label": row["label"],
                "ok": True, "ts": t, "feed": bool(row.get("feed", True)), "paused": True,
            })
            continue
        if t < _due.get(row["id"], 0):
            continue
        due.append(row)
    if due:
        await asyncio.gather(*(fetch_one(row) for row in due), return_exceptions=True)
        for row in due:
            wait = int(row.get("interval") or DEFAULT_INTERVAL)
            live = _live.get(row["id"]) or {}
            if not live.get("ok"):
                wait = min(wait, 30)
            _due[row["id"]] = t + wait
    return snapshot()


def snapshot() -> dict[str, dict[str, Any]]:
    ensure()
    raw = {r["id"]: _live.get(r["id"], {
        "id": r["id"],
        "kind": r["type"],
        "label": r["label"],
        "ok": True,
        "ts": 0,
        "pending": True,
        "feed": bool(r.get("feed", True)),
    }) for r in _rows}
    return nasa_api.public_snapshot(raw)


def apply(msg: dict[str, Any]) -> dict[str, Any]:
    msg["sources"] = snapshot()
    return msg


def _schedule_prefetch(items: list[dict[str, Any]]) -> None:
    urls = [
        str(it.get("image") or "")
        for it in items
        if str(it.get("image") or "").startswith("https://")
    ]
    if not urls:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(_prefetch_stills(urls[:PREFETCH_STILLS]))


async def _prefetch_stills(urls: list[str]) -> None:
    async def one(url: str) -> None:
        try:
            await agent_assets.ensure_photo(url)
        except (ValueError, ClientError, TimeoutError):
            return

    await asyncio.gather(*(one(url) for url in urls), return_exceptions=True)


def headlines(limit: int = HEADLINE_LIMIT) -> list[dict[str, str]]:
    """Feed-ready rows from enabled sources that opted into the ticker."""
    out: list[dict[str, str]] = []
    for row in ensure():
        live = _live.get(row["id"])
        if not live or not row.get("feed", True) or not row.get("enabled", True):
            continue
        label = str(live.get("label") or row["label"])
        for item in live.get("items") or []:
            title = " ".join(str(item.get("title") or "").split())
            if not title:
                continue
            line = {
                "id": f"{row['id']}:{len(out)}",
                "source": row["id"],
                "label": label,
                "text": title[:MAX_TITLE],
                "link": str(item.get("link") or ""),
            }
            image = str(item.get("image") or "").strip()
            if image:
                line["image"] = image[:MAX_IMAGE_URL]
            out.append(line)
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
    return {
        "sources": nasa_api.public_sources(ensure()),
        "live": snapshot(),
        "kinds": list(KINDS),
        "nasaApiKeyConfigured": nasa_api.configured(),
    }


async def api_image(request: web.Request) -> web.Response:
    """Same-origin JPEG/PNG for RSS enclosure stills (CSP img-src 'self')."""
    raw = str(request.query.get("url") or "").strip()
    if not raw:
        return web.json_response({"error": "url required"}, status=400)
    try:
        row = await agent_assets.ensure_photo(raw)
    except (ValueError, ClientError, TimeoutError) as e:
        status = agent_assets.image_http_status(e)
        err = str(e) if isinstance(e, ValueError) else f"fetch failed: {e}"
        return web.json_response({"error": nasa_api.redact_string(err)}, status=status)
    return agent_assets.file_response(row)


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
            return web.json_response({"error": nasa_api.redact_string(str(e))}, status=400)
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
        return web.json_response({"error": nasa_api.redact_string(str(e))}, status=400)
    return web.json_response({"ok": True, "source": nasa_api.public_source_row(row), **config_payload()})


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
        return web.json_response({"error": nasa_api.redact_string(str(e))}, status=400)
    return web.json_response({"ok": True, "source": nasa_api.public_source_row(row), **config_payload()})
