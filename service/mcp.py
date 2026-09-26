"""Loopback MCP (Streamable HTTP JSON) for zoto-viz.

POST /mcp — JSON-RPC initialize / tools/list / tools/call.
GET  /mcp — short discovery payload.
CSRF is skipped; Host must still be loopback.

Live tools (list_features, get_settings, set_settings, list_plugins, set_plugin,
set_view, set_agent, roll_dice) patch the open UI over the 1 Hz WebSocket ``live``
field. Also exposes LAN state, RF watch, plugin consent/draft, profiles,
memories, host data sources (RSS / HTTPS / local files / journal / kmsg), and Nest Device Access
cameras (OAuth / Pub/Sub / WebRTC). ``install_plugin_zip`` writes ``plugins/<id>.zip`` and unpacks into
``plugins/.runtime/<id>/``. ``publish_local_plugin`` writes
``~/.zoto-viz/plugins/local/<id>.zip`` and activates when the zip is safe.
Colliding ids remint. Neither tool ``git add`` / ``git commit``.
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any

from aiohttp import web

from . import access
from . import agent
from . import live
from . import memory
from . import paths
from . import plugin_migration as pmg
from . import plugin_zip as pz
from . import plugin_local
from . import plugins
from . import profiles

PROTOCOL = "2025-03-26"
SERVER_NAME = "zoto-viz-plugins"
SERVER_VERSION = "3"

PUBLISH_LOCAL_TOOL: dict[str, Any] = {
    "name": "publish_local_plugin",
    "description": (
        "Create or replace a plugin zip in the user-local drop zone "
        "(~/.zoto-viz/plugins/local/<id>.zip), unpack it, and activate the view when "
        "the zip contract + schema pass and the plugin is YAML-only (or already consented). "
        "Accepts a packed zip (zip_b64), a files tree, or a text description (mints a "
        "graph/topology overlay). Does not write into the git checkout. Colliding ids "
        "are reminted (id-2, …) instead of overwriting a shipped src tree or another zip. "
        "Loopback only."
    ),
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "zip_b64": {"type": "string", "description": "Base64-encoded plugin zip"},
            "files": {
                "type": "object",
                "additionalProperties": {"type": "string"},
                "description": "Plugin tree (plugin.yml required; optional visualisation.yml, frontend/, …)",
            },
            "description": {
                "type": "string",
                "description": "Natural-language brief, or a plugin.yml body starting with id:",
            },
            "yaml": {"type": "string", "description": "Lone plugin.yml body"},
            "id": {
                "type": "string",
                "description": (
                    "Preferred plugin id when minting from description. Slugged, then reminted "
                    "if that id is already in the catalog (unless overwrite updates that zip)."
                ),
            },
            "name": {"type": "string"},
            "engine": {
                "type": "string",
                "enum": [
                    "graph", "netpong", "invaders", "command", "frogger", "cpupong", "doom",
                    "waves", "orbits", "helix", "skyline", "pacman", "tetris", "portal", "carousel",
                ],
            },
            "base": {"type": "string", "description": "Graph wrap target when engine is graph"},
            "overwrite": {
                "type": "boolean",
                "default": False,
                "description": "Replace ~/.zoto-viz/plugins/local/<id>.zip when the sha256 differs",
            },
            "activate": {
                "type": "boolean",
                "default": True,
                "description": "Switch the open UI to plugin:<id> when the zip is safe",
            },
        },
    },
}

INSTALL_TOOL: dict[str, Any] = {
    "name": "install_plugin_zip",
    "description": (
        "Write a zoto-viz plugin zip into the contrib drop zone at plugins/<id>.zip and "
        "unpack it into plugins/.runtime/<id>/. Loopback only. A colliding id (shipped "
        "src tree or an existing zip) is reminted to <id>-2, … unless overwrite updates "
        "that same contrib zip. Never writes over plugins/src/<id>/. "
        "Refuses a dirty working tree on plugins/src/<id>/ unless force is true. "
        "Does not git-add or commit — return the written path and let the "
        "operator promote. Emits consent-required when TypeScript, Python, or GLSL is "
        "present and the current consent stamp does not cover the new hashes."
    ),
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["zip_b64"],
        "properties": {
            "zip_b64": {"type": "string", "description": "Base64-encoded plugin zip"},
            "overwrite": {
                "type": "boolean",
                "default": False,
                "description": "Replace plugins/<id>.zip when the incoming sha256 differs",
            },
            "force": {
                "type": "boolean",
                "default": False,
                "description": (
                    "Write even when plugins/src/<id>/ has uncommitted changes. "
                    "Does not override a shipped src tree."
                ),
            },
            "mirror": {
                "type": "boolean",
                "default": False,
                "description": "Ignored. Catalog install does not copy into a home-dir plugin tree.",
            },
        },
    },
}

LIST_FEATURES_TOOL: dict[str, Any] = {
    "name": "list_features",
    "description": (
        "Catalog of every MCP-settable zoto-viz key: theme, view, feed, show, filters, "
        "anim (motion/physics/mosaic/sky/audio), plugins, agent look, dice, temper/weather, "
        "sound, plus state, RF watch, consent, draft, profiles, memories, sources, and Nest cameras."
    ),
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

GET_SETTINGS_TOOL: dict[str, Any] = {
    "name": "get_settings",
    "description": (
        "Current agent temper/weather, queued live patch, and the startup profile's "
        "settings (theme, view, plugins, motion). Live UI may differ until a patch applies."
    ),
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

def _settings_schema() -> dict[str, Any]:
    anim_props: dict[str, Any] = {
        **{k: {"type": "boolean"} for k in live.ANIM_BOOL},
        **{k: {"type": "number", "minimum": b["min"], "maximum": b["max"]} for k, b in live.ANIM_NUM.items()},
        **{k: {"type": "string", "enum": list(v)} for k, v in live.ANIM_ENUM.items()},
        **{k: {"type": "string"} for k in live.ANIM_STR},
    }
    return {
        "type": "object",
        "additionalProperties": True,
        "properties": {
            "theme": {"type": "string", "enum": list(live.THEMES)},
            "dream": {"type": "boolean"},
            "mode": {"type": "string", "description": "Catalog view id, e.g. plugin:command"},
            "chrome": {"type": "string", "enum": list(live.CHROME)},
            "redact": {"type": "boolean"},
            "merge": {"type": "boolean"},
            "autoconsent": {
                "type": "boolean",
                "description": "Auto-grant source-review consent for shipped plugins/src and ~/.zoto-viz/plugins/local zips (not contrib zips).",
            },
            "sound": {
                "type": "boolean",
                "description": "Speaker output (plugin SFX, arcade, spoken replies). Starts off.",
            },
            "temper": {"type": "integer", "minimum": live.TEMPER_MIN, "maximum": live.TEMPER_MAX},
            "weather": {"type": "string", "enum": list(live.WEATHERS)},
            "control": {"type": "boolean", "description": "Server AI Control"},
            "model": {"type": "string", "description": "Ollama tag or Cursor SDK model id"},
            "shuffle": {"type": "boolean", "description": "One-shot dice roll (same as Settings → Dice roll now). Repeat uses dice.on + dice.periodMin."},
            "dice": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "on": {"type": "boolean", "description": "Header dice repeat switch"},
                    "periodMin": {"type": "integer", "minimum": 1, "maximum": 60, "description": "Minutes between automatic rolls while on"},
                    "include": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {k: {"type": "boolean"} for k in live.DICE_INCLUDE},
                    },
                    "handoff": {"type": "boolean"},
                    "cycle": {"type": "boolean"},
                    "labelsMax": {"type": "number", "minimum": 8, "maximum": 120},
                    "sparksMax": {"type": "number", "minimum": 20, "maximum": 3000},
                    "sparkPeak": {"type": "number", "minimum": 1, "maximum": 80},
                    "mosaicMax": {"type": "string", "enum": list(live.DICE_MOSAIC_MAX)},
                    "feedDensityMax": {"type": "number", "minimum": 12, "maximum": 80},
                    "nodeTop": {"type": "number", "minimum": 8, "maximum": 80},
                },
            },
            "feed": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "on": {"type": "boolean"},
                    "source": {"type": "string", "enum": list(live.FEED_SRC)},
                    "layout": {"type": "string", "enum": list(live.FEED_LAY)},
                    "scope": {"type": "string", "enum": list(live.FEED_SCOPE)},
                    "modulate": {"type": "boolean"},
                    "includeSources": {"type": "boolean"},
                    "density": {"type": "number", "minimum": 12, "maximum": 80},
                    "textSize": {"type": "number", "minimum": 10, "maximum": 20},
                },
            },
            "show": {
                "type": "object",
                "additionalProperties": False,
                "properties": {k: {"type": "boolean"} for k in live.SHOW_KEYS},
            },
            "filters": {
                "type": "object",
                "additionalProperties": False,
                "properties": {k: {"type": "string"} for k in ("allowNames", "blockNames", "allowNets", "blockNets")},
            },
            "anim": {"type": "object", "additionalProperties": True, "properties": anim_props},
            "modeOptions": {"type": "object", "additionalProperties": {"type": "object"}},
            "arcade": {"type": "object", "additionalProperties": {"type": "string"}},
            "plugins": {"type": "object", "additionalProperties": {"type": "object"}},
            "agent": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "clear": {"type": "boolean"},
                    "shader": {"type": "string"},
                    "shaderPhoto": {"type": "string"},
                    "decos": {"type": "array"},
                },
            },
        },
    }


SET_SETTINGS_TOOL: dict[str, Any] = {
    "name": "set_settings",
    "description": (
        "Patch the open live UI. Same whitelist as an agent ```settings``` fence: theme, dream, "
        "mode, chrome, redact, merge, autoconsent, sound (speaker output; starts off), feed, show, filters, anim (motion, physics, "
        "mosaic / mosaicTiles / mosaicTree, sky, audio), modeOptions, arcade, plugins, agent look (shader/photos/SVG), "
        "dice (on / periodMin / include groups + ceilings), shuffle (one-shot dice), plus temper, weather, control, model. "
        "Camera and microphone are operator-only (Settings → Privacy)."
    ),
    "inputSchema": _settings_schema(),
}

LIST_PLUGINS_TOOL: dict[str, Any] = {
    "name": "list_plugins",
    "description": (
        "Catalog views with options, config, and the per-view prompt field. "
        "Values come from the startup profile when present."
    ),
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "id": {"type": "string", "description": "Optional plugin id to return only that row"},
        },
    },
}

SET_PLUGIN_TOOL: dict[str, Any] = {
    "name": "set_plugin",
    "description": (
        "Set one catalog view's options/config/prompt on the live UI. "
        "Keys must exist on that plugin (including reserved prompt). "
        "Also writes modeOptions for plugin:<id>."
    ),
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["id", "values"],
        "properties": {
            "id": {"type": "string", "description": "Plugin id (not plugin: prefix)"},
            "values": {
                "type": "object",
                "additionalProperties": {"type": "string"},
                "description": "Knob key → string value (booleans as 0/1)",
            },
        },
    },
}

SET_VIEW_TOOL: dict[str, Any] = {
    "name": "set_view",
    "description": "Switch the live view. mode is a catalog id (plugin:<id> for zip views).",
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["mode"],
        "properties": {"mode": {"type": "string"}},
    },
}

SET_AGENT_TOOL: dict[str, Any] = {
    "name": "set_agent",
    "description": (
        "Agent temper (0–100, system-prompt prefix + Ollama temperature), "
        "weather (AI Dynamic rebuild probability bands: hush/drift/pulse/storm), "
        "and AI Control."
    ),
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "temper": {"type": "integer", "minimum": 0, "maximum": 100},
            "weather": {"type": "string", "enum": ["hush", "drift", "pulse", "storm"]},
            "control": {"type": "boolean"},
        },
    },
}

ROLL_DICE_TOOL: dict[str, Any] = {
    "name": "roll_dice",
    "description": (
        "One-shot roll of the groups left on in Settings → Dice "
        "(theme, view, mosaic, feed, motion, physics, knobs by default). Does not toggle the header dice repeat switch. "
        "Chrome, camera, and microphone stay. Privacy filters and prompts stay. "
        "Dream cycling + AI Control follow the dice settings. A roll does not start a chat or think turn."
    ),
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

GET_STATE_TOOL: dict[str, Any] = {
    "name": "get_state",
    "description": "Live LAN snapshot (devices, flows, radio) — same as GET /api/state.",
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

GET_TRAFFIC_TOOL: dict[str, Any] = {
    "name": "get_traffic",
    "description": (
        "Recent packets for a device or group. ip is an address, @lan, @internet, @any, or a comma list. "
        "Optional peer and since (unix seconds)."
    ),
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["ip"],
        "properties": {
            "ip": {"type": "string"},
            "peer": {"type": "string"},
            "since": {"type": "number"},
        },
    },
}

GET_RF_WATCH_TOOL: dict[str, Any] = {
    "name": "get_rf_watch",
    "description": "Wi-Fi SSID watch list, channel plan, and current radio tune.",
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

SET_RF_WATCH_TOOL: dict[str, Any] = {
    "name": "set_rf_watch",
    "description": "Adopt a Wi-Fi SSID watch list (Air SSIDs cog). Persists and rewrites the hopper plan.",
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "ssids": {"description": "String list or comma-separated names"},
            "other": {"type": "boolean"},
            "dwell": {"type": "number"},
            "rotate": {"type": "boolean"},
        },
    },
}

CONSENT_PLUGIN_TOOL: dict[str, Any] = {
    "name": "consent_plugin",
    "description": "Grant source-review consent so TypeScript / Python / GLSL for a catalog plugin can run.",
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["id", "kind"],
        "properties": {
            "id": {"type": "string"},
            "kind": {"type": "string", "enum": ["reviewed", "authored"]},
        },
    },
}

DRAFT_PLUGIN_TOOL: dict[str, Any] = {
    "name": "draft_plugin",
    "description": (
        "Validate a plugin-src tree ({files} or legacy yaml). With AI Control on and install true, "
        "writes plugins/src/<id>/. Never packs or git-commits."
    ),
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "files": {"type": "object", "additionalProperties": {"type": "string"}},
            "yaml": {"type": "string", "description": "Legacy lone plugin.yml body"},
            "install": {"type": "boolean", "default": False},
        },
    },
}

LIST_PROFILES_TOOL: dict[str, Any] = {
    "name": "list_profiles",
    "description": "Saved UI profiles (id, label, shipped, default).",
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

APPLY_PROFILE_TOOL: dict[str, Any] = {
    "name": "apply_profile",
    "description": "Load a saved profile onto the open live UI (same patch path as set_settings).",
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["id"],
        "properties": {"id": {"type": "string"}},
    },
}

LIST_MEMORIES_TOOL: dict[str, Any] = {
    "name": "list_memories",
    "description": "Curated agent memories injected into later chat turns.",
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

ADD_MEMORY_TOOL: dict[str, Any] = {
    "name": "add_memory",
    "description": "Store a curated memory for later lookup.",
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["text"],
        "properties": {"text": {"type": "string"}},
    },
}

LIST_SOURCES_TOOL: dict[str, Any] = {
    "name": "list_sources",
    "description": (
        "Host data sources (RSS, public HTTPS, local files, user journal, kernel ring). "
        "Returns the registry plus the last poll. Headlines also ride GET /api/state as sources."
    ),
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

SET_SOURCE_TOOL: dict[str, Any] = {
    "name": "set_source",
    "description": (
        "Create or update one host source. type is rss, http, file, journal, or kmsg. "
        "Remote urls must be public HTTPS. File paths must stay under the home directory. "
        "journal is journalctl --user; optional unit filters to one user unit. kmsg reads /dev/kmsg."
    ),
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "id": {"type": "string"},
            "type": {"type": "string", "enum": ["rss", "http", "file", "journal", "kmsg"]},
            "label": {"type": "string"},
            "url": {"type": "string", "description": "Public HTTPS URL for rss / http"},
            "path": {"type": "string", "description": "Local file under $HOME or ~/.zoto-viz"},
            "unit": {"type": "string", "description": "Optional systemd user unit for type=journal"},
            "interval": {"type": "number", "minimum": 15, "maximum": 86400},
            "enabled": {"type": "boolean"},
            "feed": {"type": "boolean", "description": "Show headlines on the live feed ticker"},
            "fields": {
                "type": "object",
                "additionalProperties": {"type": ["string", "number"]},
                "description": "JSON field map for type=http (list, title, caption, image, link, filter, expand)",
            },
        },
    },
}

LIST_PLUGIN_INSTANCES_TOOL: dict[str, Any] = {
    "name": "list_plugin_instances",
    "description": (
        "Operator plugin instances (~/.zoto-viz/plugin-instances.yml). "
        "Each row reuses a shipped plugin tree with a source id and field picks."
    ),
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

SET_PLUGIN_INSTANCE_TOOL: dict[str, Any] = {
    "name": "set_plugin_instance",
    "description": (
        "Create or update a plugin instance. plugin is a catalog id (carousel, hn-rain, hn-term). "
        "id is the instance slug. Optional source / title / caption / image / link / filter "
        "become This-view defaults. Does not duplicate the plugin tree."
    ),
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["plugin", "id"],
        "properties": {
            "plugin": {"type": "string"},
            "id": {"type": "string"},
            "name": {"type": "string"},
            "hint": {"type": "string"},
            "source": {"type": "string"},
            "title": {"type": "string"},
            "caption": {"type": "string"},
            "image": {"type": "string"},
            "link": {"type": "string"},
            "filter": {"type": "string"},
        },
    },
}

DELETE_PLUGIN_INSTANCE_TOOL: dict[str, Any] = {
    "name": "delete_plugin_instance",
    "description": "Remove one operator plugin instance. Shipped instances stay.",
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["plugin", "id"],
        "properties": {
            "plugin": {"type": "string"},
            "id": {"type": "string"},
        },
    },
}

DELETE_SOURCE_TOOL: dict[str, Any] = {
    "name": "delete_source",
    "description": "Remove one host source by id.",
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["id"],
        "properties": {"id": {"type": "string"}},
    },
}

GET_SDM_TOOL: dict[str, Any] = {
    "name": "get_sdm",
    "description": (
        "Google Nest Device Access status (no secrets). Includes PCM URL, linked flag, "
        "devices, and recent Pub/Sub events. Config is ~/.zoto-viz/sdm.yml."
    ),
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

LIST_CAMERAS_TOOL: dict[str, Any] = {
    "name": "list_cameras",
    "description": "List Nest cameras/doorbells from the last SDM devices.list poll.",
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

SET_SDM_TOOL: dict[str, Any] = {
    "name": "set_sdm",
    "description": (
        "Write Device Access config and/or exchange a PCM authorization code. "
        "enterprise_id is the Device Access UUID (not the GCP project id). "
        "client_id/client_secret must be a Web OAuth client with redirect https://www.google.com. "
        "Pass code after PCM redirects to google.com?code=..."
    ),
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "enterprise_id": {"type": "string", "description": "Device Access project UUID"},
            "gcp_project": {"type": "string"},
            "client_id": {"type": "string"},
            "client_secret": {"type": "string"},
            "redirect_uri": {"type": "string"},
            "topic": {"type": "string"},
            "subscription": {"type": "string"},
            "code": {"type": "string", "description": "PCM OAuth authorization code"},
        },
    },
}

DELETE_MEMORY_TOOL: dict[str, Any] = {
    "name": "delete_memory",
    "description": "Delete one memory by id, or all memories when id is omitted.",
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {"id": {"type": "string"}},
    },
}


def active_tools() -> list[dict[str, Any]]:
    return [
        LIST_FEATURES_TOOL,
        GET_SETTINGS_TOOL,
        SET_SETTINGS_TOOL,
        LIST_PLUGINS_TOOL,
        SET_PLUGIN_TOOL,
        SET_VIEW_TOOL,
        SET_AGENT_TOOL,
        ROLL_DICE_TOOL,
        GET_STATE_TOOL,
        GET_TRAFFIC_TOOL,
        GET_RF_WATCH_TOOL,
        SET_RF_WATCH_TOOL,
        CONSENT_PLUGIN_TOOL,
        DRAFT_PLUGIN_TOOL,
        LIST_PROFILES_TOOL,
        APPLY_PROFILE_TOOL,
        LIST_MEMORIES_TOOL,
        ADD_MEMORY_TOOL,
        DELETE_MEMORY_TOOL,
        LIST_SOURCES_TOOL,
        SET_SOURCE_TOOL,
        DELETE_SOURCE_TOOL,
        LIST_PLUGIN_INSTANCES_TOOL,
        SET_PLUGIN_INSTANCE_TOOL,
        DELETE_PLUGIN_INSTANCE_TOOL,
        GET_SDM_TOOL,
        LIST_CAMERAS_TOOL,
        SET_SDM_TOOL,
        INSTALL_TOOL,
        PUBLISH_LOCAL_TOOL,
    ]


# tests and GET /mcp historically imported TOOLS
TOOLS: list[dict[str, Any]] = active_tools()


def _ok(rid: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": rid, "result": result}


def _err(rid: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": message}}


def _tool_text(payload: dict[str, Any], *, is_error: bool = False) -> dict[str, Any]:
    return {
        "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}],
        "structuredContent": payload,
        "isError": is_error,
    }


def decode_zip_b64(blob: str) -> bytes:
    s = "".join(str(blob or "").split())
    if s.lower().startswith("data:") and "," in s:
        s = s.split(",", 1)[1]
    try:
        return base64.b64decode(s, validate=True)
    except Exception as e:
        raise ValueError("zip_b64 is not valid base64") from e


def install_catalog_zip(
    raw: bytes,
    *,
    overwrite: bool = False,
    force: bool = False,
) -> dict[str, Any]:
    """Validate, write ``plugins/<id>.zip``, unpack. Never git-add or git-commit."""
    tmp_path: Path | None = None
    fd, tmp_name = tempfile.mkstemp(prefix="zoto-plugin.", suffix=".zip")
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        tmp_path.write_bytes(raw)
        manifest = pz.inspect_zip(tmp_path)
        doc = plugins.validate_doc(manifest.plugin)
        pid = str(doc["id"])
        dest = paths.plugin_zips_dir() / f"{pid}.zip"
        raw, doc, dest, reminted_from = plugin_local.remint_zip(raw, dest, overwrite=overwrite)
        pid = str(doc["id"])
        tmp_path.write_bytes(raw)
        runtime = paths.plugin_runtime_dir() / pid
        incoming = pz.plugin_sha256(tmp_path)
        if dest.is_file() and pz.plugin_sha256(dest) == incoming:
            unpacked = pz.unpack_zip(dest, runtime)
            info = _install_result(doc, dest, unpacked, wrote=False)
            if reminted_from:
                info["remintedFrom"] = reminted_from
            _refresh_plugin_python(info)
            return info
        dirty = pmg.dirty_tree_paths(pid)
        if dirty and not force:
            raise pmg.DirtyTreeError(dirty, pid)
        if dest.is_file() and not overwrite:
            raise ValueError(f"plugin {pid!r} already exists (pass overwrite: true)")
        dest.parent.mkdir(parents=True, exist_ok=True)
        staged = dest.with_name(dest.name + ".tmp")
        shutil.copy2(tmp_path, staged)
        os.replace(staged, dest)
        unpacked = pz.unpack_zip(dest, runtime)
        info = _install_result(doc, dest, unpacked, wrote=True)
        if reminted_from:
            info["remintedFrom"] = reminted_from
        _refresh_plugin_python(info)
        return info
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)


def _install_result(
    doc: dict[str, Any],
    dest: Path,
    unpacked: pz.UnpackResult,
    *,
    wrote: bool,
) -> dict[str, Any]:
    review, hashes, needed = pmg.consent_payload(unpacked.dest, doc)
    info: dict[str, Any] = {
        "ok": True,
        "id": doc["id"],
        "version": doc.get("version"),
        "sha256": unpacked.sha256,
        "path": str(dest),
        "dir": str(unpacked.dest),
        "parts": list(unpacked.parts),
        "wrote": wrote,
    }
    if hashes:
        info["hashes"] = hashes
    if needed:
        info["ok"] = False
        info["error"] = "consent-required"
        info["consentRequired"] = True
        info["needsReview"] = True
        info["preview"] = {"id": review.get("id"), "version": review.get("version")}
    return info


def _refresh_plugin_python(info: dict[str, Any]) -> None:
    """Load / reload in-process backends after a catalog zip lands (no process bounce)."""
    parts = {str(p) for p in (info.get("parts") or [])}
    if not (parts & {"backend", "datasource"}):
        return
    try:
        from . import hooks
        hooks.sync(plugins.scan().get("plugins") or [], allow=plugins.python_allow)
        info["pythonReloaded"] = True
    except Exception as e:  # noqa: BLE001
        info["pythonReloadError"] = str(e)


def _knobs_for(row: dict[str, Any]) -> list[dict[str, Any]]:
    viz = row.get("visualisation") if isinstance(row.get("visualisation"), dict) else {}
    options = viz.get("options") if isinstance(viz.get("options"), list) else row.get("options")
    config = viz.get("config") if isinstance(viz.get("config"), list) else row.get("config")
    knobs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for src in (options, config):
        if not isinstance(src, list):
            continue
        for item in src:
            if not isinstance(item, dict):
                continue
            key = str(item.get("key") or "")
            if not key or key in seen:
                continue
            seen.add(key)
            knobs.append({k: item[k] for k in ("key", "label", "type", "hint", "default", "min", "max", "step", "values") if k in item})
    if "prompt" not in seen:
        knobs.append({
            "key": "prompt",
            "label": "prompt",
            "type": "textarea",
            "default": "",
            "hint": "This profile's brief for AI Dynamic on this view",
        })
    return knobs


def _plugin_rows(pid: str | None = None) -> list[dict[str, Any]]:
    scan = plugins.scan()
    rows = scan.get("plugins") or []
    out: list[dict[str, Any]] = []
    settings = {}
    try:
        settings = profiles.current_settings()
    except Exception:
        settings = {}
    plugins_cfg = settings.get("plugins") if isinstance(settings.get("plugins"), dict) else {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        rid = str(row.get("id") or "")
        if pid and rid != pid:
            continue
        knobs = _knobs_for(row)
        values = plugins_cfg.get(rid) if isinstance(plugins_cfg.get(rid), dict) else {}
        out.append({
            "id": rid,
            "name": row.get("name"),
            "version": row.get("version"),
            "engine": (row.get("visualisation") or {}).get("engine") if isinstance(row.get("visualisation"), dict) else row.get("engine"),
            "base": (row.get("visualisation") or {}).get("base") if isinstance(row.get("visualisation"), dict) else row.get("base"),
            "hint": row.get("hint"),
            "mode": f"plugin:{rid}" if rid else None,
            "knobs": knobs,
            "values": {str(k): str(v) for k, v in values.items() if isinstance(k, str)},
        })
        if pid:
            break
    return out


def _set_plugin(pid: str, values: dict[str, Any]) -> dict[str, Any]:
    pid = pid.strip()
    if not pid:
        raise ValueError("id required")
    rows = _plugin_rows(pid)
    if not rows:
        raise ValueError(f"unknown plugin {pid!r}")
    allowed = {k["key"] for k in rows[0]["knobs"] if k.get("key")}
    cleaned: dict[str, str] = {}
    for k, v in values.items():
        key = str(k)
        if key not in allowed:
            raise ValueError(f"unknown knob {key!r} on {pid}")
        cleaned[key] = str(v)[:800]
    patch = live.sanitize_patch({
        "plugins": {pid: cleaned},
        "modeOptions": {f"plugin:{pid}": cleaned},
    })
    snap = live.queue_patch(patch)
    return {"ok": True, "id": pid, "values": cleaned, "live": snap}


def _require_state(app: web.Application | None) -> Any:
    if not isinstance(app, web.Application):
        raise ValueError("monitor state unavailable")
    state = app.get("state")
    if state is None:
        raise ValueError("monitor state unavailable")
    return state


def call_tool(name: str, arguments: dict[str, Any] | None, app: web.Application | None = None) -> dict[str, Any]:
    args = arguments if isinstance(arguments, dict) else {}
    try:
        if name == "list_features":
            return _tool_text({"ok": True, **live.features()})
        if name == "get_settings":
            settings = {}
            pid = ""
            try:
                settings = profiles.current_settings()
                pid = profiles.current_id()
            except Exception:
                settings = {}
            return _tool_text({
                "ok": True,
                "profile": pid,
                "agent": live.state(),
                "live": live.snapshot(),
                "settings": settings,
                "aiControl": agent.ai_control_on(),
            })
        if name == "set_settings":
            patch = live.sanitize_patch(args)
            if not patch:
                raise ValueError("no recognised settings keys")
            if "control" in patch:
                agent.set_ai_control(bool(patch.pop("control")))
            snap = live.queue_patch(patch)
            return _tool_text({"ok": True, "applied": patch, "live": snap, "aiControl": agent.ai_control_on()})
        if name == "list_plugins":
            want = str(args.get("id") or "").strip() or None
            rows = _plugin_rows(want)
            if want and not rows:
                raise ValueError(f"unknown plugin {want!r}")
            return _tool_text({"ok": True, "plugins": rows})
        if name == "set_plugin":
            vals = args.get("values")
            if not isinstance(vals, dict):
                raise ValueError("values object required")
            return _tool_text(_set_plugin(str(args.get("id") or ""), vals))
        if name == "set_view":
            mode = str(args.get("mode") or "").strip()
            if not mode:
                raise ValueError("mode required")
            patch = live.sanitize_patch({"mode": mode})
            snap = live.queue_patch(patch)
            return _tool_text({"ok": True, "mode": mode, "live": snap})
        if name == "set_agent":
            patch = live.sanitize_patch({k: args[k] for k in ("temper", "weather", "control") if k in args})
            if not patch:
                raise ValueError("temper, weather, or control required")
            if "control" in patch:
                agent.set_ai_control(bool(patch.pop("control")))
            snap = live.queue_patch(patch) if patch else live.snapshot()
            return _tool_text({"ok": True, "agent": live.state(), "live": snap, "aiControl": agent.ai_control_on()})
        if name == "roll_dice":
            snap = live.queue_patch({"shuffle": True})
            return _tool_text({"ok": True, "shuffle": True, "live": snap})
        if name == "list_sources":
            from . import sources
            return _tool_text({"ok": True, **sources.config_payload()})
        if name == "set_source":
            from . import sources
            row = sources.upsert(args)
            return _tool_text({"ok": True, "source": row, **sources.config_payload()})
        if name == "delete_source":
            from . import sources
            sid = str(args.get("id") or "").strip()
            if not sid:
                raise ValueError("id required")
            if not sources.delete(sid):
                raise ValueError(f"unknown source {sid!r}")
            return _tool_text({"ok": True, "id": sid, **sources.config_payload()})
        if name == "list_plugin_instances":
            from . import plugin_instances
            return _tool_text({"ok": True, **plugin_instances.config_payload()})
        if name == "set_plugin_instance":
            from . import plugin_instances
            row = plugin_instances.upsert(args)
            return _tool_text({"ok": True, "instance": row, **plugin_instances.config_payload()})
        if name == "delete_plugin_instance":
            from . import plugin_instances
            plugin = str(args.get("plugin") or "").strip()
            iid = str(args.get("id") or "").strip()
            if not plugin or not iid:
                raise ValueError("plugin and id required")
            if not plugin_instances.delete(plugin, iid):
                raise ValueError(f"unknown instance {plugin}:{iid}")
            return _tool_text({"ok": True, "plugin": plugin, "id": iid, **plugin_instances.config_payload()})
        if name == "get_sdm":
            from . import sdm
            return _tool_text({"ok": True, **sdm.status_payload()})
        if name == "list_cameras":
            from . import sdm
            st = sdm.status_payload()
            return _tool_text({"ok": True, "devices": st.get("devices") or [], "linked": st.get("linked")})
        if name == "set_sdm":
            from . import sdm
            keys = {k: args[k] for k in (
                "enterprise_id", "gcp_project", "client_id", "client_secret",
                "redirect_uri", "topic", "subscription",
            ) if k in args}
            if keys:
                sdm.upsert(keys)
            if args.get("code"):
                sdm.queue_code(str(args["code"]))
            st = sdm.status_payload()
            if args.get("code"):
                st = {**st, "code_queued": True}
            return _tool_text({"ok": True, **st})
        if name == "get_state":
            from .monitor import publish_state
            return _tool_text({"ok": True, **publish_state(_require_state(app))})
        if name == "get_traffic":
            ip = str(args.get("ip") or "").strip()
            if not ip:
                raise ValueError("ip required")
            since = float(args["since"]) if isinstance(args.get("since"), (int, float)) else 0.0
            peer = str(args.get("peer") or "").strip()
            detail = _require_state(app).traffic_detail(ip, time.time(), peer, since)
            if detail is None:
                raise ValueError("unknown device")
            return _tool_text({"ok": True, **detail})
        if name == "get_rf_watch":
            return _tool_text({"ok": True, **_require_state(app).radio.watch_status(time.time())})
        if name == "set_rf_watch":
            state = _require_state(app)
            body = {k: args[k] for k in ("ssids", "other", "dwell", "rotate") if k in args}
            if not body:
                raise ValueError("ssids, other, dwell, or rotate required")
            state.radio.set_watch(body)
            from .monitor import refresh_hop_plan
            refresh_hop_plan(state)
            return _tool_text({"ok": True, **state.radio.watch_status(time.time())})
        if name == "consent_plugin":
            pid = str(args.get("id") or "").strip()
            kind = str(args.get("kind") or "").strip()
            found = plugins._plugin_row(pid) if pid else None
            if not found:
                raise ValueError(f"unknown plugin {pid!r}")
            if not plugins.needs_review(found):
                return _tool_text({"ok": True, "needed": False, "id": pid})
            plugins.grant_consent(found, kind)
            from . import hooks
            hooks.sync(plugins.scan().get("plugins") or [], allow=plugins.python_allow)
            live.queue_patch({"pluginConsent": {"id": pid, "kind": kind}})
            return _tool_text({"ok": True, "needed": True, "id": pid, "kind": kind})
        if name == "draft_plugin":
            info = agent.draft_plugin(args)
            return _tool_text(info, is_error=not info.get("ok"))
        if name == "list_profiles":
            return _tool_text({"ok": True, **profiles.list_meta()})
        if name == "apply_profile":
            pid = str(args.get("id") or "").strip()
            entry = profiles.profile_entry(pid)
            if not entry:
                raise ValueError(f"unknown profile {pid!r}")
            settings = entry.get("settings") if isinstance(entry.get("settings"), dict) else {}
            patch = live.sanitize_patch(settings)
            if not patch:
                raise ValueError("profile has no recognised settings")
            snap = live.queue_patch(patch)
            return _tool_text({"ok": True, "id": pid, "applied": patch, "live": snap})
        if name == "list_memories":
            return _tool_text({"ok": True, "memories": memory.list_memories(kind="memory")})
        if name == "add_memory":
            row = memory.add_memory(str(args.get("text") or ""), kind="memory")
            if not row:
                raise ValueError("text required")
            return _tool_text({"ok": True, "memory": row, "memories": memory.list_memories(kind="memory")})
        if name == "delete_memory":
            mem_id = str(args.get("id") or "").strip()
            if mem_id:
                ok = memory.delete_memory(mem_id)
                return _tool_text({"ok": ok, "memories": memory.list_memories(kind="memory")})
            memory.clear_memories()
            return _tool_text({"ok": True, "memories": []})
        if name == "publish_local_plugin":
            info = plugin_local.publish_local(args)
            return _tool_text(info, is_error=not info.get("ok"))
        if name == "install_plugin_zip":
            raw = decode_zip_b64(str(args.get("zip_b64") or ""))
            info = install_catalog_zip(
                raw,
                overwrite=bool(args.get("overwrite")),
                force=bool(args.get("force")),
            )
            return _tool_text(info, is_error=bool(info.get("consentRequired")))
        return _tool_text({"error": f"unknown tool {name}"}, is_error=True)
    except pmg.SrcOwnedError as e:
        return _tool_text({
            "error": "src_owns_id",
            "id": e.plugin_id,
            "path": e.path,
            "hint": "force does not override a shipped src tree",
        }, is_error=True)
    except pmg.DirtyTreeError as e:
        return _tool_text({
            "error": "dirty_tree",
            "id": e.plugin_id,
            "paths": e.paths,
            "hint": "pass force: true to write despite uncommitted catalog changes",
        }, is_error=True)
    except ValueError as e:
        return _tool_text({"error": str(e)}, is_error=True)


def handle_rpc(msg: dict[str, Any], app: web.Application | None = None) -> dict[str, Any] | None:
    if msg.get("jsonrpc") != "2.0":
        return _err(msg.get("id"), -32600, "jsonrpc 2.0 required")
    method = str(msg.get("method") or "")
    rid = msg.get("id")
    params = msg.get("params") if isinstance(msg.get("params"), dict) else {}
    if rid is None:
        return None
    if method == "initialize":
        return _ok(rid, {
            "protocolVersion": PROTOCOL,
            "capabilities": {"tools": {"listChanged": True}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            "instructions": (
                "Control a running zoto-viz monitor. list_features names every settable key "
                "(theme, view, feed, show, filters, anim/physics/mosaic, plugins, agent look, dice). "
                "get_settings / set_settings / set_view / set_plugin / set_agent / roll_dice patch the open UI. "
                "get_state and get_traffic read the LAN. get_rf_watch / set_rf_watch tune Wi-Fi. "
                "consent_plugin, draft_plugin, publish_local_plugin, and install_plugin_zip manage plugins "
                "(plugin.yml at the zip or src root; optional visualisation.yml, frontend/, backend/, datasource/, sky/). "
                "publish_local_plugin writes ~/.zoto-viz/plugins/local/<id>.zip and hot-activates when safe. "
                "list_profiles / apply_profile load saved looks. list_memories / add_memory / delete_memory "
                "curate chat memories. list_sources / set_source / delete_source manage RSS, HTTPS JSON (optional field maps), "
                "local-file, user-journal, and kernel-ring feeds (~/.zoto-viz/sources.yml). get_sdm / list_cameras / set_sdm manage Nest "
                "Device Access (OAuth, Pub/Sub, WebRTC; secrets in ~/.zoto-viz/sdm.yml). "
                "Repo zip install does not git-add; the operator promotes."
            ),
        })
    if method == "ping":
        return _ok(rid, {})
    if method == "tools/list":
        return _ok(rid, {"tools": active_tools()})
    if method == "tools/call":
        name = str(params.get("name") or "")
        arguments = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
        return _ok(rid, call_tool(name, arguments, app=app))
    if method.startswith("notifications/"):
        return None
    return _err(rid, -32601, f"unknown method {method}")


async def api_mcp(req: web.Request) -> web.StreamResponse:
    host = access.header_hostname(req.headers.get("Host", ""))
    app = getattr(req, "app", None)
    flag = app.get("insecure_lan") if isinstance(app, web.Application) else False
    insecure = flag is True
    if not insecure and not access.is_loopback_name(host):
        return web.json_response({"error": "forbidden host"}, status=403)
    if req.method == "GET":
        return web.json_response({
            "ok": True,
            "name": SERVER_NAME,
            "transport": "streamable-http",
            "protocol": PROTOCOL,
            "tools": [t["name"] for t in active_tools()],
        })
    try:
        body = await req.json()
    except Exception:
        return web.json_response(_err(None, -32700, "parse error"), status=400)
    app_obj = app if isinstance(app, web.Application) else None
    if isinstance(body, list):
        out = [handle_rpc(m, app=app_obj) for m in body if isinstance(m, dict)]
        return web.json_response([x for x in out if x is not None])
    if not isinstance(body, dict):
        return web.json_response(_err(None, -32600, "object required"), status=400)
    result = handle_rpc(body, app=app_obj)
    if result is None:
        return web.Response(status=204)
    return web.json_response(result)
