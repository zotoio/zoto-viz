"""NOAA SWPC planetary K-index for the ``noaa-kp`` library row.

SWPC publishes the 3-hourly planetary Kp as public JSON with no key. A source row that points
at that product is fetched here rather than through the generic JSON path so it can:

- identify itself with a descriptive ``User-Agent`` and revalidate with ``If-None-Match`` /
  ``If-Modified-Since`` (the product changes at most every few minutes);
- never poll faster than ``MIN_INTERVAL`` and back off ``RETRY_S`` after a failure;
- keep the last good reading in ``~/.zoto-viz/cache/noaa-kp.json`` and serve it (``stale``)
  while SWPC is unreachable, so a restart offline still shows the last real Kp;
- project the readings newest first as source items: ``Kp 3.00 · unsettled``.

Views read the first item's title (``Kp <value>``); everything else is for people.
"""
from __future__ import annotations

import json
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from aiohttp import ClientSession, ClientTimeout

from . import paths

URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"
HOST = "services.swpc.noaa.gov"
PATH = "/products/noaa-planetary-k-index.json"
PAGE = "https://www.swpc.noaa.gov/products/planetary-k-index"
USER_AGENT = "zoto-viz/1.0 (+https://github.com/zotoio/zoto-viz; noaa-kp source, polls every 15 min)"
DEFAULT_INTERVAL = 900
MIN_INTERVAL = 600
RETRY_S = 300
FETCH_S = 10
MAX_BODY = 128_000
MAX_ROWS = 120
# Eight 3-hour slots: the last 24 h, newest first on the wire.
HISTORY = 8

_mem: dict[str, Any] | None = None


def reset_for_tests() -> None:
    global _mem
    _mem = None


def matches(url: str) -> bool:
    try:
        parsed = urlparse((url or "").strip())
    except ValueError:
        return False
    return parsed.scheme == "https" and (parsed.hostname or "").lower() == HOST and parsed.path == PATH


def cache_file() -> Path:
    return paths.user_dir() / "cache" / "noaa-kp.json"


def _num(raw: Any) -> float | None:
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return None
    return val if 0.0 <= val <= 9.0 else None


def _int(raw: Any) -> int | None:
    try:
        return int(float(raw))
    except (TypeError, ValueError):
        return None


def _iso(raw: Any) -> str:
    text = str(raw or "").strip().replace(" ", "T")
    if not text:
        return ""
    try:
        stamp = datetime.fromisoformat(text.removesuffix("Z").split(".")[0])
    except ValueError:
        return ""
    return stamp.replace(tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_rows(data: Any) -> list[dict[str, Any]]:
    """SWPC rows oldest first. Accepts the object rows SWPC serves now and the older
    array-of-arrays form whose first row is the header."""
    if not isinstance(data, list):
        raise ValueError("kp: expected a JSON list")
    rows: list[dict[str, Any]] = []
    header: list[str] | None = None
    for raw in data[-MAX_ROWS - 1:]:
        if isinstance(raw, list):
            if header is None and raw and all(isinstance(c, str) and not c[:1].isdigit() for c in raw):
                header = [c.strip() for c in raw]
                continue
            raw = dict(zip(header or ["time_tag", "Kp", "a_running", "station_count"], raw))
        if not isinstance(raw, dict):
            continue
        kp = _num(raw.get("Kp", raw.get("kp_index")))
        when = _iso(raw.get("time_tag"))
        if kp is None or not when:
            continue
        rows.append({
            "time": when,
            "kp": round(kp, 2),
            "a": _int(raw.get("a_running")),
            "stations": _int(raw.get("station_count")),
        })
    if not rows:
        raise ValueError("kp: no readings")
    rows.sort(key=lambda r: r["time"])
    return rows


def level(kp: float) -> str:
    """Words for the NOAA G scale (Kp 5 = G1 minor storm ... Kp 9 = G5 extreme)."""
    whole = round(kp)
    if whole >= 5:
        return f"G{min(5, whole - 4)} storm"
    if whole >= 4:
        return "active"
    if kp >= 2:
        return "unsettled"
    return "quiet"


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    last = rows[-1]
    recent = rows[-HISTORY:]
    prev = rows[-2]["kp"] if len(rows) > 1 else last["kp"]
    return {
        "kp": last["kp"],
        "time": last["time"],
        "level": level(last["kp"]),
        "max24h": max(r["kp"] for r in recent),
        "trend": round(last["kp"] - prev, 2),
        "a": last["a"],
        "stations": last["stations"],
        "history": [r["kp"] for r in recent],
    }


def items(rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Newest first. The first title is the current Kp; views parse ``Kp <value>`` from it."""
    out: list[dict[str, str]] = []
    recent = rows[-HISTORY:]
    peak = max(r["kp"] for r in recent)
    for i, row in enumerate(reversed(recent)):
        bits = [f"3 h slot from {row['time']}"]
        if i == 0:
            bits.append(f"24 h max {peak:.2f}")
        if row["a"] is not None:
            bits.append(f"a {row['a']}")
        if row["stations"] is not None:
            bits.append(f"{row['stations']} stations")
        out.append({
            "title": f"Kp {row['kp']:.2f} · {level(row['kp'])}",
            "summary": " · ".join(bits),
            "published": row["time"],
            "link": PAGE,
        })
    return out


def _read_cache() -> dict[str, Any] | None:
    try:
        doc = json.loads(cache_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(doc, dict) or not isinstance(doc.get("rows"), list):
        return None
    try:
        doc["rows"] = parse_rows([{"time_tag": r.get("time"), "Kp": r.get("kp"), "a_running": r.get("a"),
                                   "station_count": r.get("stations")} for r in doc["rows"] if isinstance(r, dict)])
    except ValueError:
        return None
    return doc


def _write_cache(doc: dict[str, Any]) -> None:
    path = cache_file()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix="noaa-kp.", suffix=".json", dir=path.parent)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(doc, fh)
        os.replace(tmp, path)
    except OSError:
        return


def _cached() -> dict[str, Any] | None:
    global _mem
    if _mem is None:
        _mem = _read_cache()
    return _mem


def _payload(doc: dict[str, Any], *, stale: bool = False, error: str = "") -> dict[str, Any]:
    rows = doc["rows"]
    out: dict[str, Any] = {
        "items": items(rows),
        "json": summarize(rows),
        "fetchedAt": doc.get("fetchedAt", 0),
    }
    if stale:
        out["stale"] = True
    if error:
        out["liveError"] = error[:160]
    return out


async def _read_body(content: Any) -> bytes:
    """The whole body, at most ``MAX_BODY`` bytes. One ``read(n)`` can stop at a network chunk."""
    body = bytearray()
    while True:
        chunk = await content.read(MAX_BODY + 1 - len(body))
        if not chunk:
            return bytes(body)
        body += chunk
        if len(body) > MAX_BODY:
            raise ValueError("response too large")


async def _get(sess: ClientSession, prev: dict[str, Any] | None) -> tuple[int, bytes, dict[str, str]]:
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if prev and prev.get("etag"):
        headers["If-None-Match"] = str(prev["etag"])
    if prev and prev.get("lastModified"):
        headers["If-Modified-Since"] = str(prev["lastModified"])
    async with sess.get(URL, headers=headers, allow_redirects=False, timeout=ClientTimeout(total=FETCH_S)) as r:
        if r.status == 304:
            return 304, b"", {}
        if r.status >= 400:
            raise ValueError(f"http {r.status}")
        if r.status != 200:
            raise ValueError(f"kp: unexpected http {r.status}")
        body = await _read_body(r.content)
        return 200, body, {
            "etag": r.headers.get("ETag") or "",
            "lastModified": r.headers.get("Last-Modified") or "",
        }


async def fetch(sess: ClientSession, *, now: float | None = None) -> dict[str, Any]:
    """Source payload for the row. Raises only when SWPC fails and nothing was ever cached."""
    global _mem
    t = time.time() if now is None else now
    prev = _cached()
    if prev and t - float(prev.get("fetchedAt") or 0) < MIN_INTERVAL:
        return _payload(prev)
    try:
        status, body, meta = await _get(sess, prev)
        if status == 304 and prev:
            doc = {**prev, "fetchedAt": t}
        else:
            rows = parse_rows(json.loads(body.decode("utf-8", errors="replace")))
            doc = {"rows": rows, "fetchedAt": t, **meta}
    except Exception as e:  # noqa: BLE001 - any failure falls back to the last good reading
        if not prev:
            raise ValueError(str(e) or type(e).__name__) from e
        return _payload(prev, stale=True, error=str(e) or type(e).__name__)
    _mem = doc
    _write_cache(doc)
    return _payload(doc)
