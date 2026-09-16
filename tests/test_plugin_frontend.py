"""Compile-on-demand ``/plugins/<id>/module.js`` from src or ``plugins/.runtime/<id>/frontend/``."""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from service import plugin_zip as pz
from service import plugins


ROOT = Path(__file__).resolve().parents[1]


FRONTEND_TS = """\
type Node = { id: string; rate: number; role: string };
declare const zoto: { onTick: ((nodes: Node[]) => void) | null; setStyle: (s: Record<string, unknown>) => void };
zoto.onTick = (nodes) => { zoto.setStyle({ n: nodes.length }); };
"""


def _req(pid: str, query: dict[str, str] | None = None):
    return SimpleNamespace(match_info={"id": pid}, rel_url=SimpleNamespace(query=query or {}))


def _frontend_tree(home: Path, *, pid: str = "pulse-ui") -> Path:
    home.mkdir(parents=True)
    (home / "plugin.yml").write_text(
        "\n".join(
            [
                f"id: {pid}",
                "name: Pulse UI",
                "version: 1",
                "engine: graph",
                "base: topology",
                "capabilities:",
                "  - graph.read",
                "  - graph.style",
                "frontend:",
                "  entry: frontend/index.ts",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (home / "frontend").mkdir()
    (home / "frontend" / "index.ts").write_text(FRONTEND_TS, encoding="utf-8")
    (home / "sky").mkdir()
    (home / "sky" / "fragment.glsl").write_text("void main() {}\n", encoding="utf-8")
    (home / "backend").mkdir()
    (home / "backend" / "readme.txt").write_text("hooks live here\n", encoding="utf-8")
    return home


def _write_frontend_src(repo: Path, *, pid: str = "pulse-ui") -> Path:
    return _frontend_tree(repo / "plugins" / "src" / pid, pid=pid)


def _pack_frontend_zip_only(repo: Path, *, pid: str = "pulse-ui") -> Path:
    pack = repo.parent / "pack" / pid
    _frontend_tree(pack, pid=pid)
    dest = repo / "plugins" / f"{pid}.zip"
    dest.parent.mkdir(parents=True, exist_ok=True)
    pz.pack_tree(pack, dest)
    return dest


def _assert_frontend_row(row: dict) -> None:
    assert row["has_frontend"] is True
    assert row["frontend"]["entry"] == "frontend/index.ts"
    assert row["capabilities"] == ["graph.read", "graph.style"]
    assert row["has_sky"] is True
    assert row["has_sky_shader"] is True
    assert row["has_backend"] is True
    assert row["has_datasource"] is False


def test_module_js_compiles_from_src_frontend_and_caches(tmp_path: Path, monkeypatch) -> None:
    repo = tmp_path / "repo"
    src = _write_frontend_src(repo)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    plugins.reset_bundles()

    if not plugins._ESBUILD.is_file():
        result = plugins.scan(repo)
        assert result["errors"]
        return

    result = plugins.scan(repo)
    assert not result["errors"], result["errors"]
    row = result["plugins"][0]
    assert row["origin"] == "src"
    assert "zip" not in row
    _assert_frontend_row(row)
    src_entry = src / "frontend" / "index.ts"
    assert src_entry.is_file()
    assert not (repo / "plugins" / ".runtime" / "pulse-ui").exists()
    assert plugins.compile_runs() >= 1
    after_scan = plugins.compile_runs()

    first = plugins.api_module(_req("pulse-ui"))
    assert first.status == 200
    assert first.content_type == "text/javascript"
    assert first.body
    assert first.headers["Cache-Control"] == "no-store"
    assert first.headers["X-Content-Type-Options"] == "nosniff"
    assert first.headers["X-Zoto-Viz-Hash"]
    assert plugins.compile_runs() == after_scan  # sha256 + mtime cache hit

    second = plugins.api_module(_req("pulse-ui"))
    assert second.status == 200
    assert second.body == first.body
    assert plugins.compile_runs() == after_scan

    hashed = plugins.api_module(_req("pulse-ui", {"h": first.headers["X-Zoto-Viz-Hash"]}))
    assert hashed.headers["Cache-Control"] == "public, max-age=31536000, immutable"

    src_entry.write_text(FRONTEND_TS + "\nexport const bumped = 1;\n", encoding="utf-8")
    third = plugins.api_module(_req("pulse-ui"))
    assert third.status == 200
    assert plugins.compile_runs() == after_scan + 1


def test_module_js_compiles_from_runtime_frontend_and_caches(tmp_path: Path, monkeypatch) -> None:
    repo = tmp_path / "repo"
    _pack_frontend_zip_only(repo)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    plugins.reset_bundles()

    if not plugins._ESBUILD.is_file():
        result = plugins.scan(repo)
        assert result["errors"]
        return

    result = plugins.scan(repo)
    assert not result["errors"], result["errors"]
    row = result["plugins"][0]
    assert row["origin"] == "zip"
    _assert_frontend_row(row)
    assert not (repo / "plugins" / "src").exists()
    runtime_entry = repo / "plugins" / ".runtime" / "pulse-ui" / "frontend" / "index.ts"
    assert runtime_entry.is_file()
    assert plugins.compile_runs() >= 1
    after_scan = plugins.compile_runs()

    first = plugins.api_module(_req("pulse-ui"))
    assert first.status == 200
    assert first.content_type == "text/javascript"
    assert first.body
    assert first.headers["Cache-Control"] == "no-store"
    assert first.headers["X-Content-Type-Options"] == "nosniff"
    assert first.headers["X-Zoto-Viz-Hash"]
    assert plugins.compile_runs() == after_scan  # sha256 + mtime cache hit

    second = plugins.api_module(_req("pulse-ui"))
    assert second.status == 200
    assert second.body == first.body
    assert plugins.compile_runs() == after_scan

    hashed = plugins.api_module(_req("pulse-ui", {"h": first.headers["X-Zoto-Viz-Hash"]}))
    assert hashed.headers["Cache-Control"] == "public, max-age=31536000, immutable"

    runtime_entry.write_text(FRONTEND_TS + "\nexport const bumped = 1;\n", encoding="utf-8")
    third = plugins.api_module(_req("pulse-ui"))
    assert third.status == 200
    assert plugins.compile_runs() == after_scan + 1


def test_yaml_only_plugin_is_not_broken(tmp_path: Path, monkeypatch) -> None:
    repo = tmp_path / "repo"
    src = repo / "plugins" / "src" / "topology"
    src.mkdir(parents=True)
    (src / "plugin.yml").write_text(
        "id: topology\nname: Topology\nversion: 1\nengine: graph\nbase: topology\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    plugins.reset_bundles()
    result = plugins.scan(repo)
    assert not result["errors"], result["errors"]
    row = result["plugins"][0]
    assert row["id"] == "topology"
    assert row["origin"] == "src"
    assert row["has_frontend"] is False
    assert row["frontend"]["entry"] == "frontend/index.ts"
    assert row["capabilities"] == []
    assert row["has_sky"] is False
    assert row["has_sky_shader"] is False
    missing = plugins.api_module(_req("topology"))
    assert missing.status == 404


def test_unknown_capability_still_rejected(tmp_path: Path) -> None:
    src = tmp_path / "bad-caps"
    src.mkdir()
    (src / "plugin.yml").write_text(
        "id: x\nname: X\nversion: 1\nengine: graph\nbase: topology\n"
        "runtime: typescript\nentry: index.ts\ncapabilities:\n  - graph.read\n",
        encoding="utf-8",
    )
    (src / "index.ts").write_text("export {}\n", encoding="utf-8")
    doc = {
        "id": "x",
        "name": "X",
        "version": 1,
        "engine": "graph",
        "base": "topology",
        "runtime": "typescript",
        "entry": "index.ts",
        "capabilities": ["graph.read", "os.exec"],
    }
    try:
        plugins.compile_typescript(doc, src / "plugin.yml")
        raise AssertionError("bad caps")
    except ValueError as e:
        assert "capabilities" in str(e)
