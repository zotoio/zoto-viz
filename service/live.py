"""Agent temper, AI-change weather, and live MCP patches for the open UI."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import paths

TEMPER_MIN = 0
TEMPER_MAX = 100
DEFAULT_TEMPER = 22
WEATHERS = ("hush", "drift", "pulse", "storm")
DEFAULT_WEATHER = "drift"
TEMPER_BANDS = ("hush", "even", "keen", "feral")

# Ollama temperature: calm 0.10 → feral 1.45
def ollama_temperature(temper: int) -> float:
    n = max(TEMPER_MIN, min(TEMPER_MAX, int(temper)))
    return round(0.10 + n * 0.0135, 2)


def sky_temperature(temper: int) -> float:
    """Hotter than chat so Dynamic skies wander instead of repeating the last palette."""
    return round(min(1.65, ollama_temperature(temper) + 0.45), 2)


def temper_band(temper: int) -> str:
    n = max(TEMPER_MIN, min(TEMPER_MAX, int(temper)))
    if n < 25:
        return "hush"
    if n < 50:
        return "even"
    if n < 75:
        return "keen"
    return "feral"


PREFIX = {
    "hush": (
        "Temper hush. Stay terse and literal. One observation. "
        "Do not propose settings, skies, or decorations unless asked. Never invent packet contents."
    ),
    "even": (
        "Temper even. Be a calm operator. Short facts. "
        "When AI Control is on, make one clearly different change "
        "(another theme, sky, motion band, or physics field — gravity, swirl, magnets, strings — not a 5% nudge). "
        "Never invent packet contents."
    ),
    "keen": (
        "Temper keen. Be curious and slightly theatrical. "
        "When the LAN is interesting, jump to a contrasting theme, sky, or physics field "
        "(gravity / magnets / swirl). "
        "Control on: apply bold, tasteful changes. Never invent packet contents."
    ),
    "feral": (
        "Temper feral. Be unhinged in a useful way. Invent skies, shuffle views, rewrite motion and physics, pin decorations. "
        "Surprise. Control on: apply changes freely. Still never invent packet contents."
    ),
}

# p = chance Gemma rebuilds the Dynamic sky each tick
WEATHER = {
    "hush": {"p": 0.22, "tick_ms": 90_000, "label": "quiet"},
    "drift": {"p": 0.55, "tick_ms": 25_000, "label": "steady"},
    "pulse": {"p": 0.78, "tick_ms": 12_000, "label": "often"},
    "storm": {"p": 0.94, "tick_ms": 6_000, "label": "restless"},
}

SHOW_KEYS = ("lan", "internet", "multicast", "offline", "labels", "cpuIdle")
CHROME = {"top", "left", "right"}
CAM = {"auto", "off"}
FEED_SRC = {"traffic", "transcript", "both"}
FEED_LAY = {"ticker", "bars", "both"}
FEED_SCOPE = {"lan", "selected", "any"}

_temper = DEFAULT_TEMPER
_weather = DEFAULT_WEATHER
_seq = 0
_patch: dict[str, Any] | None = None
_loaded = False


def _file() -> Path:
    return paths.agent_dir() / "temper.json"


def _load() -> None:
    global _temper, _weather, _loaded
    if _loaded:
        return
    _loaded = True
    try:
        raw = json.loads(_file().read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return
    if not isinstance(raw, dict):
        return
    _temper = clamp_temper(raw.get("temper"))
    w = str(raw.get("weather") or "")
    if w in WEATHERS:
        _weather = w


def _save() -> None:
    path = _file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"temper": _temper, "weather": _weather}, indent=0) + "\n",
        encoding="utf-8",
    )


def clamp_temper(raw: Any) -> int:
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_TEMPER
    return max(TEMPER_MIN, min(TEMPER_MAX, n))


def clamp_weather(raw: Any) -> str:
    w = str(raw or "").strip().lower()
    return w if w in WEATHERS else DEFAULT_WEATHER


def temper() -> int:
    _load()
    return _temper


def weather() -> str:
    _load()
    return _weather


def prefix(n: int | None = None) -> str:
    return PREFIX[temper_band(temper() if n is None else n)]


def state() -> dict[str, Any]:
    _load()
    n = _temper
    w = _weather
    meta = WEATHER[w]
    return {
        "temper": n,
        "band": temper_band(n),
        "prefix": prefix(n),
        "temperature": ollama_temperature(n),
        "skyTemperature": sky_temperature(n),
        "weather": w,
        "p": meta["p"],
        "tickMs": meta["tick_ms"],
        "weatherLabel": meta["label"],
    }


def snapshot() -> dict[str, Any]:
    """Attached to the 1 Hz WebSocket state as `live`."""
    out = state()
    out["seq"] = _seq
    if _patch is not None:
        out["patch"] = _patch
    return out


def set_temper(n: Any, *, bump: bool = False) -> dict[str, Any]:
    global _temper
    _load()
    nxt = clamp_temper(n)
    if nxt != _temper:
        _temper = nxt
        _save()
        if bump:
            _bump({"temper": nxt})
    elif bump:
        _bump({"temper": nxt})
    return state()


def set_weather(w: Any, *, bump: bool = False) -> dict[str, Any]:
    global _weather
    _load()
    nxt = clamp_weather(w)
    if nxt != _weather:
        _weather = nxt
        _save()
        if bump:
            _bump({"weather": nxt})
    elif bump:
        _bump({"weather": nxt})
    return state()


def queue_patch(patch: dict[str, Any]) -> dict[str, Any]:
    extra: dict[str, Any] = {}
    if "temper" in patch:
        extra["temper"] = set_temper(patch["temper"])["temper"]
    if "weather" in patch:
        extra["weather"] = set_weather(patch["weather"])["weather"]
    body = {k: v for k, v in patch.items() if k not in {"temper", "weather"}}
    merged = {**body, **extra} if extra else body
    if merged:
        _bump(merged)
    return snapshot()


def _bump(patch: dict[str, Any]) -> None:
    global _seq, _patch
    _seq += 1
    _patch = patch


def reset_for_tests() -> None:
    global _temper, _weather, _seq, _patch, _loaded
    _temper = DEFAULT_TEMPER
    _weather = DEFAULT_WEATHER
    _seq = 0
    _patch = None
    _loaded = True


def sanitize_patch(raw: Any) -> dict[str, Any]:
    """Whitelist a settings/MCP patch. Unknown keys dropped."""
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    theme = raw.get("theme")
    if isinstance(theme, str) and theme.strip():
        out["theme"] = theme.strip()[:32]
    if isinstance(raw.get("dream"), bool):
        out["dream"] = raw["dream"]
    if raw.get("camera") in CAM:
        out["camera"] = raw["camera"]
    if raw.get("mic") in CAM:
        out["mic"] = raw["mic"]
    if raw.get("chrome") in CHROME:
        out["chrome"] = raw["chrome"]
    mode = raw.get("mode")
    if isinstance(mode, str) and 0 < len(mode) <= 48:
        out["mode"] = mode
    if isinstance(raw.get("redact"), bool):
        out["redact"] = raw["redact"]
    if isinstance(raw.get("merge"), bool):
        out["merge"] = raw["merge"]
    feed = _feed(raw.get("feed"))
    if feed:
        out["feed"] = feed
    show = _bool_map(raw.get("show"), SHOW_KEYS)
    if show:
        out["show"] = show
    filters = _str_map(raw.get("filters"), ("allowNames", "blockNames", "allowNets", "blockNets"), 400)
    if filters:
        out["filters"] = filters
    anim = _anim(raw.get("anim"))
    if anim:
        out["anim"] = anim
    mode_opts = _nested(raw.get("modeOptions"))
    if mode_opts:
        out["modeOptions"] = mode_opts
    arcade = _flat(raw.get("arcade"))
    if arcade:
        out["arcade"] = arcade
    plugins = _nested(raw.get("plugins"))
    if plugins:
        out["plugins"] = plugins
    if "temper" in raw:
        out["temper"] = clamp_temper(raw.get("temper"))
    if "weather" in raw:
        out["weather"] = clamp_weather(raw.get("weather"))
    if isinstance(raw.get("control"), bool):
        out["control"] = raw["control"]
    if isinstance(raw.get("model"), str) and raw["model"].strip():
        out["model"] = raw["model"].strip()[:64]
    return out


def _feed(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    if isinstance(raw.get("on"), bool):
        out["on"] = raw["on"]
    if raw.get("source") in FEED_SRC:
        out["source"] = raw["source"]
    if raw.get("layout") in FEED_LAY:
        out["layout"] = raw["layout"]
    if raw.get("scope") in FEED_SCOPE:
        out["scope"] = raw["scope"]
    if isinstance(raw.get("modulate"), bool):
        out["modulate"] = raw["modulate"]
    dens = _num(raw.get("density"), 12, 80)
    if dens is not None:
        out["density"] = dens
    size = _num(raw.get("textSize"), 10, 20)
    if size is not None:
        out["textSize"] = size
    return out


def _anim(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    for k, v in list(raw.items())[:40]:
        key = str(k)[:32]
        if isinstance(v, bool):
            out[key] = v
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            out[key] = float(v) if not isinstance(v, int) else int(v)
        elif isinstance(v, str) and len(v) <= 48:
            out[key] = v
    return out


def _bool_map(raw: Any, keys: tuple[str, ...]) -> dict[str, bool]:
    if not isinstance(raw, dict):
        return {}
    return {k: bool(raw[k]) for k in keys if k in raw and isinstance(raw[k], bool)}


def _str_map(raw: Any, keys: tuple[str, ...], cap: int) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for k in keys:
        if isinstance(raw.get(k), str):
            out[k] = raw[k][:cap]
    return out


def _flat(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for k, v in list(raw.items())[:40]:
        if isinstance(v, (str, int, float, bool)):
            out[str(k)[:64]] = str(v)[:200]
    return out


def _nested(raw: Any) -> dict[str, dict[str, str]]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, dict[str, str]] = {}
    for k, v in list(raw.items())[:40]:
        inner = _flat(v)
        if inner:
            out[str(k)[:48]] = inner
    return out


def _num(raw: Any, lo: float, hi: float) -> float | None:
    try:
        n = float(raw)
    except (TypeError, ValueError):
        return None
    if n != n:
        return None
    return max(lo, min(hi, n))


def features() -> dict[str, Any]:
    """Catalog of MCP-settable keys."""
    return {
        "settings": [
            "theme", "dream", "mode", "chrome", "camera", "mic", "redact", "merge",
            "feed", "show", "filters", "anim", "modeOptions", "arcade", "plugins",
        ],
        "agent": {
            "temper": {"min": TEMPER_MIN, "max": TEMPER_MAX, "default": DEFAULT_TEMPER, "bands": list(TEMPER_BANDS)},
            "weather": {"values": list(WEATHERS), "default": DEFAULT_WEATHER, "odds": {
                k: {"p": v["p"], "tickMs": v["tick_ms"], "label": v["label"]} for k, v in WEATHER.items()
            }},
            "control": {"type": "boolean"},
            "model": {"type": "string"},
        },
        "plugins": "list_plugins / set_plugin — options, config, prompt per catalog id",
        "view": "set_view { mode }",
        "install": "install_plugin_zip { zip_b64, overwrite?, force? }",
    }
