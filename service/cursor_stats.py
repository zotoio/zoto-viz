"""Append-only Cursor SDK usage/cost log at ~/.zoto-viz/cursor-stats.jsonl."""
from __future__ import annotations

import json
import math
import os
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from aiohttp import web

from . import logbuf
from . import paths

SECRET_KEYS = frozenset({
    "apikey", "api_key", "api-key", "authorization", "password", "secret", "cursor_api_key",
})
TOKEN_FIELDS = (
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "totalTokens",
    "reasoningTokens",
)
TAIL_DEFAULT = 80
TAIL_MAX = 400
_totals_cache: dict[str, Any] = {"sig": None, "totals": None}


def stats_path() -> Path:
    env = os.environ.get("ZOTO_VIZ_CURSOR_STATS", "").strip()
    if env:
        return Path(env).expanduser()
    return paths.user_dir() / "cursor-stats.jsonl"


def _env_key() -> str:
    return os.environ.get("CURSOR_API_KEY", "").strip()


def _looks_like_key(value: str) -> bool:
    key = _env_key()
    if key and key in value:
        return True
    return value.startswith(("key_", "crsr_")) and len(value) >= 20


def redact_string(value: str) -> str:
    key = _env_key()
    out = value.replace(key, "[redacted]") if key else value
    if _looks_like_key(out):
        return "[redacted]"
    return out[:2000]


def sanitize(value: Any, depth: int = 0) -> Any:
    if value is None or isinstance(value, (int, float, bool)):
        return value
    if depth > 8:
        return None
    if isinstance(value, str):
        return redact_string(value)
    if isinstance(value, list):
        return [sanitize(item, depth + 1) for item in value]
    if not isinstance(value, dict):
        return None
    out: dict[str, Any] = {}
    for raw_k, raw_v in value.items():
        key = str(raw_k)
        if key.lower().replace("-", "_") in SECRET_KEYS:
            continue
        out[key] = sanitize(raw_v, depth + 1)
    return out


def _last_id(path: Path) -> str:
    try:
        last = path.read_text(encoding="utf-8").splitlines()[-1]
        row = json.loads(last)
    except (OSError, IndexError, json.JSONDecodeError):
        return ""
    return str(row.get("id") or "") if isinstance(row, dict) else ""


def append(partial: dict[str, Any]) -> dict[str, Any]:
    rec = sanitize(dict(partial))
    if not isinstance(rec, dict):
        rec = {}
    rec.setdefault("id", str(uuid.uuid4()))
    rec.setdefault("t", time.time())
    path = stats_path()
    if _last_id(path) == str(rec["id"]):
        return rec
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, separators=(",", ":")) + "\n")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return rec


def summary(rec: dict[str, Any]) -> str:
    op = str(rec.get("op") or "cursor")
    model = str(rec.get("model") or "")
    usage = rec.get("usage") if isinstance(rec.get("usage"), dict) else {}
    billed = rec.get("billed") if isinstance(rec.get("billed"), dict) else {}
    billed_usage = billed.get("usage") if isinstance(billed.get("usage"), dict) else {}
    cost = rec.get("cost") if isinstance(rec.get("cost"), dict) else {}
    if not cost:
        cost = billed.get("cost") if isinstance(billed.get("cost"), dict) else {}
    tokens = usage or billed_usage
    bits = ["cursor stats", op]
    if model:
        bits.append(model)
    if rec.get("status"):
        bits.append(str(rec["status"]))
    if tokens:
        inn = tokens.get("inputTokens")
        out = tokens.get("outputTokens")
        tot = tokens.get("totalTokens")
        if inn is not None:
            bits.append(f"in={inn}")
        if out is not None:
            bits.append(f"out={out}")
        if tot is not None:
            bits.append(f"total={tot}")
        cache = tokens.get("cacheReadTokens")
        if cache:
            bits.append(f"cache={cache}")
        reason = tokens.get("reasoningTokens")
        if reason:
            bits.append(f"think={reason}")
    if isinstance(cost, dict) and cost:
        if "chargedCents" in cost:
            bits.append(f"charged={cost['chargedCents']}¢")
        if "rawCostCents" in cost:
            bits.append(f"raw={cost['rawCostCents']}¢")
    account = rec.get("account") if isinstance(rec.get("account"), dict) else {}
    if account.get("apiKeyName"):
        bits.append(f"key={account['apiKeyName']}")
    if rec.get("models") is not None:
        bits.append(f"models={rec['models']}")
    if rec.get("error"):
        bits.append(str(rec["error"])[:120])
    return " ".join(bits)


def _finite(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    n = float(value)
    return n if math.isfinite(n) else None


def cost_of(rec: dict[str, Any]) -> dict[str, float]:
    """Charged and raw cents from a stats row. Top-level cost wins over billed.cost."""
    cost = rec.get("cost") if isinstance(rec.get("cost"), dict) else {}
    if not cost:
        billed = rec.get("billed") if isinstance(rec.get("billed"), dict) else {}
        cost = billed.get("cost") if isinstance(billed.get("cost"), dict) else {}
    out: dict[str, float] = {}
    charged = _finite(cost.get("chargedCents")) if isinstance(cost, dict) else None
    raw = _finite(cost.get("rawCostCents")) if isinstance(cost, dict) else None
    if charged is not None:
        out["chargedCents"] = charged
    if raw is not None:
        out["rawCostCents"] = raw
    return out


def spend_cents(cost: dict[str, float]) -> float:
    """What to add to the header: charged when present, otherwise raw."""
    if "chargedCents" in cost:
        return cost["chargedCents"]
    return cost.get("rawCostCents") or 0.0


def row_time(rec: dict[str, Any]) -> float:
    t = _finite(rec.get("t"))
    return t if t is not None and t > 0 else 0.0


def local_day_start(now: float) -> float:
    dt = datetime.fromtimestamp(now).astimezone()
    return dt.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()


def reset_totals_cache() -> None:
    _totals_cache["sig"] = None
    _totals_cache["totals"] = None


def totals(*, now: float | None = None) -> dict[str, Any]:
    """All-time and local-calendar-day spend. Dedupes by ``id`` so a bridge write + ingest do not double-count."""
    t = time.time() if now is None else float(now)
    path = stats_path()
    day = datetime.fromtimestamp(t).astimezone().date().isoformat()
    try:
        st = path.stat()
        sig = (str(path), st.st_mtime_ns, st.st_size, day)
    except OSError:
        sig = (str(path), 0, 0, day)
    cached = _totals_cache.get("totals")
    if _totals_cache.get("sig") == sig and isinstance(cached, dict):
        return cached
    out = _scan_totals(path, t, day)
    _totals_cache["sig"] = sig
    _totals_cache["totals"] = out
    return out


def _scan_totals(path: Path, now: float, day: str) -> dict[str, Any]:
    start = local_day_start(now)
    seen: set[str] = set()
    charged = raw = today_charged = today_raw = 0.0
    total = today = 0.0
    calls = 0
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        lines = []
    for line in lines:
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(row, dict):
            continue
        rid = str(row.get("id") or "")
        if rid:
            if rid in seen:
                continue
            seen.add(rid)
        calls += 1
        cost = cost_of(row)
        amt = spend_cents(cost)
        if "chargedCents" in cost:
            charged += cost["chargedCents"]
            if row_time(row) >= start:
                today_charged += cost["chargedCents"]
        if "rawCostCents" in cost:
            raw += cost["rawCostCents"]
            if row_time(row) >= start:
                today_raw += cost["rawCostCents"]
        if amt:
            total += amt
            if row_time(row) >= start:
                today += amt
    return {
        "day": day,
        "calls": calls,
        "totalCents": total,
        "todayCents": today,
        "chargedCents": charged,
        "rawCostCents": raw,
        "todayChargedCents": today_charged,
        "todayRawCostCents": today_raw,
    }


def usage_from_stats(stats: dict[str, Any] | None) -> dict[str, Any] | None:
    """Compact token + spend blob for the conversation / parking log."""
    if not isinstance(stats, dict):
        return None
    usage = stats.get("usage") if isinstance(stats.get("usage"), dict) else {}
    billed = stats.get("billed") if isinstance(stats.get("billed"), dict) else {}
    billed_usage = billed.get("usage") if isinstance(billed.get("usage"), dict) else {}
    cost = stats.get("cost") if isinstance(stats.get("cost"), dict) else {}
    if not cost:
        cost = billed.get("cost") if isinstance(billed.get("cost"), dict) else {}
    tokens = usage or billed_usage
    out: dict[str, Any] = {}
    if tokens:
        out["usage"] = tokens
    if cost:
        out["cost"] = cost
    if billed.get("error"):
        out["spendError"] = str(billed["error"])[:200]
    if stats.get("model"):
        out["model"] = str(stats["model"])
    if stats.get("runId"):
        out["runId"] = str(stats["runId"])
    if stats.get("agentId"):
        out["agentId"] = str(stats["agentId"])
    if stats.get("durationMs") is not None:
        out["durationMs"] = stats["durationMs"]
    return out or None


def ingest(row: dict[str, Any] | None) -> dict[str, Any] | None:
    """Persist a bridge ``stats`` object (or a raw usage row) and log it for debug."""
    if not isinstance(row, dict):
        return None
    payload = row.get("stats") if isinstance(row.get("stats"), dict) else row
    if not isinstance(payload, dict):
        return None
    if not (payload.get("op") or payload.get("usage") or payload.get("cost") or payload.get("billed")
            or payload.get("account")):
        return None
    rec = append(payload)
    logbuf.record(summary(rec))
    return rec


def tail(limit: int = TAIL_DEFAULT) -> list[dict[str, Any]]:
    try:
        n = int(limit)
    except (TypeError, ValueError):
        n = TAIL_DEFAULT
    n = max(1, min(TAIL_MAX, n))
    path = stats_path()
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    rows: list[dict[str, Any]] = []
    for line in lines[-n:]:
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            clean = sanitize(row)
            if isinstance(clean, dict):
                rows.append(clean)
    return rows


async def api_stats(req: web.Request) -> web.Response:
    n = req.query.get("tail", TAIL_DEFAULT)
    rows = tail(n)
    return web.json_response({
        "ok": True,
        "path": "cursor-stats.jsonl",
        "lines": rows,
        "totals": totals(),
    })
