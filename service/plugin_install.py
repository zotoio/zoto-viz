"""Staged zip → runtime install pipeline (local drop, web publish, MCP catalog)."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import shutil
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from . import paths
from . import pack_safe_zip as psz
from . import plugin_zip as pz
from .pack_boundary import PackBundleBoundaryError
from .pack_install_blocked_store import clear_blocked_pack, clear_blocked_zip, record_blocked_zip
from .pack_install_copy import (
    REASON_BOUNDARY_BLOCKED,
    REASON_PACK_INSTALL_BLOCKED,
    REASON_SCHEMA_INVALID,
    REASON_ZIP_UNSAFE,
    blocked_message,
)
from .pack_sdk_contract import assert_pack_sdk_compatible

_LOG = logging.getLogger(__name__)

InstallCheck = Callable[["InstallContext"], None]


@dataclass(frozen=True)
class InstallValidator:
    """Ordered install check. Register extras (e.g. work-budget in #45e) via ``register_install_validator``."""

    name: str
    order: int
    check: InstallCheck


@dataclass
class InstallFailure:
    validator: str
    reason: str
    message: str


class InstallBlocked(Exception):
    def __init__(self, reason: str, message: str, *, validator: str = "") -> None:
        self.reason = reason
        self.message = message
        self.validator = validator
        super().__init__(message)


_after_first_rename: Callable[[], None] | None = None
_start_runtime_hook: Callable[[Path, dict[str, Any], str | None], None] | None = None
_extra_validators: list[InstallValidator] = []
_pack_lock_meta = threading.Lock()
_pack_install_locks: dict[str, threading.Lock] = {}
_swap_in_progress: set[str] = set()
_last_install_pack_read: psz.PackZipRead | None = None


def register_install_validator(validator: InstallValidator) -> None:
    """Append a validator; lower ``order`` runs earlier. Duplicate names are allowed."""
    _extra_validators.append(validator)


def reset_install_pipeline_for_tests() -> None:
    global _after_first_rename, _start_runtime_hook
    _after_first_rename = None
    _start_runtime_hook = None
    _extra_validators.clear()
    _swap_in_progress.clear()
    global _last_install_pack_read
    _last_install_pack_read = None
    with _pack_lock_meta:
        _pack_install_locks.clear()


def set_after_first_rename(hook: Callable[[], None] | None) -> None:
    global _after_first_rename
    _after_first_rename = hook


def set_start_runtime_hook(hook: Callable[[Path, dict[str, Any], str | None], None] | None) -> None:
    global _start_runtime_hook
    _start_runtime_hook = hook


def ordered_validators() -> list[InstallValidator]:
    return sorted(_builtin_validators() + list(_extra_validators), key=lambda v: v.order)


@dataclass
class InstallContext:
    staging: Path
    runtime: Path
    dest_zip: Path
    doc: dict[str, Any]
    sha256: str
    upgrade: bool
    rel: str
    zip_path: Path = field(default_factory=Path)
    pack_zip: psz.PackZipRead | None = None


def staging_root(runtime_parent: Path) -> Path:
    return runtime_parent / ".staging"


def new_staging_dir(runtime_parent: Path, pack_id: str) -> Path:
    token = secrets.token_hex(4)
    base = staging_root(runtime_parent) / pack_id
    base.mkdir(parents=True, exist_ok=True)
    path = base / token
    path.mkdir(parents=True, exist_ok=False)
    return path


def cleanup_staging_dir(staging: Path | None) -> None:
    if staging is None:
        return
    shutil.rmtree(staging, ignore_errors=True)


def cleanup_staging_for_pack(runtime_parent: Path, pack_id: str) -> None:
    pack_staging = staging_root(runtime_parent) / pack_id
    if pack_staging.is_dir():
        shutil.rmtree(pack_staging, ignore_errors=True)


def list_staging_dirs(runtime_parent: Path) -> list[Path]:
    root = staging_root(runtime_parent)
    if not root.is_dir():
        return []
    out: list[Path] = []
    for pack_dir in root.iterdir():
        if not pack_dir.is_dir():
            continue
        for token_dir in pack_dir.iterdir():
            if token_dir.is_dir():
                out.append(token_dir)
    return out


def runtime_tree_hash(runtime: Path) -> str:
    if not runtime.is_dir():
        return ""
    digest = hashlib.sha256()
    for path in sorted(runtime.rglob("*")):
        if not path.is_file():
            continue
        digest.update(path.relative_to(runtime).as_posix().encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()


def bak_path(runtime: Path) -> Path:
    return runtime.parent / f"{runtime.name}.bak"


def install_state_path(runtime_parent: Path) -> Path:
    return runtime_parent / ".install-state.json"


def read_install_state(runtime_parent: Path) -> dict[str, str]:
    path = install_state_path(runtime_parent)
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return raw if isinstance(raw, dict) else {}


def write_install_state(runtime_parent: Path, pack_id: str, sha256: str) -> None:
    state = read_install_state(runtime_parent)
    state[str(pack_id)] = sha256
    install_state_path(runtime_parent).write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def installed_zip_sha(runtime_parent: Path, pack_id: str) -> str | None:
    hit = read_install_state(runtime_parent).get(pack_id)
    return str(hit) if hit else None


def should_skip_unchanged_zip(dest_zip: Path, runtime: Path, incoming_sha: str) -> bool:
    if not dest_zip.is_file() or not runtime.is_dir():
        return False
    if pz.plugin_sha256(dest_zip) != incoming_sha:
        return False
    return installed_zip_sha(runtime.parent, runtime.name) == incoming_sha


def last_install_pack_read_for_tests() -> psz.PackZipRead | None:
    return _last_install_pack_read


def _check_zip_safety(ctx: InstallContext) -> None:
    read = ctx.pack_zip
    if read is None:
        raise InstallBlocked(
            REASON_ZIP_UNSAFE,
            blocked_message(str(ctx.doc.get("name") or ctx.doc.get("id")), "zip was not read through the safe reader"),
            validator="zip_safety",
        )
    name = str(ctx.doc.get("name") or ctx.doc.get("id") or "Plugin")
    for rel, want in read.member_sha256.items():
        path = ctx.staging / rel
        if not path.is_file():
            raise InstallBlocked(
                REASON_ZIP_UNSAFE,
                blocked_message(name, psz.zip_entry_error(rel, "missing from staging")),
                validator="zip_safety",
            )
        got = hashlib.sha256(path.read_bytes()).hexdigest()
        if got != want:
            raise InstallBlocked(
                REASON_ZIP_UNSAFE,
                blocked_message(name, psz.zip_entry_error(rel, "staged bytes do not match zip entry")),
                validator="zip_safety",
            )


def _check_schema(ctx: InstallContext) -> None:
    from . import plugins

    import yaml

    yml = ctx.staging / "plugin.yml"
    if yml.is_file():
        raw = yaml.safe_load(yml.read_text(encoding="utf-8"))
        doc = raw if isinstance(raw, dict) else ctx.doc
    else:
        doc = ctx.doc
    name = str(doc.get("name") or doc.get("id") or ctx.doc.get("name") or ctx.doc.get("id") or "Plugin")
    try:
        plugins.validate_doc(doc)
    except ValueError as e:
        raise InstallBlocked(
            REASON_SCHEMA_INVALID,
            blocked_message(name, str(e)),
            validator="schema",
        ) from e


def _check_bundle_boundary(ctx: InstallContext) -> None:
    from . import plugins

    name = str(ctx.doc.get("name") or ctx.doc.get("id") or "Plugin")
    try:
        plugins.compile_typescript(ctx.doc, ctx.staging / "plugin.yml", sha256=ctx.sha256)
    except PackBundleBoundaryError as e:
        raise InstallBlocked(
            REASON_BOUNDARY_BLOCKED,
            blocked_message(name, e.block.to_dict().get("message", str(e))),
            validator="bundle_boundary",
        ) from e
    except ValueError as e:
        text = str(e)
        if "was blocked" in text or "pack" in text.lower():
            raise InstallBlocked(REASON_BOUNDARY_BLOCKED, blocked_message(name, text), validator="bundle_boundary") from e
        raise InstallBlocked(REASON_BOUNDARY_BLOCKED, blocked_message(name, text), validator="bundle_boundary") from e


def _check_sdk_contract(ctx: InstallContext) -> None:
    row = assert_pack_sdk_compatible(ctx.staging, ctx.doc, ctx.rel, runtime_parent=ctx.runtime.parent)
    if row is not None:
        name = str(ctx.doc.get("name") or ctx.doc.get("id") or "Plugin")
        raise InstallBlocked(
            REASON_PACK_INSTALL_BLOCKED,
            blocked_message(name, str(row.get("message") or "SDK contract mismatch")),
            validator="sdk_contract",
        )


def _builtin_validators() -> list[InstallValidator]:
    return [
        InstallValidator("zip_safety", 10, _check_zip_safety),
        InstallValidator("schema", 20, _check_schema),
        InstallValidator("bundle_boundary", 30, _check_bundle_boundary),
        InstallValidator("sdk_contract", 40, _check_sdk_contract),
    ]


def run_staging_validators(ctx: InstallContext) -> tuple[InstallFailure | None, list[InstallFailure]]:
    failures: list[InstallFailure] = []
    for validator in ordered_validators():
        try:
            validator.check(ctx)
        except InstallBlocked as e:
            failures.append(InstallFailure(validator.name, e.reason, e.message))
    if failures:
        for f in failures:
            _LOG.info(
                "pack install validator failed pack=%s validator=%s reason=%s message=%s",
                ctx.doc.get("id"),
                f.validator,
                f.reason,
                f.message,
            )
        return failures[0], failures
    return None, []


def blocked_result(first: InstallFailure, *, pack_id: str, sha256: str, zip_path: str) -> dict[str, Any]:
    record_blocked_zip(
        pack_id=pack_id,
        sha256=sha256,
        message=first.message,
        zip_path=zip_path,
        reason=first.reason,
    )
    return {
        "ok": False,
        "error": first.reason,
        "reason": first.reason,
        "message": first.message,
        "id": pack_id,
        "sha256": sha256,
        "zip": zip_path,
    }


def success_result(
    doc: dict[str, Any],
    dest: Path,
    unpacked: pz.UnpackResult,
    *,
    wrote: bool,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    clear_blocked_zip(unpacked.sha256)
    clear_blocked_pack(str(doc.get("id") or ""))
    info: dict[str, Any] = {
        "ok": True,
        "id": doc["id"],
        "version": doc.get("version"),
        "sha256": unpacked.sha256,
        "path": str(dest),
        "dir": str(unpacked.dest),
        "parts": list(unpacked.parts),
        "wrote": wrote,
    }
    if extra:
        info.update(extra)
    return info


def _write_zip_atomic(src_zip: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    staged = dest.with_name(dest.name + ".tmp")
    shutil.copy2(src_zip, staged)
    os.replace(staged, dest)


def _backup_zip_if_present(dest_zip: Path) -> None:
    zb = dest_zip.with_name(dest_zip.name + ".bak")
    if zb.is_file():
        zb.unlink(missing_ok=True)
    if dest_zip.is_file():
        shutil.copy2(dest_zip, zb)


def _restore_zip_from_bak(dest_zip: Path) -> None:
    zb = dest_zip.with_name(dest_zip.name + ".bak")
    if not zb.is_file():
        return
    if dest_zip.is_file():
        dest_zip.unlink()
    zb.rename(dest_zip)


def _commit_zip_after_success(src_zip: Path, dest_zip: Path) -> None:
    _write_zip_atomic(src_zip, dest_zip)
    zb = dest_zip.with_name(dest_zip.name + ".bak")
    if zb.is_file():
        zb.unlink(missing_ok=True)


def _start_runtime(runtime: Path, doc: dict[str, Any], sha256: str | None) -> None:
    if _start_runtime_hook is not None:
        _start_runtime_hook(runtime, doc, sha256)
        return
    from . import plugins

    plugins.compile_typescript(doc, runtime / "plugin.yml", sha256=sha256)


def _atomic_swap(staging: Path, runtime: Path) -> bool:
    pid = runtime.name
    if pid in _swap_in_progress:
        raise RuntimeError("swap already in progress")
    bak = bak_path(runtime)
    had_v1 = runtime.is_dir()
    if not had_v1:
        staging.rename(runtime)
        return False
    _swap_in_progress.add(pid)
    try:
        runtime.rename(bak)
        try:
            if _after_first_rename is not None:
                _after_first_rename()
            staging.rename(runtime)
        except Exception:
            if bak.is_dir():
                if runtime.exists():
                    shutil.rmtree(runtime, ignore_errors=True)
                bak.rename(runtime)
            raise
        return True
    finally:
        _swap_in_progress.discard(pid)


def _restore_from_bak(runtime: Path, dest_zip: Path) -> None:
    bak = bak_path(runtime)
    if runtime.exists():
        shutil.rmtree(runtime)
    if bak.is_dir():
        bak.rename(runtime)
    _restore_zip_from_bak(dest_zip)


def _rollback_blocked_install(
    runtime: Path,
    dest_zip: Path,
    old_zip_bytes: bytes,
    old_runtime_hash: str,
) -> None:
    """Ensure a blocked install leaves live zip + runtime exactly as before."""
    if dest_zip.is_file():
        if dest_zip.read_bytes() != old_zip_bytes:
            _restore_zip_from_bak(dest_zip)
            if dest_zip.read_bytes() != old_zip_bytes and old_zip_bytes:
                dest_zip.write_bytes(old_zip_bytes)
    elif old_zip_bytes:
        dest_zip.parent.mkdir(parents=True, exist_ok=True)
        dest_zip.write_bytes(old_zip_bytes)
    if runtime_tree_hash(runtime) == old_runtime_hash:
        return
    bak = bak_path(runtime)
    if bak.is_dir():
        _restore_from_bak(runtime, dest_zip)
    elif old_zip_bytes and dest_zip.is_file():
        pz.unpack_zip(dest_zip, runtime)
    elif runtime.exists():
        shutil.rmtree(runtime, ignore_errors=True)


def _lock_for_pack(pack_id: str) -> threading.Lock:
    with _pack_lock_meta:
        lock = _pack_install_locks.get(pack_id)
        if lock is None:
            lock = threading.Lock()
            _pack_install_locks[pack_id] = lock
        return lock


def install_zip_to_runtime(
    zip_path: Path,
    dest_zip: Path,
    runtime: Path,
    doc: dict[str, Any],
    *,
    rel: str,
    sha256: str | None = None,
    upgrade: bool = False,
    force: bool = False,
    pack_read: psz.PackZipRead | None = None,
) -> dict[str, Any]:
    """Run staged install; return structured ok/blocked result (never raises InstallBlocked)."""
    pid = str(doc["id"])
    incoming = sha256 or pz.plugin_sha256(zip_path)
    if not force and should_skip_unchanged_zip(dest_zip, runtime, incoming):
        unpacked = pz.unpack_zip(dest_zip, runtime)
        return success_result(doc, dest_zip, unpacked, wrote=False)
    lock = _lock_for_pack(pid)
    lock.acquire()
    try:
        return _install_zip_to_runtime_locked(
            zip_path,
            dest_zip,
            runtime,
            doc,
            rel=rel,
            sha256=incoming,
            upgrade=upgrade,
            pid=pid,
            pack_read=pack_read,
        )
    finally:
        lock.release()


def _install_zip_to_runtime_locked(
    zip_path: Path,
    dest_zip: Path,
    runtime: Path,
    doc: dict[str, Any],
    *,
    rel: str,
    sha256: str,
    upgrade: bool,
    pid: str,
    pack_read: psz.PackZipRead | None = None,
) -> dict[str, Any]:
    global _last_install_pack_read
    staging: Path | None = None
    swapped = False
    parent = runtime.parent
    old_zip_bytes = dest_zip.read_bytes() if dest_zip.is_file() else b""
    old_runtime_hash = runtime_tree_hash(runtime)
    name = str(doc.get("name") or doc.get("id") or "Plugin")
    try:
        pack_zip = pack_read or psz.read_pack_zip(zip_path)
    except ValueError as e:
        _rollback_blocked_install(runtime, dest_zip, old_zip_bytes, old_runtime_hash)
        fail = InstallFailure("zip_safety", REASON_ZIP_UNSAFE, blocked_message(name, str(e)))
        return blocked_result(fail, pack_id=pid, sha256=sha256, zip_path=rel)
    _last_install_pack_read = pack_zip
    try:
        cleanup_staging_for_pack(parent, pid)
        staging = new_staging_dir(parent, pid)
        psz.write_pack_zip_to_staging(staging, pack_zip)
        ctx = InstallContext(
            staging=staging,
            runtime=runtime,
            dest_zip=dest_zip,
            doc=doc,
            sha256=sha256,
            upgrade=upgrade,
            rel=rel,
            zip_path=zip_path,
            pack_zip=pack_zip,
        )
        first, _all = run_staging_validators(ctx)
        if first is not None:
            if not swapped:
                _rollback_blocked_install(runtime, dest_zip, old_zip_bytes, old_runtime_hash)
            return blocked_result(first, pack_id=pid, sha256=sha256, zip_path=rel)
        if upgrade:
            _backup_zip_if_present(dest_zip)
        swapped = _atomic_swap(staging, runtime)
        staging = None
        _start_runtime(runtime, doc, sha256)
        _commit_zip_after_success(zip_path, dest_zip)
        if swapped:
            shutil.rmtree(bak_path(runtime), ignore_errors=True)
        write_install_state(parent, pid, sha256)
        final = pz.UnpackResult(
            dest=runtime,
            sha256=sha256,
            unpacked=True,
            plugin=doc,
            parts=pack_zip.parts,
            members=pack_zip.members_sorted,
        )
        return success_result(doc, dest_zip, final, wrote=True)
    finally:
        cleanup_staging_dir(staging)
        cleanup_staging_for_pack(parent, pid)
