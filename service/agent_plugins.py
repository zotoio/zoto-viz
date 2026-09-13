"""Agent-plugin zips: Agent Skills tree + frontend/backend scripts + a UI section.

Installed under ~/.zoto-viz/agent-plugins/<id>/ via MCP `install_plugin_zip` (or
`./zoto-viz.py plugin zip`). A view-plugin.yml is written so consented TypeScript
and Python load through the existing plugin host.
"""
from __future__ import annotations

import base64
import io
import json
import os
import posixpath
import shutil
import zipfile
from pathlib import Path
from typing import Any

import yaml
from aiohttp import web

from . import paths
from . import plugins

REPO = Path(__file__).resolve().parents[1]
SCHEMA_FILE = REPO / "schema" / "agent-plugin.schema.json"
EXAMPLES = REPO / "examples" / "agent-plugins"
MAX_ZIP = 1_500_000
MAX_UNCOMPRESSED = 4 * 1024 * 1024
MAX_FILES = 80
ALLOWED_SUFFIX = {
    ".json", ".md", ".ts", ".py", ".yml", ".yaml", ".txt", ".svg",
}
ALLOWED_PREFIX = (
    "skills/",
    "scripts/frontend/",
    "scripts/backend/",
    "ui/",
)
ROOT_FILES = {"manifest.json", "plugin.yml", "plugin.yaml", "readme.md"}

_validator = None


def DIR() -> Path:
    return paths.agent_plugins_dir()


def _schema() -> dict[str, Any]:
    raw = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("agent-plugin schema is not an object")
    return raw


def validator():
    global _validator
    if _validator is None:
        from jsonschema import Draft202012Validator
        _validator = Draft202012Validator(_schema())
    return _validator


def validate_manifest(doc: Any) -> dict[str, Any]:
    if not isinstance(doc, dict):
        raise ValueError("manifest.json must be an object")
    errors = sorted(validator().iter_errors(doc), key=lambda e: list(e.path))
    if errors:
        bits = []
        for err in errors:
            loc = ".".join(str(p) for p in err.path) or "(root)"
            bits.append(f"{loc}: {err.message}")
        raise ValueError("; ".join(bits))
    return doc


def _safe_name(name: str) -> str:
    n = name.replace("\\", "/").lstrip("/")
    if not n or n.endswith("/"):
        return ""
    if n.startswith("__MACOSX/") or posixpath.basename(n).startswith("._"):
        return ""
    parts = [p for p in n.split("/") if p and p != "."]
    if ".." in parts or not parts:
        raise ValueError(f"illegal zip path {name!r}")
    return "/".join(parts)


def _zip_root(names: list[str]) -> str:
    tops = {n.split("/", 1)[0] for n in names if n}
    if len(tops) == 1:
        top = next(iter(tops))
        if all(n == top or n.startswith(top + "/") for n in names):
            return top + "/"
    return ""


def _allowed_member(rel: str) -> bool:
    low = rel.lower()
    if low in ROOT_FILES:
        return True
    if not any(rel.startswith(p) for p in ALLOWED_PREFIX):
        return False
    return Path(rel).suffix.lower() in ALLOWED_SUFFIX


def _read_zip(raw: bytes) -> dict[str, bytes]:
    if len(raw) > MAX_ZIP:
        raise ValueError(f"zip exceeds {MAX_ZIP} bytes")
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as e:
        raise ValueError("not a zip") from e
    names = [_safe_name(i.filename) for i in zf.infolist() if not i.is_dir()]
    names = [n for n in names if n]
    if not names:
        raise ValueError("empty zip")
    if len(names) > MAX_FILES:
        raise ValueError(f"zip has more than {MAX_FILES} files")
    prefix = _zip_root(names)
    files: dict[str, bytes] = {}
    total = 0
    for info in zf.infolist():
        if info.is_dir():
            continue
        rel = _safe_name(info.filename)
        if not rel:
            continue
        if prefix:
            if not rel.startswith(prefix):
                continue
            rel = rel[len(prefix):]
        if not rel or not _allowed_member(rel):
            raise ValueError(f"disallowed path {rel or info.filename!r}")
        data = zf.read(info)
        total += len(data)
        if total > MAX_UNCOMPRESSED:
            raise ValueError("uncompressed zip too large")
        files[rel] = data
    if "manifest.json" not in files:
        raise ValueError("manifest.json is required")
    return files


def _need_file(files: dict[str, bytes], rel: str, *, what: str) -> None:
    if rel not in files:
        raise ValueError(f"missing {what} {rel}")


def _check_tree(doc: dict[str, Any], files: dict[str, bytes]) -> None:
    _need_file(files, doc["scripts"]["frontend"], what="frontend script")
    _need_file(files, doc["scripts"]["backend"], what="backend script")
    ui = doc["ui"]
    if ui["kind"] == "typescript":
        _need_file(files, ui["entry"], what="UI entry")
        _need_file(files, ui["tests"], what="UI tests")
        tests = files[ui["tests"]].decode("utf-8", "replace")
        if not any(tok in tests for tok in ("describe(", "it(", "test(")):
            raise ValueError("UI tests must contain describe/it/test")
    else:
        _need_file(files, ui["skill"], what="UI skill")
        _need_file(files, ui["prompt"], what="UI prompt")
    for skill in doc.get("skills") or []:
        marker = str(skill).rstrip("/") + "/SKILL.md"
        if marker not in files:
            raise ValueError(f"missing skill {marker}")


def _write_view_yaml(home: Path, doc: dict[str, Any]) -> None:
    ui = doc["ui"]
    if ui["kind"] == "typescript":
        entry = ui["entry"]
    else:
        generated = home / "ui" / "index.ts"
        entry = "ui/index.ts" if generated.is_file() else doc["scripts"]["frontend"]
    view = {
        "id": doc["id"],
        "name": doc["name"],
        "version": int(doc["version"]),
        "hint": doc.get("hint") or f"agent plugin · {','.join(doc['produces'])}",
        "engine": doc.get("engine") or "graph",
        "base": doc.get("base") or "topology",
        "runtime": "typescript",
        "entry": entry,
        "service": doc["scripts"]["backend"],
        "capabilities": doc.get("capabilities") or ["graph.read", "graph.style", "ui.overlay"],
    }
    if view["engine"] != "graph":
        view.pop("base", None)
    (home / "plugin.yml").write_text(yaml.safe_dump(view, sort_keys=False), encoding="utf-8")


def install_bytes(raw: bytes, *, dest: Path | None = None, overwrite: bool = False) -> dict[str, Any]:
    files = _read_zip(raw)
    try:
        doc = validate_manifest(json.loads(files["manifest.json"].decode("utf-8")))
    except json.JSONDecodeError as e:
        raise ValueError("manifest.json is not JSON") from e
    _check_tree(doc, files)
    root = dest or DIR()
    home = root / str(doc["id"])
    if home.exists() and not overwrite:
        raise ValueError(f"plugin {doc['id']!r} already exists")
    tmp = home.with_name(home.name + ".tmp")
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    try:
        for rel, data in files.items():
            path = tmp / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        _write_view_yaml(tmp, doc)
        if home.exists():
            shutil.rmtree(home)
        os.replace(tmp, home)
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    return load_installed(home)


def install_b64(blob: str, *, dest: Path | None = None, overwrite: bool = False) -> dict[str, Any]:
    s = "".join(str(blob or "").split())
    if s.lower().startswith("data:") and "," in s:
        s = s.split(",", 1)[1]
    try:
        raw = base64.b64decode(s, validate=True)
    except Exception as e:
        raise ValueError("zip_b64 is not valid base64") from e
    return install_bytes(raw, dest=dest, overwrite=overwrite)


def load_installed(home: Path) -> dict[str, Any]:
    man = home / "manifest.json"
    doc = validate_manifest(json.loads(man.read_text(encoding="utf-8")))
    ui = doc["ui"]
    out: dict[str, Any] = {
        "id": doc["id"],
        "name": doc["name"],
        "version": doc["version"],
        "produces": list(doc["produces"]),
        "consumes": list(doc["consumes"]),
        "dir": str(home),
        "ui": ui,
        "scripts": doc["scripts"],
        "skills": list(doc.get("skills") or []),
    }
    if ui.get("kind") == "prompt":
        out["needsUiGeneration"] = not (home / "ui" / "index.ts").is_file()
    return out


def scan(root: Path | None = None) -> dict[str, Any]:
    base = root or DIR()
    plugins_out: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    if not base.exists():
        return {"dir": str(base), "plugins": [], "errors": []}
    for child in sorted(base.iterdir()):
        if not child.is_dir() or not (child / "manifest.json").is_file():
            continue
        try:
            plugins_out.append(load_installed(child))
        except (ValueError, OSError, json.JSONDecodeError) as e:
            errors.append({"dir": str(child), "error": str(e)})
    return {"dir": str(base), "schema": str(SCHEMA_FILE), "plugins": plugins_out, "errors": errors}


def ui_brief(plugin_id: str, *, dest: Path | None = None) -> dict[str, Any]:
    """Assemble the generate-ui skill + prompt with in/out streams for a model turn."""
    home = (dest or DIR()) / str(plugin_id)
    if not (home / "manifest.json").is_file():
        raise ValueError(f"unknown plugin {plugin_id!r}")
    info = load_installed(home)
    ui = info["ui"]
    if ui.get("kind") != "prompt":
        raise ValueError("plugin UI is TypeScript, not a generation prompt")
    skill = (home / ui["skill"]).read_text(encoding="utf-8")
    prompt = (home / ui["prompt"]).read_text(encoding="utf-8")
    return {
        **info,
        "skill": skill,
        "prompt": prompt,
        "brief": (
            f"{prompt.rstrip()}\n\n"
            f"## Bound interfaces\n"
            f"- consumes: {', '.join(info['consumes'])}\n"
            f"- produces: {', '.join(info['produces'])}\n"
            f"- frontend: {info['scripts']['frontend']}\n"
            f"- backend: {info['scripts']['backend']}\n"
            f"- frontend host API: `zoto.onTick`, `zoto.setStyle` (see scripts/frontend)\n"
        ),
    }


def write_generated_ui(plugin_id: str, entry_ts: str, tests_ts: str, *, dest: Path | None = None) -> dict[str, Any]:
    home = (dest or DIR()) / str(plugin_id)
    if not (home / "manifest.json").is_file():
        raise ValueError(f"unknown plugin {plugin_id!r}")
    entry = str(entry_ts or "").strip()
    tests = str(tests_ts or "").strip()
    if "describe(" not in tests and "it(" not in tests and "test(" not in tests:
        raise ValueError("tests must contain describe/it/test")
    if "zoto" not in entry:
        raise ValueError("generated UI must use the zoto host interface")
    (home / "ui").mkdir(parents=True, exist_ok=True)
    (home / "ui" / "index.ts").write_text(entry, encoding="utf-8")
    (home / "ui" / "index.test.ts").write_text(tests, encoding="utf-8")
    doc = validate_manifest(json.loads((home / "manifest.json").read_text(encoding="utf-8")))
    _write_view_yaml(home, doc)
    return load_installed(home)


async def api_list(_: web.Request) -> web.Response:
    return web.json_response(scan())


def mirror_into_view_plugins(home: Path) -> None:
    """Copy the installed tree into ~/.zoto-viz/plugins/<id> so scan() sees it."""
    target = plugins.DIR / home.name
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(home, target)
