"""Loopback MCP (Streamable HTTP JSON) for agent-plugin zips.

POST /mcp — JSON-RPC initialize / tools/list / tools/call.
GET  /mcp — short discovery payload (no SSE required for the zip tool).
CSRF is skipped; Host must still be loopback.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from aiohttp import web

from . import agent_plugins

PROTOCOL = "2025-03-26"
SERVER_NAME = "zoto-viz-plugins"
SERVER_VERSION = "1"

TOOLS: list[dict[str, Any]] = [
    {
        "name": "install_plugin_zip",
        "description": (
            "Install a zoto-viz agent plugin from a zip. The zip is a directory of the "
            "Agent Skills layout (skills/, scripts/frontend, scripts/backend) plus a "
            "manifest.json that declares produces[] and consumes[] datastreams and a ui "
            "section (TypeScript + tests, or a prompt that calls the generate-ui skill)."
        ),
        "inputSchema": {
            "type": "object",
            "additionalProperties": False,
            "required": ["zip_b64"],
            "properties": {
                "zip_b64": {"type": "string", "description": "Base64-encoded plugin zip"},
                "overwrite": {"type": "boolean", "default": False},
                "mirror": {
                    "type": "boolean",
                    "default": True,
                    "description": "Also copy into ~/.zoto-viz/plugins so the live view list sees it",
                },
            },
        },
    },
    {
        "name": "list_agent_plugins",
        "description": "List installed agent plugins (id, streams, UI kind).",
        "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
    },
    {
        "name": "plugin_ui_brief",
        "description": (
            "Return the generate-ui skill plus the plugin prompt bound to this plugin's "
            "consumes/produces arrays. Run that brief non-deterministically, then call "
            "write_plugin_ui with the TypeScript and tests."
        ),
        "inputSchema": {
            "type": "object",
            "additionalProperties": False,
            "required": ["id"],
            "properties": {"id": {"type": "string"}},
        },
    },
    {
        "name": "write_plugin_ui",
        "description": "Write generated ui/index.ts and ui/index.test.ts into an installed prompt-UI plugin.",
        "inputSchema": {
            "type": "object",
            "additionalProperties": False,
            "required": ["id", "entry_ts", "tests_ts"],
            "properties": {
                "id": {"type": "string"},
                "entry_ts": {"type": "string"},
                "tests_ts": {"type": "string"},
            },
        },
    },
]


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


def call_tool(name: str, arguments: dict[str, Any] | None) -> dict[str, Any]:
    args = arguments if isinstance(arguments, dict) else {}
    try:
        if name == "install_plugin_zip":
            info = agent_plugins.install_b64(
                str(args.get("zip_b64") or ""),
                overwrite=bool(args.get("overwrite")),
            )
            if args.get("mirror", True):
                agent_plugins.mirror_into_view_plugins(Path(info["dir"]))
            if info.get("needsUiGeneration"):
                brief = agent_plugins.ui_brief(str(info["id"]))
                info = {**info, "uiBrief": brief["brief"], "skill": brief["skill"]}
            return _tool_text(info)
        if name == "list_agent_plugins":
            return _tool_text(agent_plugins.scan())
        if name == "plugin_ui_brief":
            return _tool_text(agent_plugins.ui_brief(str(args.get("id") or "")))
        if name == "write_plugin_ui":
            info = agent_plugins.write_generated_ui(
                str(args.get("id") or ""),
                str(args.get("entry_ts") or ""),
                str(args.get("tests_ts") or ""),
            )
            agent_plugins.mirror_into_view_plugins(Path(info["dir"]))
            return _tool_text(info)
        return _tool_text({"error": f"unknown tool {name}"}, is_error=True)
    except ValueError as e:
        return _tool_text({"error": str(e)}, is_error=True)


def handle_rpc(msg: dict[str, Any]) -> dict[str, Any] | None:
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
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            "instructions": (
                "Install zoto-viz agent plugin zips. Each zip needs manifest.json with "
                "produces[] and consumes[] datastreams, scripts/frontend + scripts/backend, "
                "and ui as TypeScript+tests or a generate-ui prompt."
            ),
        })
    if method == "ping":
        return _ok(rid, {})
    if method == "tools/list":
        return _ok(rid, {"tools": TOOLS})
    if method == "tools/call":
        name = str(params.get("name") or "")
        arguments = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
        return _ok(rid, call_tool(name, arguments))
    if method.startswith("notifications/"):
        return None
    return _err(rid, -32601, f"unknown method {method}")


async def api_mcp(req: web.Request) -> web.StreamResponse:
    if req.method == "GET":
        return web.json_response({
            "ok": True,
            "name": SERVER_NAME,
            "transport": "streamable-http",
            "protocol": PROTOCOL,
            "tools": [t["name"] for t in TOOLS],
        })
    try:
        body = await req.json()
    except Exception:
        return web.json_response(_err(None, -32700, "parse error"), status=400)
    if isinstance(body, list):
        out = [handle_rpc(m) for m in body if isinstance(m, dict)]
        return web.json_response([x for x in out if x is not None])
    if not isinstance(body, dict):
        return web.json_response(_err(None, -32600, "object required"), status=400)
    result = handle_rpc(body)
    if result is None:
        return web.Response(status=204)
    return web.json_response(result)
