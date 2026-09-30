"""User-local plugin zips at ~/.zoto-viz/plugins/local/*.zip.

Hot-installs a validated zip (or a files tree / description packed into one)
without touching the git checkout. YAML-only plugins activate immediately.
TypeScript / Python / GLSL still install, but need consent before they run.
"""
from __future__ import annotations

import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any

import yaml
from aiohttp import web

from . import live
from . import paths
from . import plugin_migration as pmg
from . import plugin_zip as pz
from . import plugins
from .pack_boundary import PackBundleBoundaryError, format_upgrade_blocked_message
from .pack_id import refuse_case_insensitive_id_collision
from .pack_install_blocked_store import PackInstallStoreFault, clear_blocked_pack, pack_info_blocked_line
from .pack_install_lint import REASON_INSTALL_CHECK_UNAVAILABLE, PackInstallLintSetupError
from . import pack_safe_zip as psz
from .pack_install_copy import (
    REASON_ALREADY_EXISTS,
    REASON_PACK_INSTALL_BLOCKED,
    REASON_PACK_INSTALL_FAULT,
    REASON_SCHEMA_INVALID,
    blocked_message,
    drop_zone_already_exists_install_message,
    drop_zone_schema_install_message,
    fault_message,
)
from .pack_install_retry import (
    RETRY_RESULT_IN_PROGRESS,
    RETRY_RESULT_NOT_BLOCKED,
    RETRY_RESULT_START_FAILED,
    RETRY_RESULT_SUCCESS,
    RETRY_RESULT_ZIP_CHANGED,
    format_retry_start_failed_message,
    format_retry_zip_changed_message,
)
from .pack_zip_blocks import record_zip_block, row_for_start_failure
from .pack_zip_install_ux import zip_unsafe_blocked_payload
from .pack_install_wall_notices import wall_notice_for_install_result
from .plugin_install import (
    InstallStartFailedError,
    InstallUpgradeRollbackError,
    InstallV2BlockedError,
    _install_staged_to_runtime_locked,
    install_zip_to_runtime,
    pack_install_lock,
)

ENGINES = frozenset({
    "graph", "netpong", "invaders", "command", "frogger", "cpupong", "doom",
    "waves", "orbits", "helix", "skyline", "pacman", "tetris", "portal", "carousel",
})
ID_RE = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
_seen: dict[str, str] = {}
_primed = False


def reset_watch_for_tests() -> None:
    global _primed
    _seen.clear()
    _primed = False


def notify_catalog(*, mode: str | None = None) -> None:
    """Ask the open UI to refetch /api/plugins, then optionally switch view."""
    patch: dict[str, Any] = {"reloadPlugins": True}
    if mode:
        patch["mode"] = mode
    live.queue_patch(patch)


def slug_id(text: str) -> str:
    raw = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    if not raw or not raw[0].isalpha():
        raw = "local-" + (raw[:26] if raw else "plugin")
    return raw[:32]


def unique_id(want: str) -> str:
    base = slug_id(want)
    taken = pmg.catalog_ids()
    if ID_RE.fullmatch(base) and base not in taken:
        return base
    for i in range(2, 100):
        suffix = f"-{i}"
        cand = (base[: 32 - len(suffix)] + suffix)
        if ID_RE.fullmatch(cand) and cand not in taken:
            return cand
    raise ValueError(f"could not allocate a free plugin id from {want!r}")


def _id_claimed(pid: str) -> bool:
    """True when src, a contrib zip, or a local zip already uses ``pid``."""
    if plugins.src_plugin_home(pid) is not None:
        return True
    return pid in pmg.catalog_ids()


def zip_bytes_from_staged(staged: psz.StagedPack) -> bytes:
    fd, tmp_name = tempfile.mkstemp(prefix="zoto-staged.", suffix=".zip")
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        pz.pack_files(_members_from_staged(staged), tmp)
        return tmp.read_bytes()
    finally:
        tmp.unlink(missing_ok=True)


def _members_from_staged(staged: psz.StagedPack) -> dict[str, bytes]:
    root = staged.staging_dir
    out: dict[str, bytes] = {}
    for path in root.rglob("*"):
        if not path.is_file() or path.name == pz.SHA256_NAME:
            continue
        out[path.relative_to(root).as_posix()] = path.read_bytes()
    return out


def remint_pack_read(
    staged: psz.StagedPack,
    dest: Path,
    *,
    overwrite: bool = False,
    incoming_sha: str | None = None,
) -> tuple[psz.StagedPack, dict[str, Any], Path, str | None]:
    """Adjust id/remint in staging (no extra zip CD parse)."""
    doc = plugins.validate_doc(staged.manifest)
    pid = str(doc["id"])
    dest = Path(dest)
    incoming = incoming_sha or staged.zip_sha256
    if dest.is_file() and pz.plugin_sha256(dest) == incoming:
        return staged, doc, dest, None
    if dest.is_file() and overwrite:
        return staged, doc, dest, None
    if not _id_claimed(pid):
        return staged, doc, dest, None
    nxt = unique_id(pid)
    if nxt == pid:
        return staged, doc, dest, None
    new_staged = psz.remint(staged, nxt)
    doc = plugins.validate_doc(new_staged.manifest)
    return new_staged, doc, dest.with_name(f"{nxt}.zip"), pid


def remint_zip(raw: bytes, dest: Path, *, overwrite: bool = False) -> tuple[bytes, dict[str, Any], Path, str | None]:
    """Legacy byte-oriented remint (parses the zip once). Prefer ``remint_pack_read``."""
    fd, tmp_name = tempfile.mkstemp(prefix="zoto-remint.", suffix=".zip")
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        tmp.write_bytes(raw)
        read = psz.read_pack_zip(tmp)
        pack_read, doc, out_dest, reminted = remint_pack_read(
            read, dest, overwrite=overwrite, incoming_sha=pz.plugin_sha256(tmp),
        )
        raw_out = zip_bytes_from_staged(pack_read)
        return raw_out, doc, out_dest, reminted
    finally:
        tmp.unlink(missing_ok=True)


def files_from_description(
    text: str,
    *,
    pid: str | None = None,
    name: str | None = None,
    engine: str | None = None,
    base: str | None = None,
) -> dict[str, str]:
    """Mint a YAML-only graph plugin so a remote description can go live."""
    body = (text or "").strip()
    if not body:
        raise ValueError("description required")
    title = (name or body.split("\n", 1)[0]).strip()[:48] or "Local plugin"
    if isinstance(pid, str) and pid.strip():
        ident = slug_id(pid)
        if not ID_RE.fullmatch(ident):
            raise ValueError(f"invalid plugin id {pid!r}")
        if not (paths.plugin_local_dir() / f"{ident}.zip").is_file():
            ident = unique_id(ident)
    else:
        ident = unique_id(title)
    hint = re.sub(r"\s+", " ", body)[:280]
    eng = engine if engine in ENGINES else "graph"
    graph_base = base if isinstance(base, str) and ID_RE.fullmatch(base) else "topology"
    plugin: dict[str, Any] = {
        "id": ident,
        "name": title,
        "version": 1,
        "hint": hint,
    }
    if body:
        plugin["description"] = body[:2000]
    viz: dict[str, Any] = {"engine": eng}
    if eng == "graph":
        viz["base"] = graph_base
    return {
        "plugin.yml": yaml.safe_dump(plugin, sort_keys=False, allow_unicode=True),
        "visualisation.yml": yaml.safe_dump(viz, sort_keys=False, allow_unicode=True),
    }


def ensure_viewable(tree: dict[str, str]) -> dict[str, str]:
    """Guarantee a menu row: YAML-only drafts without engine get graph/topology."""
    yml_name = "plugin.yml" if "plugin.yml" in tree else "plugin.yaml" if "plugin.yaml" in tree else ""
    if not yml_name:
        return tree
    try:
        doc = yaml.safe_load(tree[yml_name])
    except yaml.YAMLError:
        return tree
    if not isinstance(doc, dict):
        return tree
    if "visualisation.yml" in tree or doc.get("engine"):
        return tree
    plugin, viz = pmg.split_plugin_doc(doc)
    out = dict(tree)
    if viz:
        out[yml_name] = yaml.safe_dump(plugin, sort_keys=False, allow_unicode=True)
        out["visualisation.yml"] = yaml.safe_dump(viz, sort_keys=False, allow_unicode=True)
        return out
    out["visualisation.yml"] = "engine: graph\nbase: topology\n"
    return out


def _tree_bytes(tree: dict[str, str]) -> bytes:
    packed = {rel: text.encode("utf-8") for rel, text in tree.items()}
    fd, tmp_name = tempfile.mkstemp(prefix="zoto-local.", suffix=".zip")
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        pz.pack_files(packed, tmp)
        return tmp.read_bytes()
    finally:
        tmp.unlink(missing_ok=True)


def _payload_bytes(args: dict[str, Any]) -> bytes:
    blob = args.get("zip_b64")
    if isinstance(blob, str) and blob.strip():
        from .mcp import decode_zip_b64
        return decode_zip_b64(blob)
    files = args.get("files")
    if isinstance(files, dict) and files:
        from . import agent
        tree = ensure_viewable(agent._draft_files({"files": files}))
        return _tree_bytes(tree)
    yaml_text = args.get("yaml")
    if isinstance(yaml_text, str) and yaml_text.strip():
        from . import agent
        tree = ensure_viewable(agent._draft_files({"yaml": yaml_text}))
        return _tree_bytes(tree)
    desc = str(args.get("description") or "").strip()
    if desc:
        if re.search(r"(?m)^id:\s+\S", desc):
            from . import agent
            tree = ensure_viewable(agent._draft_files({"yaml": desc}))
            return _tree_bytes(tree)
        pid = str(args.get("id") or "").strip() or None
        name = str(args.get("name") or "").strip() or None
        engine = str(args.get("engine") or "").strip() or None
        base = str(args.get("base") or "").strip() or None
        return _tree_bytes(files_from_description(desc, pid=pid, name=name, engine=engine, base=base))
    raise ValueError("zip_b64, files, or description required")


def _install_result(
    doc: dict[str, Any],
    dest: Path,
    unpacked: pz.UnpackResult,
    *,
    wrote: bool,
) -> dict[str, Any]:
    review, hashes, needed = pmg.consent_payload(unpacked.dest, doc)
    info: dict[str, Any] = {
        "ok": True,
        "id": doc["id"],
        "version": doc.get("version"),
        "sha256": unpacked.sha256,
        "path": str(dest),
        "dir": str(unpacked.dest),
        "parts": list(unpacked.parts),
        "wrote": wrote,
        "origin": "local",
    }
    if hashes:
        info["hashes"] = hashes
    if needed:
        info["ok"] = False
        info["error"] = "consent-required"
        info["consentRequired"] = True
        info["needsReview"] = True
        info["preview"] = {"id": review.get("id"), "version": review.get("version")}
    return info


def _refresh_python(info: dict[str, Any]) -> None:
    parts = {str(p) for p in (info.get("parts") or [])}
    if not (parts & {"backend", "datasource"}):
        return
    try:
        from . import hooks
        hooks.sync(plugins.scan().get("plugins") or [], allow=plugins.python_allow)
        info["pythonReloaded"] = True
    except Exception as e:  # noqa: BLE001
        info["pythonReloadError"] = str(e)


def _upgrade_rollback_result(err: InstallUpgradeRollbackError) -> dict[str, Any]:
    return {
        "ok": False,
        "error": REASON_PACK_INSTALL_BLOCKED,
        "message": str(err),
        "id": err.pack_id,
        "sha256": err.sha256,
        "zip": err.zip_path,
    }


def _zip_blocked_result(
    exc: ValueError,
    *,
    zip_display_name: str | None = None,
    zip_path: str | Path | None = None,
    pack_id: str = "",
    sha256: str = "",
    runtime: Path | None = None,
) -> dict[str, Any]:
    return zip_unsafe_blocked_payload(
        str(exc),
        zip_display_name=zip_display_name,
        zip_path=zip_path,
        pack_id=pack_id,
        sha256=sha256,
        runtime=runtime,
    )


def _finish(info: dict[str, Any], *, activate: bool) -> dict[str, Any]:
    if info.get("ok") and info.get("id"):
        clear_blocked_pack(str(info["id"]))
    notice = wall_notice_for_install_result(info)
    if notice:
        info.setdefault("installNotices", [])
        if isinstance(info["installNotices"], list):
            info["installNotices"].append(notice)
    blocked = pack_info_blocked_line(str(info.get("id") or ""))
    if blocked:
        info["packInstallBlocked"] = blocked
    _refresh_python(info)
    safe = not info.get("consentRequired")
    mode = (
        f"plugin:{info['id']}"
        if activate and safe and info.get("ok") and info.get("id")
        else None
    )
    notify_catalog(mode=mode)
    info["activated"] = bool(mode)
    if mode:
        info["mode"] = mode
        info["hint"] = f"{info['id']} is live at {info['path']}; view {mode}"
    elif info.get("consentRequired"):
        info["hint"] = (
            "zip is installed under ~/.zoto-viz/plugins/local; "
            "grant consent_plugin before code runs, then set_view"
        )
    return info


def _install_settings_check_staging(staging_dir: Path) -> None:
    """Preset/settings semantics on staged plugin.yml + visualisation.yml (no extra zip parse)."""
    yml = staging_dir / "plugin.yml"
    doc = plugins.load_file(yml)
    viz = plugins._visualisation_doc(staging_dir)
    merged: dict[str, Any] = {**doc, **({"visualisation": viz} if viz is not None else {})}
    plugins._check_plugin_settings(merged)


def install_local_zip(
    raw: bytes,
    *,
    overwrite: bool = False,
    activate: bool = True,
    zip_display_name: str | None = None,
) -> dict[str, Any]:
    """Validate, write ``~/.zoto-viz/plugins/local/<id>.zip``, unpack, maybe activate."""
    fd, tmp_name = tempfile.mkstemp(prefix="zoto-local.", suffix=".zip")
    os.close(fd)
    tmp_path = Path(tmp_name)
    runtime_parent = paths.plugin_local_runtime_dir(create=True)
    pack_pid = ""
    staging_to_clean: Path | None = None
    try:
        tmp_path.write_bytes(raw)
        try:
            pack_read = psz.read_pack_zip(tmp_path)
            staging_to_clean = pack_read.staging_dir
            pack_pid = str(pack_read.manifest.get("id") or "")
        except ValueError as e:
            return _finish(
                _zip_blocked_result(
                    e,
                    zip_display_name=zip_display_name or "pack",
                    zip_path=None,
                ),
                activate=False,
            )
        try:
            doc = plugins.validate_doc(pack_read.manifest)
        except ValueError:
            return _finish(
                {
                    "ok": False,
                    "error": REASON_SCHEMA_INVALID,
                    "message": drop_zone_schema_install_message(zip_display_name or "pack"),
                },
                activate=False,
            )
        pid = str(doc["id"])
        pack_pid = pid
        try:
            refuse_case_insensitive_id_collision(pid)
        except ValueError as e:
            return _finish(
                {
                    "ok": False,
                    "error": REASON_SCHEMA_INVALID,
                    "message": str(e),
                },
                activate=False,
            )
        dest = paths.plugin_local_dir(create=True) / f"{pid}.zip"
        pack_read, doc, dest, reminted_from = remint_pack_read(
            pack_read,
            dest,
            overwrite=overwrite,
            incoming_sha=pz.plugin_sha256(tmp_path),
        )
        staging_to_clean = pack_read.staging_dir
        pid = str(doc["id"])
        if reminted_from:
            tmp_path.write_bytes(zip_bytes_from_staged(pack_read))
        _install_settings_check_staging(pack_read.staging_dir)
        runtime = runtime_parent / pid
        incoming = pz.plugin_sha256(tmp_path)
        if dest.is_file() and pz.plugin_sha256(dest) == incoming and not overwrite:
            unpacked = pz.unpack_zip(dest, runtime)
            info = _install_result(doc, dest, unpacked, wrote=False)
            if reminted_from:
                info["remintedFrom"] = reminted_from
            return _finish(info, activate=activate)
        if dest.is_file() and not overwrite:
            return _finish(
                {
                    "ok": False,
                    "error": REASON_ALREADY_EXISTS,
                    "message": drop_zone_already_exists_install_message(
                        zip_display_name or "pack",
                    ),
                },
                activate=False,
            )
        upgrade = dest.is_file() and runtime.is_dir()
        try:
            unpacked = install_zip_to_runtime(
                tmp_path,
                dest,
                runtime,
                doc,
                rel=str(dest),
                sha256=incoming,
                upgrade=upgrade,
                pack_read=pack_read,
            )
            staging_to_clean = None
        except PackBundleBoundaryError as e:
            if upgrade:
                return _finish(
                    {
                        "ok": False,
                        "error": "pack_install_blocked",
                        "message": format_upgrade_blocked_message(e.block, doc.get("version")),
                        "upgrade_blocked": "true",
                        **{k: v for k, v in e.block.to_dict().items() if k != "message"},
                    },
                    activate=False,
                )
            return _finish({"ok": False, **e.block.to_dict()}, activate=False)
        except InstallV2BlockedError as e:
            payload = {k: v for k, v in (e.payload or {}).items() if k != "message"}
            return _finish(
                {"ok": False, "error": "pack_install_blocked", "message": str(e), **payload},
                activate=False,
            )
        except ValueError as e:
            text = str(e)
            if isinstance(e, PackInstallLintSetupError):
                return _finish({"ok": False, "error": REASON_INSTALL_CHECK_UNAVAILABLE, "message": text}, activate=False)
            if "was blocked" in text:
                return _finish({"ok": False, "error": "pack_boundary", "message": text}, activate=False)
            return _finish({"ok": False, "error": text, "message": text}, activate=False)
        except InstallUpgradeRollbackError as e:
            return _finish(_upgrade_rollback_result(e), activate=activate)
        info = _install_result(doc, dest, unpacked, wrote=True)
        if reminted_from:
            info["remintedFrom"] = reminted_from
        return _finish(info, activate=activate)
    finally:
        if staging_to_clean is not None:
            psz.cleanup_staging_dir(staging_to_clean)
            if pack_pid:
                psz.cleanup_staging_for_pack(runtime_parent, pack_pid)
        tmp_path.unlink(missing_ok=True)


def adopt_local_zip_file(path: Path, *, activate: bool = True) -> dict[str, Any]:
    """Validate a zip already in the local drop zone and unpack it."""
    path = Path(path)
    raw = path.read_bytes()
    try:
        pack_read = psz.read_pack_zip(path)
    except ValueError as e:
        return _finish(
            _zip_blocked_result(e, zip_display_name=path.stem, zip_path=path),
            activate=False,
        )
    try:
        doc = plugins.validate_doc(pack_read.manifest)
    except ValueError:
        psz.cleanup_staging_dir(pack_read.staging_dir)
        return _finish(
            {
                "ok": False,
                "error": REASON_SCHEMA_INVALID,
                "message": drop_zone_schema_install_message(path.stem),
            },
            activate=False,
        )
    pid = str(doc["id"])
    dest = paths.plugin_local_dir(create=True) / f"{pid}.zip"
    pack_read, doc, dest, reminted_from = remint_pack_read(
        pack_read,
        dest,
        overwrite=dest.is_file(),
        incoming_sha=pz.plugin_sha256(path),
    )
    pid = str(doc["id"])
    try:
        _install_settings_check_staging(pack_read.staging_dir)
    except ValueError:
        psz.cleanup_staging_dir(pack_read.staging_dir)
        drop = paths.plugin_local_dir(create=True)
        if path.resolve().parent == drop.resolve() and path.resolve() != dest.resolve():
            path.unlink(missing_ok=True)
        raise
    if reminted_from:
        raw = zip_bytes_from_staged(pack_read)
        dest.write_bytes(raw)
        if path.resolve() != dest.resolve() and path.resolve().parent == dest.resolve().parent:
            path.unlink(missing_ok=True)
    elif path.resolve() != dest.resolve():
        if dest.is_file() and pz.plugin_sha256(dest) != pz.plugin_sha256(path):
            psz.cleanup_staging_dir(pack_read.staging_dir)
            return _finish(
                {
                    "ok": False,
                    "error": REASON_ALREADY_EXISTS,
                    "message": drop_zone_already_exists_install_message(path.stem),
                },
                activate=False,
            )
        if path.resolve().parent == dest.resolve().parent:
            os.replace(path, dest)
        else:
            shutil.copy2(path, dest)
    runtime = paths.plugin_local_runtime_dir(create=True) / pid
    incoming = pz.plugin_sha256(dest)
    upgrade = runtime.is_dir()
    try:
        unpacked = install_zip_to_runtime(
            dest,
            dest,
            runtime,
            doc,
            rel=str(dest),
            sha256=incoming,
            upgrade=upgrade,
            pack_read=pack_read,
        )
    except InstallUpgradeRollbackError as e:
        psz.cleanup_staging_dir(pack_read.staging_dir)
        return _finish(_upgrade_rollback_result(e), activate=activate)
    info = _install_result(doc, dest, unpacked, wrote=True)
    if reminted_from:
        info["remintedFrom"] = reminted_from
    return _finish(info, activate=activate)


def publish_local(body: dict[str, Any] | None) -> dict[str, Any]:
    args = body if isinstance(body, dict) else {}
    activate = True if args.get("activate") is None else bool(args.get("activate"))
    try:
        raw = _payload_bytes(args)
        zip_name = args.get("zip_name") or args.get("filename")
        display = str(zip_name).strip() if isinstance(zip_name, str) and zip_name.strip() else None
        return install_local_zip(
            raw,
            overwrite=bool(args.get("overwrite")),
            activate=activate,
            zip_display_name=display,
        )
    except pmg.SrcOwnedError as e:
        return {
            "ok": False,
            "error": "src_owns_id",
            "id": e.plugin_id,
            "path": e.path,
            "hint": "a shipped plugins/src tree already owns this id",
        }
    except InstallV2BlockedError as e:
        payload = {k: v for k, v in (e.payload or {}).items() if k != "message"}
        return {"ok": False, "error": "pack_install_blocked", "message": str(e), **payload}
    except InstallStartFailedError as e:
        return {"ok": False, "error": "pack_install_start_failed", "message": str(e), "reason": e.reason}
    except PackBundleBoundaryError as e:
        return {"ok": False, **e.block.to_dict()}
    except PackInstallStoreFault as e:
        return {"ok": False, "error": REASON_PACK_INSTALL_FAULT, "message": fault_message(str(e))}
    except ValueError as e:
        text = str(e)
        if isinstance(e, PackInstallLintSetupError):
            return {"ok": False, "error": REASON_INSTALL_CHECK_UNAVAILABLE, "message": text}
        if "was blocked" in text:
            return {"ok": False, "error": "pack_boundary", "message": text}
        return {"ok": False, "error": text}


def sync_local_drop() -> list[dict[str, Any]]:
    """Pick up new or changed zips in the local drop zone. First pass records only."""
    global _primed
    folder = paths.plugin_local_dir(create=True)
    results: list[dict[str, Any]] = []
    current: dict[str, str] = {}
    for z in plugins._zip_files(folder):
        try:
            digest = pz.plugin_sha256(z)
        except OSError:
            continue
        key = str(z.resolve())
        current[key] = digest
        prev = _seen.get(key)
        _seen[key] = digest
        if not _primed or prev == digest:
            continue
        from .pack_zip_blocks import zip_block_for_sha

        if zip_block_for_sha(digest):
            continue
        try:
            results.append(adopt_local_zip_file(z, activate=True))
        except pmg.SrcOwnedError as e:
            results.append({"ok": False, "error": "src_owns_id", "id": e.plugin_id, "path": str(z)})
        except PackInstallStoreFault as e:
            results.append({"ok": False, "error": REASON_PACK_INSTALL_FAULT, "message": fault_message(str(e)), "path": str(z)})
        except ValueError as e:
            text = str(e)
            if "is not a zip" in text.lower() or "zip entry" in text or "symlink" in text:
                blocked = _zip_blocked_result(e, zip_display_name=z.stem, zip_path=z)
                blocked["path"] = str(z)
                results.append(blocked)
            elif "already exists" in text.lower():
                results.append(
                    {
                        "ok": False,
                        "error": REASON_ALREADY_EXISTS,
                        "message": drop_zone_already_exists_install_message(z.stem),
                        "path": str(z),
                    },
                )
            else:
                results.append(
                    {
                        "ok": False,
                        "error": REASON_SCHEMA_INVALID,
                        "message": drop_zone_schema_install_message(z.stem),
                        "path": str(z),
                    },
                )
        except OSError as e:
            results.append({"ok": False, "error": str(e), "path": str(z)})
    gone = [key for key in _seen if key not in current]
    if gone:
        for key in gone:
            del _seen[key]
        if _primed:
            notify_catalog()
    _primed = True
    return results



def _find_local_zip_for_digest(digest: str, pid: str, row: dict[str, str]) -> Path | None:
    folder = paths.plugin_local_dir(create=True)
    for z in plugins._zip_files(folder):
        if pz.plugin_sha256(z).lower() == digest:
            return z
    hint = str(row.get("zip") or "")
    cand = Path(hint)
    if cand.is_file() and pz.plugin_sha256(cand).lower() == digest:
        return cand
    return None


def _retry_row_version(row: dict[str, str]) -> str | int | None:
    raw = str(row.get("version") or "").strip()
    if not raw:
        return 2
    try:
        return int(raw)
    except ValueError:
        return raw


def _pack_id_for_local_zip_digest(digest: str) -> str | None:
    """Resolve pack id from a staged local zip when the block row was cleared mid-retry."""
    folder = paths.plugin_local_dir(create=False)
    if not folder or not folder.is_dir():
        return None
    want = digest.strip().lower()
    for zp in folder.glob("*.zip"):
        if not zp.is_file():
            continue
        try:
            if pz.plugin_sha256(zp).lower() == want:
                return zp.stem
        except OSError:
            continue
    return None


def _retry_in_progress_response(
    digest: str,
    pid: str,
    row: dict[str, str] | None = None,
) -> dict[str, Any]:
    name = str((row or {}).get("name") or pid)
    version = _retry_row_version(row or {"version": "2"})
    return {
        "ok": False,
        "error": "retry_in_progress",
        "retryResult": RETRY_RESULT_IN_PROGRESS,
        "id": pid,
        "name": name,
        "version": version,
        "zipSha256": digest,
    }


def _retry_zip_changed_response(
    digest: str,
    row: dict[str, str],
    pid: str,
    *,
    zip_error: str,
) -> dict[str, Any]:
    from .pack_zip_blocks import zip_block_for_sha

    name = str(row.get("name") or pid)
    version = _retry_row_version(row)
    msg = format_retry_zip_changed_message(name, pid)
    record_zip_block(
        digest,
        row_for_start_failure(
            sha256=digest,
            message=msg,
            pack_id=pid,
            name=name,
            zip_path=str(row.get("zip") or ""),
            version=version,
        ),
    )
    fresh = zip_block_for_sha(digest) or row
    return {
        "ok": False,
        "error": zip_error,
        "retryResult": RETRY_RESULT_ZIP_CHANGED,
        "id": pid,
        "name": name,
        "version": version,
        "message": msg,
        "zipSha256": digest,
        "blockReason": fresh.get("blockReason", "couldnt_start"),
        "retryable": "true",
    }


def retry_blocked_zip_install(sha256: str, *, activate: bool = True) -> dict[str, Any]:
    """Re-run the blocked zip through the full install pipeline (sync, pack lock held)."""
    from .pack_runtime import forget_zip_block_cache_for_path
    from .pack_zip_blocks import clear_zip_block, zip_block_for_sha

    digest = sha256.strip().lower()
    row = zip_block_for_sha(digest)
    if row is None:
        pid_hint = _pack_id_for_local_zip_digest(digest)
        if pid_hint:
            lock = pack_install_lock(pid_hint)
            if not lock.acquire(blocking=False):
                return _retry_in_progress_response(digest, pid_hint)
        return {"ok": False, "error": "not_blocked", "retryResult": RETRY_RESULT_NOT_BLOCKED}
    pid = str(row.get("id") or "")
    folder = paths.plugin_local_dir(create=True)
    dest = folder / f"{pid}.zip"
    if dest.is_file() and pz.plugin_sha256(dest).lower() != digest:
        return _retry_zip_changed_response(digest, row, pid, zip_error="zip_hash_mismatch")

    lock = pack_install_lock(pid)
    if not lock.acquire(blocking=False):
        return _retry_in_progress_response(digest, pid, row)
    try:
        row = zip_block_for_sha(digest)
        if row is None:
            return {"ok": False, "error": "not_blocked", "retryResult": RETRY_RESULT_NOT_BLOCKED}
        zip_path = _find_local_zip_for_digest(digest, pid, row)
        if zip_path is None:
            return _retry_zip_changed_response(digest, row, pid, zip_error="zip_not_found")
        if dest.is_file() and pz.plugin_sha256(dest).lower() != digest:
            return _retry_zip_changed_response(digest, row, pid, zip_error="zip_hash_mismatch")

        clear_zip_block(digest)
        forget_zip_block_cache_for_path(zip_path)
        plugins.reset_scan_memo()

        pack_read = psz.read_pack_zip(zip_path)
        doc = plugins.validate_doc(pack_read.manifest)
        pid = str(doc["id"])
        dest = folder / f"{pid}.zip"
        if zip_path.resolve() != dest.resolve():
            shutil.copy2(zip_path, dest)
        runtime = paths.plugin_local_runtime_dir(create=True) / pid
        incoming = pz.plugin_sha256(dest)
        if incoming.lower() != digest:
            row = zip_block_for_sha(digest) or row
            return _retry_zip_changed_response(digest, row, pid, zip_error="zip_hash_mismatch")
        upgrade = runtime.is_dir()
        name = str(doc.get("name") or pid)
        version = doc.get("version")
        staging = pack_read.staging_dir
        try:
            try:
                unpacked = _install_staged_to_runtime_locked(
                    pack_read,
                    dest,
                    dest,
                    runtime,
                    rel=str(dest),
                    sha256=incoming,
                    upgrade=upgrade,
                    pid=pid,
                    name=name,
                    version=version,
                )
            except InstallV2BlockedError as e:
                payload = {k: v for k, v in (e.payload or {}).items() if k != "message"}
                return {
                    "ok": False,
                    "error": "pack_install_blocked",
                    "retryResult": "blocked",
                    "message": str(e),
                    **payload,
                }
            except (InstallStartFailedError, RuntimeError):
                msg = format_retry_start_failed_message(name, version)
                record_zip_block(
                    digest,
                    row_for_start_failure(
                        sha256=digest,
                        message=msg,
                        pack_id=pid,
                        name=name,
                        zip_path=str(dest),
                        version=version,
                    ),
                )
                return {
                    "ok": False,
                    "error": "pack_install_start_failed",
                    "retryResult": RETRY_RESULT_START_FAILED,
                    "message": msg,
                    "id": pid,
                    "name": name,
                    "version": version,
                    "zipSha256": digest,
                    "blockReason": "couldnt_start",
                    "retryable": "true",
                }
            except PackBundleBoundaryError as e:
                return {"ok": False, **e.block.to_dict()}
            except ValueError as e:
                text = str(e)
                if isinstance(e, PackInstallLintSetupError):
                    return {"ok": False, "error": REASON_INSTALL_CHECK_UNAVAILABLE, "message": text, "id": pid}
                if "was blocked" in text:
                    return {"ok": False, "error": "pack_boundary", "message": text}
                return {"ok": False, "error": text, "id": pid}
        finally:
            psz.cleanup_staging_dir(staging)

        forget_zip_block_cache_for_path(dest)
        info = _install_result(doc, dest, unpacked, wrote=True)
        finished = _finish(info, activate=activate)
        finished["retryResult"] = RETRY_RESULT_SUCCESS
        return finished
    finally:
        lock.release()


def retry_blocked_zip_http_status(info: dict[str, Any]) -> int:
    if info.get("ok") or info.get("consentRequired"):
        return 200
    result = str(info.get("retryResult") or "")
    if result == RETRY_RESULT_NOT_BLOCKED:
        return 404
    if result == RETRY_RESULT_ZIP_CHANGED:
        return 409
    if result == RETRY_RESULT_IN_PROGRESS:
        return 423
    if result == RETRY_RESULT_START_FAILED:
        return 400
    err = str(info.get("error") or "")
    if err == "not_blocked" or err == "zip_not_found":
        return 404
    if err == "zip_hash_mismatch":
        return 409
    if err == "retry_in_progress":
        return 423
    return 400


async def api_retry_blocked_zip(req: web.Request) -> web.Response:
    try:
        body = await req.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "object required"}, status=400)
    sha = str(body.get("sha256") or "").strip().lower()
    if not sha:
        return web.json_response({"error": "sha256 required"}, status=400)
    import asyncio

    info = await asyncio.to_thread(retry_blocked_zip_install, sha)
    status = retry_blocked_zip_http_status(info)
    return web.json_response(info, status=status)

async def api_publish_local(req: web.Request) -> web.Response:
    try:
        body = await req.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "object required"}, status=400)
    info = publish_local(body)
    status = 200 if info.get("ok") or info.get("consentRequired") else 400
    if info.get("error") == "src_owns_id":
        status = 409
    return web.json_response(info, status=status)
