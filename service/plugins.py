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
import yaml
from aiohttp import web

DIR = paths.plugins_dir()
CONSENT_FILE = paths.user_dir() / "plugin-consent.yml"
REPO = Path(__file__).resolve().parents[1]
SCHEMA_FILE = REPO / "schema" / "plugin.schema.json"
SUFFIXES = {".yml", ".yaml"}
ALLOWED_CAPS = frozenset({
    "graph.read", "graph.style", "ui.overlay", "config.read", "viz.read", "viz.write",
    "typesafe",
})
MAX_BUNDLE = 256 * 1024
DEFAULT_FRONTEND_ENTRY = "frontend/index.ts"
_ESBUILD = REPO / "web" / "node_modules" / ".bin" / "esbuild"
# id -> (js sha256, bundle bytes, cache key, entry path, plugin sha256)
_bundles: dict[str, tuple[str, bytes, str, Path, str]] = {}
_compile_runs = 0
_scan_lock = threading.Lock()
_scan_memo: dict[str, tuple[tuple[Any, ...], dict[str, Any]]] = {}
_scan_builds = 0
_WATCH_NAMES = frozenset({"plugin.yml", "plugin.yaml", "visualisation.yml", "visualisation.yaml"})
_WATCH_SUFFIX = frozenset({".ts", ".tsx", ".js", ".mjs", ".glsl", ".py", ".zip", ".yml", ".yaml"})
_WATCH_SKIP_DIRS = frozenset({"node_modules", "__pycache__", ".git"})
_SCHEMA_KEYS = frozenset({"$ref", "$schema", "$id", "title", "description"})


def deref_schema(raw: dict[str, Any], origin: Path) -> dict[str, Any]:
    """Follow a one-line sibling `$ref` shim (view/agent-plugin → plugin.schema.json)."""
    ref = raw.get("$ref")
    if (
        not isinstance(ref, str)
        or not ref.endswith(".json")
        or "://" in ref
        or "#" in ref
    ):
        return raw
    if any(key not in _SCHEMA_KEYS for key in raw):
        return raw
    target = (origin.parent / ref).resolve()
    if target.parent != origin.parent.resolve() or not target.is_file():
        raise ValueError(f"unresolved schema $ref {ref!r}")
    loaded = yaml.safe_load(target.read_text(encoding="utf-8"))
    if not isinstance(loaded, dict):
        raise ValueError(f"{target.name} is not a mapping")
    return loaded


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
    fe = dict(doc["frontend"]) if isinstance(doc.get("frontend"), dict) else {}
    fe["entry"] = entry
    inspect = nested and home.is_dir()
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


def _cache_key(sha256: str, entry: Path) -> str:
    mtime = entry.stat().st_mtime_ns if entry.is_file() else 0
    return f"{sha256}:{mtime}"


def compile_runs() -> int:
    """How many times esbuild actually ran (cache misses). Tests use this."""
    return _compile_runs


def reset_bundles() -> None:
    global _compile_runs
    _bundles.clear()
    _compile_runs = 0
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


def compile_typescript(doc: dict[str, Any], path: Path, sha256: str | None = None) -> dict[str, Any]:
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
    key = _cache_key(digest_src, entry)
    cached = _bundles.get(pid)
    if cached and cached[2] == key:
        return {"hash": cached[0], "capabilities": caps, "bytes": len(cached[1]), "cached": True}
    if not _ESBUILD.is_file():
        raise ValueError("esbuild is not installed (cd web && pnpm install)")
    global _compile_runs
    proc = subprocess.run(
        [str(_ESBUILD), str(entry), "--bundle", "--format=esm", "--platform=browser",
         "--target=es2022", "--external:three", "--external:d3-force-3d"],
        capture_output=True, text=True, timeout=20, check=False,
    )
    if proc.returncode != 0:
        raise ValueError(proc.stderr.strip() or "esbuild failed")
    js = proc.stdout.encode("utf-8")
    if len(js) > MAX_BUNDLE:
        raise ValueError(f"compiled plugin exceeds {MAX_BUNDLE} bytes")
    digest = hashlib.sha256(js).hexdigest()
    _compile_runs += 1
    _bundles[pid] = (digest, js, key, entry, digest_src)
    return {"hash": digest, "capabilities": caps, "bytes": len(js)}


def python_enabled() -> bool:
    """Master switch: in-process plugin Python is off until the operator sets the env var."""
    return os.environ.get("ZOTO_VIZ_PLUGIN_SERVICE", "").strip().lower() in {"1", "true", "yes", "on"}


CONSENT_ARTEFACTS = ("frontend", "backend", "collector", "shader")
AUTOCONSENT_ORIGINS = frozenset({"src", "local"})
_ARTEFACT_FIELD = {
    "frontend": "hash",
    "backend": "backend_sha256",
    "collector": "collector_sha256",
    "shader": "shader_sha256",
}
_CONSENT_HASH_KEYS = ("backend_sha256", "collector_sha256", "shader_sha256")


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


def grant_consent(doc: dict[str, Any], kind: str) -> str:
    if kind not in {"reviewed", "authored"}:
        raise ValueError("kind must be reviewed or authored")
    data = _consent_doc()
    rec: dict[str, Any] = {"kind": kind, "stamp": consent_stamp(doc), "version": doc.get("version")}
    for key in _CONSENT_HASH_KEYS:
        digest = doc.get(key)
        if digest:
            rec[key] = digest
    data[str(doc["id"])] = rec
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
    return kind


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
    query = getattr(getattr(req, "rel_url", None), "query", None) or {}
    want = query.get("h") or query.get("hash") if hasattr(query, "get") else None
    if want and want == digest:
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    else:
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


_validator = None


def _schema() -> dict[str, Any]:
    raw = yaml.safe_load(SCHEMA_FILE.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"{SCHEMA_FILE} is not a mapping")
    return deref_schema(raw, SCHEMA_FILE)


def validator():
    global _validator
    if _validator is None:
        from jsonschema import Draft202012Validator
        _validator = Draft202012Validator(_schema())
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
    elif isinstance(viz, dict) and viz.get("graphWalk") is not False:
        raise ValueError("viz.graphWalk must be false when viz block is present")
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
        sub = {**schema["$defs"]["visualisation"], "$defs": schema["$defs"]}
        _viz_validator = Draft202012Validator(sub)
    return _viz_validator


def _validate_visualisation_yaml(viz: dict[str, Any]) -> None:
    """JSON Schema for visualisation.yml (legacy list ``options`` checked in semantics)."""
    opts = viz.get("options")
    errors = sorted(_visualisation_validator().iter_errors(viz), key=lambda e: list(e.path))
    if errors:
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
    merged = _attach_visualisation({**doc}, home, errors, rel)
    if errors:
        raise ValueError(errors[0]["error"])
    if merged is None:
        raise ValueError(f"{doc.get('id', '?')}: invalid plugin")
    if not isinstance(merged.get("visualisation"), dict):
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
    return raw


def _attach_visualisation(
    row: dict[str, Any],
    home: Path,
    errors: list[dict[str, str]],
    rel: str,
) -> dict[str, Any] | None:
    try:
        viz = _visualisation_doc(home)
    except ValueError as e:
        errors.append({"file": rel, "error": str(e)})
        return row
    if viz is None:
        return row
    try:
        _validate_visualisation_yaml(viz)
    except ValueError as e:
        errors.append({"file": rel, "error": str(e)})
        return None
    merged = {**row, "visualisation": viz}
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


def _scan_payload(dir_path: Path, plugins: list[dict[str, Any]], errors: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "dir": str(dir_path),
        "schema": str(SCHEMA_FILE),
        "plugins": plugins,
        "errors": errors,
        "pythonService": python_enabled(),
    }


def _file_token(path: Path) -> tuple[str, int, int]:
    try:
        st = path.stat()
        return (str(path), int(st.st_mtime_ns), int(st.st_size))
    except OSError:
        return (str(path), -1, -1)


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
        parts.extend(_file_token(z) for z in _zip_files(zips_dir))
        parts.extend(_dir_token(runtime_dir))
        local_dir = paths.plugin_local_dir()
        parts.extend(_file_token(z) for z in _zip_files(local_dir))
        parts.extend(_dir_token(paths.plugin_local_runtime_dir()))
    else:
        zips_dir, runtime_dir, mode = _scan_roots(root)
        if mode == "zips":
            parts.extend(_file_token(z) for z in _zip_files(zips_dir))
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
        extra = {
            **flags,
            **compile_typescript(doc, path, sha256=sha256),
            **service_meta(doc, path),
            **pb.artefacts(path),
            **psky.artefacts(path),
        }
    except ValueError as e:
        errors.append({"file": rel, "error": str(e)})
        return None
    return extra


def _catalog_row(
    doc: dict[str, Any],
    extra: dict[str, Any],
    home: Path,
    errors: list[dict[str, str]],
    rel: str,
    **more: Any,
) -> dict[str, Any] | None:
    merged = {**doc, **more, **extra}
    kind = consent_kind(merged)
    sky = psky.catalog(merged, home, allowed=consented(merged))
    row = _attach_visualisation({**merged, "consent": kind, **sky}, home, errors, rel)
    if row is None:
        return None
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
            unpacked = pz.unpack_zip(zip_path, dest)
            yml = dest / "plugin.yml"
            doc = load_file(yml)
        except (ValueError, OSError) as e:
            errors.append({"file": rel, "error": str(e)})
            continue
        pid = str(doc["id"])
        if pid in seen:
            errors.append({"file": rel, "error": f"duplicate plugin id {pid!r}"})
            continue
        seen.add(pid)
        extra = _attach_runtime(doc, yml, errors, rel, sha256=unpacked.sha256, parts=unpacked.parts)
        if extra is None:
            continue
        row = _catalog_row(
            doc, extra, dest, errors, rel,
            file=str(yml), zip=rel, sha256=unpacked.sha256, parts=list(unpacked.parts),
            origin=origin,
        )
        if row is not None:
            plugins.append(row)
    return _scan_payload(zips_dir, plugins, errors)


def _scan_trees(root: Path, *, origin: str | None = None) -> dict[str, Any]:
    files = plugin_paths(root)
    plugins: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
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
            more["sha256"] = _plugin_sha(path, None)
        row = _catalog_row(doc, extra, home, errors, rel, **more)
        if row is not None:
            plugins.append(row)
    return _scan_payload(root, plugins, errors)


def _scan_catalog(src_dir: Path, zips_dir: Path, runtime_dir: Path) -> dict[str, Any]:
    src = _scan_trees(src_dir, origin="src")
    owned = _owned_src_ids(src_dir, src["plugins"])
    zipped = _scan_zips(zips_dir, runtime_dir, owned_ids=owned)
    seen = owned | {str(p.get("id") or "") for p in zipped["plugins"] if p.get("id")}
    local_dir = paths.plugin_local_dir()
    local_plugins: list[dict[str, Any]] = []
    local_errors: list[dict[str, str]] = []
    if local_dir.is_dir():
        local = _scan_zips(
            local_dir, paths.plugin_local_runtime_dir(), owned_ids=seen, origin="local",
        )
        local_plugins = list(local["plugins"])
        local_errors = list(local["errors"])
    catalog_dir = zips_dir if zips_dir.is_dir() else src_dir
    return _scan_payload(
        catalog_dir,
        pins.attach(list(src["plugins"]) + list(zipped["plugins"]) + local_plugins),
        list(src["errors"]) + list(zipped["errors"]) + local_errors,
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
        return web.json_response(scan())
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def api_list_http(request: web.Request) -> web.Response:
    return await asyncio.to_thread(api_list, request)


async def api_module_http(request: web.Request) -> web.StreamResponse:
    return await asyncio.to_thread(api_module, request)


async def api_sky_http(request: web.Request) -> web.StreamResponse:
    return await asyncio.to_thread(api_sky, request)


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
                manifest = pz.inspect_zip(path)
                doc = validate_doc(manifest.plugin)
                plugins.append({**doc, "file": str(path), "parts": list(manifest.parts)})
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
