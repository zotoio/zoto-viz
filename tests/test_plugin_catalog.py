"""CI catalog scan: shipped plugins/src/<id>/; gitignored zips are contrib-only."""
from __future__ import annotations

from pathlib import Path

import pytest

from service import paths
from service import plugin_zip as pz
from service import plugins


ROOT = Path(__file__).resolve().parents[1]
PLUGINS = ROOT / "plugins"
SRC = PLUGINS / "src"
ARCADE_DOOM = ROOT / "web" / "src" / "arcade" / "doom.ts"
MAIN = ROOT / "web" / "src" / "app" / "main.ts"
DISPATCH = ROOT / "web" / "src" / "plugins" / "plugin-visualisation.ts"

_MIN_YML = "id: {pid}\nname: {name}\nversion: {version}\n"


def _src_ids() -> list[str]:
    return sorted(
        p.name for p in SRC.iterdir()
        if p.is_dir() and (p / "plugin.yml").is_file()
    )


def _collision_errors(result: dict) -> list[dict]:
    return [
        e for e in (result.get("errors") or [])
        if "src catalog owns id" in str(e.get("error") or "")
    ]


def test_catalog_from_src() -> None:
    src_ids = set(_src_ids())
    assert src_ids, "shipped plugins/src/<id>/ catalog is empty"
    result = plugins.scan()
    by_id = {p["id"]: p for p in result["plugins"]}
    missing = src_ids - by_id.keys()
    assert not missing, f"src ids missing from scan(): {missing}"
    for pid in src_ids:
        row = by_id[pid]
        assert row.get("origin") == "src"
        assert "zip" not in row
        assert Path(row["file"]).resolve() == (SRC / pid / "plugin.yml").resolve()
    assert not _collision_errors(result)


def test_scan_plugins_dir_sees_src() -> None:
    src_ids = set(_src_ids())
    result = plugins.scan(PLUGINS)
    ids = {p["id"] for p in result["plugins"]}
    missing = src_ids - ids
    assert not missing, f"src ids missing from scan(PLUGINS): {missing}"
    assert "doom" in ids
    assert "lan-pulse" in ids
    assert not _collision_errors(result)
    for row in result["plugins"]:
        if row["id"] in src_ids:
            assert row.get("origin") == "src"


def test_doom_view_wraps_arcade_id() -> None:
    result = plugins.scan(PLUGINS)
    errors = [e for e in result["errors"] if "doom" in str(e.get("file"))]
    assert not errors, errors
    row = next(p for p in result["plugins"] if p["id"] == "doom")
    assert row.get("origin") == "src"
    viz = row.get("visualisation") or {}
    assert viz.get("engine") == "doom"
    assert row.get("engine") in (None, "doom")
    # View wrap: engine doom → arcadeId dispatch. Not an overlay-only row.
    assert "overlay" not in row or not row.get("overlay")
    assert ARCADE_DOOM.is_file()
    doom_src = ARCADE_DOOM.read_text(encoding="utf-8")
    assert "export class DoomView" in doom_src
    main = MAIN.read_text(encoding="utf-8")
    assert "from \"../arcade/doom\"" in main or "from '../arcade/doom'" in main
    assert "doom:" in main and "DoomView" in main
    dispatch = DISPATCH.read_text(encoding="utf-8")
    assert "arcadeId: spec.engine" in dispatch
    assert '"doom"' in dispatch


def test_lan_pulse_frontend_backend_declarative_datasource() -> None:
    src = SRC / "lan-pulse"
    assert (src / "frontend" / "index.ts").is_file()
    assert (src / "backend" / "service.py").is_file()
    assert not (src / "datasource" / "collector.py").is_file()
    assert not (src / "skills" / "generate-ui" / "SKILL.md").is_file()
    assert not (src / "ui" / "prompt.md").is_file()
    doc = plugins.load_file(src / "plugin.yml")
    ds = doc.get("datasource") or {}
    assert ds.get("produces") == ["graph", "hud", "plugin_state"]
    assert ds.get("consumes") == ["devices", "flows", "feed"]
    result = plugins.scan(PLUGINS)
    row = next(p for p in result["plugins"] if p["id"] == "lan-pulse")
    assert row.get("origin") == "src"
    assert row["has_frontend"] is True
    assert row["has_backend"] is True
    assert row["has_datasource"] is False
    viz = row.get("visualisation") or {}
    assert viz.get("engine") == "graph"
    assert viz.get("base") == "talkers"


FORMER_MODES = [
    "topology", "talkers", "services", "protocols", "layers", "watch",
    "netpong", "invaders", "command", "frogger", "cores", "load", "cpupong", "doom",
]
RF_WRAPPERS = {"air-ssid": "wifi", "air-bt": "bluetooth"}
EXTRA_VIEWS = (
    "lan-heat", "lan-pong", "pulse-ts", "lan-pulse", "drone-show",
    "waves", "orbits", "helix", "skyline", "pacman", "tetris", "portal",
)


def test_former_modes_are_menu_plugins() -> None:
    result = plugins.scan(PLUGINS)
    by_id = {p["id"]: p for p in result["plugins"]}
    for pid in FORMER_MODES:
        assert pid in by_id, f"{pid} missing from catalog menu"
        row = by_id[pid]
        viz = row.get("visualisation") or {}
        assert viz.get("engine"), f"{pid} is overlay-only (no visualisation.engine)"
        assert not row.get("overlay")
    for pid, base in RF_WRAPPERS.items():
        assert pid in by_id, f"{pid} missing from catalog"
        viz = by_id[pid].get("visualisation") or {}
        assert viz.get("engine") == "graph"
        assert viz.get("base") == base
    for pid in EXTRA_VIEWS:
        assert pid in by_id, f"{pid} missing extra catalog row"
        viz = by_id[pid].get("visualisation") or {}
        assert viz.get("engine"), f"{pid} is overlay-only"


def test_scan_src_only_row(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = tmp_path / "repo"
    src = repo / "plugins" / "src" / "alpha"
    src.mkdir(parents=True)
    (src / "plugin.yml").write_text(_MIN_YML.format(pid="alpha", name="Alpha", version=1), encoding="utf-8")
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    result = plugins.scan()
    assert [p["id"] for p in result["plugins"]] == ["alpha"]
    row = result["plugins"][0]
    assert row["origin"] == "src"
    assert "zip" not in row
    assert row["file"].endswith("plugin.yml")
    assert "src/alpha" in row["file"].replace("\\", "/")
    assert not result["errors"]
    assert not (repo / "plugins" / ".runtime" / "alpha").exists()


def test_scan_zip_only_when_no_src(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = tmp_path / "repo"
    plug = repo / "plugins"
    plug.mkdir(parents=True)
    pack = tmp_path / "pack" / "beta"
    pack.mkdir(parents=True)
    (pack / "plugin.yml").write_text(_MIN_YML.format(pid="beta", name="Beta", version=1), encoding="utf-8")
    zpath = plug / "beta.zip"
    pz.pack_tree(pack, zpath)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    result = plugins.scan()
    assert [p["id"] for p in result["plugins"]] == ["beta"]
    row = result["plugins"][0]
    assert row["origin"] == "zip"
    assert row["zip"] == str(zpath)
    assert row["sha256"] == pz.plugin_sha256(zpath)
    assert (plug / ".runtime" / "beta" / "plugin.yml").is_file()
    assert not result["errors"]


def test_scan_colliding_zip_skipped(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = tmp_path / "repo"
    src = repo / "plugins" / "src" / "alpha"
    src.mkdir(parents=True)
    (src / "plugin.yml").write_text(_MIN_YML.format(pid="alpha", name="Alpha", version=1), encoding="utf-8")
    pack = tmp_path / "pack" / "alpha"
    pack.mkdir(parents=True)
    (pack / "plugin.yml").write_text(_MIN_YML.format(pid="alpha", name="ZipAlpha", version=9), encoding="utf-8")
    zpath = repo / "plugins" / "alpha.zip"
    pz.pack_tree(pack, zpath)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    result = plugins.scan()
    assert [p["id"] for p in result["plugins"]] == ["alpha"]
    row = result["plugins"][0]
    assert row["origin"] == "src"
    assert row["version"] == 1
    assert "zip" not in row
    assert not any(p.get("origin") == "zip" for p in result["plugins"])
    hits = _collision_errors(result)
    assert hits, result.get("errors")
    assert any(str(zpath) == e.get("file") for e in hits)
    assert any("alpha" in str(e.get("error")) for e in hits)
    assert not (repo / "plugins" / ".runtime" / "alpha").exists()


def test_scan_local_zip(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = tmp_path / "repo"
    src = repo / "plugins" / "src" / "alpha"
    src.mkdir(parents=True)
    (src / "plugin.yml").write_text(_MIN_YML.format(pid="alpha", name="Alpha", version=1), encoding="utf-8")
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    pack = tmp_path / "pack" / "gamma"
    pack.mkdir(parents=True)
    (pack / "plugin.yml").write_text(_MIN_YML.format(pid="gamma", name="Gamma", version=1), encoding="utf-8")
    local = paths.plugin_local_dir(create=True)
    zpath = local / "gamma.zip"
    pz.pack_tree(pack, zpath)
    result = plugins.scan()
    by_id = {p["id"]: p for p in result["plugins"]}
    assert "alpha" in by_id and by_id["alpha"]["origin"] == "src"
    assert by_id["gamma"]["origin"] == "local"
    assert by_id["gamma"]["zip"] == str(zpath)
    assert (paths.plugin_local_runtime_dir() / "gamma" / "plugin.yml").is_file()
    assert not result["errors"]


def test_scan_yaml_tree_fallback(tmp_path: Path) -> None:
    (tmp_path / "solo.yml").write_text(
        _MIN_YML.format(pid="solo", name="Solo", version=1), encoding="utf-8",
    )
    result = plugins.scan(tmp_path)
    assert [p["id"] for p in result["plugins"]] == ["solo"]
    assert result["plugins"][0].get("origin") is None
    assert "zip" not in result["plugins"][0]
    assert not result["errors"]
