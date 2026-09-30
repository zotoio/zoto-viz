"""Single zip → runtime install pipeline (local, contrib, catalog)."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import shutil
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from . import pack_safe_zip as psz
from . import paths
from . import plugin_zip as pz
from .pack_boundary import PackBundleBoundary, PackBundleBoundaryError, format_blocked_message
from .pack_install_lint import (
    REASON_INSTALL_CHECK_UNAVAILABLE,
    PackInstallLintSetupError,
    format_install_lint_setup_upgrade_message,
    merge_lint_warnings,
    run_install_pack_lint,
)
from .pack_zip_blocks import record_zip_block, row_for_start_failure, zip_block_for_sha
from .pack_install_blocked_store import record_blocked_zip
from .pack_install_copy import REASON_PACK_INSTALL_BLOCKED, upgrade_rollback_user_message
from .pack_sdk_contract import assert_pack_sdk_compatible, read_cached_sdk_manifest
from .pack_zip_install_ux import installed_runtime_version
from .pack_block_copy import (
    BLOCK_FIX_TAIL,
    SENTENCE_BOUNDARY,
    SENTENCE_CHECKS_FAILED,
    SENTENCE_SDK_OLDER,
    PackBlockedError,
    upgrade_block_message,
)

InstallCheck = Callable[["InstallContext"], None]

_LOG = logging.getLogger(__name__)

_INSTALL_CHECKS: list[InstallCheck] = []
_after_first_rename: Callable[[], None] | None = None
_start_runtime_hook: Callable[[Path, dict[str, Any], str | None], None] | None = None
_pending_notices: list[dict[str, str]] = []
_pack_lock_meta = threading.Lock()
_pack_install_locks: dict[str, threading.Lock] = {}
_swap_in_progress: set[str] = set()
_last_install_staged: psz.StagedPack | None = None


@dataclass(frozen=True)
class PackZipReadView:
    """Test-facing view of the last ``StagedPack`` install."""

    plugin: dict[str, Any]
    stats: psz.ZipReadStats
    member_sha256: dict[str, str]
    members_sorted: tuple[str, ...]


def last_install_pack_read_for_tests() -> PackZipReadView | None:
    s = _last_install_staged
    if s is None:
        return None
    return PackZipReadView(s.manifest, s.stats, s.member_sha256, s.members_sorted)


def reset_install_pipeline_for_tests() -> None:
    global _after_first_rename, _start_runtime_hook, _last_install_staged
    _after_first_rename = None
    _start_runtime_hook = None
    _last_install_staged = None
    _INSTALL_CHECKS.clear()
    _pending_notices.clear()
    _swap_in_progress.clear()
    with _pack_lock_meta:
        _pack_install_locks.clear()


class InstallV2BlockedError(Exception):
    def __init__(self, message: str, *, payload: dict[str, str] | None = None) -> None:
        self.payload = payload or {}
        super().__init__(message)


class InstallStartFailedError(Exception):
    def __init__(self, message: str, *, reason: str = "") -> None:
        self.reason = reason
        super().__init__(message)


class InstallUpgradeRollbackError(Exception):
    """Upgrade swap failed after ``.bak`` was taken; live tree was rolled back."""

    def __init__(
        self,
        message: str,
        *,
        pack_id: str,
        sha256: str,
        zip_path: str,
    ) -> None:
        self.pack_id = pack_id
        self.sha256 = sha256
        self.zip_path = zip_path
        super().__init__(message)


class InstallCheckUnavailableError(Exception):
    """Labelled failure when a required check cannot run."""


def register_install_check(check: InstallCheck) -> None:
    _INSTALL_CHECKS.append(check)


def _lock_for_pack(pack_id: str) -> threading.Lock:
    with _pack_lock_meta:
        lock = _pack_install_locks.get(pack_id)
        if lock is None:
            lock = threading.Lock()
            _pack_install_locks[pack_id] = lock
        return lock


def pack_install_lock(pack_id: str) -> threading.Lock:
    return _lock_for_pack(pack_id)


def drain_install_notices() -> list[dict[str, str]]:
    out = list(_pending_notices)
    _pending_notices.clear()
    return out


def queue_install_notice(message: str, *, error: str = "pack_install") -> None:
    _pending_notices.append({"error": error, "message": message})


def format_v2_blocked_message(
    name: str,
    old_version: str | int | None,
    sentence: str,
    *,
    tail: str = BLOCK_FIX_TAIL,
) -> str:
    """#185: upgrade block copy; ``old_version`` is the installed version (never a hard-coded v1)."""
    return upgrade_block_message(name, sentence, old_version, tail=tail)


def format_v2_start_failed_message(name: str, version: str | int | None) -> str:
    label = (name or "Plugin").strip()
    ver = str(version).strip() if version is not None else "2"
    return f"{label} v{ver} couldn't start, so v1 was restored"


def format_interrupted_restore_message(name: str) -> str:
    label = (name or "Plugin").strip()
    return f"An update to {label} was interrupted, so v1 was restored"


def format_couldnt_check_message(name: str) -> str:
    label = (name or "Plugin").strip()
    return f"Couldn't check {label}; v1 is still running"


@dataclass
class InstallContext:
    staging: Path
    runtime: Path
    dest_zip: Path
    doc: dict[str, Any]
    sha256: str
    upgrade: bool
    rel: str


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
    parent = staging.parent
    if parent.name and parent.parent == staging_root(parent.parent.parent):
        try:
            if parent.is_dir() and not any(parent.iterdir()):
                parent.rmdir()
        except OSError:
            pass


def cleanup_staging_for_pack(runtime_parent: Path, pack_id: str) -> None:
    """Only under lock for ``pack_id``."""
    legacy = runtime_parent / f".{pack_id}-staging"
    shutil.rmtree(legacy, ignore_errors=True)
    shutil.rmtree(runtime_parent / f"{pack_id}.bundle-staging", ignore_errors=True)
    pack_staging = staging_root(runtime_parent) / pack_id
    if pack_staging.is_dir():
        shutil.rmtree(pack_staging, ignore_errors=True)


def cleanup_staging_artifacts(runtime: Path) -> None:
    """Remove staging dirs for this pack only (safe outside per-pack lock for error paths)."""
    cleanup_staging_for_pack(runtime.parent, runtime.name)


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


def list_bak_dirs(runtime_parent: Path) -> list[Path]:
    if not runtime_parent.is_dir():
        return []
    return [p for p in runtime_parent.iterdir() if p.is_dir() and p.name.endswith(".bak")]


def assert_runtime_parent_clean(runtime_parent: Path) -> None:
    """No ``.staging/*`` or ``*.bak`` (tests / diagnostics)."""
    staging = list_staging_dirs(runtime_parent)
    assert not staging, f"staging left: {staging}"
    baks = list_bak_dirs(runtime_parent)
    assert not baks, f".bak left: {baks}"


def runtime_tree_hash(runtime: Path) -> str:
    return psz.runtime_tree_hash(runtime)


def set_after_first_rename(cb: Callable[[], None] | None) -> None:
    global _after_first_rename
    _after_first_rename = cb


def bak_path(runtime: Path) -> Path:
    return runtime.parent / f"{runtime.name}.bak"


def zip_bak_path(dest_zip: Path) -> Path:
    return dest_zip.with_name(dest_zip.name + ".bak")


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
    path = install_state_path(runtime_parent)
    path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def installed_zip_sha(runtime_parent: Path, pack_id: str) -> str | None:
    hit = read_install_state(runtime_parent).get(pack_id)
    return str(hit) if hit else None


def should_skip_unchanged_zip(
    dest_zip: Path,
    runtime: Path,
    incoming_sha: str,
) -> bool:
    if not dest_zip.is_file() or not runtime.is_dir():
        return False
    if pz.plugin_sha256(dest_zip) != incoming_sha:
        return False
    recorded = installed_zip_sha(runtime.parent, runtime.name)
    return recorded == incoming_sha


def _check_pack_install_warnings(ctx: InstallContext) -> dict[str, Any]:
    _blocks, warnings = run_install_pack_lint(ctx.staging)
    ctx.doc = merge_lint_warnings(ctx.doc, warnings)
    return ctx.doc


def _check_sdk_contract(ctx: InstallContext) -> None:
    row = assert_pack_sdk_compatible(ctx.staging, ctx.doc, ctx.rel, runtime_parent=ctx.runtime.parent)
    if row is not None:
        try:
            older = int(row.get("packSdkContractVersion") or 0) < int(row.get("hostSdkContractVersion") or 0)
        except ValueError:
            older = False
        if older:
            raise PackBlockedError(row.get("name") or ctx.doc.get("name") or ctx.doc.get("id"), SENTENCE_SDK_OLDER, tail="")
        raise ValueError(row.get("message") or "SDK contract mismatch")


def _check_bundle_allowlist(ctx: InstallContext) -> None:
    from . import plugins

    try:
        plugins.verify_pack_bundle_home(ctx.staging, ctx.doc, sha256=ctx.sha256)
    except FileNotFoundError as e:
        raise InstallCheckUnavailableError(format_couldnt_check_message(str(ctx.doc.get("name") or ctx.doc.get("id")))) from e
    except OSError as e:
        raise InstallCheckUnavailableError(format_couldnt_check_message(str(ctx.doc.get("name") or ctx.doc.get("id")))) from e


def run_staging_checks(ctx: InstallContext) -> None:
    for check in _INSTALL_CHECKS:
        check(ctx)
    _check_pack_install_warnings(ctx)
    _check_bundle_allowlist(ctx)
    _check_sdk_contract(ctx)


def _write_zip_atomic(src_zip: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    staged = dest.with_name(dest.name + ".tmp")
    shutil.copy2(src_zip, staged)
    os.replace(staged, dest)


def _backup_zip_if_present(dest_zip: Path) -> None:
    zb = zip_bak_path(dest_zip)
    if zb.is_file():
        zb.unlink(missing_ok=True)
    if dest_zip.is_file():
        shutil.copy2(dest_zip, zb)


def _restore_zip_from_bak(dest_zip: Path) -> None:
    zb = zip_bak_path(dest_zip)
    if not zb.is_file():
        return
    if dest_zip.is_file():
        dest_zip.unlink()
    zb.rename(dest_zip)


def _commit_zip_after_success(src_zip: Path, dest_zip: Path) -> None:
    _write_zip_atomic(src_zip, dest_zip)
    zb = zip_bak_path(dest_zip)
    if zb.is_file():
        zb.unlink(missing_ok=True)


def _start_runtime(runtime: Path, doc: dict[str, Any], sha256: str | None) -> None:
    if _start_runtime_hook is not None:
        _start_runtime_hook(runtime, doc, sha256)
        return
    from . import plugins

    plugins.compile_typescript(doc, runtime / "plugin.yml", sha256=sha256)


def _recover_bak_if_present(runtime: Path) -> bool:
    bak = bak_path(runtime)
    if not bak.is_dir():
        return False
    if runtime.exists():
        shutil.rmtree(runtime)
    bak.rename(runtime)
    return True


def _atomic_swap(staging: Path, runtime: Path) -> bool:
    pid = runtime.name
    if pid in _swap_in_progress:
        raise RuntimeError("swap already in progress")
    _recover_bak_if_present(runtime)
    bak = bak_path(runtime)
    had_v1 = runtime.is_dir()
    if not had_v1:
        staging.rename(runtime)
        return False
    _swap_in_progress.add(pid)
    try:
        runtime.rename(bak)
        if _after_first_rename is not None:
            _after_first_rename()
        staging.rename(runtime)
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


def install_staged_to_runtime(
    staged: psz.StagedPack,
    zip_path: Path,
    dest_zip: Path,
    runtime: Path,
    *,
    rel: str,
    upgrade: bool = False,
    force: bool = False,
) -> pz.UnpackResult:
    doc = staged.manifest
    pid = str(doc["id"])
    incoming = staged.zip_sha256
    if not force:
        blocked = zip_block_for_sha(incoming)
        if blocked is not None:
            msg = str(blocked.get("message") or "This zip install is blocked.")
            reason = str(blocked.get("blockReason") or blocked.get("error") or "blocked")
            raise InstallStartFailedError(msg, reason=reason)
    if not force and should_skip_unchanged_zip(dest_zip, runtime, incoming):
        psz.cleanup_staging_for_pack(runtime.parent, pid)
        return _unpack_result_from_runtime(dest_zip, runtime, incoming)
    name = str(doc.get("name") or pid)
    version = doc.get("version")
    lock = _lock_for_pack(pid)
    lock.acquire()
    try:
        return _install_staged_to_runtime_locked(
            staged,
            zip_path,
            dest_zip,
            runtime,
            rel=rel,
            sha256=incoming,
            upgrade=upgrade,
            pid=pid,
            name=name,
            version=version,
        )
    finally:
        lock.release()


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
    pack_read: psz.StagedPack | PackZipReadView | None = None,
) -> pz.UnpackResult:
    parent = runtime.parent
    if isinstance(pack_read, psz.StagedPack):
        staged = pack_read
    else:
        hit = psz.validate_pack_zip_path(zip_path, rel, parent)
        if isinstance(hit, psz.Blocked):
            raise ValueError(hit.message)
        staged = hit
    return install_staged_to_runtime(
        staged,
        zip_path,
        dest_zip,
        runtime,
        rel=rel,
        upgrade=upgrade,
        force=force,
    )


def _unpack_result_from_runtime(dest_zip: Path, runtime: Path, digest: str) -> pz.UnpackResult:
    yml = runtime / pz.REQUIRED_MEMBER
    plugin = pz._parse_plugin_yml(yml.read_bytes()) if yml.is_file() else {}
    members = tuple(pz._list_tree_members(runtime))
    return pz.UnpackResult(
        dest=runtime,
        sha256=digest,
        unpacked=False,
        plugin=plugin,
        parts=pz.detect_parts(runtime),
        members=members,
    )


def _install_staged_to_runtime_locked(
    staged: psz.StagedPack,
    zip_path: Path,
    dest_zip: Path,
    runtime: Path,
    *,
    rel: str,
    sha256: str,
    upgrade: bool,
    pid: str,
    name: str,
    version: str | int | None,
) -> pz.UnpackResult:
    global _last_install_staged
    swapped = False
    parent = runtime.parent
    staging = staged.staging_dir
    doc = dict(staged.manifest)
    try:
        ctx = InstallContext(
            staging=staging,
            runtime=runtime,
            dest_zip=dest_zip,
            doc=doc,
            sha256=sha256,
            upgrade=upgrade,
            rel=rel,
        )
        try:
            run_staging_checks(ctx)
            doc = ctx.doc
        except PackBundleBoundaryError as e:
            if upgrade:
                raise InstallV2BlockedError(
                    format_v2_blocked_message(name, installed_runtime_version(runtime), SENTENCE_BOUNDARY),
                    payload={**e.block.to_dict(), "upgrade_blocked": "true", "zip": rel},
                ) from e
            raise
        except InstallCheckUnavailableError as e:
            if upgrade:
                raise InstallV2BlockedError(str(e), payload={"upgrade_blocked": "true", "zip": rel}) from e
            raise
        except PackInstallLintSetupError as e:
            # #185: the install lint couldn't run (or gave no valid verdict). Never "was blocked";
            # an upgrade says which version is still installed.
            if upgrade:
                raise InstallV2BlockedError(
                    format_install_lint_setup_upgrade_message(name or e.pack_name, installed_runtime_version(runtime)),
                    payload={"error": REASON_INSTALL_CHECK_UNAVAILABLE, "upgrade_blocked": "true", "zip": rel},
                ) from e
            raise
        except ValueError as e:
            if upgrade:
                if isinstance(e, PackBlockedError):
                    sentence, tail = e.sentence, e.tail
                else:
                    # Not a plain-words block (esbuild error, bad manifest): keep the raw text in the log.
                    _LOG.warning("pack upgrade blocked for %s: %s", pid, e)
                    sentence, tail = SENTENCE_CHECKS_FAILED, BLOCK_FIX_TAIL
                raise InstallV2BlockedError(
                    format_v2_blocked_message(name, installed_runtime_version(runtime), sentence, tail=tail),
                    payload={"error": "pack_install_blocked", "upgrade_blocked": "true", "zip": rel, "sentence": sentence},
                ) from e
            raise

        if upgrade:
            _backup_zip_if_present(dest_zip)
        if pid in _swap_in_progress:
            raise RuntimeError("swap already in progress")
        _swap_in_progress.add(pid)
        try:
            try:
                swapped = psz.go_live(staged, runtime, after_first_rename=_after_first_rename)
            except OSError as e:
                if upgrade:
                    _recover_bak_if_present(runtime)
                if upgrade and runtime.is_dir():
                    old_version = installed_runtime_version(runtime)
                    msg = upgrade_rollback_user_message(name, version, old_version)
                    _LOG.info("pack upgrade swap failed; rolled back to prior version: %s", e)
                    record_blocked_zip(
                        pack_id=pid,
                        sha256=sha256,
                        message=msg,
                        zip_path=rel,
                        reason=REASON_PACK_INSTALL_BLOCKED,
                    )
                    raise InstallUpgradeRollbackError(
                        msg,
                        pack_id=pid,
                        sha256=sha256,
                        zip_path=rel,
                    ) from e
                raise
        finally:
            _swap_in_progress.discard(pid)
        try:
            _start_runtime(runtime, doc, sha256)
        except Exception as e:
            if swapped:
                _restore_from_bak(runtime, dest_zip)
                msg = format_v2_start_failed_message(name, version)
                record_zip_block(
                    sha256,
                    row_for_start_failure(
                        sha256=sha256,
                        message=msg,
                        pack_id=pid,
                        name=name,
                        zip_path=rel,
                        version=version,
                    ),
                )
                raise InstallStartFailedError(msg, reason=str(e).strip()) from e
            if runtime.is_dir():
                shutil.rmtree(runtime, ignore_errors=True)
            raise
        if swapped:
            leftover = bak_path(runtime)
            if leftover.is_dir():
                try:
                    shutil.rmtree(leftover)
                except OSError as exc:
                    _LOG.warning(
                        "pack upgrade left .bak directory after successful swap: %s",
                        leftover,
                        exc_info=exc,
                    )
        _commit_zip_after_success(zip_path, dest_zip)
        write_install_state(parent, pid, sha256)
        _last_install_staged = staged
        return _unpack_result_from_runtime(dest_zip, runtime, sha256)
    finally:
        if staging.is_dir() and ".staging" in staging.parts:
            psz.cleanup_staging_dir(staging)


def recover_interrupted_swaps(runtime_parent: Path) -> list[str]:
    if not runtime_parent.is_dir():
        return []
    messages: list[str] = []
    for bak in sorted(runtime_parent.glob("*.bak")):
        if not bak.is_dir() or not bak.name.endswith(".bak"):
            continue
        runtime = bak.with_suffix("")
        pid = runtime.name
        if pid in _swap_in_progress:
            continue
        lock = _lock_for_pack(pid)
        if not lock.acquire(blocking=False):
            continue
        try:
            if pid in _swap_in_progress:
                continue
            name = pid
            yml = bak / "plugin.yml"
            if yml.is_file():
                try:
                    import yaml

                    raw = yaml.safe_load(yml.read_text(encoding="utf-8"))
                    if isinstance(raw, dict) and raw.get("name"):
                        name = str(raw["name"])
                except Exception:
                    pass
            dest_zip = _guess_zip_for_runtime(runtime_parent, pid)
            if runtime.exists():
                shutil.rmtree(runtime)
            bak.rename(runtime)
            if dest_zip is not None:
                _restore_zip_from_bak(dest_zip)
            cleanup_staging_for_pack(runtime_parent, pid)
            from .pack_install_catalog import append_catalog_record

            msg = format_interrupted_restore_message(name)
            append_catalog_record(
                {
                    "error": "pack_install_interrupted",
                    "message": msg,
                    "id": pid,
                    "name": name,
                },
                once_key=f"interrupted:{pid}",
            )
            messages.append(msg)
        finally:
            lock.release()
    return messages


def _guess_zip_for_runtime(runtime_parent: Path, pid: str) -> Path | None:
    local = paths.plugin_local_runtime_dir()
    if runtime_parent.resolve() == local.resolve():
        cand = paths.plugin_local_dir() / f"{pid}.zip"
        return cand if cand.parent.is_dir() else None
    cand = paths.plugin_zips_dir() / f"{pid}.zip"
    return cand if cand.is_file() or cand.parent.is_dir() else None


def recover_leftover_bak_dirs(runtime_parent: Path) -> int:
    """Remove ``*.bak`` when the live runtime dir already exists (failed post-swap cleanup)."""
    removed = 0
    for bak in list_bak_dirs(runtime_parent):
        runtime = bak.with_suffix("")
        if runtime.is_dir():
            shutil.rmtree(bak, ignore_errors=True)
            removed += 1
    return removed


def recover_orphan_staging_dirs(runtime_parent: Path) -> int:
    """Drop crash-leftover ``.staging`` token dirs (once per boot)."""
    dirs = psz.list_staging_dirs(runtime_parent)
    for staging in dirs:
        psz.cleanup_staging_dir(staging)
    return len(dirs)


def recover_all_runtime_roots() -> list[str]:
    msgs: list[str] = []
    local_rt = paths.plugin_local_runtime_dir()
    recover_orphan_staging_dirs(local_rt)
    recover_leftover_bak_dirs(local_rt)
    msgs.extend(recover_interrupted_swaps(local_rt))
    try:
        catalog_rt = paths.plugin_runtime_dir()
        recover_orphan_staging_dirs(catalog_rt)
        recover_leftover_bak_dirs(catalog_rt)
        msgs.extend(recover_interrupted_swaps(catalog_rt))
    except RuntimeError:
        pass
    from . import plugins

    msgs.extend(plugins.migrate_consent_pack_tree_hashes(local_rt))
    try:
        msgs.extend(plugins.migrate_consent_pack_tree_hashes(paths.plugin_runtime_dir()))
    except RuntimeError:
        pass
    return msgs
