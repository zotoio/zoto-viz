"""View plugins: YAML files in ~/.zoto-viz/plugins validated against the view-plugin schema.

A plugin declares identity plus a shipped engine. Graph plugins wrap topology /
talkers / services / protocols / layers / watch / cores / load (and the RF/CPU
bases wifi, bluetooth, cpu). Arcade plugins reuse NetPong, Invaders, Command,
Frogger, or CPU Pong. TypeScript plugins (runtime: typescript + entry) are compiled
by esbuild and loaded in a sandboxed iframe with an explicit capability allowlist.
A directory plugin may also ship `service/__init__.py` (or `service.py`); the monitor
hot-loads that module in-process. That path is trusted local code, not the iframe.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from . import hooks
from . import paths
from . import sysconfig
import yaml
from aiohttp import web

DIR = paths.plugins_dir()
CONSENT_FILE = paths.user_dir() / "plugin-consent.yml"
REPO = Path(__file__).resolve().parents[1]
SCHEMA_FILE = REPO / "schema" / "view-plugin.schema.json"
SHIPPED = REPO / "examples" / "plugins"
SUFFIXES = {".yml", ".yaml"}
ALLOWED_CAPS = frozenset({"graph.read", "graph.style", "ui.overlay", "config.read"})
MAX_BUNDLE = 256 * 1024
_ESBUILD = REPO / "web" / "node_modules" / ".bin" / "esbuild"
_bundles: dict[str, tuple[str, bytes]] = {}


def _plugin_home(path: Path) -> Path:
    if path.name in ("plugin.yml", "plugin.yaml"):
        return path.parent
    return path.parent


def compile_typescript(doc: dict[str, Any], path: Path) -> dict[str, Any]:
    """Bundle entry.ts with esbuild. Returns {hash, error?} metadata attached to the plugin list."""
    if doc.get("runtime") != "typescript":
        return {}
    caps = [c for c in (doc.get("capabilities") or []) if c in ALLOWED_CAPS]
    unknown = [c for c in (doc.get("capabilities") or []) if c not in ALLOWED_CAPS]
    if unknown:
        raise ValueError(f"unknown capabilities {unknown}")
    home = _plugin_home(path)
    if path.name not in ("plugin.yml", "plugin.yaml"):
        raise ValueError("typescript plugins must live in a directory as plugin.yml")
    entry = (home / str(doc["entry"])).resolve()
    if not str(entry).startswith(str(home.resolve())):
        raise ValueError("entry must stay inside the plugin directory")
    if not entry.is_file():
        raise ValueError(f"missing entry {entry.name}")
    if not _ESBUILD.is_file():
        raise ValueError("esbuild is not installed (cd web && pnpm install)")
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
    _bundles[str(doc["id"])] = (digest, js)
    return {"hash": digest, "capabilities": caps, "bytes": len(js)}


def python_enabled() -> bool:
    """Master switch: in-process plugin Python is off until the operator sets the env var."""
    return os.environ.get("ZOTO_VIZ_PLUGIN_SERVICE", "").strip().lower() in {"1", "true", "yes", "on"}


def needs_review(doc: dict[str, Any]) -> bool:
    """True when the plugin ships executable code (TypeScript and/or a service module)."""
    if doc.get("runtime") == "typescript":
        return True
    svc = doc.get("service")
    return isinstance(svc, str) and bool(svc.strip())


def consent_stamp(doc: dict[str, Any]) -> str:
    return f"{doc.get('id')}:{doc.get('version')}:{doc.get('hash') or doc.get('service') or 'yaml'}"


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
    kind = rec.get("kind")
    return kind if kind in {"reviewed", "authored"} else None


def consented(doc: dict[str, Any]) -> bool:
    if not needs_review(doc):
        return True
    return consent_kind(doc) in {"reviewed", "authored"}


def grant_consent(doc: dict[str, Any], kind: str) -> str:
    if kind not in {"reviewed", "authored"}:
        raise ValueError("kind must be reviewed or authored")
    data = _consent_doc()
    data[str(doc["id"])] = {"kind": kind, "stamp": consent_stamp(doc), "version": doc.get("version")}
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
    return _bundles.get(pid)


def api_module(req: web.Request) -> web.StreamResponse:
    pid = req.match_info["id"]
    got = _bundles.get(pid)
    if not got:
        scan()  # compile on demand
        got = _bundles.get(pid)
    if not got:
        return web.json_response({"error": "no compiled module"}, status=404)
    digest, js = got
    resp = web.Response(body=js, content_type="text/javascript; charset=utf-8")
    resp.headers["Content-Security-Policy"] = "default-src 'none'; script-src 'none'"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Zoto-Viz-Hash"] = digest
    resp.headers["Cache-Control"] = "no-store"
    return resp

_validator = None


def _schema() -> dict[str, Any]:
    raw = yaml.safe_load(SCHEMA_FILE.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"{SCHEMA_FILE} is not a mapping")
    return raw


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


def _check_semantics(doc: dict[str, Any]) -> None:
    keys: set[str] = set()
    for opt in doc.get("options") or []:
        if not isinstance(opt, dict):
            continue
        key = _take_key(keys, opt)
        vals = [v[0] for v in _pairs(opt.get("values"))]
        default = str(opt.get("default") or "")
        if vals and default not in vals:
            raise ValueError(f"option {key!r} default {default!r} is not in values")
    for field in doc.get("config") or []:
        if not isinstance(field, dict):
            continue
        key = _take_key(keys, field)
        if field.get("type") == "select":
            vals = [v[0] for v in _pairs(field.get("values"))]
            default = field.get("default")
            if default is not None and vals and str(default) not in vals:
                raise ValueError(f"config {key!r} default {default!r} is not in values")
        lo, hi = field.get("min"), field.get("max")
        if isinstance(lo, (int, float)) and isinstance(hi, (int, float)) and lo > hi:
            raise ValueError(f"config {key!r} min is greater than max")


def validate_doc(doc: Any) -> dict[str, Any]:
    if not isinstance(doc, dict):
        raise ValueError("plugin must be a mapping")
    errors = sorted(validator().iter_errors(doc), key=lambda e: list(e.path))
    if errors:
        bits = []
        for err in errors:
            loc = ".".join(str(p) for p in err.path) or "(root)"
            bits.append(f"{loc}: {err.message}")
        raise ValueError("; ".join(bits))
    _check_semantics(doc)
    return doc


def load_file(path: Path) -> dict[str, Any]:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as e:
        raise ValueError(f"could not read {path}: {e}") from e
    return validate_doc(raw)


def scan(root: Path | None = None) -> dict[str, Any]:
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
        extra: dict[str, Any] = {}
        try:
            extra = {**compile_typescript(doc, path), **service_meta(doc, path)}
        except ValueError as e:
            errors.append({"file": rel, "error": str(e)})
            continue
        plugins.append({**doc, "file": rel, **extra, "consent": consent_kind({**doc, **extra})})
    return {
        "dir": str(root or DIR),
        "schema": str(SCHEMA_FILE),
        "plugins": plugins,
        "errors": errors,
        "pythonService": python_enabled(),
    }


def api_list(_: web.Request) -> web.Response:
    try:
        return web.json_response(scan())
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


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
    found = next((p for p in (scan().get("plugins") or []) if p.get("id") == pid), None)
    if not found:
        return web.json_response({"error": "unknown plugin"}, status=404)
    if not needs_review(found):
        return web.json_response({"ok": True, "needed": False})
    try:
        grant_consent(found, kind)
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=400)
    hooks.sync(scan().get("plugins") or [], allow=python_allow)
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


def cli_validate(paths: list[str]) -> int:
    if not paths:
        if not DIR.exists():
            print(f"no plugins directory at {DIR} (nothing to validate)")
            return 0
        return _print_scan(scan(DIR))
    code = 0
    plugins: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for raw in paths:
        path = Path(raw).expanduser().resolve()
        if path.is_dir():
            result = scan(path)
            plugins.extend(result["plugins"])
            errors.extend(result["errors"])
            continue
        try:
            doc = load_file(path)
        except (ValueError, OSError) as e:
            errors.append({"file": str(path), "error": str(e)})
            code = 1
            continue
        plugins.append({**doc, "file": str(path)})
    return _print_scan({"plugins": plugins, "errors": errors}) or code


def seed(dest: Path | None = None, overwrite: bool = False) -> dict[str, list[str]]:
    """Copy shipped YAML from examples/plugins into dest. Existing files are left alone unless overwrite."""
    dest = dest or DIR
    dest.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    skipped: list[str] = []
    if not SHIPPED.is_dir():
        return {"copied": copied, "skipped": skipped}
    for src in sorted(SHIPPED.iterdir()):
        if src.is_dir() and (src / "plugin.yml").is_file():
            target = dest / src.name
            if target.exists() and not overwrite:
                skipped.append(src.name)
                continue
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(src, target)
            copied.append(src.name)
            continue
        if src.suffix.lower() not in SUFFIXES:
            continue
        target = dest / src.name
        if target.exists() and not overwrite:
            skipped.append(src.name)
            continue
        shutil.copy2(src, target)
        copied.append(src.name)
    return {"copied": copied, "skipped": skipped}


def cli_install(force: bool) -> int:
    cfg = sysconfig.ensure()
    result = seed(DIR, overwrite=force)
    dest = DIR
    air = dest / "air-ssid.yml"
    if cfg.get("ssids") and air.is_file():
        if sysconfig.apply_watch_default(air, cfg["ssids"]):
            print(f"watch {air}  <-  {', '.join(cfg['ssids'])}")
    dropin = sysconfig.write_systemd_override(cfg)
    for name in result["copied"]:
        print(f"copy  {SHIPPED / name}  ->  {dest / name}")
    for name in result["skipped"]:
        print(f"skip  {dest / name}  (exists)")
    n = len(result["copied"]) + len(result["skipped"])
    print(f"{n} shipped, {len(result['copied'])} copied, {len(result['skipped'])} kept")
    print(f"sys-config  {sysconfig.sys_config_file()}")
    for line in sysconfig.describe(cfg):
        print(f"  {line}")
    if dropin:
        print(f"systemd    {dropin}  (systemctl --user daemon-reload)")
    return 0


def add_parser(sub: argparse._SubParsersAction) -> None:
    p = sub.add_parser("plugin", help="validate view plugins against the JSON Schema")
    inner = p.add_subparsers(dest="plugin_cmd", required=True)
    v = inner.add_parser("validate", help="check YAML against schema/view-plugin.schema.json")
    v.add_argument("paths", nargs="*", help="files or directories (default: ~/.zoto-viz/plugins)")
    v.set_defaults(plugin_fn=lambda args: sys.exit(cli_validate(args.paths)))
    ls = inner.add_parser("list", help="list valid plugins in ~/.zoto-viz/plugins")
    ls.set_defaults(plugin_fn=lambda _args: sys.exit(_print_scan(scan())))
    ins = inner.add_parser("install", help="copy shipped examples/plugins into ~/.zoto-viz/plugins")
    ins.add_argument("--force", action="store_true", help="overwrite existing files")
    ins.set_defaults(plugin_fn=lambda args: sys.exit(cli_install(args.force)))
