"""Persistent agent transcript and curated memories under ~/.zoto-viz/agent/."""
from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from . import paths

CONV_MAX = 200
UI_MAX = 80
# Prompt tail is the current user turn only. Older prose is not replayed.
OLLAMA_TAIL = 2
ROLL_KEEP = 1
ROLL_SUMMARY_CAP = 1400
OLLAMA_MSG_CAP = 600
OLLAMA_LAST_CAP = 2000
MEMORY_MAX = 50
HIGHLIGHT_MAX = 40
FACTS_MAX_TOKENS = 384
FACTS_MIN_TOKENS = 64
FACTS_MAX_TOKENS_CAP = 2048
INJECT_CHARS = 900
CONTENT_MAX = 8000
HIGHLIGHT_LINE = 160
_LOCK = threading.Lock()

_IP = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")
_FENCE_MEMORY = re.compile(r"```memory\n([\s\S]+?)```", re.I)
_FENCE_ANY = re.compile(r"```[\s\S]*?```")
_REMEMBER = re.compile(
    r"^\s*(?:please\s+)?(?:remember|note that|don'?t forget|from now on)\s*[:,\-]?\s+(.+)$",
    re.I | re.S,
)
_FORGET = re.compile(r"^\s*(?:forget|stop remembering)\s*[:,\-]?\s*(.+)$", re.I)
_DURABLE = re.compile(
    r"\b(always|prefer|my name is|call me|this (?:host|device|box) is)\b",
    re.I,
)
_STOP = {
    "the", "and", "for", "that", "this", "with", "from", "you", "are", "was",
    "have", "has", "not", "but", "what", "who", "how", "why", "when", "about",
    "just", "can", "please", "into", "your", "our",
}


def agent_dir() -> Path:
    return paths.agent_dir()


def conversation_file() -> Path:
    return agent_dir() / "conversation.json"


def memories_file() -> Path:
    return agent_dir() / "memories.json"


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(path)


def _read_json(path: Path) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return raw if isinstance(raw, dict) else {}


def _scrub(text: str, redact: bool) -> str:
    s = str(text or "")[:CONTENT_MAX]
    if redact:
        s = _IP.sub("x.x.x.x", s)
    return s


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def _tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]{3,}", text.lower()) if t not in _STOP}


def messages() -> list[dict[str, Any]]:
    with _LOCK:
        rows = _read_json(conversation_file()).get("messages") or []
    out: list[dict[str, Any]] = []
    if not isinstance(rows, list):
        return out
    for m in rows:
        if not isinstance(m, dict):
            continue
        role = m.get("role")
        if role not in ("user", "assistant"):
            continue
        thought = str(m.get("thinking") or "")[:CONTENT_MAX]
        row: dict[str, Any] = {"t": m.get("t") or 0, "role": role, "content": str(m.get("content") or "")[:CONTENT_MAX]}
        if thought.strip():
            row["thinking"] = thought
        out.append(row)
    return out


def ui_messages() -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for m in messages()[-UI_MAX:]:
        row: dict[str, str] = {"role": m["role"], "content": m["content"]}
        if m.get("thinking"):
            row["thinking"] = str(m["thinking"])
        out.append(row)
    return out


def estimate_tokens(text: str) -> int:
    s = str(text or "")
    if not s:
        return 0
    return max(1, (len(s) + 3) // 4)


def _one_line(text: str) -> str:
    s = _FENCE_ANY.sub(" ", str(text or ""))
    return re.sub(r"\s+", " ", s).strip()


def abbreviate(msgs: list[dict[str, Any]], *, redact: bool = False) -> str:
    """Short carry-over of a closed chat window; used as the next chat's opening state."""
    parts: list[str] = []
    for m in msgs:
        if not isinstance(m, dict):
            continue
        role = "User" if m.get("role") == "user" else "You"
        line = _one_line(_scrub(str(m.get("content") or ""), redact))
        if not line:
            continue
        parts.append(f"{role}: {line[:180]}")
    if not parts:
        return ""
    body = "\n".join(parts)
    if len(body) > ROLL_SUMMARY_CAP:
        keep_head, keep_tail = 2, 8
        if len(parts) > keep_head + keep_tail:
            parts = parts[:keep_head] + ["…"] + parts[-keep_tail:]
        body = "\n".join(parts)
    return body[:ROLL_SUMMARY_CAP]


def _rolls_of(data: dict[str, Any]) -> list[dict[str, Any]]:
    rows = data.get("rolls")
    if not isinstance(rows, list):
        return []
    return [r for r in rows if isinstance(r, dict)]


def _through(rows: list[Any], rolls: list[dict[str, Any]]) -> int:
    if not rolls:
        return 0
    try:
        n = int(rolls[-1].get("through") or 0)
    except (TypeError, ValueError):
        n = 0
    return max(0, min(n, len(rows)))


def ollama_tail() -> list[dict[str, str]]:
    """Current user turn only. Prior assistant prose and CoT stay on the feed, not in the prompt."""
    with _LOCK:
        data = _read_json(conversation_file())
        rows = data.get("messages") if isinstance(data.get("messages"), list) else []
        rolls = _rolls_of(data)
        through = _through(rows, rolls)
    live = [m for m in rows[through:] if isinstance(m, dict) and m.get("role") in ("user", "assistant")]
    last_user = ""
    for m in reversed(live):
        if m.get("role") != "user":
            continue
        last_user = str(m.get("content") or "").strip()
        if last_user:
            break
    if not last_user:
        return []
    return [{"role": "user", "content": last_user[:OLLAMA_LAST_CAP]}]


def maybe_roll(
    *,
    extra_tokens: int = 0,
    budget_tokens: int = 0,
    keep: int = ROLL_KEEP,
    redact: bool = False,
    force: bool = False,
) -> dict[str, Any] | None:
    """Close the live Ollama window and start a new session. Memories stay; UI transcript is unchanged."""
    keep = max(1, min(int(keep), OLLAMA_TAIL))
    with _LOCK:
        path = conversation_file()
        data = _read_json(path)
        rows = [m for m in (data.get("messages") or []) if isinstance(m, dict)]
        rolls = _rolls_of(data)
        through = _through(rows, rolls)
        live = rows[through:]
        live_tokens = extra_tokens + sum(estimate_tokens(str(m.get("content") or "")) for m in live)
        over_budget = budget_tokens > 0 and live_tokens > budget_tokens
        over_count = len(live) > OLLAMA_TAIL
        if not force and not over_budget and not over_count:
            return None
        if len(live) <= keep:
            compact = live[:-1] if len(live) > 1 else []
        else:
            compact = live[:-keep]
        if not compact:
            return None
        _ = redact
        roll = {
            "t": time.time(),
            "summary": "",
            "through": through + len(compact),
            "new_session": True,
        }
        rolls.append(roll)
        data["rolls"] = rolls[-20:]
        data["messages"] = rows
        _write_json(path, data)
        return roll


def append_message(role: str, content: str, *, thinking: str = "") -> None:
    if role not in ("user", "assistant"):
        return
    text = str(content or "")[:CONTENT_MAX]
    thought = str(thinking or "")[:CONTENT_MAX]
    if not text.strip() and not thought.strip():
        return
    with _LOCK:
        path = conversation_file()
        data = _read_json(path)
        rows = data.get("messages") if isinstance(data.get("messages"), list) else []
        if (
            rows
            and isinstance(rows[-1], dict)
            and rows[-1].get("role") == role
            and str(rows[-1].get("content") or "") == text
            and str(rows[-1].get("thinking") or "") == thought
        ):
            return
        row: dict[str, Any] = {"t": time.time(), "role": role, "content": text}
        if thought.strip():
            row["thinking"] = thought
        rows.append(row)
        dropped = max(0, len(rows) - CONV_MAX)
        if dropped:
            rows = rows[-CONV_MAX:]
            rolls = _rolls_of(data)
            for roll in rolls:
                try:
                    roll["through"] = max(0, int(roll.get("through") or 0) - dropped)
                except (TypeError, ValueError):
                    roll["through"] = 0
            data["rolls"] = rolls
        data["messages"] = rows
        _write_json(path, data)


def clear_conversation() -> None:
    with _LOCK:
        _write_json(conversation_file(), {"messages": [], "rolls": []})
        data = _read_json(memories_file())
        rows = [
            m for m in (data.get("memories") or [])
            if isinstance(m, dict) and str(m.get("kind") or "memory") != "highlight"
        ]
        _save_memories(rows)


def list_memories(*, kind: str | None = None) -> list[dict[str, Any]]:
    with _LOCK:
        rows = _read_json(memories_file()).get("memories") or []
    out: list[dict[str, Any]] = []
    if not isinstance(rows, list):
        return out
    for m in rows:
        if not isinstance(m, dict):
            continue
        text = str(m.get("text") or "").strip()
        if not text:
            continue
        k = str(m.get("kind") or "memory")
        if kind and k != kind:
            continue
        out.append({
            "id": str(m.get("id") or ""),
            "text": text[:CONTENT_MAX],
            "t": m.get("t") or 0,
            "kind": k,
        })
    return out


def _save_memories(rows: list[dict[str, Any]]) -> None:
    mems = [m for m in rows if m.get("kind") != "highlight"][-MEMORY_MAX:]
    highs = [m for m in rows if m.get("kind") == "highlight"][-HIGHLIGHT_MAX:]
    _write_json(memories_file(), {"memories": mems + highs})


def add_memory(text: str, *, kind: str = "memory", redact: bool = False) -> dict[str, Any] | None:
    text = _scrub(text, redact).strip()
    if not text or kind not in ("memory", "highlight"):
        return None
    n = _norm(text)
    if len(n) < 4:
        return None
    with _LOCK:
        data = _read_json(memories_file())
        rows = data.get("memories") if isinstance(data.get("memories"), list) else []
        cleaned: list[dict[str, Any]] = [m for m in rows if isinstance(m, dict)]
        for m in cleaned:
            existing = _norm(str(m.get("text") or ""))
            if not existing:
                continue
            same_kind = str(m.get("kind") or "memory") == kind
            if same_kind and (n == existing or n in existing or existing in n):
                return None
        row = {"id": uuid.uuid4().hex[:8], "text": text[:CONTENT_MAX], "t": time.time(), "kind": kind}
        cleaned.append(row)
        _save_memories(cleaned)
        return row


def delete_memory(mem_id: str) -> bool:
    want = str(mem_id or "").strip()
    if not want:
        return False
    with _LOCK:
        data = _read_json(memories_file())
        rows = data.get("memories") if isinstance(data.get("memories"), list) else []
        kept = [m for m in rows if isinstance(m, dict) and str(m.get("id") or "") != want]
        if len(kept) == len([m for m in rows if isinstance(m, dict)]):
            return False
        _save_memories(kept)
        return True


def clear_memories() -> None:
    with _LOCK:
        _write_json(memories_file(), {"memories": []})


def forget(query: str) -> int:
    q = _tokens(query)
    if not q:
        return 0
    with _LOCK:
        data = _read_json(memories_file())
        rows = [m for m in (data.get("memories") or []) if isinstance(m, dict)]
        kept: list[dict[str, Any]] = []
        dropped = 0
        for m in rows:
            t = _tokens(str(m.get("text") or ""))
            if t and (q <= t or len(q & t) >= max(1, min(3, len(q)))):
                dropped += 1
                continue
            kept.append(m)
        if dropped:
            _save_memories(kept)
        return dropped


def recall(query: str, limit: int = 8) -> list[str]:
    items = list_memories()
    if not items:
        return []
    q = _tokens(query)
    scored: list[tuple[float, float, str]] = []
    for m in items:
        overlap = len(q & _tokens(m["text"])) if q else 0
        bonus = 2.0 if m["kind"] == "memory" else 0.0
        recency = float(m["t"] or 0) / 1e12
        scored.append((overlap + bonus + recency, float(m["t"] or 0), m["text"]))
    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    picked: list[str] = []
    seen: set[str] = set()
    for _, _, text in scored:
        n = _norm(text)
        if n in seen:
            continue
        seen.add(n)
        picked.append(text)
        if len(picked) >= limit:
            break
    if len(picked) < min(2, limit):
        for m in reversed(items):
            n = _norm(m["text"])
            if n not in seen:
                picked.append(m["text"])
                seen.add(n)
            if len(picked) >= min(2, limit):
                break
    return picked[:limit]


def facts_token_budget() -> int:
    raw = os.environ.get("ZOTO_VIZ_FACTS_TOKENS", "").strip()
    if raw:
        try:
            return max(FACTS_MIN_TOKENS, min(FACTS_MAX_TOKENS_CAP, int(raw)))
        except ValueError:
            pass
    return FACTS_MAX_TOKENS


def facts_window(*, query: str = "", max_tokens: int | None = None) -> str:
    """Sliding outcome window for the next prompt. CoT is not included."""
    budget = facts_token_budget() if max_tokens is None else int(max_tokens)
    budget = max(FACTS_MIN_TOKENS, min(FACTS_MAX_TOKENS_CAP, budget))
    mems = list_memories(kind="memory")
    highs = list_memories(kind="highlight")
    q = _tokens(query)

    def rank(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return sorted(
            rows,
            key=lambda m: (len(q & _tokens(m["text"])) if q else 0, float(m["t"] or 0)),
            reverse=True,
        )

    header = "Facts (outcomes to reuse; not a transcript):\n"
    used = estimate_tokens(header)
    lines: list[str] = []
    seen: set[str] = set()
    for m in rank(mems) + rank(highs):
        n = _norm(m["text"])
        if n in seen:
            continue
        line = f"- {m['text']}"
        cost = estimate_tokens(line) + 1
        if used + cost > budget:
            continue
        seen.add(n)
        lines.append(line)
        used += cost
    if not lines:
        return ""
    return (header + "\n".join(lines))[: max(INJECT_CHARS, budget * 4)]


def inject_block(query: str, *, max_tokens: int | None = None) -> str:
    body = facts_window(query=query, max_tokens=max_tokens)
    return ("\n" + body) if body else ""


def _memory_texts_from_fence(blob: str) -> list[str]:
    out: list[str] = []
    for m in _FENCE_MEMORY.finditer(blob or ""):
        inner = m.group(1).strip()
        if inner.startswith("{") or inner.startswith("["):
            try:
                parsed = json.loads(inner)
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, dict) and parsed.get("text"):
                out.append(str(parsed["text"]))
                continue
            if isinstance(parsed, list):
                for item in parsed:
                    if isinstance(item, str) and item.strip():
                        out.append(item)
                    elif isinstance(item, dict) and item.get("text"):
                        out.append(str(item["text"]))
                continue
        if inner:
            out.append(inner)
    return out


def harvest(user: str, assistant: str, *, redact: bool = False) -> list[dict[str, Any]]:
    """Save explicit memories, forget matches, and a one-line outcome fact (not CoT)."""
    added: list[dict[str, Any]] = []
    user_text = _scrub(user, redact).strip()
    reply = _scrub(assistant, redact).strip()
    forget_m = _FORGET.match(user_text)
    if forget_m:
        target = forget_m.group(1).strip()
        if _tokens(target):
            forget(target)
        else:
            items = list_memories(kind="memory")
            if items:
                delete_memory(str(items[-1]["id"]))
    rem = _REMEMBER.match(user_text)
    if rem:
        row = add_memory(rem.group(1), kind="memory", redact=redact)
        if row:
            added.append(row)
    if _DURABLE.search(user_text) and not rem:
        row = add_memory(user_text, kind="memory", redact=redact)
        if row:
            added.append(row)
    for text in _memory_texts_from_fence(reply):
        row = add_memory(text, kind="memory", redact=redact)
        if row:
            added.append(row)
    highlight = _outcome_line(user_text, reply)
    if highlight:
        row = add_memory(highlight, kind="highlight", redact=redact)
        if row:
            added.append(row)
    return added


_PLUGIN_FENCE = re.compile(r"```[^\n]*plugin\.yml[^\n]*\n([\s\S]+?)```", re.I)
_PLUGIN_ID = re.compile(r"(?:^|\n)\s*id:\s*([A-Za-z0-9][A-Za-z0-9_-]{1,40})")
_SETTINGS_FENCE = re.compile(r"```settings\n([\s\S]+?)```", re.I)


def _outcome_line(user: str, assistant: str) -> str:
    """One retained fact from a finished turn. Drops fences and reasoning prose."""
    if not user.strip() or not assistant.strip():
        return ""
    if assistant.lower().startswith("chat failed") or assistant.lower().startswith("error"):
        return ""
    bits: list[str] = []
    for block in _PLUGIN_FENCE.finditer(assistant):
        hit = _PLUGIN_ID.search(block.group(1))
        if hit:
            bits.append(f"built plugin {hit.group(1)}")
            break
    settings = _SETTINGS_FENCE.search(assistant)
    if settings:
        try:
            obj = json.loads(settings.group(1))
        except json.JSONDecodeError:
            obj = None
        if isinstance(obj, dict) and obj:
            bits.append("changed " + ", ".join(str(k) for k in list(obj)[:6]))
    clean = _FENCE_MEMORY.sub(" ", assistant)
    clean = re.sub(r"```[\s\S]*?```", " ", clean)
    clean = re.sub(r"<think>[\s\S]*?</think>", " ", clean, flags=re.I)
    clean = re.sub(r"\s+", " ", clean).strip()
    if clean and len(clean) >= 12:
        bits.append(clean[:100])
    if not bits:
        return ""
    u = re.sub(r"\s+", " ", user).strip()
    return f"{u[:70]} · {'; '.join(bits)}"[:HIGHLIGHT_LINE]
