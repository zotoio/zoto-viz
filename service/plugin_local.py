"""User-local plugin zips at ~/.zoto-viz/plugins/local/*.zip.

Hot-installs a validated zip (or a files tree / description packed into one)
without touching the git checkout. YAML-only plugins activate immediately.
TypeScript / Python / GLSL still install, but need consent before they run.
"""
from __future__ import annotations

import hashlib
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
from .pack_install_blocked_store import PackInstallStoreFault, clear_blocked_pack, pack_info_blocked_line
from . import pack_safe_zip as psz
from .pack_install_copy import REASON_PACK_INSTALL_FAULT, fault_message
from .pack_zip_install_ux import zip_unsafe_blocked_payload
from .pack_install_wall_notices import wall_notice_for_install_result
from .plugin_install import install_zip_to_runtime

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


def remint_pack_read(
    read: psz.PackZipRead,
    dest: Path,
    *,
    overwrite: bool = False,
    incoming_sha: str | None = None,
) -> tuple[psz.PackZipRead, dict[str, Any], Path, str | None]:
    """Adjust id/remint using already-parsed members (no extra zip CD parse)."""
    doc = plugins.validate_doc(read.plugin)
    pid = str(doc["id"])
    dest = Path(dest)
    incoming = incoming_sha or hashlib.sha256(pz.pack_bytes_from_members(read.members)).hexdigest()
    if dest.is_file() and pz.plugin_sha256(dest) == incoming:
        return read, doc, dest, None
    if dest.is_file() and overwrite:
        return read, doc, dest, None
    if not _id_claimed(pid):
        return read, doc, dest, None
    nxt = unique_id(pid)
    if nxt == pid:
        return read, doc, dest, None
    members = pz.rewrite_plugin_members(read.members, nxt)
    doc = dict(doc)
    doc["id"] = nxt
    new_read = psz.pack_read_from_members(members, compressed_bytes=read.compressed_bytes, stats=read.stats)
    return new_read, doc, dest.with_name(f"{nxt}.zip"), pid


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
        raw_out = pz.pack_bytes_from_members(pack_read.members)
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
    zip_display_name: str | None = None,
) -> dict[str, Any]:
    """Validate, write ``~/.zoto-viz/plugins/local/<id>.zip``, unpack, maybe activate."""
    fd, tmp_name = tempfile.mkstemp(prefix="zoto-local.", suffix=".zip")
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        tmp_path.write_bytes(raw)
        try:
            pack_read = psz.read_pack_zip(tmp_path)
        except ValueError as e:
            return _finish(
                _zip_blocked_result(
                    e,
                    zip_display_name=zip_display_name,
                    zip_path=tmp_path,
                ),
                activate=False,
            )
        doc = plugins.validate_doc(pack_read.plugin)
        pid = str(doc["id"])
        dest = paths.plugin_local_dir(create=True) / f"{pid}.zip"
        pack_read, doc, dest, reminted_from = remint_pack_read(
            pack_read,
            dest,
            overwrite=overwrite,
            incoming_sha=pz.plugin_sha256(tmp_path),
        )
        pid = str(doc["id"])
        if reminted_from:
            tmp_path.write_bytes(pz.pack_bytes_from_members(pack_read.members))
        runtime = paths.plugin_local_runtime_dir(create=True) / pid
        incoming = pz.plugin_sha256(tmp_path)
        if dest.is_file() and pz.plugin_sha256(dest) == incoming:
            unpacked = pz.unpack_zip(dest, runtime)
            info = _install_result(doc, dest, unpacked, wrote=False)
            if reminted_from:
                info["remintedFrom"] = reminted_from
            return _finish(info, activate=activate)
        if dest.is_file() and not overwrite:
            raise ValueError(
                f"plugin {pid!r} already exists in the local drop zone (pass overwrite: true)"
            )
        upgrade = dest.is_file() and runtime.is_dir()
        pipeline = install_zip_to_runtime(
            tmp_path,
            dest,
            runtime,
            doc,
            rel=str(dest),
            sha256=incoming,
            upgrade=upgrade,
            pack_read=pack_read,
        )
        if not pipeline.get("ok"):
            return _finish(pipeline, activate=False)
        unpacked = pz.UnpackResult(
            dest=runtime,
            sha256=str(pipeline["sha256"]),
            unpacked=bool(pipeline.get("wrote", True)),
            plugin=doc,
            parts=tuple(pipeline.get("parts") or pack_read.parts),
            members=pack_read.members_sorted,
        )
        info = _install_result(doc, dest, unpacked, wrote=bool(pipeline.get("wrote", True)))
        if reminted_from:
            info["remintedFrom"] = reminted_from
        return _finish(info, activate=activate)
    finally:
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
    doc = plugins.validate_doc(pack_read.plugin)
    pid = str(doc["id"])
    dest = paths.plugin_local_dir(create=True) / f"{pid}.zip"
    pack_read, doc, dest, reminted_from = remint_pack_read(
        pack_read,
        dest,
        overwrite=dest.is_file(),
        incoming_sha=pz.plugin_sha256(path),
    )
    pid = str(doc["id"])
    if reminted_from:
        raw = pz.pack_bytes_from_members(pack_read.members)
        dest.write_bytes(raw)
        if path.resolve() != dest.resolve() and path.resolve().parent == dest.resolve().parent:
            path.unlink(missing_ok=True)
    elif path.resolve() != dest.resolve():
        if dest.is_file() and pz.plugin_sha256(dest) != pz.plugin_sha256(path):
            raise ValueError(
                f"local zip {path.name} id is {pid!r} but {dest.name} already exists"
            )
        if path.resolve().parent == dest.resolve().parent:
            os.replace(path, dest)
        else:
            shutil.copy2(path, dest)
    runtime = paths.plugin_local_runtime_dir(create=True) / pid
    incoming = pz.plugin_sha256(dest)
    upgrade = runtime.is_dir()
    pipeline = install_zip_to_runtime(
        dest,
        dest,
        runtime,
        doc,
        rel=str(dest),
        sha256=incoming,
        upgrade=upgrade,
        pack_read=pack_read,
    )
    if not pipeline.get("ok"):
        return _finish(pipeline, activate=False)
    unpacked = pz.UnpackResult(
        dest=runtime,
        sha256=str(pipeline["sha256"]),
        unpacked=bool(pipeline.get("wrote", True)),
        plugin=doc,
        parts=tuple(pipeline.get("parts") or pack_read.parts),
        members=pack_read.members_sorted,
    )
    info = _install_result(doc, dest, unpacked, wrote=bool(pipeline.get("wrote", True)))
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
    except PackInstallStoreFault as e:
        return {"ok": False, "error": REASON_PACK_INSTALL_FAULT, "message": fault_message(str(e))}
    except ValueError as e:
        return {"ok": False, "error": str(e)}


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
        except PackInstallStoreFault as e:
            results.append({"ok": False, "error": REASON_PACK_INSTALL_FAULT, "message": fault_message(str(e)), "path": str(z)})
        except ValueError as e:
            blocked = _zip_blocked_result(e)
            blocked["path"] = str(z)
            results.append(blocked)
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
