"""Outbound HTTP headers for public feed, still, and catalog fetches.

Wikimedia and Wikipedia reject requests without a descriptive ``User-Agent``
(HTTP 403: `Please set a user-agent` — see T400119). aiohttp ``ClientSession``
defaults send no ``User-Agent``, so every outbound GET must set one explicitly
or on the session.
"""
from __future__ import annotations

from urllib.parse import urlparse

USER_AGENT = (
    "zoto-viz/0.1.0 (+https://github.com/zotoio/zoto-viz; carousel/source polling)"
)
FEED_ACCEPT = "application/rss+xml, application/atom+xml, application/json, text/xml, */*"
IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"

_WIKI_HOSTS = frozenset({"wikimedia.org", "wikipedia.org"})
_WIKI_SUFFIXES = (".wikimedia.org", ".wikipedia.org")


def _host(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""


def is_wikimedia_host(url: str) -> bool:
    host = _host(url)
    return host in _WIKI_HOSTS or any(host.endswith(s) for s in _WIKI_SUFFIXES)


def outbound_headers(url: str, *, accept: str | None = None) -> dict[str, str]:
    """Headers for a single GET to a public URL."""
    headers: dict[str, str] = {"User-Agent": USER_AGENT}
    if accept:
        headers["Accept"] = accept
    host = _host(url)
    if host:
        headers.setdefault("Referer", f"https://{host}/")
    return headers


def feed_session_headers() -> dict[str, str]:
    """Default headers for the shared RSS/JSON source ``ClientSession``."""
    return {"User-Agent": USER_AGENT, "Accept": FEED_ACCEPT}
