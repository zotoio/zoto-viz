from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase

from service import agent_plugins
from service import mcp as plugin_mcp
from service import paths
from service import plugins


EX = Path(__file__).resolve().parents[1] / "examples" / "agent-plugins" / "lan-pulse"


def _zip(files: dict[str, str | bytes], *, folder: str = "") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, body in files.items():
            data = body.encode("utf-8") if isinstance(body, str) else body
            z.writestr(f"{folder}{name}" if folder else name, data)
    return buf.getvalue()


def _tree(ui: str = "prompt") -> dict[str, str]:
    front = "export function heatFrom(n: {rate:number}[]) { return n.length; }\ndeclare const zoto: { onTick: any; setStyle: (s: object) => void };\nzoto.onTick = (n) => zoto.setStyle({ heat: heatFrom(n) });\n"
    back = "def setup(host):\n    host.log('ok')\n\ndef on_snapshot(host, msg):\n    msg.setdefault('plugin_state', {})[host.plugin_id] = {'n': 1}\n"
    man: dict = {
        "id": "lan-pulse",
        "name": "LAN Pulse",
        "version": 1,
        "produces": ["graph", "hud"],
        "consumes": ["devices", "flows"],
        "scripts": {
            "frontend": "scripts/frontend/index.ts",
            "backend": "scripts/backend/service.py",
        },
        "skills": ["skills/generate-ui"],
    }
    files = {
        "scripts/frontend/index.ts": front,
        "scripts/backend/service.py": back,
        "skills/generate-ui/SKILL.md": "---\nname: generate-ui\ndescription: gen\n---\n# Generate\n",
    }
    if ui == "prompt":
        man["ui"] = {
            "kind": "prompt",
            "skill": "skills/generate-ui/SKILL.md",
            "prompt": "ui/prompt.md",
        }
        files["ui/prompt.md"] = "Generate a unique overlay. Characters only in 50%."
    else:
        man["ui"] = {"kind": "typescript", "entry": "ui/index.ts", "tests": "ui/index.test.ts"}
        files["ui/index.ts"] = front
        files["ui/index.test.ts"] = "import { describe, it, expect } from 'vitest';\ndescribe('ui', () => { it('ticks', () => { expect(1).toBe(1); }); });\n"
        man.pop("skills", None)
        files.pop("skills/generate-ui/SKILL.md")
    files["manifest.json"] = json.dumps(man)
    return files


def test_agent_plugins_dir() -> None:
    assert paths.agent_plugins_dir().name == "agent-plugins"


def test_example_manifest_validates() -> None:
    doc = json.loads((EX / "manifest.json").read_text(encoding="utf-8"))
    agent_plugins.validate_manifest(doc)
    assert doc["produces"] == ["graph", "hud", "plugin_state"]
    assert doc["consumes"] == ["devices", "flows", "feed"]
    assert doc["ui"]["kind"] == "prompt"


def test_install_prompt_zip(tmp_path: Path) -> None:
    info = agent_plugins.install_bytes(_zip(_tree("prompt")), dest=tmp_path, overwrite=True)
    assert info["id"] == "lan-pulse"
    assert info["needsUiGeneration"] is True
    assert (tmp_path / "lan-pulse" / "plugin.yml").is_file()
    brief = agent_plugins.ui_brief("lan-pulse", dest=tmp_path)
    assert "consumes:" in brief["brief"]
    assert "characters only in 50%" in brief["prompt"].lower() or "50%" in brief["skill"]
    written = agent_plugins.write_generated_ui(
        "lan-pulse",
        "declare const zoto: { onTick: any; setStyle: (s: object) => void };\nzoto.onTick = () => zoto.setStyle({ heat: 1 });\n",
        "describe('overlay', () => { it('ok', () => { expect(1).toBe(1); }); });\n",
        dest=tmp_path,
    )
    assert written["needsUiGeneration"] is False
    assert (tmp_path / "lan-pulse" / "ui" / "index.ts").is_file()


def test_install_typescript_zip(tmp_path: Path) -> None:
    info = agent_plugins.install_bytes(_zip(_tree("ts"), folder="lan-pulse/"), dest=tmp_path, overwrite=True)
    assert info["ui"]["kind"] == "typescript"
    assert "needsUiGeneration" not in info


def test_zip_slip_and_missing_manifest(tmp_path: Path) -> None:
    try:
        agent_plugins.install_bytes(_zip({"../evil.py": "x"}), dest=tmp_path)
        raise AssertionError("slip")
    except ValueError:
        pass
    try:
        agent_plugins.install_bytes(_zip({"scripts/frontend/index.ts": "x"}), dest=tmp_path)
        raise AssertionError("manifest")
    except ValueError:
        pass
    try:
        agent_plugins.install_bytes(b"not-a-zip", dest=tmp_path)
        raise AssertionError("zip")
    except ValueError:
        pass
    try:
        agent_plugins.install_b64("!!!!", dest=tmp_path)
        raise AssertionError("b64")
    except ValueError:
        pass


def test_duplicate_refused(tmp_path: Path) -> None:
    raw = _zip(_tree("prompt"))
    agent_plugins.install_bytes(raw, dest=tmp_path)
    try:
        agent_plugins.install_bytes(raw, dest=tmp_path, overwrite=False)
        raise AssertionError("dup")
    except ValueError:
        pass
    again = agent_plugins.install_bytes(raw, dest=tmp_path, overwrite=True)
    assert again["id"] == "lan-pulse"


def test_scan_skips_broken(tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    got = agent_plugins.scan(empty)
    assert got["plugins"] == []
    bad = tmp_path / "broken"
    bad.mkdir()
    (bad / "manifest.json").write_text("{", encoding="utf-8")
    got = agent_plugins.scan(tmp_path)
    assert got["errors"]


def test_ui_brief_rejects_typescript(tmp_path: Path) -> None:
    agent_plugins.install_bytes(_zip(_tree("ts")), dest=tmp_path, overwrite=True)
    try:
        agent_plugins.ui_brief("lan-pulse", dest=tmp_path)
        raise AssertionError("ts")
    except ValueError:
        pass
    try:
        agent_plugins.ui_brief("missing", dest=tmp_path)
        raise AssertionError("missing")
    except ValueError:
        pass


def test_write_generated_ui_gates(tmp_path: Path) -> None:
    agent_plugins.install_bytes(_zip(_tree("prompt")), dest=tmp_path, overwrite=True)
    try:
        agent_plugins.write_generated_ui("lan-pulse", "no host", "describe('x', () => {});", dest=tmp_path)
        raise AssertionError("zoto")
    except ValueError:
        pass
    try:
        agent_plugins.write_generated_ui("lan-pulse", "zoto.onTick = () => {}", "no tests here", dest=tmp_path)
        raise AssertionError("tests")
    except ValueError:
        pass


def test_example_tree_zips(tmp_path: Path) -> None:
    files: dict[str, str] = {}
    for p in EX.rglob("*"):
        if p.is_file():
            files[str(p.relative_to(EX))] = p.read_text(encoding="utf-8")
    info = agent_plugins.install_bytes(_zip(files), dest=tmp_path, overwrite=True)
    assert info["id"] == "lan-pulse"
    listed = agent_plugins.scan(tmp_path)
    assert listed["plugins"][0]["produces"]


def test_mcp_initialize_and_install(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(agent_plugins, "DIR", lambda: tmp_path)
    init = plugin_mcp.handle_rpc({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}},
    })
    assert init and init["result"]["serverInfo"]["name"] == "zoto-viz-plugins"
    listed = plugin_mcp.handle_rpc({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    names = {t["name"] for t in listed["result"]["tools"]}
    assert "install_plugin_zip" in names
    import base64
    raw = _zip(_tree("prompt"))
    call = plugin_mcp.handle_rpc({
        "jsonrpc": "2.0", "id": 3, "method": "tools/call",
        "params": {
            "name": "install_plugin_zip",
            "arguments": {"zip_b64": base64.b64encode(raw).decode(), "overwrite": True, "mirror": False},
        },
    })
    payload = json.loads(call["result"]["content"][0]["text"])
    assert payload["id"] == "lan-pulse"
    assert payload.get("uiBrief")
    ping = plugin_mcp.handle_rpc({"jsonrpc": "2.0", "id": 4, "method": "ping"})
    assert ping["result"] == {}
    note = plugin_mcp.handle_rpc({"jsonrpc": "2.0", "method": "notifications/initialized"})
    assert note is None
    bad = plugin_mcp.handle_rpc({"jsonrpc": "2.0", "id": 5, "method": "nope"})
    assert bad["error"]["code"] == -32601
    unknown = plugin_mcp.call_tool("nope", {})
    assert unknown["isError"] is True
    listed2 = plugin_mcp.call_tool("list_agent_plugins", {})
    assert "lan-pulse" in listed2["content"][0]["text"]


def test_mcp_http_get_and_call(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(agent_plugins, "DIR", lambda: tmp_path)

    async def _run() -> None:
        from aiohttp.test_utils import make_mocked_request
        # GET discovery
        req = make_mocked_request("GET", "/mcp")
        resp = await plugin_mcp.api_mcp(req)
        body = json.loads(resp.body)
        assert body["ok"] is True
        assert "install_plugin_zip" in body["tools"]

    import asyncio
    asyncio.run(_run())
    bad_rpc = plugin_mcp.handle_rpc({"jsonrpc": "1.0", "id": 1, "method": "ping"})
    assert bad_rpc["error"]["code"] == -32600


def test_typescript_tests_must_assert(tmp_path: Path) -> None:
    files = _tree("ts")
    files["ui/index.test.ts"] = "export const x = 1;\n"
    try:
        agent_plugins.install_bytes(_zip(files), dest=tmp_path)
        raise AssertionError("tests")
    except ValueError:
        pass
    files = _tree("prompt")
    files.pop("scripts/frontend/index.ts")
    try:
        agent_plugins.install_bytes(_zip(files), dest=tmp_path)
        raise AssertionError("front")
    except ValueError:
        pass
    try:
        agent_plugins.install_bytes(_zip({"manifest.json": "{}", "nope.exe": "x"}), dest=tmp_path)
        raise AssertionError("exe")
    except ValueError:
        pass


def test_mcp_write_plugin_ui(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(agent_plugins, "DIR", lambda: tmp_path)
    monkeypatch.setattr(agent_plugins, "mirror_into_view_plugins", lambda home: None)
    agent_plugins.install_bytes(_zip(_tree("prompt")), dest=tmp_path, overwrite=True)
    out = plugin_mcp.call_tool("write_plugin_ui", {
        "id": "lan-pulse",
        "entry_ts": "declare const zoto: { onTick: any }; zoto.onTick = () => {};",
        "tests_ts": "describe('ui', () => { it('ok', () => {}); });",
    })
    assert out["isError"] is False
    brief = plugin_mcp.call_tool("plugin_ui_brief", {"id": "lan-pulse"})
    assert brief.get("isError") is False


def test_validate_manifest_rejects_junk() -> None:
    try:
        agent_plugins.validate_manifest([])
        raise AssertionError("list")
    except ValueError:
        pass
    try:
        agent_plugins.validate_manifest({"id": "x"})
        raise AssertionError("short")
    except ValueError:
        pass


def test_cli_zip(tmp_path: Path, monkeypatch) -> None:
    zip_path = tmp_path / "p.zip"
    zip_path.write_bytes(_zip(_tree("prompt")))
    dest = tmp_path / "agent-plugins"
    dest.mkdir()
    views = tmp_path / "views"
    views.mkdir()
    monkeypatch.setattr(agent_plugins, "DIR", lambda: dest)
    monkeypatch.setattr(plugins, "DIR", views)
    assert plugins._cli_zip(str(zip_path), True) == 0
    assert plugins._cli_zip(str(tmp_path / "missing.zip"), False) == 1


def test_install_b64_and_mirror(tmp_path: Path, monkeypatch) -> None:
    import base64
    views = tmp_path / "views"
    views.mkdir()
    monkeypatch.setattr(plugins, "DIR", views)
    raw = _zip(_tree("prompt"))
    info = agent_plugins.install_b64(base64.b64encode(raw).decode(), dest=tmp_path, overwrite=True)
    agent_plugins.mirror_into_view_plugins(Path(info["dir"]))
    assert (views / "lan-pulse" / "manifest.json").is_file()


class McpHttpTests(AioHTTPTestCase):
    async def get_application(self) -> web.Application:
        app = web.Application()
        app.router.add_get("/mcp", plugin_mcp.api_mcp)
        app.router.add_post("/mcp", plugin_mcp.api_mcp)
        return app

    async def test_get_post_batch_and_notify(self) -> None:
        got = await self.client.get("/mcp")
        assert got.status == 200
        ping = await self.client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"})
        assert ping.status == 200
        assert (await ping.json())["result"] == {}
        batch = await self.client.post("/mcp", json=[
            {"jsonrpc": "2.0", "id": 2, "method": "ping"},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
        ])
        assert batch.status == 200
        note = await self.client.post("/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"})
        assert note.status == 204
        bad = await self.client.post("/mcp", data=b"not-json", headers={"Content-Type": "application/json"})
        assert bad.status == 400
        nope = await self.client.post("/mcp", json=[1, 2])
        assert nope.status == 200
        empty = await self.client.post("/mcp", json=[])
        assert empty.status == 200
        scalar = await self.client.post("/mcp", json="nope")
        assert scalar.status == 400
