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
SERVER_VERSION = "4"

# Read-only tools. Everything else writes or queues a live patch.
_READ_ONLY = frozenset({
    "list_features", "get_settings", "list_plugins", "get_state", "get_pack_perf",
    "get_traffic", "get_rf_watch", "list_profiles", "list_memories", "list_sources",
    "list_source_library",
    "list_plugin_instances", "get_sdm", "list_cameras", "get_logs",
})
_DESTRUCTIVE = frozenset({
    "delete_memory", "delete_source", "delete_plugin_instance",
})
_NON_IDEMPOTENT = frozenset({"roll_dice", "add_memory"})


def _with_annotations(tool: dict[str, Any]) -> dict[str, Any]:
    name = str(tool.get("name") or "")
    return {
        **tool,
        "annotations": {
            "readOnlyHint": name in _READ_ONLY,
            "destructiveHint": name in _DESTRUCTIVE,
            "idempotentHint": name not in _NON_IDEMPOTENT,
            "openWorldHint": False,
        },
    }

PUBLISH_LOCAL_TOOL: dict[str, Any] = {
    "name": "publish_local_plugin",
    "description": (
        "Write a plugin that is not part of the git checkout. Use when experimenting "
        "without touching plugins/src. Pass exactly one of zip_b64, files "
        "(path → text, plugin.yml required), or description. Optional id, name, engine, "
        "base, overwrite, activate (default true). Writes ~/.zoto-viz/plugins/local/<id>.zip, "
        "unpacks it, and switches the open view when the zip is YAML-only or already consented. "
        "Code-bearing zips return consent-required — then consent_plugin and set_view. "
        "A taken id is reminted to <id>-2 unless overwrite updates that same local zip. "
        "Do not use this for a shipped tree (draft_plugin) or a contrib zip in the repo "
        "(install_plugin_zip). Does not git-add."
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
        "Drop a contrib plugin zip into the checkout. Use when the operator wants "
        "plugins/<id>.zip (gitignored), not a shipped src tree and not a home-dir experiment. "
        "Pass {zip_b64}. overwrite replaces that same contrib zip when the sha256 differs. "
        "force writes even if plugins/src/<id>/ has uncommitted edits; it still will not "
        "replace a shipped src tree (the id is reminted to <id>-2). Returns path, id, and "
        "consent-required when TypeScript, Python, or GLSL needs consent_plugin before it runs. "
        "Do not git-add. For ~/.zoto-viz/plugins/local use publish_local_plugin."
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
        "Map of every settable key and which tool writes it. Use when you do not yet know "
        "whether to call set_settings, set_view, set_plugin, or something else. No arguments. "
        "Returns theme/chrome/feed/anim enums (including graphFabric, graphSpace, graphLayout, "
        "backdrop), dice, and a how-to that names the tool for views, knobs, consent, sources, "
        "and LAN. Call this before inventing a settings key. Camera and microphone are absent on purpose."
    ),
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

GET_SETTINGS_TOOL: dict[str, Any] = {
    "name": "get_settings",
    "description": (
        "Read the startup profile plus the queued live patch. Use when you need the last "
        "settings this server was asked to apply (theme, mode, anim, plugins, temper). "
        "No arguments. Returns profile, agent, live, settings, aiControl. This is not the "
        "live canvas: a queued mode can differ from the picture on screen until the open tab "
        "applies the patch. Do not treat it as proof a sky or view rendered."
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
        "Patch the open monitor. Use for theme, motion, mosaic, sky, feed, dice repeat, sound, "
        "and agent look — not for switching a view (set_view) or one plugin's knobs (set_plugin). "
        "Pass only whitelist keys from list_features: theme, dream, mode, chrome, redact, merge, "
        "autoconsent, sound (speakers; starts off), feed, show, filters, anim, modeOptions, arcade, "
        "plugins, agent {clear, shader, shaderPhoto, decos}, dice {on, periodMin, include}, shuffle, "
        "temper, weather, control, model. anim.audioNodes true follows the mic beat; false keeps "
        "graph motion eased. anim.skyAudio false unless a pulse fade is intended. Do not write "
        "uBright. Camera and microphone are operator-only and are rejected. Queues a live patch; "
        "wait about a second, then look at the open UI."
    ),
    "inputSchema": _settings_schema(),
}

LIST_PLUGINS_TOOL: dict[str, Any] = {
    "name": "list_plugins",
    "description": (
        "List views the header menu can show. Use before set_view or set_plugin, and whenever "
        "the view dropdown is empty. Omit id for every row; pass a bare id (topology, not "
        "plugin:topology) for one. Each row has mode (pass that string to set_view), knobs "
        "(keys for set_plugin), and saved values. Also returns errors and blocked. plugins:[] "
        "plus an errors entry means the catalog scan refused the menu (often two plugin "
        "directories whose names slug to the same id). Values are the startup profile, not "
        "unsaved live knob edits."
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
        "Set one view's knobs. Use after list_plugins shows that id's knob keys. "
        "Pass {id, values}. id is bare (cypher-cic, not plugin:cypher-cic). values is an object "
        "of knob key → string; booleans are \"1\" or \"0\". Unknown keys error. The reserved "
        "prompt key is the AI Dynamic brief for that view. Also queues modeOptions for "
        "plugin:<id>. Does not switch the view — call set_view for that. Does not consent code."
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
    "description": (
        "Switch the open monitor's VIEW. Use when the user wants a different picture. "
        "Pass {mode} copied from list_plugins (the mode field), e.g. plugin:topology or "
        "plugin:fluid-dyn. Do not invent ids and do not strip or add plugin: yourself if "
        "list_plugins already returned mode. Queues a live patch the open tab applies within "
        "about a second; a tab that loaded while the catalog was empty must be reloaded. "
        "get_settings showing the mode is not proof the canvas changed. Sky stays near-black "
        "(about 5,10,22) until consent_plugin if the pack has TypeScript or GLSL."
    ),
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
        "Set the in-monitor agent's temper, weather, or AI Control. Use for the chat agent "
        "inside zoto-viz, not for theme or view. Pass any of temper (integer 0–100), "
        "weather (hush, drift, pulse, or storm), control (boolean). temper also scales "
        "Ollama temperature. weather is how often AI Dynamic rebuilds. control must be on "
        "before draft_plugin can write plugins/src. Empty arguments error."
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
        "Roll the dice once. Use for a single reshuffle of the groups left on in Settings → Dice "
        "(theme, view, mosaic, feed, motion, physics, knobs by default). No arguments. "
        "Does not flip the header repeat switch — that is set_settings {dice:{on, periodMin}}. "
        "Chrome, camera, and microphone stay. Filters and prompts stay. Does not start a chat turn."
    ),
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

GET_STATE_TOOL: dict[str, Any] = {
    "name": "get_state",
    "description": (
        "Read the live LAN snapshot. Use when you need devices, flows, services, or radio "
        "as the monitor sees them now. No arguments. Same payload as GET /api/state. "
        "Fails if this MCP call has no monitor process attached. Not a settings read — "
        "use get_settings for theme and view."
    ),
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

GET_PACK_PERF_TOOL: dict[str, Any] = {
    "name": "get_pack_perf",
    "description": (
        "Read the latest pack frame timings the browser posted. Use when a view is slow "
        "or you need pack-level frame numbers, not the HUD fps. No arguments. The page "
        "must have been loaded with ?packPerf=1 or localStorage zoto-viz.packPerf=1 (set before "
        "load or from another tab) or the buffer stays empty. Does not change settings."
    ),
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

GET_TRAFFIC_TOOL: dict[str, Any] = {
    "name": "get_traffic",
    "description": (
        "Read recent packets. Use after get_state when you need flows for one address or a group. "
        "Pass ip: a host address, @lan, @internet, @any, or a comma list. Optional peer and "
        "since (unix seconds). Unknown ip returns an error. Does not change capture."
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
    "description": (
        "Read the Wi-Fi watch list. Use before set_rf_watch, or to see the channel plan and "
        "current tune. No arguments. Returns ssids, dwell, rotate, and what the radio is doing."
    ),
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

SET_RF_WATCH_TOOL: dict[str, Any] = {
    "name": "set_rf_watch",
    "description": (
        "Replace the Wi-Fi SSID watch list. Use when Air SSIDs should follow specific names. "
        "Pass ssids (string list or comma-separated), and optionally other (boolean), dwell "
        "(seconds), rotate (boolean). At least one of those keys is required. Persists and "
        "rewrites the hopper plan. Read first with get_rf_watch."
    ),
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
    "description": (
        "Allow one plugin's TypeScript, Python, or GLSL to run. Use after you change "
        "frontend/, backend/, datasource/, or sky/, or when a plugin sky stays near-black "
        "(about 5,10,22). Pass {id, kind}. id is bare. kind authored means you wrote it; "
        "reviewed means you only read the source. Then set_view. YAML-only plugins return "
        "needed:false. A hash change invalidates the old stamp — consent again. "
        "autoconsent via set_settings covers shipped src and local zips only, not contrib zips."
    ),
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
        "Validate a shipped plugin tree, and optionally write it. Use when the plugin belongs "
        "in plugins/src/<id>/ (the git catalog). Pass files (relative path → text, plugin.yml "
        "required) or legacy yaml. install true writes the tree only when AI Control is already "
        "on (set_agent {control:true}); otherwise it validates and does not write. Never packs "
        "a zip and does not git-add. For a home-dir experiment use publish_local_plugin."
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
    "description": (
        "List saved UI profiles. Use before apply_profile. No arguments. "
        "Each row has id, label, shipped, and whether it is the default. "
        "Does not change the open view."
    ),
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

APPLY_PROFILE_TOOL: dict[str, Any] = {
    "name": "apply_profile",
    "description": (
        "Load a saved profile onto the open UI. Use when the user names a profile from "
        "list_profiles. Pass {id}. Same whitelist as set_settings, so camera and microphone "
        "in a profile are dropped. Unknown id errors. Queues a live patch; wait, then look "
        "at the canvas. Does not set the profile as the startup default."
    ),
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["id"],
        "properties": {"id": {"type": "string"}},
    },
}

LIST_MEMORIES_TOOL: dict[str, Any] = {
    "name": "list_memories",
    "description": (
        "List curated memories the in-monitor chat agent sees on later turns. "
        "Use before add_memory or delete_memory. No arguments. Returns memories "
        "with id and text. Not LAN state and not the view prompt (that is set_plugin prompt)."
    ),
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

ADD_MEMORY_TOOL: dict[str, Any] = {
    "name": "add_memory",
    "description": (
        "Store one memory for later in-monitor chat turns. Use when the user asks to remember "
        "a fact. Pass {text}. Empty text errors. Returns the new row and the full list. "
        "Each call adds another row; it does not update by id."
    ),
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["text"],
        "properties": {"text": {"type": "string"}},
    },
}

LIST_SOURCE_LIBRARY_TOOL: dict[str, Any] = {
    "name": "list_source_library",
    "description": (
        "List third-party datasource recipes that are not polled yet. Use when a plugin or "
        "view should consume a public feed (weather, quakes, news, prices) instead of inventing "
        "a URL. No arguments. Returns id, label, vendor, type, hint, and extends. "
        "Then set_source {library: id} or {library: [id, id], feed: true} to combine and enable. "
        "Plugins name the same ids under visualisation.yml datasource.library."
    ),
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

LIST_SOURCES_TOOL: dict[str, Any] = {
    "name": "list_sources",
    "description": (
        "List host headline sources. Use before set_source or delete_source. No arguments. "
        "Returns the registry in ~/.zoto-viz/sources.yml plus the last poll. Kinds: rss, http, "
        "file, journal, kmsg. Headlines also appear on GET /api/state. feed:true on a source "
        "is what puts it on the on-screen ticker (set_settings feed.on still has to be true)."
    ),
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

SET_SOURCE_TOOL: dict[str, Any] = {
    "name": "set_source",
    "description": (
        "Create or update headline sources. Use after list_sources, or pass library from "
        "list_source_library to add a third-party feed. library is one id or a list to combine "
        "(usgs-quakes, bbc-news). interval, feed, url, and fields overlay every chosen recipe. "
        "Otherwise pass type rss, http, file, journal, or kmsg. rss/http need a public https url. "
        "file needs a path under the home directory. journal is journalctl --user. "
        "kmsg reads /dev/kmsg. Same id updates that row. Library rows stay off the ticker "
        "until feed is true."
    ),
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "id": {"type": "string"},
            "library": {
                "description": "Source-library id, or a list of ids to combine. See list_source_library.",
                "oneOf": [
                    {"type": "string"},
                    {"type": "array", "items": {"type": "string"}},
                ],
            },
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
        "List extra catalog rows that reuse a shipped plugin. Use before set_plugin_instance. "
        "No arguments. Each row is plugin + instance id with a source and field picks "
        "(~/.zoto-viz/plugin-instances.yml). The view id on screen is plugin:<plugin>:<id>. "
        "Does not copy the plugin tree."
    ),
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

SET_PLUGIN_INSTANCE_TOOL: dict[str, Any] = {
    "name": "set_plugin_instance",
    "description": (
        "Add or update an extra row on a shipped plugin. Use when one pack should appear twice "
        "with a different source (carousel, hn-rain, hn-term), not when you need a new plugin. "
        "Pass plugin (bare catalog id) and id (instance slug). Optional name, hint, source, "
        "title, caption, image, link, filter become that row's defaults. Open it with set_view "
        "{mode:\"plugin:<plugin>:<id>\"}. Does not duplicate files. Shipped rows stay if you "
        "only meant to change knobs — that is set_plugin."
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
    "description": (
        "Remove one operator-added plugin instance. Use after list_plugin_instances. "
        "Pass {plugin, id}. Shipped instances that came with the pack stay. "
        "Does not delete the plugin tree or a headline source."
    ),
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
    "description": (
        "Remove one headline source from ~/.zoto-viz/sources.yml. Use after list_sources, "
        "when that feed should stop polling. Pass {id}. Unknown id errors. Does not delete "
        "a plugin, a plugin instance, or the on-screen feed toggle (that is set_settings)."
    ),
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
        "Read Nest Device Access status without secrets. Use before set_sdm or list_cameras. "
        "No arguments. Returns the PCM URL, linked flag, devices, and recent Pub/Sub events. "
        "Config file is ~/.zoto-viz/sdm.yml. linked false means set_sdm still needs a code."
    ),
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

LIST_CAMERAS_TOOL: dict[str, Any] = {
    "name": "list_cameras",
    "description": (
        "List Nest cameras and doorbells from the last devices poll. Use when the user asks "
        "what cameras are linked. No arguments. Empty devices with linked false means OAuth "
        "is not finished — get_sdm then set_sdm. Does not start a live stream."
    ),
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
}

SET_SDM_TOOL: dict[str, Any] = {
    "name": "set_sdm",
    "description": (
        "Save Nest Device Access config and/or queue an OAuth code. Use after get_sdm shows "
        "what is missing. Pass any of enterprise_id (Device Access project UUID, not the GCP "
        "project id), gcp_project, client_id, client_secret, redirect_uri, topic, subscription, "
        "code. client_id and client_secret must be a Web OAuth client whose redirect is "
        "https://www.google.com. Pass code only after the PCM page redirects to "
        "google.com?code=... Secrets stay in ~/.zoto-viz/sdm.yml and are not echoed back."
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

GET_LOGS_TOOL: dict[str, Any] = {
    "name": "get_logs",
    "description": (
        "Read the monitor's in-process log ring. Use when a view is black, a plugin failed "
        "to load, or the catalog looks wrong and list_plugins errors are not enough. "
        "Pass {after: seq} to fetch lines newer than that seq, or omit after for the buffer. "
        "Returns {seq, lines:[{seq, t, text}]}. Same data as GET /api/logs. "
        "Does not include packet payloads."
    ),
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "after": {
                "type": "integer",
                "minimum": 0,
                "description": "Return lines with seq greater than this. Omit for the whole ring.",
            },
        },
    },
}

DELETE_MEMORY_TOOL: dict[str, Any] = {
    "name": "delete_memory",
    "description": (
        "Delete curated chat memories. Use after list_memories, when the user wants one "
        "fact or the whole list gone. Pass {id} to remove that row. Omit id to clear every "
        "memory. Returns the list that remains. Does not touch the view prompt or LAN state."
    ),
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {"id": {"type": "string"}},
    },
}


def active_tools() -> list[dict[str, Any]]:
    return [_with_annotations(tool) for tool in (
        LIST_FEATURES_TOOL,
        GET_SETTINGS_TOOL,
        SET_SETTINGS_TOOL,
        LIST_PLUGINS_TOOL,
        SET_PLUGIN_TOOL,
        SET_VIEW_TOOL,
        SET_AGENT_TOOL,
        ROLL_DICE_TOOL,
        GET_STATE_TOOL,
        GET_PACK_PERF_TOOL,
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
        LIST_SOURCE_LIBRARY_TOOL,
        SET_SOURCE_TOOL,
        DELETE_SOURCE_TOOL,
        LIST_PLUGIN_INSTANCES_TOOL,
        SET_PLUGIN_INSTANCE_TOOL,
        DELETE_PLUGIN_INSTANCE_TOOL,
        GET_SDM_TOOL,
        LIST_CAMERAS_TOOL,
        SET_SDM_TOOL,
        GET_LOGS_TOOL,
        INSTALL_TOOL,
        PUBLISH_LOCAL_TOOL,
    )]


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
    zip_display_name: str | None = None,
) -> dict[str, Any]:
    """Validate, write ``plugins/<id>.zip``, unpack. Never git-add or git-commit."""
    tmp_path: Path | None = None
    fd, tmp_name = tempfile.mkstemp(prefix="zoto-plugin.", suffix=".zip")
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        tmp_path.write_bytes(raw)
        from . import pack_safe_zip as psz

        try:
            pack_read = psz.read_pack_zip(tmp_path)
        except ValueError as e:
            return plugin_local._zip_blocked_result(e, zip_display_name=zip_display_name, zip_path=tmp_path)
        doc = plugins.validate_doc(pack_read.manifest)
        pid = str(doc["id"])
        dest = paths.plugin_zips_dir() / f"{pid}.zip"
        pack_read, doc, dest, reminted_from = plugin_local.remint_pack_read(
            pack_read,
            dest,
            overwrite=overwrite,
            incoming_sha=pz.plugin_sha256(tmp_path),
        )
        pid = str(doc["id"])
        if reminted_from:
            tmp_path.write_bytes(plugin_local.zip_bytes_from_staged(pack_read))
        runtime = paths.plugin_runtime_dir() / pid
        incoming = pz.plugin_sha256(tmp_path)
        if dest.is_file() and pz.plugin_sha256(dest) == incoming and not force:
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
        from .plugin_install import install_zip_to_runtime

        upgrade = dest.is_file() and runtime.is_dir()
        unpacked = install_zip_to_runtime(
            tmp_path,
            dest,
            runtime,
            doc,
            rel=str(dest),
            sha256=incoming,
            upgrade=upgrade,
            force=force,
            pack_read=pack_read,
        )
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


def _consent_plugin_result(args: dict[str, Any]) -> dict[str, Any]:
    """Grant plugin source-review consent. Kept out of call_tool so local imports here cannot shadow module-level live."""
    pid = str(args.get("id") or "").strip()
    kind = str(args.get("kind") or "").strip()
    found = plugins._plugin_row(pid) if pid else None
    if not found:
        raise ValueError(f"unknown plugin {pid!r}")
    if not plugins.needs_review(found):
        return {"ok": True, "needed": False, "id": pid}
    plugins.grant_consent(found, kind)
    from . import hooks

    hooks.sync(plugins.scan().get("plugins") or [], allow=plugins.python_allow)
    live.queue_patch({"pluginConsent": {"id": pid, "kind": kind}})
    return {"ok": True, "needed": True, "id": pid, "kind": kind}


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
            scan = plugins.scan()
            rows = _plugin_rows(want)
            errors = [dict(e) for e in (scan.get("errors") or []) if isinstance(e, dict)]
            blocked = [dict(b) for b in (scan.get("blocked") or []) if isinstance(b, dict)]
            if want and not rows:
                extra = ""
                if errors and not (scan.get("plugins") or []):
                    msg = str(errors[0].get("error") or "catalog error")
                    extra = f"; catalog empty: {msg}"
                raise ValueError(f"unknown plugin {want!r}{extra}")
            return _tool_text({"ok": True, "plugins": rows, "errors": errors, "blocked": blocked})
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
        if name == "list_source_library":
            from . import source_library
            return _tool_text({"ok": True, "library": source_library.catalog()})
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
        if name == "get_logs":
            from . import logbuf
            after = args.get("after") if isinstance(args.get("after"), (int, float)) else 0
            return _tool_text({"ok": True, **logbuf.since(int(after))})
        if name == "get_state":
            from .monitor import publish_state
            return _tool_text({"ok": True, **publish_state(_require_state(app))})
        if name == "get_pack_perf":
            from . import pack_perf
            return _tool_text(pack_perf.mcp_pack_perf_payload(app))
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
            return _tool_text(_consent_plugin_result(args))
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
            zip_name = args.get("zip_name") or args.get("filename")
            display = str(zip_name).strip() if isinstance(zip_name, str) and zip_name.strip() else None
            force = bool(args.get("force"))
            info = install_catalog_zip(
                raw,
                overwrite=bool(args.get("overwrite")) or force,
                force=force,
                zip_display_name=display,
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
                "Drive the running zoto-viz monitor. Patches ride the 1 Hz live socket; wait about "
                "a second and look at the open canvas. get_settings is the startup profile plus the "
                "queued patch, not proof of pixels. Read each tool description before calling it.\n"
                "Pick a tool: list_features when you do not know the key. list_plugins then set_view "
                "{mode from the row} to switch VIEW. set_settings for theme, anim, mosaic, sky, feed, "
                "dice repeat, and sound. set_plugin {id, values} for one view's knobs (id is bare; "
                "values are strings). Empty view menu: list_plugins errors — a slug collision returns "
                "plugins:[]. consent_plugin {id, kind:authored|reviewed} after frontend or sky edits, "
                "then set_view. Near-black (about 5,10,22) means the sky failed. "
                "publish_local_plugin writes ~/.zoto-viz/plugins/local/<id>.zip (not git). "
                "install_plugin_zip writes plugins/<id>.zip in the checkout. draft_plugin writes "
                "plugins/src only when AI Control is on. plugin.yml is required at the zip or src root. "
                "Never git-add from these tools. get_state / get_traffic read the LAN. "
                "get_rf_watch / set_rf_watch tune Wi-Fi. roll_dice is one shot; header repeat is "
                "set_settings {dice:{on, periodMin}}. list_source_library then set_source {library} "
                "adds a public feed (quakes, weather, news) without inventing a URL. "
                "list_sources / set_source / delete_source manage RSS, HTTPS JSON, local-file, "
                "user-journal, and kernel-ring feeds. Graph styles: visualisation.yml style.library "
                "(orbit-helix, jelly-bloom) combines fabric, space, layout, and links. "
                "list_plugin_instances / set_plugin_instance add a row without copying the tree. "
                "list_memories / add_memory / delete_memory curate chat memories. "
                "list_profiles / apply_profile load a saved look. get_sdm / list_cameras / set_sdm "
                "manage Nest Device Access (secrets in ~/.zoto-viz/sdm.yml). get_logs reads the "
                "monitor log ring. Camera and microphone are operator-only."
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
