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
from .pack_boundary import PackBundleBoundaryError
from .pack_install_retry import (
    RETRY_RESULT_IN_PROGRESS,
    RETRY_RESULT_NOT_BLOCKED,
    RETRY_RESULT_START_FAILED,
    RETRY_RESULT_SUCCESS,
    RETRY_RESULT_ZIP_CHANGED,
    format_retry_start_failed_message,
    format_retry_zip_changed_message,
)
from .pack_id import PACK_ID_RE, refuse_case_insensitive_id_collision
from .pack_zip_blocks import record_zip_block, row_for_start_failure
from .plugin_install import (
    InstallStartFailedError,
    InstallV2BlockedError,
    drain_install_notices,
    install_zip_to_runtime,
)

ENGINES = frozenset({
    "graph", "netpong", "invaders", "command", "frogger", "cpupong", "doom",
    "waves", "orbits", "helix", "skyline", "pacman", "tetris", "portal", "carousel",
})
ID_RE = PACK_ID_RE
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


def remint_zip(raw: bytes, dest: Path, *, overwrite: bool = False) -> tuple[bytes, dict[str, Any], Path, str | None]:
    """Keep ``id`` only when dest is free, same-sha, or an explicit overwrite.

    Otherwise rewrite ``plugin.yml`` to the next free id so a new plugin never
    collides with src / contrib / local.
    """
    fd, tmp_name = tempfile.mkstemp(prefix="zoto-remint.", suffix=".zip")
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        tmp.write_bytes(raw)
        doc = plugins.validate_doc(pz.inspect_zip(tmp).plugin)
        pid = str(doc["id"])
        incoming = pz.plugin_sha256(tmp)
        dest = Path(dest)
        if dest.is_file() and pz.plugin_sha256(dest) == incoming:
            return raw, doc, dest, None
        if dest.is_file() and overwrite:
            return raw, doc, dest, None
        if not _id_claimed(pid):
            return raw, doc, dest, None
        nxt = unique_id(pid)
        if nxt == pid:
            return raw, doc, dest, None
        rewritten = pz.rewrite_plugin_id(raw, nxt)
        doc = dict(doc)
        doc["id"] = nxt
        return rewritten, doc, dest.with_name(f"{nxt}.zip"), pid
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


def _verify_pack_bundle(home: Path, doc: dict[str, Any], sha256: str | None = None) -> None:
    yml = home / "plugin.yml"
    if not yml.is_file():
        raise ValueError("missing plugin.yml")
    plugins.compile_typescript(doc, yml, sha256=sha256)


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


def _finish(info: dict[str, Any], *, activate: bool) -> dict[str, Any]:
    notices = drain_install_notices()
    if notices:
        info["installNotices"] = notices
        info.setdefault("message", notices[0].get("message"))
    _refresh_python(info)
    safe = not info.get("consentRequired")
    mode = f"plugin:{info['id']}" if activate and safe and info.get("id") else None
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


def install_local_zip(
    raw: bytes,
    *,
    overwrite: bool = False,
    activate: bool = True,
) -> dict[str, Any]:
    """Validate, write ``~/.zoto-viz/plugins/local/<id>.zip``, unpack, maybe activate."""
    fd, tmp_name = tempfile.mkstemp(prefix="zoto-local.", suffix=".zip")
    os.close(fd)
    tmp_path = Path(tmp_name)
    runtime: Path | None = None
    dest: Path | None = None
    try:
        tmp_path.write_bytes(raw)
        manifest = pz.inspect_zip(tmp_path)
        doc = plugins.validate_doc(manifest.plugin)
        pid = str(doc["id"])
        refuse_case_insensitive_id_collision(pid)
        dest = paths.plugin_local_dir(create=True) / f"{pid}.zip"
        raw, doc, dest, reminted_from = remint_zip(raw, dest, overwrite=overwrite)
        pid = str(doc["id"])
        tmp_path.write_bytes(raw)
        runtime = paths.plugin_local_runtime_dir(create=True) / pid
        incoming = pz.plugin_sha256(tmp_path)
        upgrade = dest.is_file() and runtime.is_dir()
        if dest.is_file() and pz.plugin_sha256(dest) == incoming:
            unpacked = install_zip_to_runtime(
                dest,
                dest,
                runtime,
                doc,
                rel=str(dest),
                sha256=incoming,
                upgrade=upgrade,
            )
            info = _install_result(doc, dest, unpacked, wrote=False)
            if reminted_from:
                info["remintedFrom"] = reminted_from
            return _finish(info, activate=activate)
        if dest.is_file() and not overwrite:
            raise ValueError(
                f"plugin {pid!r} already exists in the local drop zone (pass overwrite: true)"
            )
        unpacked = install_zip_to_runtime(
            tmp_path,
            dest,
            runtime,
            doc,
            rel=str(dest),
            sha256=incoming,
            upgrade=upgrade,
        )
        info = _install_result(doc, dest, unpacked, wrote=True)
        if reminted_from:
            info["remintedFrom"] = reminted_from
        return _finish(info, activate=activate)
    finally:
        tmp_path.unlink(missing_ok=True)


def adopt_local_zip_file(path: Path, *, activate: bool = True) -> dict[str, Any]:
    """Validate a zip already in the local drop zone and unpack it."""
    path = Path(path)
    raw = path.read_bytes()
    manifest = pz.inspect_zip(path)
    doc = plugins.validate_doc(manifest.plugin)
    pid = str(doc["id"])
    refuse_case_insensitive_id_collision(pid)
    dest = paths.plugin_local_dir(create=True) / f"{pid}.zip"
    raw, doc, dest, reminted_from = remint_zip(raw, dest, overwrite=False)
    pid = str(doc["id"])
    if reminted_from:
        dest.write_bytes(raw)
        if path.resolve() != dest.resolve() and path.resolve().parent == dest.resolve().parent:
            path.unlink(missing_ok=True)
    elif path.resolve() != dest.resolve():
        if dest.is_file() and pz.plugin_sha256(dest) != pz.plugin_sha256(path):
            raise ValueError(
                f"local zip {path.name} id is {pid!r} but {dest.name} already exists"
            )
    runtime = paths.plugin_local_runtime_dir(create=True) / pid
    zip_source = path if path.is_file() else dest
    incoming = pz.plugin_sha256(zip_source)
    upgrade = runtime.is_dir()
    try:
        unpacked = install_zip_to_runtime(
            zip_source,
            dest,
            runtime,
            doc,
            rel=str(dest),
            sha256=incoming,
            upgrade=upgrade,
        )
    except InstallV2BlockedError as e:
        raise ValueError(str(e)) from e
    except InstallStartFailedError as e:
        raise ValueError(str(e)) from e
    info = _install_result(doc, dest, unpacked, wrote=True)
    if reminted_from:
        info["remintedFrom"] = reminted_from
    if path.resolve() != dest.resolve() and path.resolve().parent == dest.resolve().parent:
        path.unlink(missing_ok=True)
    return _finish(info, activate=activate)


def publish_local(body: dict[str, Any] | None) -> dict[str, Any]:
    args = body if isinstance(body, dict) else {}
    activate = True if args.get("activate") is None else bool(args.get("activate"))
    try:
        raw = _payload_bytes(args)
        return install_local_zip(raw, overwrite=bool(args.get("overwrite")), activate=activate)
    except pmg.SrcOwnedError as e:
        return {
            "ok": False,
            "error": "src_owns_id",
            "id": e.plugin_id,
            "path": e.path,
            "hint": "a shipped plugins/src tree already owns this id",
        }
    except InstallV2BlockedError as e:
        return {"ok": False, "error": "pack_install_blocked", "message": str(e), **e.payload}
    except InstallStartFailedError as e:
        return {"ok": False, "error": "pack_install_start_failed", "message": str(e), "reason": e.reason}
    except PackBundleBoundaryError as e:
        return {"ok": False, **e.block.to_dict()}
    except ValueError as e:
        text = str(e)
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
        try:
            results.append(adopt_local_zip_file(z, activate=True))
        except pmg.SrcOwnedError as e:
            results.append({"ok": False, "error": "src_owns_id", "id": e.plugin_id, "path": str(z)})
        except InstallV2BlockedError as e:
            results.append({"ok": False, "error": "pack_install_blocked", "message": str(e), "path": str(z)})
        except InstallStartFailedError as e:
            results.append({"ok": False, "error": "pack_install_start_failed", "message": str(e), "path": str(z)})
        except (ValueError, OSError) as e:
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
    from .pack_zip_blocks import forget_zip_block_cache_for_path
    from .pack_zip_blocks import clear_zip_block, zip_block_for_sha
    from .plugin_install import (
        _install_zip_to_runtime_locked,
        pack_install_lock,
    )

    digest = sha256.strip().lower()
    row = zip_block_for_sha(digest)
    if row is None:
        return {"ok": False, "error": "not_blocked", "retryResult": RETRY_RESULT_NOT_BLOCKED}
    pid = str(row.get("id") or "")
    folder = paths.plugin_local_dir(create=True)
    dest = folder / f"{pid}.zip"
    if dest.is_file() and pz.plugin_sha256(dest).lower() != digest:
        return _retry_zip_changed_response(digest, row, pid, zip_error="zip_hash_mismatch")

    lock = pack_install_lock(pid)
    if not lock.acquire(blocking=False):
        return {
            "ok": False,
            "error": "retry_in_progress",
            "retryResult": RETRY_RESULT_IN_PROGRESS,
            "id": pid,
            "name": str(row.get("name") or pid),
            "version": _retry_row_version(row),
            "zipSha256": digest,
        }
    try:
        row = zip_block_for_sha(digest)
        if row is None:
            return {"ok": False, "error": "not_blocked", "retryResult": RETRY_RESULT_NOT_BLOCKED}
        zip_path = _find_local_zip_for_digest(digest, pid, row)
        if zip_path is None:
            return _retry_zip_changed_response(digest, row, pid, zip_error="zip_not_found")
        if dest.is_file() and pz.plugin_sha256(dest).lower() != digest:
            return _retry_zip_changed_response(digest, row, pid, zip_error="zip_hash_mismatch")

        forget_zip_block_cache_for_path(zip_path)
        plugins.reset_scan_memo()

        manifest = pz.inspect_zip(zip_path)
        doc = plugins.validate_doc(manifest.plugin)
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
        try:
            unpacked = _install_zip_to_runtime_locked(
                dest,
                dest,
                runtime,
                doc,
                rel=str(dest),
                sha256=incoming,
                upgrade=upgrade,
                pid=pid,
                name=name,
                version=version,
            )
        except InstallV2BlockedError as e:
            return {"ok": False, "error": "pack_install_blocked", "retryResult": "blocked", "message": str(e), **e.payload}
        except InstallStartFailedError:
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
            if "was blocked" in text:
                return {"ok": False, "error": "pack_boundary", "message": text}
            return {"ok": False, "error": text, "id": pid}

        clear_zip_block(digest)
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
