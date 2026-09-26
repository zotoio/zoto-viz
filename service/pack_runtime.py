"""Zip → .runtime materialization (delegates to plugin_install)."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from . import plugin_zip as pz
from .pack_boundary import (
    PackBundleBoundary,
    PackBundleBoundaryError,
    format_blocked_message,
)
from .plugin_install import (
    InstallStartFailedError,
    InstallV2BlockedError,
    cleanup_staging_artifacts,
    format_v2_blocked_message,
    install_zip_to_runtime,
)

# zip identity → catalog error row (avoids re-unpack/re-bundle on every scan)
_zip_block_cache: dict[str, dict[str, str]] = {}


def reset_zip_block_cache() -> None:
    _zip_block_cache.clear()


def zip_block_cache_key(zip_path: Path) -> str:
    path = Path(zip_path)
    digest = pz.plugin_sha256(path)
    st = path.stat()
    return f"{path.resolve()}:{digest}:{st.st_mtime_ns}:{st.st_size}"


def cached_zip_block(key: str) -> dict[str, str] | None:
    hit = _zip_block_cache.get(key)
    return dict(hit) if hit else None


def remember_zip_block(key: str, row: dict[str, str]) -> None:
    _zip_block_cache[key] = dict(row)


def forget_zip_block_cache_for_path(zip_path: Path) -> None:
    key = zip_block_cache_key(zip_path)
    _zip_block_cache.pop(key, None)


def staging_path(runtime: Path) -> Path:
    """Legacy staging path (prefer plugin_install.new_staging_dir)."""
    return runtime.parent / f".{runtime.name}-staging"


def cleanup_staging(runtime: Path) -> None:
    cleanup_staging_artifacts(runtime)


def catalog_boundary_error(
    zip_file: str,
    block: PackBundleBoundary,
    *,
    upgrade: bool = False,
    version: str | int | None = None,
) -> dict[str, str]:
    row = block.to_dict()
    row["file"] = zip_file
    row["error"] = "pack_boundary"
    row["zip"] = zip_file
    if upgrade:
        row["upgrade_blocked"] = "true"
        detail = f"({block.file} imports {block.import_spec})"
        row["message"] = format_v2_blocked_message(
            block.pack_name or block.pack_id,
            version,
            detail,
        )
    else:
        row.setdefault("message", format_blocked_message(block))
    return row


def _boundary_from_payload(doc: dict[str, Any], payload: dict[str, str]) -> PackBundleBoundary:
    return PackBundleBoundary(
        pack_id=str(payload.get("id") or doc.get("id") or ""),
        pack_name=str(payload.get("name") or doc.get("name") or doc.get("id") or ""),
        file=str(payload.get("file") or ""),
        import_spec=str(payload.get("import") or ""),
        detail=str(payload.get("detail") or ""),
    )


def materialize_zip_runtime(
    zip_path: Path,
    runtime: Path,
    *,
    compile_bundle: Any,
    verify_bundle: Any,
    load_doc: Any,
) -> pz.UnpackResult:
    """Unpack to staging, verify, swap via ``.bak``, compile (cache)."""
    del compile_bundle, verify_bundle, load_doc
    from . import plugins

    from . import pack_safe_zip as psz

    hit = psz.validate_pack_zip_path(zip_path, str(zip_path), runtime.parent)
    if isinstance(hit, psz.Blocked):
        raise ValueError(hit.message)
    doc = plugins.validate_doc(hit.manifest)
    upgrade = runtime.is_dir()
    rel = str(zip_path)
    try:
        return install_zip_to_runtime(
            zip_path,
            zip_path,
            runtime,
            doc,
            rel=rel,
            upgrade=upgrade,
            pack_read=hit,
        )
    except InstallV2BlockedError:
        raise
    except InstallStartFailedError as e:
        raise ValueError(str(e)) from e


def runtime_has_partial_bundle(runtime: Path) -> bool:
    """True when a failed install left a module.js artifact (should not happen)."""
    return (runtime / "module.js").is_file()
