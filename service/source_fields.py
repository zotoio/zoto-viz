"""Project HTTP/file JSON onto RSS-shaped source items via a field map."""
from __future__ import annotations

import re
from typing import Any

MAX_ITEMS = 20
MAX_TITLE = 240
MAX_SUMMARY = 400
MAX_EXPAND = 8
FIELD_KEYS = (
    "list", "title", "caption", "image", "imageFallback", "link",
    "filter", "imageTemplate", "linkTemplate", "expand", "expandCap", "id",
)

_PLACE = re.compile(r"\{([A-Za-z_][A-Za-z0-9_.]*)\}")


def normalize_fields(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    out: dict[str, Any] = {}
    for key in FIELD_KEYS:
        if key not in raw:
            continue
        val = raw[key]
        if key == "expandCap":
            try:
                n = int(val)
            except (TypeError, ValueError):
                continue
            out[key] = max(1, min(12, n))
            continue
        text = str(val or "").strip()
        if text:
            out[key] = text[:240]
    return out or None


def dig(obj: Any, path: str | None) -> Any:
    if not path:
        return obj
    cur = obj
    for part in path.split("."):
        if isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list) and part.isdigit():
            i = int(part)
            cur = cur[i] if 0 <= i < len(cur) else None
        else:
            return None
    return cur


def as_list(data: Any, path: str | None) -> list[Any]:
    node = dig(data, path) if path else data
    if isinstance(node, list):
        return node
    if node is None:
        return []
    return [node]


def subst(template: str, rec: dict[str, Any]) -> str:
    def repl(m: re.Match[str]) -> str:
        val = dig(rec, m.group(1))
        return "" if val is None else str(val)

    return _PLACE.sub(repl, template)


def _text(val: Any, cap: int) -> str:
    if val is None:
        return ""
    return " ".join(str(val).split())[:cap]


def _https(url: str) -> str:
    href = (url or "").strip()
    return href[:500] if href.startswith("https://") else ""


def item_from_record(rec: dict[str, Any], fields: dict[str, Any]) -> dict[str, str] | None:
    title = _text(dig(rec, str(fields.get("title") or "title")), MAX_TITLE)
    caption = _text(dig(rec, str(fields.get("caption") or "summary")), MAX_SUMMARY)
    image = _https(str(dig(rec, str(fields.get("image") or "image")) or ""))
    if not image and fields.get("imageFallback"):
        image = _https(str(dig(rec, str(fields["imageFallback"])) or ""))
    if not image and fields.get("imageTemplate"):
        image = _https(subst(str(fields["imageTemplate"]), rec))
    link = str(dig(rec, str(fields.get("link") or "link")) or "").strip()
    if link and not link.startswith("http") and fields.get("linkTemplate"):
        link = subst(str(fields["linkTemplate"]), rec)
    if link.startswith("http://"):
        link = ""
    if not title and not image:
        return None
    row: dict[str, str] = {
        "title": title or (image.rsplit("/", 1)[-1] if image else ""),
        "summary": caption,
        "link": link[:500] if link.startswith("https://") else "",
        "published": _text(dig(rec, "published") or dig(rec, "date") or "", 40),
    }
    if image:
        row["image"] = image
    return row


def pass_filter(rec: dict[str, Any], item: dict[str, str], spec: str | None) -> bool:
    rule = (spec or "").strip()
    if not rule or rule in {"all", "*"}:
        return True
    if rule in {"has-image", "image", "pictured"}:
        return bool(item.get("image"))
    if "!=" in rule:
        key, _, want = rule.partition("!=")
        got = dig(rec, key.strip())
        return bool(got) if want.strip() == "" else str(got) != want.strip()
    if "=" in rule:
        key, _, want = rule.partition("=")
        return str(dig(rec, key.strip()) or "") == want.strip()
    return True


def project_items(data: Any, fields: dict[str, Any] | None) -> list[dict[str, str]]:
    """Turn a JSON payload into ``{title, summary, image, link}`` rows."""
    if not fields:
        return []
    rows = as_list(data, str(fields.get("list") or "") or None)
    items: list[dict[str, str]] = []
    for rec in rows[:MAX_ITEMS]:
        if not isinstance(rec, dict):
            continue
        item = item_from_record(rec, fields)
        if item and pass_filter(rec, item, fields.get("filter") if isinstance(fields.get("filter"), str) else None):
            items.append(item)
    return items


def expand_ids(data: Any, fields: dict[str, Any]) -> list[Any]:
    """List of ids (or records) to hydrate when ``expand`` is set."""
    rows = as_list(data, str(fields.get("list") or "") or None)
    cap = int(fields.get("expandCap") or MAX_EXPAND)
    return rows[: max(1, min(12, cap))]
