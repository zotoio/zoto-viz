"""Third-party public datasource recipes.

Plugins and Settings name these ids. They are not polled until something
materializes them (`set_source` `{library}` or POST `/api/sources`).
A recipe may `extends` another. A call may pass several ids to combine them,
then overlay interval / feed / url / fields on every row.
"""
from __future__ import annotations

from typing import Any

LIBRARY: list[dict[str, Any]] = [
    {
        "id": "open-meteo",
        "type": "http",
        "label": "Open-Meteo",
        "vendor": "Open-Meteo",
        "hint": "Current weather JSON. No key. Extend the url to move latitude and longitude.",
        "url": "https://api.open-meteo.com/v1/forecast?latitude=-33.87&longitude=151.21&current=temperature_2m,wind_speed_10m,weather_code",
        "interval": 600,
        "feed": False,
    },
    {
        "id": "sydney-meteo",
        "extends": "open-meteo",
        "label": "Sydney weather",
        "hint": "Open-Meteo pinned to Sydney.",
        "url": "https://api.open-meteo.com/v1/forecast?latitude=-33.87&longitude=151.21&current=temperature_2m,wind_speed_10m,weather_code",
    },
    {
        "id": "usgs-quakes",
        "type": "http",
        "label": "USGS earthquakes",
        "vendor": "USGS",
        "hint": "M4.5+ earthquakes in the last day. GeoJSON features.",
        "url": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson",
        "interval": 300,
        "feed": False,
        "fields": {
            "list": "features",
            "title": "properties.title",
            "caption": "properties.place",
            "link": "properties.url",
        },
    },
    {
        "id": "frankfurter",
        "type": "http",
        "label": "ECB exchange rates",
        "vendor": "Frankfurter",
        "hint": "European Central Bank rates via Frankfurter. No key.",
        "url": "https://api.frankfurter.app/latest",
        "interval": 3600,
        "feed": False,
    },
    {
        "id": "github-events",
        "type": "http",
        "label": "GitHub public events",
        "vendor": "GitHub",
        "hint": "Public event stream. Titles are the event type.",
        "url": "https://api.github.com/events",
        "interval": 120,
        "feed": False,
        "fields": {
            "title": "type",
            "caption": "actor.login",
        },
    },
    {
        "id": "coingecko",
        "type": "http",
        "label": "CoinGecko prices",
        "vendor": "CoinGecko",
        "hint": "Bitcoin and Ethereum spot prices in USD. No key.",
        "url": "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd",
        "interval": 300,
        "feed": False,
    },
    {
        "id": "spacex-latest",
        "type": "http",
        "label": "SpaceX latest launch",
        "vendor": "r/SpaceX API",
        "hint": "Latest launch JSON.",
        "url": "https://api.spacexdata.com/v4/launches/latest",
        "interval": 3600,
        "feed": False,
        "fields": {
            "title": "name",
            "caption": "details",
            "link": "links.webcast",
        },
    },
    {
        "id": "bbc-news",
        "type": "rss",
        "label": "BBC news",
        "vendor": "BBC",
        "hint": "BBC News front page RSS.",
        "url": "https://feeds.bbci.co.uk/news/rss.xml",
        "interval": 600,
        "feed": False,
    },
    {
        "id": "reddit-space",
        "type": "rss",
        "label": "Reddit r/space",
        "vendor": "Reddit",
        "hint": "r/space RSS.",
        "url": "https://www.reddit.com/r/space/.rss",
        "interval": 600,
        "feed": False,
    },
    {
        "id": "cisa-kev",
        "type": "http",
        "label": "CISA known exploited",
        "vendor": "CISA",
        "hint": "Known exploited vulnerabilities catalog.",
        "url": "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
        "interval": 3600,
        "feed": False,
        "fields": {
            "list": "vulnerabilities",
            "title": "cveID",
            "caption": "vulnerabilityName",
        },
    },
    {
        "id": "wikipedia-featured",
        "type": "rss",
        "label": "Wikipedia featured",
        "vendor": "Wikimedia",
        "hint": "English Wikipedia featured-article feed.",
        "url": "https://en.wikipedia.org/w/api.php?action=featuredfeed&feed=featured&feedformat=atom",
        "interval": 3600,
        "feed": False,
    },
]

# Static JSON from https://jsonlint.com/datasets/{slug}.json
# Featured rows are the useful reference sets. Every other dataset on that page stays selectable.
_JSONLINT: list[tuple[str, str, str, bool, str, str, str]] = [
    ("countries", "World countries", "Geographic", True, "countries", "name", "capital"),
    ("world-cities", "World cities", "Geographic", True, "cities", "name", "country"),
    ("airports", "World airports", "Geographic", True, "airports", "name", "city"),
    ("us-states-with-detail", "US states", "Geographic", True, "states", "name", "capital"),
    ("us-capitals", "US state capitals", "Geographic", False, "capitals", "capital", "state"),
    ("european-countries", "European countries", "Geographic", True, "countries", "name", "capital"),
    ("continents", "Continents", "Geographic", False, "continents", "name", "largest_country"),
    ("oceans", "Oceans", "Geographic", False, "oceans", "name", "max_depth_location"),
    ("rivers", "Rivers", "Geographic", False, "rivers", "name", "mouth"),
    ("mountains", "Mountains", "Geographic", False, "mountains", "name", "range"),
    ("http-status-codes", "HTTP status codes", "Reference", True, "status_codes", "message", "description"),
    ("timezones", "World timezones", "Reference", True, "timezones", "name", "utc_offset"),
    ("languages", "World languages", "Reference", True, "languages", "name", "native_name"),
    ("currencies", "World currencies", "Reference", True, "currencies", "name", "code"),
    ("planets", "Solar system planets", "Reference", True, "planets", "name", "type"),
    ("elements", "Chemical elements", "Reference", True, "elements", "name", "symbol"),
    ("programming-languages", "Programming languages", "Reference", True, "languages", "name", "creator"),
    ("file-extensions", "File extensions", "Reference", False, "extensions", "extension", "description"),
    ("colors", "Colors", "Reference", False, "colors", "name", "hex"),
    ("css-colors", "CSS named colors", "Reference", False, "colors", "name", "hex"),
    ("emoji-categories", "Emoji categories", "Reference", False, "categories", "name", ""),
    ("emoticons", "Emoticons", "Reference", False, "emoticons", "emoticon", "meaning"),
    ("holidays-us", "US holidays", "Reference", False, "holidays", "name", "date"),
    ("keyboard-shortcuts", "Keyboard shortcuts", "Reference", False, "shortcuts", "action", "category"),
    ("movie-genres", "Movie genres", "Reference", False, "genres", "name", "description"),
    ("music-genres", "Music genres", "Reference", False, "genres", "name", "parent"),
    ("nato-alphabet", "NATO phonetic alphabet", "Reference", False, "alphabet", "code", "phonetic"),
    ("regex-patterns", "Regex patterns", "Reference", False, "patterns", "name", "description"),
    ("sports-teams-nfl", "NFL teams", "Reference", False, "teams", "name", "city"),
    ("units-of-measurement", "Units of measurement", "Reference", False, "units", "name", "symbol"),
    ("zodiac-signs", "Zodiac signs", "Reference", False, "signs", "name", "element"),
    ("config-eslint", "ESLint config", "Configuration", False, "", "", ""),
    ("config-package", "package.json example", "Configuration", False, "", "", ""),
    ("config-prettier", "Prettier config", "Configuration", False, "", "", ""),
    ("config-tsconfig", "TypeScript config", "Configuration", False, "", "", ""),
    ("lorem-ipsum", "Lorem ipsum", "Testing", False, "", "", ""),
    ("test-edge-cases", "JSON edge cases", "Testing", False, "", "", ""),
    ("test-large-array", "Large array", "Testing", False, "items", "id", "value"),
    ("test-validation", "Validation samples", "Testing", False, "", "", ""),
    ("mock-comments", "Mock comments", "API Mocks", False, "comments", "author", "content"),
    ("mock-events", "Mock events", "API Mocks", False, "events", "title", "location"),
    ("mock-notifications", "Mock notifications", "API Mocks", False, "notifications", "message", "type"),
    ("mock-orders", "Mock orders", "API Mocks", False, "orders", "id", "status"),
    ("mock-posts", "Mock blog posts", "API Mocks", False, "posts", "title", "excerpt"),
    ("mock-products", "Mock products", "API Mocks", False, "products", "name", "category"),
    ("mock-transactions", "Mock transactions", "API Mocks", False, "transactions", "description", "type"),
    ("mock-users", "Mock users", "API Mocks", False, "users", "name", "email"),
]


def _jsonlint_row(spec: tuple[str, str, str, bool, str, str, str]) -> dict[str, Any]:
    slug, label, group, featured, list_key, title, caption = spec
    row: dict[str, Any] = {
        "id": f"jl-{slug}",
        "type": "http",
        "label": label,
        "vendor": "JSONLint",
        "group": group,
        "featured": featured,
        "hint": f"{label}. Static JSON from jsonlint.com/datasets/{slug}.",
        "url": f"https://jsonlint.com/datasets/{slug}.json",
        "interval": 86_400,
        "feed": False,
    }
    if list_key and title:
        fields: dict[str, str] = {"list": list_key, "title": title}
        if caption:
            fields["caption"] = caption
        row["fields"] = fields
    return row


LIBRARY.extend(_jsonlint_row(spec) for spec in _JSONLINT)

_BY_ID = {str(row["id"]): row for row in LIBRARY}

_OVERLAY_KEYS = ("label", "url", "path", "interval", "enabled", "feed", "fields", "unit")


def catalog() -> list[dict[str, Any]]:
    """Public rows for the settings list and MCP. No secrets."""
    out: list[dict[str, Any]] = []
    for row in LIBRARY:
        item = {
            "id": row["id"],
            "label": row.get("label") or row["id"],
            "hint": row.get("hint") or "",
            "vendor": row.get("vendor") or "",
            "type": _resolved_type(row["id"]),
        }
        if row.get("extends"):
            item["extends"] = row["extends"]
        if row.get("group"):
            item["group"] = row["group"]
        if row.get("featured"):
            item["featured"] = True
        out.append(item)
    return out


def _resolved_type(sid: str) -> str:
    seen: set[str] = set()
    cur: str | None = sid
    while cur and cur not in seen:
        seen.add(cur)
        row = _BY_ID.get(cur)
        if not row:
            return ""
        if row.get("type"):
            return str(row["type"])
        cur = str(row.get("extends") or "") or None
    return ""


def _fold(sid: str, into: dict[str, Any], seen: set[str]) -> None:
    if sid in seen:
        return
    row = _BY_ID.get(sid)
    if not row:
        raise ValueError(f"unknown source library {sid!r}")
    seen.add(sid)
    parent = row.get("extends")
    if parent:
        _fold(str(parent), into, seen)
    for key, value in row.items():
        if key in ("extends", "hint", "vendor"):
            continue
        into[key] = value


def _ids(spec: Any) -> list[str]:
    if isinstance(spec, str):
        text = spec.strip()
        return [text] if text else []
    if isinstance(spec, list):
        return [str(item).strip() for item in spec if str(item).strip()]
    raise ValueError("library must be an id or a list of ids")


def materialize(spec: Any, overlay: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Combine library ids, then apply the same overlay onto each row."""
    ids = _ids(spec)
    if not ids:
        raise ValueError("library id required")
    extra = {k: overlay[k] for k in _OVERLAY_KEYS if isinstance(overlay, dict) and k in overlay}
    rows: list[dict[str, Any]] = []
    for sid in ids:
        folded: dict[str, Any] = {"enabled": True, "feed": False}
        _fold(sid, folded, set())
        folded.update(extra)
        folded["id"] = sid
        rows.append(folded)
    return rows
