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
CHROME = ("top", "left", "right")
FEED_SRC = ("traffic", "transcript", "both")
FEED_LAY = ("ticker", "bars", "both")
FEED_SCOPE = ("lan", "selected", "any")
THEMES = (
    "midnight", "ocean", "nord", "dracula", "solarized",
    "gruvbox", "ember", "neon", "tactical", "paper",
    "dusk", "void", "vhs", "acid", "ice", "phosphor",
)
BACKDROPS = (
    "none", "fractal", "space", "matrix", "live", "aurora", "rain", "ocean",
    "fire", "warp", "clouds", "circuit", "plasma", "lattice",
    "dusk", "void", "vhs", "nebula", "acid", "ice", "dawn", "phosphor",
    "earth", "meadow", "tunnel",
    "bomb", "reef", "tornado", "desert", "amazon",
    "aquarium", "macaws", "ruins", "fungi",
    "dynamic", "custom", "plugin",
)
FLOOR_SHAPES = ("square", "hex", "triangle", "diamond", "circle")
AUDIO_DRIVES = ("mic", "traffic", "node")
THEME_CYCLES = ("off", "cadence", "audio")
EDGE_GLOWS = ("off", "comet", "pulse")
FABRIC_KINDS = (
    "auto", "off",
    "tubes", "cloth", "crystals", "voxels", "neon", "beads", "pillars", "orbit", "wire", "lattice",
    "ribbon", "dots", "constellation", "hex", "circuit", "ink", "map", "tiles", "mosaic",
)
GRAPH_SPACES = ("auto", "space", "plane")
GRAPH_LAYOUTS = (
    "auto", "force", "tree", "radial", "concentric", "cluster", "dag", "globe", "bars", "scatter",
    "helix", "vortex", "bloom", "ripple", "weave", "cascade", "knot", "hourglass", "coral",
    "tide", "mobius", "spine", "halo", "fold", "drift",
    "sierpinski", "hilbert", "koch", "julia",
    "spectrum", "waterfall", "carrier", "phased",
    "heap", "trie", "hashmap", "matrix", "queue",
)
GRAPH_LINKS = ("auto", "arrows", "bundle", "both")
MOSAIC_SIZES = ("off", "4", "6", "8")
HERO_POS = ("off", "left", "center", "right")
FOCUS_MODES = ("activity", "motion", "cloud", "selection")
DICE_INCLUDE = (
    "theme", "view", "mosaic", "feed",
    "motion", "style", "physics", "knobs", "show",
)
DICE_MOSAIC_MAX = ("4", "6", "8")
ANIM_BOOL = (
    "follow", "cycle", "randomize", "skyAudio", "bgAudio", "gridAudio",
    "audioCamera", "camTheme", "audioNodes", "audioPhysics", "audioParts", "autoTune",
    "mosaicSharedTheme", "mosaicUniqueSkies",
)
# mirrors web/src/graph/scene.ts DREAM_BOUNDS (plus shared opacity/bright/magnet aliases)
ANIM_NUM: dict[str, dict[str, float]] = {
    "yawPeriod": {"min": 40, "max": 480, "step": 10},
    "pitchDeg": {"min": 0, "max": 20, "step": 1},
    "pitchPeriod": {"min": 6, "max": 40, "step": 1},
    "zoom": {"min": 0, "max": 0.7, "step": 0.05},
    "zoomPeriod": {"min": 15, "max": 180, "step": 5},
    "cyclePeriod": {"min": 15, "max": 180, "step": 5},
    "skyOpacity": {"min": 0, "max": 1, "step": 0.05},
    "skyBright": {"min": 0, "max": 2, "step": 0.05},
    "skySpeed": {"min": 0, "max": 4, "step": 0.05},
    "skyEase": {"min": 0, "max": 1, "step": 0.05},
    "skyAiMin": {"min": 1, "max": 30, "step": 1},
    "bgOpacity": {"min": 0, "max": 1, "step": 0.05},
    "gridOpacity": {"min": 0, "max": 1, "step": 0.05},
    "gridBright": {"min": 0, "max": 2, "step": 0.05},
    "gridSize": {"min": 16, "max": 160, "step": 4},
    "gridFollow": {"min": 0, "max": 1, "step": 0.05},
    "audioSens": {"min": 0, "max": 2, "step": 0.05},
    "camAudio": {"min": 0, "max": 2, "step": 0.05},
    "camChange": {"min": 0, "max": 2, "step": 0.05},
    "camGaze": {"min": 0, "max": 2, "step": 0.05},
    "camInertia": {"min": 0, "max": 1, "step": 0.05},
    "moveEase": {"min": 0, "max": 1, "step": 0.05},
    "labelWeight": {"min": 0.5, "max": 2, "step": 0.05},
    "labelCount": {"min": 8, "max": 120, "step": 4},
    "nodeWeight": {"min": 0.4, "max": 2.5, "step": 0.05},
    "edgeWeight": {"min": 0.3, "max": 2.5, "step": 0.05},
    "edgeGlowAmt": {"min": 0.2, "max": 2, "step": 0.05},
    "edgeGlowSpeed": {"min": 0.25, "max": 3, "step": 0.05},
    "partAmt": {"min": 0, "max": 2, "step": 0.05},
    "partBusy": {"min": 0.25, "max": 3, "step": 0.05},
    "partQuiet": {"min": 0, "max": 4000, "step": 50},
    "partPeak": {"min": 1, "max": 80, "step": 1},
    "partCap": {"min": 20, "max": 4000, "step": 20},
    "partSpeed": {"min": 0.25, "max": 3, "step": 0.05},
    "partSize": {"min": 0.3, "max": 2.5, "step": 0.05},
    "magnetSelf": {"min": -1, "max": 1, "step": 0.05},
    "magnetGateway": {"min": -1, "max": 1, "step": 0.05},
    "magnetLan": {"min": -1, "max": 1, "step": 0.05},
    "magnetLocal": {"min": -1, "max": 1, "step": 0.05},
    "magnetInternet": {"min": -1, "max": 1, "step": 0.05},
    "magnetMulticast": {"min": -1, "max": 1, "step": 0.05},
    "magnetCross": {"min": -1, "max": 1, "step": 0.05},
    "magnetRange": {"min": 0.15, "max": 2, "step": 0.05},
    "gravity": {"min": 0, "max": 2, "step": 0.05},
    "swirl": {"min": 0, "max": 2, "step": 0.05},
    "chargeAmt": {"min": 0, "max": 2, "step": 0.05},
    "spring": {"min": 0, "max": 2, "step": 0.05},
    "linkSpan": {"min": 0.4, "max": 2.5, "step": 0.05},
    "drag": {"min": 0.12, "max": 0.7, "step": 0.01},
    "centerPull": {"min": 0, "max": 2, "step": 0.05},
    "stringAmt": {"min": 0, "max": 1, "step": 0.05},
}
ANIM_ENUM = {
    "backdrop": BACKDROPS,
    "gridShape": FLOOR_SHAPES,
    "audioDrive": AUDIO_DRIVES,
    "themeCycle": THEME_CYCLES,
    "skyCycle": THEME_CYCLES,
    "edgeGlow": EDGE_GLOWS,
    "graphFabric": FABRIC_KINDS,
    "graphSpace": GRAPH_SPACES,
    "graphLayout": GRAPH_LAYOUTS,
    "graphLinks": GRAPH_LINKS,
    "mosaic": MOSAIC_SIZES,
    "hero": HERO_POS,
    "focus": FOCUS_MODES,
}
ANIM_STR = ("bgColor", "gridColor")
ANIM_CAP = 120
MOSAIC_TREE_DEPTH = 8
MOSAIC_TILE_CAP = 8
MAP_CAP = 80

_temper = DEFAULT_TEMPER
_weather = DEFAULT_WEATHER
_seq = 0
_patch: dict[str, Any] | None = None
_loaded = False
_autoconsent: bool | None = None


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
    if "autoconsent" in patch:
        set_autoconsent(bool(patch["autoconsent"]))
    body = {k: v for k, v in patch.items() if k not in {"temper", "weather"}}
    merged = {**body, **extra} if extra else body
    if merged:
        _bump(merged)
    return snapshot()


def _bump(patch: dict[str, Any]) -> None:
    global _seq, _patch
    _seq += 1
    _patch = patch


def autoconsent_on() -> bool:
    """Operator toggle: auto-grant consent for shipped src and local plugins."""
    global _autoconsent
    if _autoconsent is not None:
        return _autoconsent
    try:
        from . import profiles
        return bool(profiles.current_settings().get("autoconsent"))
    except Exception:
        return False


def set_autoconsent(on: bool) -> None:
    global _autoconsent
    _autoconsent = bool(on)


def reset_for_tests() -> None:
    global _temper, _weather, _seq, _patch, _loaded, _autoconsent
    _temper = DEFAULT_TEMPER
    _weather = DEFAULT_WEATHER
    _seq = 0
    _patch = None
    _loaded = True
    _autoconsent = False


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
    if raw.get("chrome") in CHROME:
        out["chrome"] = raw["chrome"]
    mode = raw.get("mode")
    if isinstance(mode, str) and 0 < len(mode) <= 48:
        out["mode"] = mode
    if isinstance(raw.get("redact"), bool):
        out["redact"] = raw["redact"]
    if isinstance(raw.get("merge"), bool):
        out["merge"] = raw["merge"]
    if isinstance(raw.get("autoconsent"), bool):
        out["autoconsent"] = raw["autoconsent"]
    if isinstance(raw.get("sound"), bool):
        out["sound"] = raw["sound"]
    feed = _feed(raw.get("feed"))
    if feed:
        if feed.get("source") in ("transcript", "both"):
            out["chat"] = {**out.get("chat", {}), "on": True}
            feed["source"] = "traffic"
        out["feed"] = feed
    chat = _chat(raw.get("chat"))
    if chat:
        out["chat"] = {**out.get("chat", {}), **chat}
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
    if raw.get("shuffle") is True:
        out["shuffle"] = True
    if raw.get("reloadPlugins") is True:
        out["reloadPlugins"] = True
    pc = raw.get("pluginConsent")
    if isinstance(pc, dict):
        pid = pc.get("id")
        kind = pc.get("kind")
        if isinstance(pid, str) and pid.strip() and kind in {"reviewed", "authored"}:
            out["pluginConsent"] = {"id": pid.strip()[:64], "kind": kind}
    if raw.get("reloadClient") is True:
        out["reloadClient"] = True
    dice = _dice(raw.get("dice"))
    if dice:
        out["dice"] = dice
    agent_look = _agent(raw.get("agent"))
    if agent_look:
        out["agent"] = agent_look
    return out


def _chat(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    if isinstance(raw.get("on"), bool):
        out["on"] = raw["on"]
    size = _num(raw.get("textSize"), 10, 20)
    if size is not None:
        out["textSize"] = size
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
    if isinstance(raw.get("includeSources"), bool):
        out["includeSources"] = raw["includeSources"]
    dens = _num(raw.get("density"), 12, 80)
    if dens is not None:
        out["density"] = dens
    size = _num(raw.get("textSize"), 10, 20)
    if size is not None:
        out["textSize"] = size
    return out


def _chat(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    if isinstance(raw.get("on"), bool):
        out["on"] = raw["on"]
    size = _num(raw.get("textSize"), 10, 20)
    if size is not None:
        out["textSize"] = size
    return out


def _dice(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    include = _bool_map(raw.get("include"), DICE_INCLUDE)
    if include:
        out["include"] = include
    if isinstance(raw.get("on"), bool):
        out["on"] = raw["on"]
    period = _num(raw.get("periodMin"), 1, 60)
    if period is not None:
        out["periodMin"] = int(period)
    out["handoff"] = False
    if isinstance(raw.get("cycle"), bool):
        out["cycle"] = raw["cycle"]
    if raw.get("mosaicMax") in DICE_MOSAIC_MAX:
        out["mosaicMax"] = raw["mosaicMax"]
    labels = _num(raw.get("labelsMax"), 8, 120)
    if labels is not None:
        out["labelsMax"] = int(labels)
    sparks = _num(raw.get("sparksMax"), 20, 3000)
    if sparks is not None:
        out["sparksMax"] = int(sparks)
    peak = _num(raw.get("sparkPeak"), 1, 80)
    if peak is not None:
        out["sparkPeak"] = int(peak)
    dens = _num(raw.get("feedDensityMax"), 12, 80)
    if dens is not None:
        out["feedDensityMax"] = int(dens)
    top = _num(raw.get("nodeTop"), 8, 80)
    if top is not None:
        out["nodeTop"] = int(top)
    return out


def _anim(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    for k, v in list(raw.items())[:ANIM_CAP]:
        key = str(k)[:32]
        if key in ANIM_BOOL and isinstance(v, bool):
            out[key] = v
        elif key in ANIM_NUM and isinstance(v, (int, float)) and not isinstance(v, bool):
            b = ANIM_NUM[key]
            n = float(v) if not isinstance(v, int) else int(v)
            lo, hi = b["min"], b["max"]
            out[key] = max(lo, min(hi, n))
        elif key in ANIM_ENUM and isinstance(v, str) and v in ANIM_ENUM[key]:
            out[key] = v
        elif key in ANIM_STR and isinstance(v, str) and len(v) <= 48:
            out[key] = v
        elif isinstance(v, bool) and key not in ANIM_NUM:
            out[key] = v
        elif isinstance(v, (int, float)) and not isinstance(v, bool) and key not in ANIM_ENUM:
            out[key] = float(v) if not isinstance(v, int) else int(v)
        elif key == "mosaicTree":
            node = _mosaic_node(v)
            if node:
                out["mosaicTree"] = node
        elif key == "mosaicTiles" and isinstance(v, list):
            tiles: list[str] = []
            seen: set[str] = set()
            for row in v[:MOSAIC_TILE_CAP]:
                if not isinstance(row, str) or not row.strip():
                    continue
                tid = row.strip()[:80]
                if tid in seen:
                    continue
                seen.add(tid)
                tiles.append(tid)
            if tiles:
                out["mosaicTiles"] = tiles
        elif key == "mosaicMaxId" and isinstance(v, str) and v.strip():
            out["mosaicMaxId"] = v.strip()[:80]
        elif key == "mosaicSkies" and isinstance(v, dict):
            skies: dict[str, str] = {}
            for tid, sky in list(v.items())[:16]:
                if not isinstance(tid, str) or not isinstance(sky, str):
                    continue
                kind = sky.strip()
                if kind in BACKDROPS:
                    skies[tid.strip()[:80]] = kind
            if skies:
                out["mosaicSkies"] = skies
        elif isinstance(v, str) and len(v) <= 48 and key not in ANIM_ENUM:
            out[key] = v
    return out


def _mosaic_node(raw: Any, depth: int = 0) -> dict[str, Any] | None:
    if not isinstance(raw, dict) or depth > MOSAIC_TREE_DEPTH:
        return None
    kind = raw.get("type")
    if kind == "leaf" and isinstance(raw.get("id"), str) and raw["id"].strip():
        return {"type": "leaf", "id": raw["id"].strip()[:80]}
    if kind == "split" and raw.get("dir") in ("h", "v"):
        a = _mosaic_node(raw.get("a"), depth + 1)
        b = _mosaic_node(raw.get("b"), depth + 1)
        if not a or not b:
            return None
        try:
            ratio = float(raw.get("ratio", 0.5))
        except (TypeError, ValueError):
            ratio = 0.5
        if ratio != ratio:
            ratio = 0.5
        ratio = max(0.12, min(0.88, ratio))
        return {"type": "split", "dir": raw["dir"], "ratio": ratio, "a": a, "b": b}
    return None


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
    for k, v in list(raw.items())[:MAP_CAP]:
        if isinstance(v, (str, int, float, bool)):
            out[str(k)[:64]] = str(v)[:200]
    return out


def _nested(raw: Any) -> dict[str, dict[str, str]]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, dict[str, str]] = {}
    for k, v in list(raw.items())[:MAP_CAP]:
        inner = _flat(v)
        if inner:
            out[str(k)[:48]] = inner
    return out


def _agent(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    if isinstance(raw.get("clear"), bool):
        out["clear"] = raw["clear"]
    shader = raw.get("shader")
    if isinstance(shader, str) and shader.strip():
        out["shader"] = shader[:16_000]
    photo = raw.get("shaderPhoto")
    if isinstance(photo, str) and photo.strip():
        out["shaderPhoto"] = photo.strip()[:64]
    decos = raw.get("decos")
    if isinstance(decos, list):
        cleaned: list[dict[str, Any]] = []
        for row in decos[:24]:
            if not isinstance(row, dict):
                continue
            kind = row.get("kind")
            src = row.get("src")
            did = row.get("id")
            if kind not in {"photo", "svg"} or not isinstance(src, str) or not isinstance(did, str):
                continue
            item: dict[str, Any] = {
                "id": did.strip()[:40],
                "kind": kind,
                "src": src.strip()[:2000],
            }
            at = row.get("at")
            if at in {"selected", "internet", "origin"}:
                item["at"] = at
            elif isinstance(at, list) and len(at) >= 3:
                try:
                    item["at"] = [float(at[0]), float(at[1]), float(at[2])]
                except (TypeError, ValueError):
                    item["at"] = "internet"
            if isinstance(row.get("label"), str) and row["label"].strip():
                item["label"] = row["label"].strip()[:80]
            if item["id"] and item["src"]:
                cleaned.append(item)
        if cleaned:
            out["decos"] = cleaned
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
            "theme", "dream", "mode", "chrome", "redact", "merge", "autoconsent", "sound",
            "feed", "chat", "show", "filters", "anim", "modeOptions", "arcade", "plugins",
            "agent", "dice", "shuffle", "temper", "weather", "control", "model",
            "sources",
            "sdm",
        ],
        "theme": {"values": list(THEMES)},
        "chrome": {"values": list(CHROME)},
        "show": {"keys": list(SHOW_KEYS), "type": "boolean"},
        "filters": {"keys": ["allowNames", "blockNames", "allowNets", "blockNets"]},
        "feed": {
            "on": {"type": "boolean"},
            "source": {"values": list(FEED_SRC)},
            "layout": {"values": list(FEED_LAY)},
            "scope": {"values": list(FEED_SCOPE)},
            "modulate": {"type": "boolean"},
            "includeSources": {"type": "boolean", "hint": "RSS / HTTP / file headlines on the feed ticker"},
            "density": {"min": 12, "max": 80},
            "textSize": {"min": 10, "max": 20},
        },
        "anim": {
            "bool": list(ANIM_BOOL),
            "number": ANIM_NUM,
            "enum": {k: list(v) for k, v in ANIM_ENUM.items()},
            "string": list(ANIM_STR),
            "mosaicTree": "split tree ({type, dir, ratio, a, b} or {type:leaf, id})",
            "mosaicTiles": "view ids in leaf order (AI may set these when mosaic layout is locked)",
            "mosaicMaxId": "maximized tile view id",
            "mosaicSkies": "per-tile backdrop when mosaicUniqueSkies is on (plugin tiles stay plugin)",
        },
        "look": {
            "shader": "GLSL fragment (vec3 color or void main)",
            "shaderPhoto": "asset id",
            "decos": "photo/svg pins ({id, kind, src, at, label?})",
            "clear": {"type": "boolean"},
        },
        "sources": {
            "kinds": ["rss", "http", "file"],
            "hint": "host RSS / HTTPS / local-file registry (~/.zoto-viz/sources.yml); list_sources / set_source / delete_source; plugin instances reuse a view tree",
        },
        "sdm": {
            "hint": "Google Nest Device Access (~/.zoto-viz/sdm.yml). list_cameras / get_sdm / set_sdm. OAuth + Pub/Sub + WebRTC.",
        },
        "shuffle": {"type": "boolean", "hint": "roll_dice — groups on Settings → Dice"},
        "sound": {"type": "boolean", "default": False, "hint": "speaker output: plugin SFX, arcade, spoken replies. Starts off."},
        "dice": {
            "roll_dice": "one-shot roll; respects include + ceilings on Settings → Dice",
            "on": {"type": "boolean", "default": False, "hint": "header dice repeat switch"},
            "periodMin": {"min": 1, "max": 60, "default": 5, "hint": "minutes between automatic rolls while on"},
            "include": {"keys": list(DICE_INCLUDE), "type": "boolean", "default": True},
            "handoff": {"type": "boolean", "hint": "ignored — a roll never starts a chat turn"},
            "cycle": {"type": "boolean", "hint": "dream + view cycling + AI Control after a roll"},
            "labelsMax": {"min": 8, "max": 120, "default": 48},
            "sparksMax": {"min": 20, "max": 3000, "default": 800},
            "sparkPeak": {"min": 1, "max": 80, "default": 48},
            "mosaicMax": {"values": list(DICE_MOSAIC_MAX), "default": "6"},
            "feedDensityMax": {"min": 12, "max": 80, "default": 48},
            "nodeTop": {"min": 8, "max": 80, "default": 40},
        },
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
        "install": "install_plugin_zip { zip_b64, overwrite?, force? } — repo contrib plugins/<id>.zip",
        "publish": (
            "publish_local_plugin { zip_b64 | files | description, overwrite?, activate? } "
            "— ~/.zoto-viz/plugins/local/<id>.zip, hot-load, activate if YAML-only / already consented"
        ),
        "draft": "draft_plugin { files, install? } — validate / write plugins/src/<id>/ when AI Control is on",
        "consent": "consent_plugin { id, kind: reviewed|authored }",
        "state": "get_state — live LAN snapshot",
        "traffic": "get_traffic { ip, peer?, since? }",
        "rf": "get_rf_watch / set_rf_watch { ssids, other?, dwell?, rotate? }",
        "profiles": "list_profiles / apply_profile { id }",
        "memories": "list_memories / add_memory { text } / delete_memory { id? }",
    }
