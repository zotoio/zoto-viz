"""Unified plugin catalog: shipped ``plugins/src/<id>/`` plus gitignored contrib zips
and user-local ``~/.zoto-viz/plugins/local/*.zip``.

Default ``scan()`` loads src trees directly. Non-colliding ``plugins/*.zip``
unpack into ``plugins/.runtime/<id>/``. Local zips unpack into
``~/.zoto-viz/plugins/local/.runtime/<id>/``. A zip whose id is already a src
tree (or an earlier zip) is a scan error and is skipped.

A plugin declares identity in ``plugin.yml``. Optional folders (``frontend/``,
``backend/``, ``sky/``, ``datasource/``, ``visualisation.yml``) are the switch.
TypeScript plugins are compiled by esbuild into a sandboxed iframe; Python
hooks load in-process behind consent + ``ZOTO_VIZ_PLUGIN_SERVICE``.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from typing import Any

from . import hooks
from . import paths
from . import plugin_backend as pb
from . import plugin_sky as psky
from . import plugin_instances as pins
from . import plugin_zip as pz
from . import plugin_manifest_block as pmb
from .plugin_schema import PLUGIN_SCHEMA_PATH, deref_schema, load_plugin_schema
from .pack_boundary import PackBundleBoundaryError, boundary_from_compile
from .pack_sdk_contract import (
    assert_pack_sdk_compatible,
    runtime_parent_for_sdk_cache,
    write_pack_sdk_manifest_cache,
)
from .pack_runtime import (
    cached_zip_block,
    catalog_boundary_error,
    cleanup_staging,
    materialize_zip_runtime,
    remember_zip_block,
    _clear_zip_block_cache,
    zip_block_cache_key,
)
from .plugin_install import InstallV2BlockedError
from . import data_source_plugin as dsp
import yaml
from aiohttp import web

DIR = paths.plugins_dir()
CONSENT_FILE = paths.user_dir() / "plugin-consent.yml"
REPO = Path(__file__).resolve().parents[1]
SCHEMA_FILE = PLUGIN_SCHEMA_PATH
SUFFIXES = {".yml", ".yaml"}
ALLOWED_CAPS = frozenset({
    "graph.read", "graph.style", "ui.overlay", "config.read", "viz.read", "viz.write",
    "typesafe",
})
MAX_BUNDLE = 256 * 1024
DEFAULT_FRONTEND_ENTRY = "frontend/index.ts"
_ESBUILD = REPO / "web" / "node_modules" / ".bin" / "esbuild"
_PACK_BUNDLE_SCRIPT = REPO / "web" / "scripts" / "bundle-pack-entry.mjs"
_SDK_ROOT = REPO / "plugins" / "sdk"
# id -> (js sha256, bundle bytes, cache key, entry path, plugin sha256)
_bundles: dict[str, tuple[str, bytes, str, Path, str]] = {}
_compile_runs = 0
_bundle_invocations = 0
_scan_lock = threading.Lock()
_scan_memo: dict[str, tuple[tuple[Any, ...], dict[str, Any]]] = {}
_scan_builds = 0
_WATCH_NAMES = frozenset({"plugin.yml", "plugin.yaml", "visualisation.yml", "visualisation.yaml"})
_WATCH_SUFFIX = frozenset({
    ".ts", ".tsx", ".js", ".mjs", ".glsl", ".py", ".zip", ".yml", ".yaml",
    ".mp3", ".wav", ".ogg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".json",
    ".md", ".txt",
})
_WATCH_SKIP_DIRS = frozenset({"node_modules", "__pycache__", ".git"})
_SCHEMA_KEYS = frozenset({"$ref", "$schema", "$id", "title", "description"})


def deref_schema(raw: dict[str, Any], origin: Path) -> dict[str, Any]:
    """Resolve file `$ref` shims (including nested refs with title/description wrappers)."""
    ref = raw.get("$ref")
    if not isinstance(ref, str) or "://" in ref or "#" in ref:
        return raw
    if not ref.endswith(".json"):
        return raw
    target = (origin.parent / ref).resolve()
    if not target.is_file():
        raise ValueError(f"unresolved schema $ref {ref!r}")
    loaded = yaml.safe_load(target.read_text(encoding="utf-8"))
    if not isinstance(loaded, dict):
        raise ValueError(f"{target.name} is not a mapping")
    merged = deref_schema(loaded, target.parent)
    overlay = {k: v for k, v in raw.items() if k != "$ref"}
    if overlay:
        return {**merged, **overlay}
    return merged


def _plugin_home(path: Path) -> Path:
    if path.name in ("plugin.yml", "plugin.yaml"):
        return path.parent
    return path.parent


def _declared_frontend_entry(doc: dict[str, Any]) -> str:
    fe = doc.get("frontend")
    if isinstance(fe, dict):
        return str(fe.get("entry") or "").strip()
    return ""


def resolve_frontend_entry(doc: dict[str, Any], home: Path) -> str:
    """plugin.yml ``frontend.entry``, else ``frontend/index.ts``, else legacy ``entry``."""
    declared = _declared_frontend_entry(doc)
    if declared:
        return declared
    if (home / "frontend").is_dir():
        return DEFAULT_FRONTEND_ENTRY
    if doc.get("runtime") == "typescript":
        return str(doc.get("entry") or "index.ts")
    return DEFAULT_FRONTEND_ENTRY


def has_frontend_part(
    doc: dict[str, Any],
    home: Path,
    parts: list[str] | tuple[str, ...] | None = None,
    *,
    nested: bool = True,
) -> bool:
    partset = set(parts or ())
    if "frontend" in partset or (nested and (home / "frontend").is_dir()):
        return True
    if doc.get("runtime") == "typescript":
        return True
    declared = _declared_frontend_entry(doc)
    return nested and bool(declared) and (home / declared).is_file()


def optional_part_flags(
    doc: dict[str, Any],
    home: Path,
    parts: list[str] | tuple[str, ...] | None = None,
    *,
    nested: bool = True,
) -> dict[str, Any]:
    """Catalog booleans for optional zip parts. Sky GLSL is served by ``api_sky`` after consent."""
    if parts is not None:
        partset = set(parts)
    elif nested and home.is_dir():
        partset = set(pz.detect_parts(home))
    else:
        partset = set()
    has_frontend = has_frontend_part(doc, home, tuple(partset), nested=nested)
    entry = resolve_frontend_entry(doc, home) if nested or has_frontend else DEFAULT_FRONTEND_ENTRY
    caps = [c for c in (doc.get("capabilities") or []) if c in ALLOWED_CAPS]
    inspect = nested and home.is_dir()
    if dsp.plugin_kind(doc) == "data-source":
        return {
            "has_frontend": False,
            "capabilities": caps,
            "has_sky": "sky" in partset or (inspect and (home / "sky").is_dir()),
            "has_sky_shader": inspect and (home / "sky" / "fragment.glsl").is_file(),
            "has_backend": False,
            "has_datasource": False,
        }
    fe = dict(doc["frontend"]) if isinstance(doc.get("frontend"), dict) else {}
    fe["entry"] = entry
    return {
        "has_frontend": has_frontend,
        "frontend": fe,
        "capabilities": caps,
        "has_sky": "sky" in partset or (inspect and (home / "sky").is_dir()),
        "has_sky_shader": inspect and (home / "sky" / "fragment.glsl").is_file(),
        "has_backend": "backend" in partset or (inspect and (home / "backend").is_dir()),
        "has_datasource": "datasource" in partset or (inspect and (home / "datasource").is_dir()),
    }


def _plugin_sha(path: Path, given: str | None) -> str:
    if given:
        return given
    yml = path if path.name in ("plugin.yml", "plugin.yaml") else path
    try:
        return hashlib.sha256(yml.read_bytes()).hexdigest()
    except OSError:
        return ""


def _catalog_pack_sha256(home: Path, yml: Path) -> str:
    """Catalog digest: plugin.yml bytes plus every file under ``assets/`` (sorted paths)."""
    h = hashlib.sha256()
    try:
        h.update(yml.read_bytes())
    except OSError:
        return ""
    assets = home / _ASSET_DIR
    if assets.is_dir() and not assets.is_symlink():
        for fp in sorted(assets.rglob("*")):
            if not fp.is_file() or fp.is_symlink():
                continue
            rel = fp.relative_to(home).as_posix()
            if any(part.startswith(".") for part in fp.relative_to(assets).parts):
                continue
            h.update(rel.encode())
            try:
                h.update(fp.read_bytes())
            except OSError:
                continue
    return h.hexdigest()


def _assets_manifest_sha256(home: Path, doc: dict[str, Any]) -> str:
    """Digest of declared mesh/audio assets (sorted by id) for consent."""
    raw = doc.get("assets")
    if not isinstance(raw, list) or not raw:
        return ""
    lines: list[str] = []
    for entry in sorted(raw, key=lambda e: str((e or {}).get("id") or "")):
        if not isinstance(entry, dict):
            continue
        aid = str(entry.get("id") or "").strip()
        path = str(entry.get("path") or "").strip()
        digest = str(entry.get("sha256") or "").strip().lower()
        if not aid or not path:
            continue
        fp = (home / path).resolve()
        try:
            if not fp.is_file() or not str(fp).startswith(str(home.resolve())):
                continue
        except OSError:
            continue
        if not digest:
            try:
                digest = hashlib.sha256(fp.read_bytes()).hexdigest()
            except OSError:
                continue
        lines.append(f"{aid}:{path}:{digest}")
    if not lines:
        return ""
    h = hashlib.sha256("\n".join(lines).encode())
    return h.hexdigest()


def _frontend_fingerprint(home: Path) -> str:
    """Invalidate the esbuild cache when any frontend/*.ts changes, not only entry."""
    fe = home / "frontend"
    if not fe.is_dir():
        return "0"
    parts: list[str] = []
    for p in sorted(fe.rglob("*")):
        if not p.is_file() or p.suffix.lower() not in {".ts", ".tsx", ".js", ".mjs"}:
            continue
        try:
            st = p.stat()
        except OSError:
            continue
        parts.append(f"{p.relative_to(home)}:{st.st_mtime_ns}:{st.st_size}")
    return hashlib.sha256("\n".join(parts).encode()).hexdigest() if parts else "0"


def _cache_key(sha256: str, entry: Path, home: Path | None = None) -> str:
    mtime = entry.stat().st_mtime_ns if entry.is_file() else 0
    extra = _frontend_fingerprint(home) if home else "0"
    return f"{sha256}:{mtime}:{extra}"


def compile_runs() -> int:
    """How many times esbuild produced a bundle (cache misses). Tests use this."""
    return _compile_runs


def bundle_invocations() -> int:
    """How many times the esbuild subprocess was started (includes failed bundles)."""
    return _bundle_invocations


def reset_bundles() -> None:
    global _compile_runs, _bundle_invocations
    _bundles.clear()
    _compile_runs = 0
    _bundle_invocations = 0
    _clear_zip_block_cache()
    reset_scan_memo()


def reset_scan_memo() -> None:
    """Drop the catalog mtime memo. Tests call this via ``reset_bundles``."""
    global _scan_builds
    with _scan_lock:
        _scan_memo.clear()
        _scan_builds = 0


def scan_builds() -> int:
    """How many times the catalog was actually built (memo misses). Tests use this."""
    return _scan_builds


_PACK_BUNDLE_SCRIPT = REPO / "web" / "scripts" / "bundle-pack-entry.mjs"


def _install_lint_block_from_compile(stderr: str) -> str | None:
    import json

    for line in stderr.splitlines():
        text = line.strip()
        if not text.startswith("{"):
            continue
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            continue
        if isinstance(raw, dict) and raw.get("type") == "pack-install-lint-block":
            return str(raw.get("message") or "").strip() or None
    return None


def verify_pack_bundle_home(home: Path, doc: dict[str, Any], sha256: str | None = None) -> None:
    """Run esbuild allowlist without updating the in-memory bundle cache."""
    yml = home / "plugin.yml"
    if not yml.is_file():
        raise ValueError("missing plugin.yml")
    compile_typescript(doc, yml, sha256=sha256, update_cache=False, install_lint=True)


def compile_typescript(
    doc: dict[str, Any],
    path: Path,
    sha256: str | None = None,
    *,
    update_cache: bool = True,
    install_lint: bool = False,
) -> dict[str, Any]:
    """Bundle frontend/ (or legacy entry.ts) with esbuild. Cache key is plugin sha256 + entry mtime."""
    home = _plugin_home(path)
    nested = path.name in ("plugin.yml", "plugin.yaml")
    if not has_frontend_part(doc, home, nested=nested):
        return {}
    caps = [c for c in (doc.get("capabilities") or []) if c in ALLOWED_CAPS]
    unknown = [c for c in (doc.get("capabilities") or []) if c not in ALLOWED_CAPS]
    if unknown:
        raise ValueError(f"unknown capabilities {unknown}")
    if not nested:
        raise ValueError("typescript plugins must live in a directory as plugin.yml")
    rel = resolve_frontend_entry(doc, home)
    entry = (home / rel).resolve()
    if not str(entry).startswith(str(home.resolve())):
        raise ValueError("entry must stay inside the plugin directory")
    if not entry.is_file():
        raise ValueError(f"missing entry {entry.name}")
    pid = str(doc["id"])
    digest_src = _plugin_sha(path, sha256)
    key = _cache_key(digest_src, entry, home)
    cached = _bundles.get(pid)
    if update_cache and cached and cached[2] == key:
        return {"hash": cached[0], "capabilities": caps, "bytes": len(cached[1]), "cached": True}
    global _compile_runs, _bundle_invocations
    fe = doc.get("frontend") if isinstance(doc.get("frontend"), dict) else {}
    if fe.get("bundle") is False:
        js = entry.read_bytes()
        if len(js) > MAX_BUNDLE:
            raise ValueError(f"compiled plugin exceeds {MAX_BUNDLE} bytes")
        digest = hashlib.sha256(js).hexdigest()
        _compile_runs += 1
        if update_cache:
            _bundles[pid] = (digest, js, key, entry, digest_src)
        return {"hash": digest, "capabilities": caps, "bytes": len(js), "cached": False}
    if not _PACK_BUNDLE_SCRIPT.is_file():
        raise ValueError("pack bundle script missing (web/scripts/bundle-pack-entry.mjs)")
    from . import cursor_agent

    home_resolved = home.resolve()
    bundle_env = os.environ.copy()
    bundle_env.setdefault("NODE_ENV", "production")
    if install_lint:
        bundle_env["ZOTO_PACK_INSTALL_LINT"] = "1"
    proc = subprocess.run(
        [
            cursor_agent.node_bin(),
            str(_PACK_BUNDLE_SCRIPT),
            str(entry),
            str(_SDK_ROOT),
            str(home_resolved),
            str(REPO),
        ],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
        env=bundle_env,
    )
    _bundle_invocations += 1
    if proc.returncode != 0:
        block = boundary_from_compile(doc, proc.stderr)
        if block:
            raise PackBundleBoundaryError(block)
        lint_msg = _install_lint_block_from_compile(proc.stderr)
        if lint_msg:
            label = str(doc.get("name") or doc.get("id") or "Plugin")
            raise ValueError(
                f"{label} was blocked: {lint_msg} "
                "Nothing was installed and the current wall is unchanged. "
                "Ask the pack author to run pack lint — see plugins/sdk/starter/README.md#2-pack-lint."
            )
        raise ValueError(proc.stderr.strip() or "esbuild failed")
    js = proc.stdout.encode("utf-8")
    if len(js) > MAX_BUNDLE:
        raise ValueError(f"compiled plugin exceeds {MAX_BUNDLE} bytes")
    digest = hashlib.sha256(js).hexdigest()
    _compile_runs += 1
    try:
        write_pack_sdk_manifest_cache(runtime_parent_for_sdk_cache(home), pid)
    except OSError:
        pass
    if update_cache:
        _bundles[pid] = (digest, js, key, entry, digest_src)
    return {"hash": digest, "capabilities": caps, "bytes": len(js)}


def python_enabled() -> bool:
    """Master switch: in-process plugin Python is off until the operator sets the env var."""
    return os.environ.get("ZOTO_VIZ_PLUGIN_SERVICE", "").strip().lower() in {"1", "true", "yes", "on"}


CONSENT_ARTEFACTS = ("frontend", "backend", "collector", "shader", "assets")
AUTOCONSENT_ORIGINS = frozenset({"src", "local"})
_ARTEFACT_FIELD = {
    "frontend": "hash",
    "backend": "backend_sha256",
    "collector": "collector_sha256",
    "shader": "shader_sha256",
    "assets": "assets_sha256",
}
_CONSENT_HASH_KEYS = ("backend_sha256", "collector_sha256", "shader_sha256", "assets_sha256")
# Matches ``pack_safe_zip._TREE_HASH_VERSION`` (0x01) stored on each consent row.
PACK_TREE_HASH_VERSION = 0x01


def needs_review(doc: dict[str, Any]) -> bool:
    """True when the plugin ships executable code (TypeScript, Python, and/or GLSL)."""
    if doc.get("runtime") == "typescript" or doc.get("has_frontend"):
        return True
    svc = doc.get("service")
    if isinstance(svc, str) and bool(svc.strip()):
        return True
    if doc.get("backend_sha256") or doc.get("collector") or doc.get("collector_sha256"):
        return True
    if doc.get("shader_sha256") or doc.get("has_sky_shader"):
        return True
    return False


def consent_stamp(doc: dict[str, Any]) -> str:
    return f"{doc.get('id')}:{doc.get('version')}:{doc.get('hash') or doc.get('service') or 'yaml'}"


def consent_hashes(doc: dict[str, Any]) -> dict[str, str]:
    """Current artefact sha256s keyed as the union ``{frontend, backend, collector, shader}``."""
    out: dict[str, str] = {}
    for arte, field in _ARTEFACT_FIELD.items():
        digest = doc.get(field)
        if digest:
            out[arte] = str(digest)
    return out


def _consent_doc() -> dict[str, Any]:
    try:
        raw = yaml.safe_load(CONSENT_FILE.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError):
        return {}
    return raw if isinstance(raw, dict) else {}


def consent_kind(doc: dict[str, Any]) -> str | None:
    rec = _consent_doc().get(str(doc.get("id") or ""))
    if not isinstance(rec, dict):
        return None
    if rec.get("stamp") != consent_stamp(doc):
        return None
    for key in _CONSENT_HASH_KEYS:
        current = doc.get(key)
        if current and rec.get(key) != current:
            return None
    kind = rec.get("kind")
    return kind if kind in {"reviewed", "authored"} else None


def autoconsent_enabled() -> bool:
    """True when the operator enabled auto-consent (profile or live MCP patch)."""
    from . import live
    return live.autoconsent_on()


def autoconsent_eligible(doc: dict[str, Any]) -> bool:
    """Only shipped src trees and operator-installed local zips — not contrib zips."""
    return str(doc.get("origin") or "").strip().lower() in AUTOCONSENT_ORIGINS


def autoconsent_kind(doc: dict[str, Any]) -> str:
    if str(doc.get("origin") or "").strip().lower() == "src":
        return "authored"
    return "reviewed"


def maybe_autoconsent(doc: dict[str, Any]) -> bool:
    """Grant consent for eligible catalog rows when auto-consent is on. Returns True when granted."""
    if not needs_review(doc) or not autoconsent_enabled() or not autoconsent_eligible(doc):
        return False
    if consent_kind(doc) in {"reviewed", "authored"}:
        return False
    grant_consent(doc, autoconsent_kind(doc))
    return True


def consented(doc: dict[str, Any]) -> bool:
    if not needs_review(doc):
        return True
    kind = consent_kind(doc)
    if kind in {"reviewed", "authored"}:
        return True
    if maybe_autoconsent(doc):
        return True
    return False


def consented_for(doc: dict[str, Any], hashes: dict[str, str] | None = None) -> bool:
    """True when stored consent covers ``hashes`` (keys: frontend, backend, collector, shader).

    Overlay hashes onto ``doc`` and reuse ``consented``. Unknown artefact keys fail closed.
    Subtask 08 calls this from ``install_plugin_zip`` without reading the stamp file.
    """
    merged = dict(doc)
    if hashes:
        for arte, digest in hashes.items():
            field = _ARTEFACT_FIELD.get(arte)
            if field is None:
                return False
            if digest:
                merged[field] = digest
    return consented(merged)


def _persist_consent_doc(data: dict[str, Any]) -> None:
    CONSENT_FILE.parent.mkdir(parents=True, exist_ok=True)
    text = yaml.safe_dump(data, sort_keys=True, allow_unicode=True)
    fd, tmp = tempfile.mkstemp(prefix="plugin-consent.", suffix=".yml", dir=CONSENT_FILE.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.chmod(tmp, 0o600)
        os.replace(tmp, CONSENT_FILE)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def grant_consent(doc: dict[str, Any], kind: str) -> str:
    if kind not in {"reviewed", "authored"}:
        raise ValueError("kind must be reviewed or authored")
    data = _consent_doc()
    rec: dict[str, Any] = {"kind": kind, "stamp": consent_stamp(doc), "version": doc.get("version")}
    for key in _CONSENT_HASH_KEYS:
        digest = doc.get(key)
        if digest:
            rec[key] = digest
    tree = doc.get("pack_tree_sha256")
    if tree:
        rec["pack_tree_sha256"] = str(tree)
        rec["tree_hash_version"] = PACK_TREE_HASH_VERSION
    data[str(doc["id"])] = rec
    _persist_consent_doc(data)
    return kind


def migrate_consent_pack_tree_hashes(runtime_parent: Path) -> list[str]:
    """One-time upgrade of consent ``pack_tree_sha256`` to format version ``PACK_TREE_HASH_VERSION``."""
    from . import pack_safe_zip as psz

    data = _consent_doc()
    if not data:
        return []
    runtime_parent = Path(runtime_parent)
    changed = False
    msgs: list[str] = []
    for pid, rec in data.items():
        if not isinstance(rec, dict):
            continue
        if rec.get("tree_hash_version") == PACK_TREE_HASH_VERSION:
            continue
        home = runtime_parent / str(pid)
        if not home.is_dir():
            continue
        rec["pack_tree_sha256"] = psz.runtime_tree_hash(home)
        rec["tree_hash_version"] = PACK_TREE_HASH_VERSION
        changed = True
        msgs.append(f"pack tree hash migrated for {pid}")
    if changed:
        _persist_consent_doc(data)
    return msgs


def service_meta(doc: dict[str, Any], path: Path) -> dict[str, Any]:
    """Attach `service` (path relative to the plugin dir) when a Python module is present.

    Does not import the module — `plugin validate` only checks the file exists and stays inside
    the plugin directory. The monitor hot-loads it separately.
    """
    home = _plugin_home(path)
    found = hooks.service_path(home, doc, yaml_path=path)
    declared = str(doc.get("service") or "").strip()
    if declared and (found is None or not found.is_file()):
        raise ValueError(f"missing service module {declared}")
    if not found or not found.is_file():
        return {}
    try:
        rel = str(found.relative_to(home.resolve()))
    except ValueError:
        rel = found.name
    return {"service": rel}


def bundle_for(pid: str) -> tuple[str, bytes] | None:
    got = _bundles.get(pid)
    if not got:
        return None
    return got[0], got[1]


def _bundle_fresh(pid: str) -> tuple[str, bytes] | None:
    got = _bundles.get(pid)
    if not got:
        return None
    digest, js, key, entry, sha256 = got
    if key != _cache_key(sha256, entry):
        return None
    return digest, js


def api_module(req: web.Request) -> web.StreamResponse:
    pid = req.match_info["id"]
    resp = module_response(pid)
    if resp.status == 200:
        digest = resp.headers.get("X-Zoto-Viz-Hash")
        query = getattr(getattr(req, "rel_url", None), "query", None) or {}
        want = query.get("h") or query.get("hash") if hasattr(query, "get") else None
        if want and digest and want == digest:
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp


def module_response(pid: str) -> web.StreamResponse:
    got = _bundle_fresh(pid)
    if not got:
        scan()  # compile on demand from plugins/.runtime/<id>/frontend/
        got = _bundle_fresh(pid) or bundle_for(pid)
    if not got:
        return web.json_response({"error": "no compiled module"}, status=404)
    digest, js = got
    resp = web.Response(body=js, content_type="text/javascript", charset="utf-8")
    resp.headers["Content-Security-Policy"] = "default-src 'none'; script-src 'none'"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Zoto-Viz-Hash"] = digest
    resp.headers["Cache-Control"] = "no-store"
    return resp


def _plugin_row(pid: str) -> dict[str, Any] | None:
    return next((p for p in (scan().get("plugins") or []) if p.get("id") == pid), None)


def api_sky(req: web.Request) -> web.StreamResponse:
    """Serve ``sky/fragment.glsl`` after consent. 403 without review; 404 if missing."""
    pid = req.match_info["id"]
    row = _plugin_row(pid)
    if not row or not row.get("has_sky_shader"):
        return web.json_response({"error": "no sky shader"}, status=404)
    if not row.get("sky_available"):
        err = str(row.get("sky_error") or "unavailable")
        status = 403 if err == psky.AWAITING_REVIEW else 404
        return web.json_response({"error": err}, status=status)
    home = Path(str(row.get("file") or ""))
    glsl = psky.shader_file(home.parent if home.name in {"plugin.yml", "plugin.yaml"} else home)
    try:
        src = glsl.read_text(encoding="utf-8")
    except OSError:
        return web.json_response({"error": "no sky shader"}, status=404)
    digest = str(row.get("sha256") or row.get("shader_sha256") or "")
    resp = web.Response(text=src, content_type="text/x-shader", charset="utf-8")
    resp.headers["X-Content-Type-Options"] = "nosniff"
    if digest:
        resp.headers["X-Zoto-Viz-Hash"] = digest
        resp.headers["ETag"] = f'"{digest}"'
    query = getattr(getattr(req, "rel_url", None), "query", None) or {}
    want = query.get("h") or query.get("hash") if hasattr(query, "get") else None
    if want and digest and want == digest:
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    else:
        resp.headers["Cache-Control"] = "private, max-age=30"
    return resp


_ASSET_SUFFIX = frozenset({
    ".mp3", ".wav", ".ogg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".md", ".txt",
    ".glb", ".gltf", ".bin", ".ktx2",
})
_ASSET_DIR = "assets"
_MAX_ASSET_BYTES = 16 * 1024 * 1024


def _plugin_pack_home(row: dict[str, Any]) -> Path | None:
    raw = str(row.get("file") or "").strip()
    if not raw:
        return None
    path = Path(raw)
    if not path.is_file() and not path.is_dir():
        return None
    return _plugin_home(path)


def _plugin_enabled_for_serve(row: dict[str, Any]) -> bool:
    if row.get("disabled"):
        return False
    if str(row.get("origin") or "zip").strip().lower() == "src":
        return True
    if not needs_review(row):
        return True
    kind = consent_kind(row)
    return kind in {"reviewed", "authored"}


def _asset_content_type(suffix: str) -> str:
    suf = suffix.lower()
    if suf == ".mp3":
        return "audio/mpeg"
    if suf in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suf == ".png":
        return "image/png"
    if suf == ".webp":
        return "image/webp"
    if suf == ".gif":
        return "image/gif"
    if suf == ".wav":
        return "audio/wav"
    if suf == ".ogg":
        return "audio/ogg"
    return "application/octet-stream"


def _parse_asset_rel(raw: str) -> Path | None:
    from urllib.parse import unquote

    rel = unquote(raw or "").strip().lstrip("/")
    if not rel:
        return None
    safe = Path(rel)
    if safe.is_absolute():
        return None
    for part in safe.parts:
        if part in ("", ".", "..") or part.startswith("."):
            return None
    return safe


def _plugin_assets_root(row: dict[str, Any]) -> Path | None:
    home = _plugin_pack_home(row)
    if not home:
        return None
    assets = home / _ASSET_DIR
    if assets.is_symlink():
        return None
    assets = assets.resolve()
    if not assets.is_dir():
        return None
    try:
        if not assets.is_relative_to(home.resolve()):
            return None
    except AttributeError:
        if not str(assets).startswith(str(home.resolve())):
            return None
    return assets


def api_asset(req: web.Request) -> web.StreamResponse:
    """Serve files under ``assets/`` after review (no autoconsent on GET)."""
    pid = req.match_info["id"]
    rel_raw = str(req.match_info.get("path") or "")
    row = _plugin_row(pid)
    if not row:
        return web.json_response({"error": "unknown plugin"}, status=404)
    if not _plugin_enabled_for_serve(row):
        err = str(row.get("sky_error") or psky.AWAITING_REVIEW)
        return web.json_response({"error": err}, status=403)
    home = _plugin_pack_home(row)
    if home and (home / _ASSET_DIR).is_symlink():
        return web.json_response({"error": "invalid assets"}, status=400)
    root = _plugin_assets_root(row)
    if not root:
        return web.json_response({"error": "no assets"}, status=404)
    safe = _parse_asset_rel(rel_raw)
    if safe is None:
        return web.json_response({"error": "invalid path"}, status=400)
    target = (root / safe).resolve()
    try:
        if not target.is_relative_to(root):
            return web.json_response({"error": "invalid path"}, status=400)
    except AttributeError:
        if not str(target).startswith(str(root)):
            return web.json_response({"error": "invalid path"}, status=400)
    if target.suffix.lower() not in _ASSET_SUFFIX:
        return web.json_response({"error": "unsupported type"}, status=400)
    if target.is_dir():
        return web.json_response({"error": "not found"}, status=404)
    if not target.is_file():
        return web.json_response({"error": "not found"}, status=404)
    try:
        size = target.stat().st_size
    except OSError:
        return web.json_response({"error": "not found"}, status=404)
    if size > _MAX_ASSET_BYTES:
        return web.json_response({"error": "too large"}, status=413)
    pack_digest = str(row.get("sha256") or row.get("shader_sha256") or "")
    query = getattr(getattr(req, "rel_url", None), "query", None) or {}
    want = query.get("h") or query.get("hash") or query.get("v") if hasattr(query, "get") else None
    file_digest = ""
    try:
        file_digest = hashlib.sha256(target.read_bytes()).hexdigest()
    except OSError:
        file_digest = ""
    ctype = _asset_content_type(target.suffix)
    resp = web.FileResponse(path=target, headers={"Content-Type": ctype})
    resp.headers["X-Content-Type-Options"] = "nosniff"
    if want and file_digest and want == file_digest:
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif want and pack_digest and want == pack_digest:
        resp.headers["Cache-Control"] = "private, max-age=31536000, immutable"
    else:
        resp.headers["Cache-Control"] = "private, no-cache"
    return resp


_validator = None


def _schema() -> dict[str, Any]:
    return load_plugin_schema()


def _schema_defs_resolved(schema: dict[str, Any]) -> dict[str, Any]:
    """Inline external $refs under $defs (e.g. manifest workBudget SDK schema)."""
    import json

    defs = dict(schema.get("$defs") or {})
    wb = defs.get("manifestWorkBudget")
    if isinstance(wb, dict):
        ref = wb.get("$ref")
        if isinstance(ref, str) and ref.endswith("manifest-work-budget.schema.json"):
            path = (SCHEMA_FILE.parent / ref).resolve()
            loaded = json.loads(path.read_text(encoding="utf-8"))
            inlined = {k: v for k, v in loaded.items() if k not in ("$schema", "$id")}
            if isinstance(wb.get("title"), str):
                inlined["title"] = wb["title"]
            if isinstance(wb.get("description"), str):
                inlined["description"] = wb["description"]
            defs["manifestWorkBudget"] = inlined
    return defs


def validator():
    global _validator
    if _validator is None:
        from jsonschema import Draft202012Validator

        schema = _schema()
        if schema.get("$defs"):
            schema = {**schema, "$defs": _schema_defs_resolved(schema)}
        _validator = Draft202012Validator(schema)
    return _validator


def plugin_paths(root: Path | None = None) -> list[Path]:
    base = root or DIR
    if not base.exists():
        return []
    if base.is_file():
        return [base]
    found: list[Path] = []
    for p in sorted(base.iterdir()):
        if p.is_file() and p.suffix.lower() in SUFFIXES:
            found.append(p)
        elif p.is_dir():
            for name in ("plugin.yml", "plugin.yaml"):
                child = p / name
                if child.is_file():
                    found.append(child)
                    break
    return found


def _pairs(raw: Any) -> list[list[str]]:
    out: list[list[str]] = []
    if not isinstance(raw, list):
        return out
    for item in raw:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            out.append([str(item[0]), str(item[1])])
    return out


def _take_key(keys: set[str], raw: Any) -> str:
    key = str((raw or {}).get("key") or "") if isinstance(raw, dict) else ""
    if key in keys:
        raise ValueError(f"duplicate key {key!r} in options/config")
    keys.add(key)
    return key


def _settings_from_doc(doc: dict[str, Any]) -> tuple[list[Any], str | None]:
    viz = doc.get("visualisation") if isinstance(doc.get("visualisation"), dict) else {}
    settings = doc.get("settings") if isinstance(doc.get("settings"), dict) else {}
    viz_settings = viz.get("settings") if isinstance(viz.get("settings"), dict) else {}
    merged = {**viz_settings, **settings}
    presets = merged.get("presets")
    if presets is None:
        presets = doc.get("presets") or viz.get("presets")
    preset_field = merged.get("presetField") or doc.get("presetField") or viz.get("presetField")
    pf = str(preset_field).strip() if preset_field else None
    if not isinstance(presets, list):
        return [], pf
    return presets, pf


def _config_field_rows(doc: dict[str, Any]) -> list[dict[str, Any]]:
    viz = doc.get("visualisation") if isinstance(doc.get("visualisation"), dict) else {}
    raw = viz.get("config")
    if raw is None:
        raw = doc.get("config")
    rows: list[dict[str, Any]] = []
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict):
                rows.append(item)
    elif isinstance(raw, dict):
        for key, item in raw.items():
            if isinstance(item, dict):
                row = dict(item)
                row.setdefault("key", key)
                rows.append(row)
    return rows


def _config_field_keys(doc: dict[str, Any]) -> set[str]:
    return {str(f.get("key") or "") for f in _config_field_rows(doc) if f.get("key")}


def _check_plugin_settings(doc: dict[str, Any]) -> None:
    presets, preset_field = _settings_from_doc(doc)
    if presets and not preset_field:
        raise ValueError("settings.presetField is required when presets are declared")
    keys = _config_field_keys(doc)
    if preset_field and preset_field not in keys:
        raise ValueError(f"settings.presetField {preset_field!r} is not a config field")
    viz = doc.get("visualisation") if isinstance(doc.get("visualisation"), dict) else {}
    settings = doc.get("settings") if isinstance(doc.get("settings"), dict) else {}
    viz_settings = viz.get("settings") if isinstance(viz.get("settings"), dict) else {}
    merged_hud = {**(viz_settings.get("hud") if isinstance(viz_settings.get("hud"), dict) else {}),
                  **(settings.get("hud") if isinstance(settings.get("hud"), dict) else {})}
    label_fields = merged_hud.get("labelFields")
    if isinstance(label_fields, list):
        for lf in label_fields:
            if isinstance(lf, str) and lf.strip() and lf.strip() not in keys:
                raise ValueError(f"settings.hud.labelFields references unknown config key {lf!r}")
    if isinstance(presets, list):
        for preset in presets:
            if not isinstance(preset, dict):
                continue
            pid = str(preset.get("id") or "")
            if pid == "custom":
                raise ValueError("preset id 'custom' is reserved")
            values = preset.get("values")
            if isinstance(values, dict):
                for vk in values:
                    if str(vk) not in keys:
                        raise ValueError(f"preset {pid!r} references unknown config key {vk!r}")
    for field in _config_field_rows(doc):
        key = str(field.get("key") or "")
        rr = field.get("randomRange")
        if rr is None:
            continue
        if field.get("type") != "number":
            raise ValueError(f"config field {key!r} randomRange is only valid on number fields")
        lo, hi = field.get("min"), field.get("max")
        if not isinstance(lo, (int, float)) or not isinstance(hi, (int, float)):
            raise ValueError(f"config field {key!r} with randomRange requires min and max")
        if not isinstance(rr, list) or len(rr) < 2:
            raise ValueError(f"config field {key!r} randomRange must be a two-number range")
        r0, r1 = rr[0], rr[1]
        if not isinstance(r0, (int, float)) or not isinstance(r1, (int, float)):
            raise ValueError(f"config field {key!r} randomRange must be numeric")
        if r0 < lo or r1 > hi or r0 > r1:
            raise ValueError(
                f"config field {key!r} randomRange [{r0}, {r1}] outside min..max [{lo}, {hi}]"
            )


def _option_rows(doc: dict[str, Any]) -> list[dict[str, Any]]:
    """Legacy option lists from plugin.yml and/or visualisation.yml."""
    rows: list[dict[str, Any]] = []
    viz = doc.get("visualisation") if isinstance(doc.get("visualisation"), dict) else {}
    for raw in (doc.get("options"), viz.get("options")):
        if isinstance(raw, list):
            for item in raw:
                if isinstance(item, dict):
                    rows.append(item)
    return rows


def _check_semantics(doc: dict[str, Any], *, include_settings: bool = False) -> None:
    dsp.check_data_source_semantics(doc)
    if dsp.plugin_kind(doc) == "data-source":
        if include_settings:
            _check_plugin_settings(doc)
        return
    keys: set[str] = set()
    for opt in _option_rows(doc):
        key = _take_key(keys, opt)
        vals = [v[0] for v in _pairs(opt.get("values"))]
        default = str(opt.get("default") or "")
        if vals and default not in vals:
            raise ValueError(f"option {key!r} default {default!r} is not in values")
    for field in _config_field_rows(doc):
        key = _take_key(keys, field)
        ftype = field.get("type") or ("select" if field.get("values") else "text")
        if ftype == "select":
            vals = [v[0] for v in _pairs(field.get("values"))]
            default = field.get("default")
            if default is not None and vals and str(default) not in vals:
                raise ValueError(f"config {key!r} default {default!r} is not in values")
        lo, hi = field.get("min"), field.get("max")
        if isinstance(lo, (int, float)) and isinstance(hi, (int, float)) and lo > hi:
            raise ValueError(f"config {key!r} min is greater than max")
    if include_settings:
        _check_plugin_settings(doc)
    caps = doc.get("capabilities") or []
    needs_viz = any(c in caps for c in ("viz.read", "viz.write"))
    viz = doc.get("viz")
    if needs_viz:
        if not isinstance(viz, dict):
            raise ValueError("viz block is required when viz.read or viz.write is declared")
        if viz.get("graphWalk") is not False:
            raise ValueError("viz.graphWalk must be false")
        idle = viz.get("idle")
        if not isinstance(idle, dict):
            raise ValueError("viz.idle is required when viz.read or viz.write is declared")
        if idle.get("fixture") == "host":
            pass
        elif not any(idle.get(k) for k in ("packets", "rf", "talkers", "headlines")):
            raise ValueError("viz.idle must be { fixture: host } or an inline demo seed")
        cv = viz.get("contract")
        if cv is not None and cv not in (1, 2):
            raise ValueError(f"viz.contract must be 1 or 2, got {cv!r}")
    elif isinstance(viz, dict) and viz.get("graphWalk") is not False:
        raise ValueError("viz.graphWalk must be false when viz block is present")
    render = doc.get("render")
    if isinstance(render, dict):
        scale = render.get("scale")
        if scale is not None:
            if not isinstance(scale, dict):
                raise ValueError("render.scale must be a mapping")
            mn = scale.get("min")
            if not isinstance(mn, (int, float)) or mn <= 0 or mn > 1:
                raise ValueError("render.scale.min must be a number greater than 0 and at most 1")
            steps = scale.get("steps")
            if steps is not None:
                if not isinstance(steps, list) or not steps:
                    raise ValueError("render.scale.steps must be a non-empty list of numbers")
                prev = 2.0
                for i, raw in enumerate(steps):
                    if not isinstance(raw, (int, float)) or raw <= 0 or raw > 1:
                        raise ValueError(f"render.scale.steps[{i}] must be a number greater than 0 and at most 1")
                    if raw < mn:
                        raise ValueError(f"render.scale.steps[{i}] must be at or above render.scale.min")
                    if raw > prev:
                        raise ValueError("render.scale.steps must be in descending order")
                    prev = float(raw)
    if isinstance(viz, dict) and viz.get("presentTick") is True and "viz.write" not in caps:
        raise ValueError("viz.presentTick requires viz.write")
    if isinstance(viz, dict) and needs_viz and viz.get("ubo") is not None:
        ubo = viz.get("ubo")
        if ubo != {
            "block": "ZotoVizData",
            "binding": 0,
            "layout": "std140",
            "hostUniform": "zotoVizSlots",
            "slotCount": 8,
            "slotFloats": 64,
            "slotVec4s": 16,
            "totalVec4s": 128,
            "totalBytes": 2048,
        }:
            raise ValueError("viz.ubo must match the fixed ZotoVizData std140 layout")


def _schema_error_line(err: Any, prefix: str = "") -> str:
    loc = ".".join(str(p) for p in err.path) or "(root)"
    msg = str(err.message).split("\n", 1)[0].strip()
    head = f"{prefix} {loc}" if prefix else loc
    return f"{head}: {msg}"


def validate_doc(doc: Any) -> dict[str, Any]:
    if not isinstance(doc, dict):
        raise ValueError("plugin must be a mapping")
    errors = sorted(validator().iter_errors(doc), key=lambda e: list(e.path))
    if errors:
        bits = []
        for err in errors:
            bits.append(_schema_error_line(err))
        raise ValueError("; ".join(bits))
    _check_semantics(doc, include_settings=False)
    return doc


_viz_validator = None


def _visualisation_validator():
    global _viz_validator
    if _viz_validator is None:
        from jsonschema import Draft202012Validator

        schema = _schema()
        defs = _schema_defs_resolved(schema)
        sub = {**defs["visualisation"], "$defs": defs}
        _viz_validator = Draft202012Validator(sub)
    return _viz_validator


class VisualisationManifestError(ValueError):
    """visualisation.yml failed manifest schema (may carry unknown top-level keys)."""

    def __init__(self, message: str, *, unknown_keys: list[str] | None = None) -> None:
        super().__init__(message)
        self.unknown_keys = list(unknown_keys or [])


def _validate_visualisation_yaml(viz: dict[str, Any]) -> None:
    """JSON Schema for visualisation.yml (legacy list ``options`` checked in semantics)."""
    opts = viz.get("options")
    errors = sorted(_visualisation_validator().iter_errors(viz), key=lambda e: list(e.path))
    if errors:
        unknown = pmb.unknown_keys_from_schema_errors(errors)
        if unknown and all(getattr(e, "validator", None) == "additionalProperties" for e in errors):
            raise VisualisationManifestError(
                "; ".join(_schema_error_line(e, "visualisation.yml") for e in errors),
                unknown_keys=unknown,
            )
        bits = []
        for err in errors:
            bits.append(_schema_error_line(err, "visualisation.yml"))
        raise ValueError("; ".join(bits))
    if isinstance(opts, list):
        keys: set[str] = set()
        for opt in opts:
            if not isinstance(opt, dict):
                continue
            key = _take_key(keys, opt)
            vals = [v[0] for v in _pairs(opt.get("values"))]
            default = str(opt.get("default") or "")
            if vals and default not in vals:
                raise ValueError(f"visualisation.yml option {key!r} default {default!r} is not in values")


def _validate_merged_catalog_row(row: dict[str, Any]) -> None:
    _check_semantics(row, include_settings=True)


def load_file(path: Path) -> dict[str, Any]:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as e:
        raise ValueError(f"could not read {path}: {e}") from e
    return validate_doc(raw)


def settings_check(staging_dir: Path) -> dict[str, Any]:
    """Pure merged-tree validation for install staging (#35 check list hook).

    No filesystem writes beyond reading ``plugin.yml`` / ``visualisation.yml`` under
    ``staging_dir``. Safe to run on a temp unpack before commit.
    """
    return validate_plugin_home(staging_dir)


def validate_plugin_home(home: Path) -> dict[str, Any]:
    """Validate plugin.yml + visualisation.yml the same way catalog scan does."""
    errors: list[dict[str, str]] = []
    yml = home / "plugin.yml"
    doc = load_file(yml)
    rel = str(yml)
    if dsp.plugin_kind(doc) == "data-source":
        dsp.validate_data_source_tree(home, doc)
    merged = _attach_visualisation({**doc}, home, errors, rel, blocked=None)
    if errors:
        raise ValueError(errors[0]["error"])
    if merged is None:
        raise ValueError(f"{doc.get('id', '?')}: invalid plugin")
    if merged.get("visualisation") is None:
        _validate_merged_catalog_row(merged)
    return merged


def _visualisation_doc(home: Path) -> dict[str, Any] | None:
    """Load optional visualisation.yml next to plugin.yml. None when the file is absent."""
    path = home / "visualisation.yml"
    if not path.is_file():
        return None
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as e:
        raise ValueError(f"could not read visualisation.yml: {e}") from e
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError("visualisation.yml must be a mapping")
    if "workBudget" in raw:
        from service.manifest_work_budget import ingest_catalog_work_budget

        clamped, note = ingest_catalog_work_budget(raw["workBudget"])
        raw["workBudget"] = clamped
        if note:
            raw["_workBudgetLimitedNote"] = note
    return raw


def _attach_visualisation(
    row: dict[str, Any],
    home: Path,
    errors: list[dict[str, str]],
    rel: str,
    blocked: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    try:
        viz = _visualisation_doc(home)
    except ValueError as e:
        errors.append({"file": rel, "error": str(e)})
        return row
    if viz is None:
        return row
    wb_note = None
    if isinstance(viz, dict):
        wb_note = viz.pop("_workBudgetLimitedNote", None)
    try:
        _validate_visualisation_yaml(viz)
    except VisualisationManifestError as e:
        pid = str(row.get("id") or home.name)
        if blocked is not None and e.unknown_keys:
            blocked.append(pmb.blocked_catalog_row(
                plugin_id=pid,
                name=str(row.get("name") or pid),
                file=rel,
                reason_code=pmb.REASON_MANIFEST_UNKNOWN_KEYS,
                message=pmb.message_unknown_manifest_keys(pid, e.unknown_keys),
                keys=e.unknown_keys,
            ))
        else:
            errors.append({"file": rel, "error": str(e)})
        return None
    except ValueError as e:
        errors.append({"file": rel, "error": str(e)})
        return None
    merged = {**row, "visualisation": viz}
    if isinstance(viz, dict) and "workBudget" in viz:
        merged["workBudget"] = viz["workBudget"]
        if wb_note:
            merged["workBudgetLimited"] = wb_note
    try:
        _validate_merged_catalog_row(merged)
    except ValueError as e:
        errors.append({"file": rel, "error": f"{row.get('id', '?')}: {e}"})
        return None
    return merged


def _typesafe_doc(home: Path) -> dict[str, Any] | None:
    """Load optional typesafe.yml next to plugin.yml. None when absent."""
    path = home / "typesafe.yml"
    if not path.is_file():
        return None
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as e:
        raise ValueError(f"could not read typesafe.yml: {e}") from e
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError("typesafe.yml must be a mapping")
    return raw


def _attach_typesafe(
    row: dict[str, Any],
    home: Path,
    errors: list[dict[str, str]],
    rel: str,
) -> dict[str, Any]:
    if row.get("typesafe") is not None:
        return row
    try:
        ts = _typesafe_doc(home)
    except ValueError as e:
        errors.append({"file": rel, "error": str(e)})
        return row
    if ts is None:
        return row
    return {**row, "typesafe": ts}


def _zip_files(folder: Path) -> list[Path]:
    if not folder.is_dir():
        return []
    return sorted(
        p for p in folder.iterdir()
        if p.is_file() and p.suffix.lower() == ".zip" and not p.name.startswith(".")
    )


def _plugin_yml_in(home: Path) -> Path | None:
    for name in ("plugin.yml", "plugin.yaml"):
        child = home / name
        if child.is_file():
            return child
    return None


def _owned_src_ids(src_dir: Path, loaded: list[dict[str, Any]]) -> set[str]:
    """Directory names and plugin.yml ids under src — used to skip colliding zips."""
    owned = {str(p["id"]) for p in loaded if p.get("id")}
    if not src_dir.is_dir():
        return owned
    for child in src_dir.iterdir():
        if not child.is_dir():
            continue
        yml = _plugin_yml_in(child)
        if yml is None:
            continue
        owned.add(child.name)
        try:
            raw = yaml.safe_load(yml.read_text(encoding="utf-8"))
        except (OSError, yaml.YAMLError):
            continue
        if isinstance(raw, dict) and raw.get("id"):
            owned.add(str(raw["id"]))
    return owned


def _catalog_layout(root: Path | None) -> tuple[Path, Path, Path] | None:
    """Resolve ``(src_dir, zips_dir, runtime_dir)`` for a merge scan, or None."""
    if root is None:
        return paths.plugin_src_dir(), paths.plugin_zips_dir(), paths.plugin_runtime_dir()
    root = Path(root)
    nested = root / "plugins" / "src"
    if nested.is_dir():
        zips = root / "plugins"
        return nested, zips, zips / ".runtime"
    sibling = root / "src"
    if sibling.is_dir():
        return sibling, root, root / ".runtime"
    return None


def _scan_roots(root: Path | None) -> tuple[Path, Path, str]:
    if root is None:
        return paths.plugin_zips_dir(), paths.plugin_runtime_dir(), "zips"
    root = Path(root)
    nested = root / "plugins"
    if nested.is_dir() and _zip_files(nested):
        return nested, nested / ".runtime", "zips"
    if root.is_dir() and _zip_files(root):
        return root, root / ".runtime", "zips"
    return root, root, "trees"


def _scan_payload(
    dir_path: Path,
    plugins: list[dict[str, Any]],
    errors: list[dict[str, str]],
    blocked: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "dir": str(dir_path),
        "schema": str(SCHEMA_FILE),
        "plugins": plugins,
        "errors": errors,
        "blocked": list(blocked or []),
        "pythonService": python_enabled(),
    }


def _is_pack_asset_watch_file(path: Path) -> bool:
    """True for files under a plugin ``assets/`` tree (memo must see byte changes)."""
    parts = path.parts
    if len(parts) < 2 or _ASSET_DIR not in parts:
        return False
    return parts.index(_ASSET_DIR) < len(parts) - 1


def _file_token(path: Path) -> tuple[Any, ...]:
    try:
        if _is_pack_asset_watch_file(path) and path.is_file() and not path.is_symlink():
            return (str(path), pz.plugin_sha256(path))
        st = path.stat()
        return (str(path), int(st.st_mtime_ns), int(st.st_size))
    except OSError:
        return (str(path), -1, -1)


def _zip_token(path: Path) -> tuple[str, str]:
    """Content hash for zip memo keys (mtime/size miss same-length repacks)."""
    try:
        return (str(path), pz.plugin_sha256(path))
    except OSError:
        return (str(path), "")


def _iter_watch_files(root: Path):
    if not root.is_dir():
        return
    stack = [root]
    while stack:
        cur = stack.pop()
        try:
            children = list(cur.iterdir())
        except OSError:
            continue
        for child in children:
            name = child.name
            if name in _WATCH_SKIP_DIRS or (name.startswith(".") and name != ".runtime"):
                continue
            try:
                if child.is_dir():
                    stack.append(child)
                    continue
                if child.is_file() and (child.suffix.lower() in _WATCH_SUFFIX or name in _WATCH_NAMES):
                    yield child
            except OSError:
                continue


def _dir_token(root: Path) -> list[tuple[str, int, int]]:
    return sorted(_file_token(p) for p in _iter_watch_files(root))


def _catalog_token(root: Path | None) -> tuple[Any, ...]:
    """Cheap mtime/size fingerprint so unchanged catalogs skip zip unpack + esbuild."""
    parts: list[Any] = [python_enabled()]
    layout = _catalog_layout(root)
    if layout is not None:
        src_dir, zips_dir, runtime_dir = layout
        parts.extend(_dir_token(src_dir))
        parts.extend(_zip_token(z) for z in _zip_files(zips_dir))
        parts.extend(_dir_token(runtime_dir))
        local_dir = paths.plugin_local_dir()
        parts.extend(_zip_token(z) for z in _zip_files(local_dir))
        parts.extend(_dir_token(paths.plugin_local_runtime_dir()))
    else:
        zips_dir, runtime_dir, mode = _scan_roots(root)
        if mode == "zips":
            parts.extend(_zip_token(z) for z in _zip_files(zips_dir))
            parts.extend(_dir_token(runtime_dir))
        else:
            parts.extend(_dir_token(zips_dir))
    parts.append(_file_token(CONSENT_FILE))
    return tuple(parts)


def _memo_key(root: Path | None) -> str:
    if root is None:
        return "__default__"
    try:
        return str(Path(root).resolve())
    except OSError:
        return str(root)


def _copy_scan(result: dict[str, Any]) -> dict[str, Any]:
    return {
        **result,
        "plugins": [dict(p) for p in (result.get("plugins") or [])],
        "errors": [dict(e) for e in (result.get("errors") or [])],
        "blocked": [dict(b) for b in (result.get("blocked") or [])],
    }


def _scan_uncached(root: Path | None = None) -> dict[str, Any]:
    """Build the catalog from src trees plus non-colliding zips, or a YAML tree."""
    global _scan_builds
    _scan_builds += 1
    layout = _catalog_layout(root)
    if layout is not None:
        src_dir, zips_dir, runtime_dir = layout
        if root is None or src_dir.is_dir():
            return _scan_catalog(src_dir, zips_dir, runtime_dir)
    zips_dir, runtime_dir, mode = _scan_roots(root)
    if mode == "zips":
        return _scan_zips(zips_dir, runtime_dir)
    return _scan_trees(zips_dir)


def _attach_runtime(
    doc: dict[str, Any],
    path: Path,
    errors: list[dict[str, str]],
    rel: str,
    *,
    sha256: str | None = None,
    parts: list[str] | tuple[str, ...] | None = None,
) -> dict[str, Any] | None:
    try:
        home = _plugin_home(path)
        nested = path.name in ("plugin.yml", "plugin.yaml")
        flags = optional_part_flags(doc, home, parts, nested=nested)
        compiled = compile_typescript(doc, path, sha256=sha256)
        sdk_err = assert_pack_sdk_compatible(home, doc, rel, runtime_parent=home.parent)
        if sdk_err is not None:
            errors.append(sdk_err)
            return None
        extra = {
            **flags,
            **compiled,
            **service_meta(doc, path),
            **pb.artefacts(path),
            **psky.artefacts(path),
        }
    except PackBundleBoundaryError as e:
        from .plugin_install import installed_zip_sha

        installed = installed_zip_sha(path.parent, path.parent.name) if sha256 else None
        upgrade = bool(installed and sha256 and installed != sha256)
        errors.append(
            catalog_boundary_error(
                rel,
                e.block,
                upgrade=upgrade,
                version=doc.get("version"),
            ),
        )
        return None
    except ValueError as e:
        errors.append({"file": rel, "error": str(e)})
        return None
    return extra


def _materialize_zip_plugin(
    zip_path: Path,
    runtime: Path,
    errors: list[dict[str, str]],
    rel: str,
    *,
    zip_version: str | int | None = None,
    pack_id: str | None = None,
) -> pz.UnpackResult | None:
    from .pack_zip_blocks import catalog_row_for_block, zip_block_for_pack, zip_block_for_sha

    zip_sha = pz.plugin_sha256(zip_path)
    persisted = zip_block_for_sha(zip_sha)
    if persisted is None and pack_id:
        persisted = zip_block_for_pack(pack_id)
    cache_key = zip_block_cache_key(zip_path)
    if pack_id:
        from .plugin_install import pack_install_lock

        if pack_install_lock(pack_id).locked():
            errors.append(
                {
                    "file": rel,
                    "error": "pack_install_retry_in_progress",
                    "message": "blocked zip retry is in progress",
                    "zip": rel,
                },
            )
            return None
    if persisted is not None:
        row = catalog_row_for_block(
            persisted,
            rel=rel,
            upgrade=runtime.is_dir(),
            version=zip_version,
        )
        remember_zip_block(cache_key, row)
        errors.append(row)
        return None
    cached = cached_zip_block(cache_key)
    if cached is not None:
        row = catalog_row_for_block(
            cached,
            rel=rel,
            upgrade=runtime.is_dir(),
            version=zip_version,
        )
        errors.append(row)
        return None
    try:
        return materialize_zip_runtime(
            zip_path,
            runtime,
            compile_bundle=compile_typescript,
            verify_bundle=verify_pack_bundle_home,
            load_doc=load_file,
        )
    except InstallV2BlockedError as e:
        row = {
            "file": rel,
            "error": "pack_install_blocked",
            "message": str(e),
            "zip": rel,
            **{k: v for k, v in e.payload.items() if k != "message"},
        }
        if "was blocked" in str(e):
            row["error"] = "pack_boundary"
        remember_zip_block(cache_key, row)
        errors.append(row)
        cleanup_staging(runtime)
        return None
    except PackBundleBoundaryError as e:
        upgrade = runtime.exists()
        row = catalog_boundary_error(rel, e.block, upgrade=upgrade, version=zip_version)
        remember_zip_block(cache_key, row)
        errors.append(row)
        cleanup_staging(runtime)
        return None
    except ValueError as e:
        text = str(e)
        row: dict[str, str] = {"file": rel, "error": text, "zip": rel}
        if "was blocked" in text:
            row["error"] = "pack_boundary"
            row["message"] = text
        elif "v1 is still running" in text or "v1 was restored" in text:
            row["error"] = "pack_install_blocked"
            row["message"] = text
        errors.append(row)
        cleanup_staging(runtime)
        return None
    except OSError as e:
        errors.append({"file": rel, "error": str(e)})
        cleanup_staging(runtime)
        return None


def _catalog_row(
    doc: dict[str, Any],
    extra: dict[str, Any],
    home: Path,
    errors: list[dict[str, str]],
    rel: str,
    blocked: list[dict[str, Any]] | None = None,
    **more: Any,
) -> dict[str, Any] | None:
    newer = pmb.pack_sdk_newer_than_host(doc)
    if newer is not None and blocked is not None:
        pid = str(doc.get("id") or home.name)
        blocked.append(pmb.blocked_catalog_row(
            plugin_id=pid,
            name=str(doc.get("name") or pid),
            file=rel,
            reason_code=pmb.REASON_MANIFEST_NEWER_SDK,
            message=pmb.message_newer_sdk(pid, newer),
            pack_sdk=newer,
        ))
        return None
    merged = {**doc, **more, **extra}
    kind = consent_kind(merged)
    sky = psky.catalog(merged, home, allowed=consented(merged))
    row = _attach_visualisation(
        {**merged, "consent": kind, **sky}, home, errors, rel, blocked,
    )
    if row is None:
        return None
    if dsp.plugin_kind(row) == "data-source":
        row["pluginKind"] = "data-source"
    if isinstance(doc.get("assets"), list) and doc["assets"]:
        row["assets"] = doc["assets"]
        assets_digest = _assets_manifest_sha256(home, doc)
        if assets_digest:
            row["assets_sha256"] = assets_digest
    if not isinstance(row.get("visualisation"), dict):
        try:
            _validate_merged_catalog_row(row)
        except ValueError as e:
            errors.append({"file": rel, "error": f"{doc.get('id', '?')}: {e}"})
            return None
    return _attach_typesafe(row, home, errors, rel)


def _scan_zips(
    zips_dir: Path,
    runtime_dir: Path,
    *,
    owned_ids: set[str] | None = None,
    origin: str = "zip",
) -> dict[str, Any]:
    plugins: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    blocked: list[dict[str, Any]] = []
    seen: set[str] = set()
    owned = owned_ids or set()
    for zip_path in _zip_files(zips_dir):
        rel = str(zip_path)
        stem = zip_path.stem
        if stem in owned:
            errors.append({"file": rel, "error": f"src catalog owns id {stem!r}"})
            continue
        try:
            manifest = pz.inspect_zip(zip_path)
            preview = validate_doc(manifest.plugin)
            pid = str(preview["id"])
            if pid in owned:
                errors.append({"file": rel, "error": f"src catalog owns id {pid!r}"})
                continue
            dest = runtime_dir / pid
        except (ValueError, OSError) as e:
            errors.append({"file": rel, "error": str(e)})
            continue
        zip_version = preview.get("version")
        if origin != "src":
            from .pack_zip_blocks import (
                catalog_row_for_store_unreadable,
                zip_blocks_store_dir_unreadable,
            )

            if zip_blocks_store_dir_unreadable():
                errors.append(catalog_row_for_store_unreadable(rel=rel, pack_id=pid))
                continue
        unpacked = _materialize_zip_plugin(
            zip_path, dest, errors, rel, zip_version=zip_version, pack_id=pid,
        )
        if dest.exists():
            yml = dest / "plugin.yml"
            doc = load_file(yml)
        else:
            continue
        pid = str(doc["id"])
        if pid in seen:
            errors.append({"file": rel, "error": f"duplicate plugin id {pid!r}"})
            continue
        seen.add(pid)
        if unpacked is None:
            if not dest.exists():
                continue
            parts = tuple(pz.detect_parts(dest))
            zip_sha = pz.plugin_sha256(zip_path)
            extra = _attach_runtime(doc, yml, errors, rel, sha256=zip_sha, parts=parts)
        else:
            extra = _attach_runtime(doc, yml, errors, rel, sha256=unpacked.sha256, parts=unpacked.parts)
        if extra is None:
            continue
        row = _catalog_row(
            doc, extra, dest, errors, rel, blocked,
            file=str(yml), zip=rel,
            sha256=unpacked.sha256 if unpacked else pz.plugin_sha256(zip_path),
            parts=list(unpacked.parts) if unpacked else list(pz.detect_parts(dest)),
            origin=origin,
        )
        if row is not None:
            plugins.append(row)
    return _scan_payload(zips_dir, plugins, errors, blocked)


def _scan_trees(root: Path, *, origin: str | None = None) -> dict[str, Any]:
    files = plugin_paths(root)
    plugins: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    blocked: list[dict[str, Any]] = []
    seen: set[str] = set()
    for path in files:
        rel = str(path)
        try:
            doc = load_file(path)
        except (ValueError, OSError) as e:
            errors.append({"file": rel, "error": str(e)})
            continue
        pid = str(doc["id"])
        if pid in seen:
            errors.append({"file": rel, "error": f"duplicate plugin id {pid!r}"})
            continue
        seen.add(pid)
        home = _plugin_home(path)
        parts = pz.detect_parts(home) if path.name in ("plugin.yml", "plugin.yaml") else []
        extra = _attach_runtime(doc, path, errors, rel, parts=parts)
        if extra is None:
            continue
        more: dict[str, Any] = {"file": rel, "parts": list(parts)}
        if origin:
            more["origin"] = origin
            more["sha256"] = _catalog_pack_sha256(home, path)
        row = _catalog_row(doc, extra, home, errors, rel, blocked, **more)
        if row is not None:
            plugins.append(row)
    return _scan_payload(root, plugins, errors, blocked)


def _scan_catalog(src_dir: Path, zips_dir: Path, runtime_dir: Path) -> dict[str, Any]:
    src = _scan_trees(src_dir, origin="src")
    owned = _owned_src_ids(src_dir, src["plugins"])
    zipped = _scan_zips(zips_dir, runtime_dir, owned_ids=owned)
    seen = owned | {str(p.get("id") or "") for p in zipped["plugins"] if p.get("id")}
    local_dir = paths.plugin_local_dir()
    local_plugins: list[dict[str, Any]] = []
    local_errors: list[dict[str, str]] = []
    local_blocked: list[dict[str, Any]] = []
    if local_dir.is_dir():
        local = _scan_zips(
            local_dir, paths.plugin_local_runtime_dir(), owned_ids=seen, origin="local",
        )
        local_plugins = list(local["plugins"])
        local_errors = list(local["errors"])
        local_blocked = list(local.get("blocked") or [])
    catalog_dir = zips_dir if zips_dir.is_dir() else src_dir
    blocked = (
        list(src.get("blocked") or [])
        + list(zipped.get("blocked") or [])
        + local_blocked
    )
    return _scan_payload(
        catalog_dir,
        pins.attach(list(src["plugins"]) + list(zipped["plugins"]) + local_plugins),
        list(src["errors"]) + list(zipped["errors"]) + local_errors,
        blocked,
    )


def scan(root: Path | None = None) -> dict[str, Any]:
    """Build the catalog from src trees plus non-colliding zips, or a YAML tree.

    Unchanged trees reuse the last result (mtime/size token) so the monitor watch
    loop and ``GET /api/plugins`` do not re-run esbuild on the event loop.
    """
    key = _memo_key(root)
    token = _catalog_token(root)
    with _scan_lock:
        hit = _scan_memo.get(key)
        if hit and hit[0] == token:
            return _copy_scan(hit[1])
        result = _scan_uncached(root)
        _scan_memo[key] = (_catalog_token(root), result)
        return _copy_scan(result)


def api_list(_: web.Request) -> web.Response:
    try:
        from .pack_install_catalog import drain_catalog_records
        from .plugin_install import drain_install_notices

        result = scan()
        records = drain_catalog_records()
        if records:
            merged_errors = [dict(e) for e in (result.get("errors") or [])]
            merged_errors.extend(records)
            result = {**result, "errors": merged_errors}
        notices = drain_install_notices()
        from .pack_install_retry import format_unreadable_block_records_notice
        from .pack_zip_blocks import unreadable_block_record_count

        unreadable_n = unreadable_block_record_count()
        if unreadable_n:
            msg = format_unreadable_block_records_notice(unreadable_n)
            if msg:
                notices = [*notices, {"error": "pack_block_record_unreadable", "message": msg}]
        if notices:
            result = {**result, "installNotices": notices}
        return web.json_response(result)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


def api_data_source_demo(req: web.Request) -> web.Response:
    """Serve a bundled demo snapshot for a data-source plugin (YAML-only; no live fetch)."""
    pid = req.match_info["id"]
    source_id = str(req.match_info.get("source_id") or "").strip()
    row = _plugin_row(pid)
    if not row:
        return web.json_response({"error": "unknown plugin"}, status=404)
    if dsp.plugin_kind(row) != "data-source":
        return web.json_response({"error": "not a data-source plugin"}, status=404)
    home = _plugin_pack_home(row)
    if not home:
        return web.json_response({"error": "plugin home missing"}, status=404)
    try:
        payload = dsp.read_demo_snapshot(home, row, source_id)
    except KeyError:
        return web.json_response({"error": "unknown source"}, status=404)
    except (ValueError, OSError) as e:
        return web.json_response({"error": str(e)}, status=400)
    return web.json_response(payload, headers={"Cache-Control": "no-store"})


async def api_list_http(request: web.Request) -> web.Response:
    return await asyncio.to_thread(api_list, request)


async def api_module_http(request: web.Request) -> web.StreamResponse:
    return await asyncio.to_thread(api_module, request)


async def api_sky_http(request: web.Request) -> web.StreamResponse:
    return await asyncio.to_thread(api_sky, request)


async def api_asset_http(request: web.Request) -> web.StreamResponse:
    return await asyncio.to_thread(api_asset, request)


async def api_data_source_demo_http(request: web.Request) -> web.Response:
    return await asyncio.to_thread(api_data_source_demo, request)


def python_allow(spec: dict[str, Any]) -> bool:
    return python_enabled() and consented(spec)


async def api_consent(req: web.Request) -> web.Response:
    pid = req.match_info["id"]
    try:
        body = await req.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "object required"}, status=400)
    kind = str(body.get("kind") or "")
    found = await asyncio.to_thread(_plugin_row, pid)
    if not found:
        return web.json_response({"error": "unknown plugin"}, status=404)
    if not needs_review(found):
        return web.json_response({"ok": True, "needed": False})
    try:
        grant_consent(found, kind)
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=400)
    await asyncio.to_thread(lambda: hooks.sync(scan().get("plugins") or [], allow=python_allow))
    from . import live
    pid = str(found.get("id") or "")
    live.queue_patch({"pluginConsent": {"id": pid, "kind": kind}})
    return web.json_response({"ok": True, "kind": kind, "needed": True})


def _print_scan(result: dict[str, Any]) -> int:
    plugins = result.get("plugins") or []
    errors = result.get("errors") or []
    for p in plugins:
        print(f"ok   {p.get('file')}  ({p.get('id')}, {p.get('engine')})")
    for e in errors:
        print(f"FAIL {e.get('file')}: {e.get('error')}", file=sys.stderr)
    n = len(plugins) + len(errors)
    print(f"{n} file{'' if n == 1 else 's'}, {len(plugins)} valid, {len(errors)} invalid")
    return 1 if errors else 0


def cli_validate(raw_paths: list[str]) -> int:
    if not raw_paths:
        return _print_scan(scan())
    code = 0
    plugins: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for raw in raw_paths:
        path = Path(raw).expanduser().resolve()
        try:
            if path.is_file() and path.suffix.lower() == ".zip":
                from . import pack_safe_zip as psz

                hit = psz.validate_pack_zip_path(path, str(path), paths.plugin_runtime_dir())
                if isinstance(hit, psz.Blocked):
                    raise ValueError(hit.message)
                doc = validate_doc(hit.manifest)
                plugins.append({**doc, "file": str(path), "parts": list(hit.parts)})
            elif path.is_dir() and ((path / "plugin.yml").is_file() or (path / "plugin.yaml").is_file()):
                manifest = pz.inspect_src(path)
                doc = validate_doc(manifest.plugin)
                yml = path / "plugin.yml" if (path / "plugin.yml").is_file() else path / "plugin.yaml"
                plugins.append({**doc, "file": str(yml), "parts": list(manifest.parts)})
            elif path.is_dir():
                result = scan(path)
                plugins.extend(result["plugins"])
                errors.extend(result["errors"])
            else:
                doc = load_file(path)
                plugins.append({**doc, "file": str(path)})
        except (ValueError, OSError) as e:
            errors.append({"file": str(path), "error": str(e)})
            code = 1
    return _print_scan({"plugins": plugins, "errors": errors}) or code


def seed(dest: Path | None = None, overwrite: bool = False) -> dict[str, list[str]]:
    """No-op. The shipped catalog is ``plugins/src/<id>/``.

    Home-dir seeding from example YAML was retired. Startup must not mkdir
    the user-dir plugin tree. Kept so callers that still invoke ``seed()``
    do not crash.
    """
    del dest, overwrite
    return {"copied": [], "skipped": []}


def cli_list() -> int:
    result = scan()
    plugins = result.get("plugins") or []
    errors = result.get("errors") or []
    for p in plugins:
        parts = ",".join(p.get("parts") or []) or "-"
        consent = p.get("consent") or "-"
        src = p.get("zip") or p.get("file")
        print(f"{p.get('id')}  v{p.get('version')}  {src}  parts={parts}  consent={consent}")
    for e in errors:
        print(f"FAIL {e.get('file')}: {e.get('error')}", file=sys.stderr)
    print(f"{len(plugins)} plugin{'' if len(plugins) == 1 else 's'}, {len(errors)} error{'' if len(errors) == 1 else 's'}")
    return 1 if errors else 0


def src_plugin_home(pid: str, repo_root: Path | None = None) -> Path | None:
    """Return ``plugins/src/<id>/`` when that tree has plugin.yml / plugin.yaml."""
    name = str(pid or "").strip()
    if not name:
        return None
    home = paths.plugin_src_dir(repo_root) / name
    if _plugin_yml_in(home) is not None:
        return home
    return None


def cli_pack(target: str, output: str | None = None) -> int:
    raw = Path(target).expanduser()
    src = raw.resolve() if raw.is_dir() else paths.plugin_src_dir() / str(target)
    try:
        manifest = pz.inspect_src(src)
        doc = validate_doc(manifest.plugin)
        pid = str(doc["id"])
        if output:
            dest = Path(output).expanduser()
            dest = dest.resolve() if dest.is_absolute() else (Path.cwd() / dest).resolve()
        else:
            dest = paths.repo_root() / "dist" / f"{pid}.zip"
        digest = pz.pack_tree(src, dest)
    except (ValueError, OSError) as e:
        print(e, file=sys.stderr)
        return 1
    print(f"packed {pid} -> {dest}")
    print(digest)
    return 0


def cli_add(zip_path: str, force: bool) -> int:
    src = Path(zip_path).expanduser().resolve()
    try:
        manifest = pz.inspect_zip(src)
        doc = validate_doc(manifest.plugin)
        pid = str(doc["id"])
        owned = src_plugin_home(pid)
        if owned is not None:
            print(
                f"refusing: src owns {pid} at {owned} (--force does not override)",
                file=sys.stderr,
            )
            return 1
        dest = paths.plugin_zips_dir() / f"{pid}.zip"
        if dest.exists() and not force:
            print(f"refusing to overwrite {dest} (pass --force)", file=sys.stderr)
            return 1
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
    except (ValueError, OSError) as e:
        print(e, file=sys.stderr)
        return 1
    print(f"added {pid} -> {dest}")
    return 0


def cli_zip_deprecated(zip_path: str, force: bool) -> int:
    print("[deprecation] plugin zip is now plugin add")
    return cli_add(zip_path, force)


def add_parser(sub: argparse._SubParsersAction) -> None:
    p = sub.add_parser("plugin", help="validate / list / pack / add (src catalog + contrib zips)")
    inner = p.add_subparsers(dest="plugin_cmd", required=True)
    v = inner.add_parser("validate", help="check a zip or plugins/src/<id>/ tree against schema + zip safety")
    v.add_argument("paths", nargs="*", help="zip files, source dirs, or YAML (default: catalog)")
    v.set_defaults(plugin_fn=lambda args: sys.exit(cli_validate(args.paths)))
    ls = inner.add_parser("list", help="list catalog plugins (id, version, zip, parts, consent)")
    ls.set_defaults(plugin_fn=lambda _args: sys.exit(cli_list()))
    pk = inner.add_parser("pack", help="zip plugins/src/<id>/ into dist/<id>.zip for sharing")
    pk.add_argument("target", help="plugin id or source directory")
    pk.add_argument("-o", "--output", default=None, help="write zip to this path instead of dist/<id>.zip")
    pk.set_defaults(plugin_fn=lambda args: sys.exit(cli_pack(args.target, args.output)))
    add = inner.add_parser("add", help="validate then copy a zip into plugins/<id>.zip")
    add.add_argument("zipfile", help="path to a plugin zip")
    add.add_argument(
        "--force",
        action="store_true",
        help="overwrite an existing zip (does not override a src tree)",
    )
    add.set_defaults(plugin_fn=lambda args: sys.exit(cli_add(args.zipfile, args.force)))
    z = inner.add_parser("zip", help="deprecated alias for plugin add")
    z.add_argument("zipfile", help="path to a plugin zip")
    z.add_argument(
        "--force",
        action="store_true",
        help="overwrite an existing zip (does not override a src tree)",
    )
    z.set_defaults(plugin_fn=lambda args: sys.exit(cli_zip_deprecated(args.zipfile, args.force)))
