"""First-startup home-plugin migration and dirty-tree checks.

Copies leftover user-dir plugin trees (``user_dir()/plugins`` and
``user_dir()/agent-plugins``) into ``plugins/src/<id>/`` when that id is not
already in the committed catalog. Does not pack, git-add, or delete the
legacy home trees.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import yaml

from . import paths
from . import plugin_backend as pb
from . import plugin_sky as psky
from . import plugin_zip as pz
from . import plugins

MIGRATE_HINT = "it is live in the catalog"

VIZ_KEYS = frozenset({"engine", "base", "look", "style", "layout", "options", "config"})
DROP_DIRS = ("skills", "ui")
SCRIPT_MAP = (
    ("scripts/frontend", "frontend"),
    ("scripts/backend", "backend"),
)


GIT_UNAVAILABLE = "git:unavailable"


class DirtyTreeError(ValueError):
    """Working tree has uncommitted changes on catalog paths for this plugin id."""

    def __init__(self, paths: list[str], plugin_id: str = "") -> None:
        super().__init__("dirty_tree")
        self.paths = list(paths)
        self.plugin_id = plugin_id


class SrcOwnedError(ValueError):
    """A shipped ``plugins/src/<id>/`` tree already owns this plugin id."""

    def __init__(self, plugin_id: str, path: str = "") -> None:
        super().__init__(f"src owns {plugin_id!r}")
        self.plugin_id = plugin_id
        self.path = path


def dirty_tree_paths(plugin_id: str, repo_root: Path | None = None) -> list[str]:
    """Uncommitted paths under ``plugins/src/<id>/``.

    Gitignored contrib zips (``plugins/<id>.zip``) and the runtime cache
    (``plugins/.runtime/<id>/``) are not catalog paths. Fail closed: git missing
    or ``git status`` nonzero is treated as dirty so MCP ``install_plugin_zip``
    refuses the write unless ``force`` is set. MCP still refuses a src-owned
    id first and skips this check when ``plugin.yml`` exists under src.
    """
    root = Path(repo_root) if repo_root is not None else paths.repo_root()
    pid = str(plugin_id or "").strip()
    if not pid:
        return []
    rels = [
        f"plugins/src/{pid}",
    ]
    try:
        proc = subprocess.run(
            ["git", "status", "--porcelain", "--", *rels],
            cwd=root,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return [GIT_UNAVAILABLE]
    if proc.returncode != 0:
        return [GIT_UNAVAILABLE]
    found: list[str] = []
    for raw in proc.stdout.splitlines():
        line = raw.rstrip()
        if len(line) < 4:
            continue
        path = line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        path = path.strip().strip('"')
        if path:
            found.append(path)
    return found


def catalog_ids(repo_root: Path | None = None) -> set[str]:
    """Ids already present as ``plugins/<id>.zip`` or ``plugins/src/<id>/``."""
    root = Path(repo_root) if repo_root is not None else paths.repo_root()
    ids: set[str] = set()
    zips = paths.plugin_zips_dir(root)
    if zips.is_dir():
        for zip_path in zips.glob("*.zip"):
            ids.add(zip_path.stem)
    src = paths.plugin_src_dir(root)
    if src.is_dir():
        for child in src.iterdir():
            if (child / "plugin.yml").is_file() or (child / "plugin.yaml").is_file():
                ids.add(child.name)
    local = paths.plugin_local_dir()
    if local.is_dir():
        for zip_path in local.glob("*.zip"):
            ids.add(zip_path.stem)
    return ids


def split_plugin_doc(doc: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Split a combined YAML/manifest into plugin.yml fields + visualisation.yml fields."""
    plugin: dict[str, Any] = {}
    viz: dict[str, Any] = {}
    datasource: dict[str, Any] = {}
    if isinstance(doc.get("datasource"), dict):
        datasource.update(doc["datasource"])
    for key, value in doc.items():
        if key in {"scripts", "ui", "skills"}:
            continue
        if key in VIZ_KEYS:
            viz[key] = value
        elif key in {"produces", "consumes"}:
            datasource[key] = value
        elif key == "datasource":
            continue
        else:
            plugin[key] = value
    if datasource:
        plugin["datasource"] = datasource
    return plugin, viz


def artefact_hashes(home: Path, doc: dict[str, Any] | None = None) -> dict[str, str]:
    """sha256s of sensitive artefacts for ``plugins.consented_for`` (no stamp-file read)."""
    home = Path(home)
    yml = home / "plugin.yml" if (home / "plugin.yml").is_file() else home / "plugin.yaml"
    row = dict(doc or {})
    extra: dict[str, Any] = {}
    try:
        extra.update(pb.artefacts(yml if yml.is_file() else home))
    except OSError:
        pass
    try:
        extra.update(psky.artefacts(yml if yml.is_file() else home))
    except OSError:
        pass
    merged = {**row, **extra}
    hashes: dict[str, str] = {}
    entry = plugins.resolve_frontend_entry(merged, home)
    front = home / entry
    if (home / "frontend").is_dir() or front.is_file():
        if front.is_file():
            hashes["frontend"] = pz.plugin_sha256(front)
    if extra.get("backend_sha256"):
        hashes["backend"] = str(extra["backend_sha256"])
    if extra.get("collector_sha256"):
        hashes["collector"] = str(extra["collector_sha256"])
    if extra.get("shader_sha256"):
        hashes["shader"] = str(extra["shader_sha256"])
    return hashes


def merged_doc(doc: dict[str, Any], home: Path) -> dict[str, Any]:
    flags = plugins.optional_part_flags(doc, home, nested=True)
    extra = pb.artefacts(home / "plugin.yml" if (home / "plugin.yml").is_file() else home)
    extra.update(psky.artefacts(home / "plugin.yml" if (home / "plugin.yml").is_file() else home))
    return {**doc, **flags, **extra}


def consent_payload(home: Path, doc: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str], bool]:
    """Return (review-doc, hashes, needs_consent_response)."""
    merged = merged_doc(doc, home)
    hashes = artefact_hashes(home, merged)
    review = dict(merged)
    if hashes.get("frontend"):
        review["hash"] = hashes["frontend"]
        review["has_frontend"] = True
    needed = plugins.needs_review(review) and not plugins.consented_for(review, hashes or None)
    return review, hashes, needed


def migrate_home_plugins(
    *,
    repo_root: Path | None = None,
    home_plugins: Path | None = None,
    home_agents: Path | None = None,
) -> dict[str, list[str]]:
    """Copy unknown home plugins into ``plugins/src/<id>/``. No pack, no git, no delete."""
    root = Path(repo_root) if repo_root is not None else paths.repo_root()
    src_root = paths.plugin_src_dir(root)
    present = catalog_ids(root)
    copied: list[str] = []
    skipped: list[str] = []
    dropped: list[str] = []
    views = Path(home_plugins) if home_plugins is not None else paths.plugins_dir()
    agents = Path(home_agents) if home_agents is not None else paths.agent_plugins_dir()
    for pid, source, kind in _discover_home(views, agents):
        if pid in present:
            skipped.append(pid)
            continue
        dest = src_root / pid
        try:
            notes = _copy_home_plugin(source, dest, kind)
        except (ValueError, OSError, json.JSONDecodeError) as e:
            print(f"[plugin-migrate] {pid} skipped: {e}", flush=True)
            skipped.append(pid)
            continue
        present.add(pid)
        copied.append(pid)
        print(
            f"[plugin-migrate] {pid} copied to plugins/src/{pid}/ — {MIGRATE_HINT}",
            flush=True,
        )
        if notes:
            dropped.append(pid)
            print(
                f"[plugin-migrate] {pid} dropped {', '.join(notes)} (v1 has no home for them)",
                flush=True,
            )
    return {"copied": copied, "skipped": skipped, "dropped": dropped}


def _discover_home(views: Path, agents: Path) -> list[tuple[str, Path, str]]:
    found: list[tuple[str, Path, str]] = []
    seen: set[str] = set()
    if agents.is_dir():
        for child in sorted(agents.iterdir()):
            if not child.is_dir() or not (child / "manifest.json").is_file():
                continue
            pid = child.name
            seen.add(pid)
            found.append((pid, child, "agent"))
    if not views.is_dir():
        return found
    for child in sorted(views.iterdir()):
        if child.is_file() and child.suffix.lower() in {".yml", ".yaml"}:
            pid = child.stem
            if pid in seen:
                continue
            seen.add(pid)
            found.append((pid, child, "flat"))
        elif child.is_dir():
            yml = child / "plugin.yml" if (child / "plugin.yml").is_file() else child / "plugin.yaml"
            if not yml.is_file():
                continue
            pid = child.name
            if pid in seen:
                continue
            seen.add(pid)
            found.append((pid, child, "tree"))
    return found


def _copy_home_plugin(source: Path, dest: Path, kind: str) -> list[str]:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        raise ValueError(f"{dest} already exists")
    dropped: list[str] = []
    if kind == "flat":
        doc = yaml.safe_load(source.read_text(encoding="utf-8"))
        if not isinstance(doc, dict):
            raise ValueError(f"{source} is not a mapping")
        pid = str(doc.get("id") or source.stem)
        plugin, viz = split_plugin_doc(doc)
        plugin.setdefault("id", pid)
        plugin.setdefault("name", pid)
        plugin.setdefault("version", 1)
        dest.mkdir(parents=True)
        (dest / "plugin.yml").write_text(_dump(plugin), encoding="utf-8")
        if viz:
            (dest / "visualisation.yml").write_text(_dump(viz), encoding="utf-8")
        return dropped
    dest.mkdir(parents=True)
    if kind == "agent":
        plugin, viz = _from_manifest(source)
        (dest / "plugin.yml").write_text(_dump(plugin), encoding="utf-8")
        if viz:
            (dest / "visualisation.yml").write_text(_dump(viz), encoding="utf-8")
        dropped.extend(_copy_scripts_and_parts(source, dest))
        return dropped
    dropped.extend(_copy_scripts_and_parts(source, dest))
    for child in source.iterdir():
        name = child.name
        if name in DROP_DIRS:
            dropped.append(name + "/")
            continue
        if name in {"scripts", "manifest.json"}:
            continue
        target = dest / name
        if child.is_dir():
            if target.exists():
                continue
            shutil.copytree(child, target)
        elif not target.exists():
            shutil.copy2(child, target)
    _rewrite_plugin_yml(dest)
    return dropped


def _from_manifest(home: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    raw = json.loads((home / "manifest.json").read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("manifest.json must be an object")
    pid = str(raw.get("id") or home.name)
    version = raw.get("version") or 1
    try:
        version = int(version)
    except (TypeError, ValueError):
        version = 1
    plugin: dict[str, Any] = {
        "id": pid,
        "name": str(raw.get("name") or pid),
        "version": version,
    }
    if raw.get("hint"):
        plugin["hint"] = raw["hint"]
    if raw.get("capabilities"):
        plugin["capabilities"] = raw["capabilities"]
    ds: dict[str, Any] = {}
    if raw.get("produces"):
        ds["produces"] = raw["produces"]
    if raw.get("consumes"):
        ds["consumes"] = raw["consumes"]
    if ds:
        plugin["datasource"] = ds
    if (home / "scripts" / "frontend").exists() or (home / "frontend").exists():
        plugin["frontend"] = {"entry": "frontend/index.ts"}
    if (home / "scripts" / "backend").exists() or (home / "backend").exists():
        plugin["backend"] = {"entry": "backend/service.py"}
    viz: dict[str, Any] = {}
    if raw.get("engine"):
        viz["engine"] = raw["engine"]
    if raw.get("base"):
        viz["base"] = raw["base"]
    if raw.get("look"):
        viz["look"] = raw["look"]
    return plugin, viz


def _copy_scripts_and_parts(source: Path, dest: Path) -> list[str]:
    dropped: list[str] = []
    for src_rel, target_rel in SCRIPT_MAP:
        src = source / src_rel
        if src.is_dir():
            shutil.copytree(src, dest / target_rel, dirs_exist_ok=True)
        elif src.is_file():
            out = dest / target_rel
            if target_rel in {"frontend", "backend"}:
                out = dest / target_rel / ("index.ts" if target_rel == "frontend" else "service.py")
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, out)
    for name in DROP_DIRS:
        if (source / name).exists():
            dropped.append(name + "/")
    return dropped


def _rewrite_plugin_yml(dest: Path) -> None:
    yml = dest / "plugin.yml" if (dest / "plugin.yml").is_file() else dest / "plugin.yaml"
    if not yml.is_file():
        return
    raw = yaml.safe_load(yml.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        return
    plugin, viz = split_plugin_doc(raw)
    if (dest / "frontend").is_dir() and "frontend" not in plugin:
        plugin["frontend"] = {"entry": "frontend/index.ts"}
    if (dest / "backend").is_dir() and "backend" not in plugin:
        plugin["backend"] = {"entry": "backend/service.py"}
    plugin.setdefault("id", dest.name)
    plugin.setdefault("name", dest.name)
    plugin.setdefault("version", 1)
    yml.write_text(_dump(plugin), encoding="utf-8")
    viz_path = dest / "visualisation.yml"
    if viz and not viz_path.is_file():
        viz_path.write_text(_dump(viz), encoding="utf-8")


def _dump(data: dict[str, Any]) -> str:
    return yaml.safe_dump(data, sort_keys=False, allow_unicode=True)
