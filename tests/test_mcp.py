from __future__ import annotations

import base64
import io
import json
import subprocess
import zipfile
from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase, make_mocked_request

from service import mcp as plugin_mcp
from service import live
from service import paths
from service import plugins


MINIMAL = "id: sample\nname: Sample\nversion: 1\n"


@pytest.fixture(autouse=True)
def _isolate_temper(tmp_path, monkeypatch):
    monkeypatch.setattr(paths, "agent_dir", lambda: tmp_path / "agent")
    (tmp_path / "agent").mkdir()
    live.reset_for_tests()


def _zip(files: dict[str, str | bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, body in files.items():
            data = body.encode("utf-8") if isinstance(body, str) else body
            zf.writestr(name, data)
    return buf.getvalue()


def _repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    repo = tmp_path / "checkout"
    (repo / "plugins" / "src").mkdir(parents=True)
    (repo / "plugins" / ".runtime").mkdir(parents=True)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    return repo


def _git_init(repo: Path) -> None:
    subprocess.run(["git", "init"], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "t@t.test"], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "config", "commit.gpgsign", "false"], cwd=repo, check=True, capture_output=True)
    (repo / ".gitignore").write_text("plugins/.runtime/\nplugins/*.zip\n", encoding="utf-8")


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def test_install_plugin_zip_writes_catalog(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _repo(tmp_path, monkeypatch)
    _git_init(repo)
    raw = _zip({"plugin.yml": MINIMAL})
    call = plugin_mcp.handle_rpc({
        "jsonrpc": "2.0", "id": 3, "method": "tools/call",
        "params": {"name": "install_plugin_zip", "arguments": {"zip_b64": _b64(raw)}},
    })
    payload = json.loads(call["result"]["content"][0]["text"])
    assert payload["id"] == "sample"
    assert payload["sha256"]
    dest = repo / "plugins" / "sample.zip"
    assert dest.is_file()
    assert payload["path"] == str(dest)
    assert (repo / "plugins" / ".runtime" / "sample" / "plugin.yml").is_file()
    cached = subprocess.run(
        ["git", "diff", "--cached", "--", "plugins/sample.zip"],
        cwd=repo, capture_output=True, text=True, check=False,
    )
    assert cached.stdout.strip() == ""


def test_overwrite_guard_and_same_sha(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _repo(tmp_path, monkeypatch)
    _git_init(repo)
    raw = _zip({"plugin.yml": MINIMAL})
    first = plugin_mcp.call_tool("install_plugin_zip", {"zip_b64": _b64(raw)})
    assert first["isError"] is False
    again = plugin_mcp.call_tool("install_plugin_zip", {"zip_b64": _b64(raw)})
    assert again["isError"] is False
    assert json.loads(again["content"][0]["text"])["wrote"] is False
    other = _zip({"plugin.yml": "id: sample\nname: Sample\nversion: 2\n"})
    reminted = plugin_mcp.call_tool("install_plugin_zip", {"zip_b64": _b64(other)})
    assert reminted["isError"] is False
    reminted_payload = json.loads(reminted["content"][0]["text"])
    assert reminted_payload["id"] == "sample-2"
    assert reminted_payload["remintedFrom"] == "sample"
    forced = plugin_mcp.call_tool(
        "install_plugin_zip",
        {"zip_b64": _b64(other), "overwrite": True},
    )
    assert forced["isError"] is False
    assert json.loads(forced["content"][0]["text"])["version"] == 2
    assert (repo / "plugins" / "sample.zip").is_file()


def test_consent_required_for_python(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _repo(tmp_path, monkeypatch)
    _git_init(repo)
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")
    raw = _zip({
        "plugin.yml": MINIMAL + "backend:\n  entry: backend/service.py\n",
        "backend/service.py": "def setup(host):\n    pass\n",
    })
    out = plugin_mcp.call_tool("install_plugin_zip", {"zip_b64": _b64(raw)})
    payload = json.loads(out["content"][0]["text"])
    assert payload["error"] == "consent-required"
    assert payload["consentRequired"] is True
    assert payload["hashes"]["backend"]
    assert (repo / "plugins" / "sample.zip").is_file()
    assert payload.get("pythonReloaded") is True


def test_dirty_tree_git_unavailable_requires_force(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _repo(tmp_path, monkeypatch)
    raw = _zip({"plugin.yml": MINIMAL})
    blocked = plugin_mcp.call_tool("install_plugin_zip", {"zip_b64": _b64(raw)})
    payload = json.loads(blocked["content"][0]["text"])
    assert payload["error"] == "dirty_tree"
    assert "git:unavailable" in payload["paths"]
    assert not (repo / "plugins" / "sample.zip").is_file()
    forced = plugin_mcp.call_tool(
        "install_plugin_zip",
        {"zip_b64": _b64(raw), "force": True},
    )
    assert forced["isError"] is False
    assert (repo / "plugins" / "sample.zip").is_file()


def test_src_owned_id_remints_even_with_force(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _repo(tmp_path, monkeypatch)
    _git_init(repo)
    src = repo / "plugins" / "src" / "sample"
    src.mkdir(parents=True)
    (src / "plugin.yml").write_text(MINIMAL, encoding="utf-8")
    raw = _zip({"plugin.yml": MINIMAL})
    reminted = plugin_mcp.call_tool("install_plugin_zip", {"zip_b64": _b64(raw)})
    payload = json.loads(reminted["content"][0]["text"])
    assert reminted["isError"] is False
    assert payload["id"] == "sample-2"
    assert payload["remintedFrom"] == "sample"
    assert (repo / "plugins" / "sample-2.zip").is_file()
    assert not (repo / "plugins" / "sample.zip").is_file()
    forced = plugin_mcp.call_tool(
        "install_plugin_zip",
        {"zip_b64": _b64(raw), "force": True, "overwrite": True},
    )
    payload = json.loads(forced["content"][0]["text"])
    assert forced["isError"] is False
    assert payload["id"] == "sample-3"
    assert payload["remintedFrom"] == "sample"
    assert not (repo / "plugins" / "sample.zip").is_file()
    assert not (repo / "plugins" / ".runtime" / "sample").exists()


def test_mcp_tools_include_live_and_install(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _repo(tmp_path, monkeypatch)
    listed = plugin_mcp.handle_rpc({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    names = {t["name"] for t in listed["result"]["tools"]}
    assert {
        "list_features", "get_settings", "set_settings",
        "list_plugins", "set_plugin", "set_view", "set_agent",
        "roll_dice", "get_state", "get_traffic", "get_rf_watch", "set_rf_watch",
        "consent_plugin", "draft_plugin", "list_profiles", "apply_profile",
        "list_memories", "add_memory", "delete_memory",         "list_sources",
        "set_source", "delete_source",
        "list_plugin_instances", "set_plugin_instance", "delete_plugin_instance",
        "get_sdm", "list_cameras", "set_sdm",
        "install_plugin_zip",
        "publish_local_plugin",
    } <= names
    unknown = plugin_mcp.call_tool("list_agent_plugins", {})
    assert unknown["isError"] is True
    feat = json.loads(plugin_mcp.call_tool("list_features", {})["content"][0]["text"])
    assert "temper" in feat["agent"]
    assert "hush" in feat["agent"]["weather"]["values"]
    assert "gravity" in feat["anim"]["number"]
    assert "mosaic" in feat["anim"]["enum"]
    assert "earth" in feat["anim"]["enum"]["backdrop"]
    assert "sources" in feat
    assert "sdm" in feat
    assert "sdm" in feat["settings"]
    assert "roll_dice" in feat["dice"]
    assert feat["dice"]["on"]["type"] == "boolean"
    assert feat["dice"]["periodMin"]["min"] == 1
    assert feat["dice"]["periodMin"]["max"] == 60
    assert "theme" in feat["dice"]["include"]["keys"]
    assert "camera" not in feat["settings"]
    assert "mic" not in feat["settings"]
    assert "camera" not in feat["dice"]["include"]["keys"]
    assert "mic" not in feat["dice"]["include"]["keys"]
    got = json.loads(plugin_mcp.call_tool("get_settings", {})["content"][0]["text"])
    assert got["ok"] is True
    assert "temper" in got["agent"]
    agent_out = json.loads(plugin_mcp.call_tool("set_agent", {"temper": 88, "weather": "storm"})["content"][0]["text"])
    assert agent_out["agent"]["band"] == "feral"
    assert agent_out["agent"]["weather"] == "storm"
    view = json.loads(plugin_mcp.call_tool("set_view", {"mode": "plugin:command"})["content"][0]["text"])
    assert view["mode"] == "plugin:command"
    settings = json.loads(plugin_mcp.call_tool("set_settings", {"theme": "ember", "dream": True})["content"][0]["text"])
    assert settings["applied"]["theme"] == "ember"
    physics = json.loads(plugin_mcp.call_tool("set_settings", {"anim": {"gravity": 1.2, "swirl": 0.5, "mosaic": "4"}})["content"][0]["text"])
    assert physics["applied"]["anim"]["gravity"] == 1.2
    assert physics["applied"]["anim"]["mosaic"] == "4"
    dice = json.loads(plugin_mcp.call_tool("roll_dice", {})["content"][0]["text"])
    assert dice["shuffle"] is True
    missing = json.loads(plugin_mcp.call_tool("get_state", {})["content"][0]["text"])
    assert "unavailable" in missing["error"]
    mem = json.loads(plugin_mcp.call_tool("add_memory", {"text": "nest cam is the doorbell"})["content"][0]["text"])
    assert mem["ok"] is True
    listed_mem = json.loads(plugin_mcp.call_tool("list_memories", {})["content"][0]["text"])
    assert any("doorbell" in str(row.get("text") or "") for row in listed_mem["memories"])
    schema = next(t for t in listed["result"]["tools"] if t["name"] == "set_settings")["inputSchema"]
    assert "gravity" in schema["properties"]["anim"]["properties"]
    assert "mosaic" in schema["properties"]["anim"]["properties"]
    assert schema["properties"]["autoconsent"]["type"] == "boolean"
    auto = json.loads(plugin_mcp.call_tool("set_settings", {"autoconsent": True})["content"][0]["text"])
    assert auto["applied"]["autoconsent"] is True


def test_list_plugins_includes_prompt_knob(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _repo(tmp_path, monkeypatch)
    dest = repo / "plugins" / ".runtime" / "sample"
    dest.mkdir(parents=True)
    (dest / "plugin.yml").write_text(MINIMAL, encoding="utf-8")
    (dest / "visualisation.yml").write_text("engine: graph\nbase: topology\n", encoding="utf-8")
    (repo / "plugins" / "sample.zip").write_bytes(_zip({
        "plugin.yml": MINIMAL,
        "visualisation.yml": "engine: graph\nbase: topology\n",
    }))
    listed = json.loads(plugin_mcp.call_tool("list_plugins", {"id": "sample"})["content"][0]["text"])
    keys = {k["key"] for k in listed["plugins"][0]["knobs"]}
    assert "prompt" in keys
    setp = json.loads(plugin_mcp.call_tool("set_plugin", {"id": "sample", "values": {"prompt": "harbour dusk"}})["content"][0]["text"])
    assert setp["values"]["prompt"] == "harbour dusk"
    bad = json.loads(plugin_mcp.call_tool("set_plugin", {"id": "sample", "values": {"nope": "1"}})["content"][0]["text"])
    assert "unknown knob" in bad["error"]


def test_initialize_and_loopback_host(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _repo(tmp_path, monkeypatch)
    init = plugin_mcp.handle_rpc({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}},
    })
    assert init and init["result"]["serverInfo"]["name"] == "zoto-viz-plugins"
    assert init["result"]["capabilities"]["tools"]["listChanged"] is True
    assert "plugin.yml" in init["result"]["instructions"]
    assert "publish_local_plugin" in init["result"]["instructions"]

    async def _run() -> None:
        req = make_mocked_request("GET", "/mcp", headers={"Host": "127.0.0.1"})
        resp = await plugin_mcp.api_mcp(req)
        body = json.loads(resp.body)
        assert body["ok"] is True
        assert "install_plugin_zip" in body["tools"]
        assert "publish_local_plugin" in body["tools"]
        denied = make_mocked_request("GET", "/mcp", headers={"Host": "example.com"})
        bad = await plugin_mcp.api_mcp(denied)
        assert bad.status == 403

    import asyncio
    asyncio.run(_run())
    ping = plugin_mcp.handle_rpc({"jsonrpc": "2.0", "id": 4, "method": "ping"})
    assert ping["result"] == {}
    note = plugin_mcp.handle_rpc({"jsonrpc": "2.0", "method": "notifications/initialized"})
    assert note is None
    bad = plugin_mcp.handle_rpc({"jsonrpc": "2.0", "id": 5, "method": "nope"})
    assert bad["error"]["code"] == -32601


def test_mcp_description_has_no_plugin_install() -> None:
    blob = json.dumps(plugin_mcp.active_tools())
    assert "plugin install" not in blob
    src = Path(plugin_mcp.__file__).read_text(encoding="utf-8")
    assert "plugin install" not in src


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
