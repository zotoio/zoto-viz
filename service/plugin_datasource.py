"""Datasource host: ``streams.yml`` remap + optional in-process collector.

Collectors share the plugin-Python gate (env + consent). Emissions are merged
into the 1 Hz snapshot dict — the same object the WebSocket already fans out —
so no extra asyncio task or IPC path is added.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Callable

import yaml

from .plugin_backend import COLLECTOR_REL, collector_file, module_name, streams_file
from .plugin_zip import plugin_sha256

_collectors: dict[str, dict[str, Any]] = {}
_stream_maps: dict[str, dict[str, Any]] = {}


class CollectorHost:
    """Small surface for ``datasource/collector.py``: start / stop / emit."""

    def __init__(self, plugin_id: str, *, state: Any = None) -> None:
        self.plugin_id = plugin_id
        self.state = state
        self._buf: dict[str, Any] = {}

    def log(self, msg: str) -> None:
        print(f"[plugin:{self.plugin_id}:collector] {msg}", file=sys.stderr)

    def emit(self, stream: str, payload: Any) -> None:
        name = str(stream or "").strip()
        if name:
            self._buf[name] = payload


def loaded() -> dict[str, dict[str, Any]]:
    return _collectors


def stream_maps() -> dict[str, dict[str, Any]]:
    return _stream_maps


def produced_streams() -> set[str]:
    names: set[str] = set()
    for rec in _collectors.values():
        names.update(rec.get("produces") or ())
    return names


def unload_all() -> None:
    for pid in list(_collectors):
        _drop(pid)


def reset() -> None:
    unload_all()
    _stream_maps.clear()


def parse_streams(path: Path) -> dict[str, Any]:
    """Load ``datasource/streams.yml`` into catalog-shaped consumes/produces/bindings."""
    try:
        raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as e:
        raise ValueError(f"could not read {path}: {e}") from e
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError("streams.yml must be a mapping")
    consumes = [_norm_ref(item) for item in (raw.get("consumes") or [])]
    produces = [_norm_ref(item) for item in (raw.get("produces") or [])]
    bindings = raw.get("bindings") if isinstance(raw.get("bindings"), dict) else {}
    out: dict[str, Any] = {
        "consumes": [c for c in consumes if c],
        "produces": [p for p in produces if p],
        "bindings": bindings,
    }
    if not out["consumes"] and not out["produces"] and not out["bindings"]:
        return {}
    return out


def load_streams(home: Path) -> dict[str, Any]:
    found = streams_file(home)
    if found is None:
        return {}
    return parse_streams(found)


def remap_fields(payload: Any, field_map: dict[str, str] | None) -> Any:
    if not field_map:
        return payload
    if isinstance(payload, list):
        return [remap_fields(item, field_map) for item in payload]
    if isinstance(payload, dict):
        return {field_map.get(str(key), key): value for key, value in payload.items()}
    return payload


def remap_consumes(snapshot: dict[str, Any], consumes: list[dict[str, Any]]) -> dict[str, Any]:
    """Return a copy of named snapshot streams with optional field remaps applied."""
    out: dict[str, Any] = {}
    for ref in consumes:
        name = str((ref or {}).get("stream") or "")
        if not name or name not in snapshot:
            continue
        mapping = ref.get("map") if isinstance(ref.get("map"), dict) else {}
        out[name] = remap_fields(snapshot[name], mapping)
    return out


def sync_maps(plugins: list[dict[str, Any]]) -> None:
    """Register streams.yml mappings from the catalog. YAML only — no Python import."""
    wanted: dict[str, dict[str, Any]] = {}
    for spec in plugins:
        pid = str(spec.get("id") or "")
        if not pid:
            continue
        streams = spec.get("streams")
        if isinstance(streams, dict) and (streams.get("consumes") or streams.get("produces") or streams.get("bindings")):
            wanted[pid] = streams
            continue
        file = spec.get("file")
        if not file:
            continue
        try:
            parsed = load_streams(Path(file).parent)
        except ValueError as e:
            print(f"[plugin:{pid}] {e}", file=sys.stderr)
            continue
        if parsed:
            wanted[pid] = parsed
    _stream_maps.clear()
    _stream_maps.update(wanted)


def sync(plugins: list[dict[str, Any]], *, allow: Callable[[dict[str, Any]], bool] | None = None) -> None:
    """Load / reload / drop collectors to match the catalog. ``allow`` is env + consent."""
    sync_maps(plugins)
    wanted: dict[str, tuple[Path, dict[str, Any]]] = {}
    for spec in plugins:
        pid = str(spec.get("id") or "")
        file = spec.get("file")
        if not pid or not file:
            continue
        if allow is not None and not allow(spec):
            continue
        path = collector_file(Path(file).parent)
        try:
            ok = path.is_file()
        except OSError:
            continue
        if ok:
            wanted[pid] = (path, spec)

    for pid in list(_collectors):
        if pid not in wanted:
            _drop(pid)

    for pid, (path, spec) in wanted.items():
        try:
            digest = plugin_sha256(path)
            mtime = path.stat().st_mtime
        except OSError:
            _drop(pid)
            continue
        cur = _collectors.get(pid)
        if cur and cur["path"] == path and cur["digest"] == digest and cur["mtime"] == mtime:
            continue
        _load(pid, path, digest, mtime, spec)


def apply_snapshot(msg: dict[str, Any]) -> dict[str, Any]:
    """Attach remapped consumes and merge collector emits onto the 1 Hz snapshot."""
    remapped: dict[str, Any] = {}
    for pid, streams in _stream_maps.items():
        consumes = streams.get("consumes") or []
        payload = remap_consumes(msg, consumes)
        if payload:
            remapped[pid] = payload
    if remapped:
        msg.setdefault("plugin_streams", {}).update(remapped)
    return merge_emits(msg)


def merge_emits(msg: dict[str, Any]) -> dict[str, Any]:
    for rec in list(_collectors.values()):
        host: CollectorHost = rec["host"]
        fn = getattr(rec["module"], "emit", None)
        if callable(fn):
            try:
                extra = fn(host)
            except Exception as e:  # noqa: BLE001 — a collector must not take down the monitor
                print(f"[plugin:{rec['id']}] emit: {type(e).__name__}: {e}", file=sys.stderr)
                extra = None
            if isinstance(extra, dict):
                host._buf.update(extra)
        produces = rec.get("produces") or ()
        for stream, payload in list(host._buf.items()):
            if produces and stream not in produces:
                continue
            msg[stream] = payload
        host._buf.clear()
    return msg


def _norm_ref(item: Any) -> dict[str, Any] | None:
    if isinstance(item, str):
        name = item.strip()
        return {"stream": name, "map": {}} if name else None
    if isinstance(item, dict):
        name = str(item.get("stream") or "").strip()
        if not name:
            return None
        raw_map = item.get("map") if isinstance(item.get("map"), dict) else {}
        mapping = {str(k): str(v) for k, v in raw_map.items()}
        return {"stream": name, "map": mapping}
    return None


def _produces_names(spec: dict[str, Any]) -> tuple[str, ...]:
    streams = spec.get("streams") if isinstance(spec.get("streams"), dict) else {}
    refs = list(streams.get("produces") or [])
    if not refs:
        ds = spec.get("datasource") if isinstance(spec.get("datasource"), dict) else {}
        refs = list(ds.get("produces") or spec.get("produces") or [])
    names: list[str] = []
    for item in refs:
        ref = item if (isinstance(item, dict) and item.get("stream") and "map" in item) else _norm_ref(item)
        if ref:
            names.append(str(ref["stream"]))
    return tuple(dict.fromkeys(names))


def _load(pid: str, path: Path, digest: str, mtime: float, spec: dict[str, Any]) -> None:
    if pid in _collectors:
        _drop(pid)
    name = module_name(pid, path, kind="collector")
    loader_spec = importlib.util.spec_from_file_location(name, path)
    if loader_spec is None or loader_spec.loader is None:
        print(f"[plugin:{pid}] could not load {COLLECTOR_REL}", file=sys.stderr)
        return
    mod = importlib.util.module_from_spec(loader_spec)
    sys.modules[name] = mod
    try:
        loader_spec.loader.exec_module(mod)
    except Exception as e:  # noqa: BLE001
        sys.modules.pop(name, None)
        print(f"[plugin:{pid}] collector load failed: {type(e).__name__}: {e}", file=sys.stderr)
        return
    host = CollectorHost(pid)
    rec = {
        "id": pid,
        "path": path,
        "digest": digest,
        "mtime": mtime,
        "module": mod,
        "host": host,
        "name": name,
        "produces": _produces_names(spec),
    }
    _collectors[pid] = rec
    start = getattr(mod, "start", None)
    if callable(start):
        try:
            start(host)
        except Exception as e:  # noqa: BLE001
            print(f"[plugin:{pid}] start: {type(e).__name__}: {e}", file=sys.stderr)


def _drop(pid: str) -> None:
    rec = _collectors.pop(pid, None)
    if not rec:
        return
    stop = getattr(rec["module"], "stop", None)
    if callable(stop):
        try:
            stop(rec["host"])
        except Exception as e:  # noqa: BLE001
            print(f"[plugin:{pid}] stop: {type(e).__name__}: {e}", file=sys.stderr)
    prefix = rec["name"] + "."
    for key in [k for k in sys.modules if k == rec["name"] or k.startswith(prefix)]:
        sys.modules.pop(key, None)
