"""Zip safety, inspect, unpack, and deterministic pack for contrib plugin zips.

Constants match ``schema/plugin.schema.json`` ``$defs/zipContract``.
``plugin pack`` sha256 is byte-stable on the pinned Python/zlib in CI; a
different zlib can change DEFLATE bytes. CI gates pack identity only for
``examples/plugins/sample.zip``. See ``docs/contributing.md``.
"""
from __future__ import annotations

import hashlib
import os
import re
import posixpath
import shutil
import stat
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import yaml

from . import pack_safe_zip as psz

MAX_ZIP_BYTES = 12_000_000
MAX_UNCOMPRESSED_BYTES = 24_000_000  # schema $defs/zipContract — a few NASA stills + tree
MAX_FILES = 80
ALLOWED_SUFFIX = frozenset({
    ".yml", ".yaml", ".json", ".py", ".ts", ".tsx", ".js", ".mjs",
    ".css", ".html", ".md", ".txt", ".svg", ".png", ".jpg", ".jpeg",
    ".webp", ".gif", ".glsl",
})
REQUIRED_MEMBER = "plugin.yml"
SHA256_NAME = ".zip.sha256"
PACK_DATE = (1980, 1, 1, 0, 0, 0)
PACK_COMPRESSLEVEL = 6
PACK_CREATE_SYSTEM = 0
PACK_EXTERNAL_ATTR = 0o644 << 16

_SKIP_PREFIX = ("__MACOSX/",)
_OPTIONAL_PARTS: tuple[tuple[str, str], ...] = (
    ("visualisation", "visualisation.yml"),
    ("frontend", "frontend/"),
    ("sky", "sky/"),
    ("datasource", "datasource/"),
    ("backend", "backend/"),
)


@dataclass(frozen=True)
class ZipManifest:
    plugin: dict[str, Any]
    members: tuple[str, ...]
    parts: tuple[str, ...]
    compressed_bytes: int
    uncompressed_bytes: int


@dataclass(frozen=True)
class UnpackResult:
    dest: Path
    sha256: str
    unpacked: bool
    plugin: dict[str, Any]
    parts: tuple[str, ...]
    members: tuple[str, ...]


def plugin_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 64), b""):
            digest.update(chunk)
    return digest.hexdigest()


def detect_parts(members: Iterable[str] | Path) -> tuple[str, ...]:
    if isinstance(members, Path):
        root = members
        found: list[str] = []
        if (root / "visualisation.yml").is_file():
            found.append("visualisation")
        for name in ("frontend", "sky", "datasource", "backend"):
            if (root / name).is_dir():
                found.append(name)
        return tuple(found)
    names = {str(m).replace("\\", "/") for m in members}
    found = []
    for part, marker in _OPTIONAL_PARTS:
        if marker.endswith("/"):
            if any(n == marker[:-1] or n.startswith(marker) for n in names):
                found.append(part)
        elif marker in names:
            found.append(part)
    return tuple(found)


def inspect_zip(path: Path) -> ZipManifest:
    read = psz.read_pack_zip(Path(path))
    return ZipManifest(
        plugin=read.plugin,
        members=read.members_sorted,
        parts=read.parts,
        compressed_bytes=read.compressed_bytes,
        uncompressed_bytes=read.uncompressed_bytes,
    )


def inspect_src(src: Path) -> ZipManifest:
    src = Path(src)
    if not src.is_dir():
        raise ValueError(f"not a directory {src}")
    files = _read_src_files(src)
    if REQUIRED_MEMBER not in files:
        raise ValueError(f"{REQUIRED_MEMBER} is required at the source root")
    plugin = _parse_plugin_yml(files[REQUIRED_MEMBER])
    members = tuple(sorted(files))
    total = sum(len(b) for b in files.values())
    if total > MAX_UNCOMPRESSED_BYTES:
        raise ValueError("uncompressed zip too large")
    return ZipManifest(
        plugin=plugin,
        members=members,
        parts=detect_parts(members),
        compressed_bytes=0,
        uncompressed_bytes=total,
    )


def unpack_zip(path: Path, dest: Path) -> UnpackResult:
    """Extract ``path`` into ``dest``. No-op when ``dest/.zip.sha256`` matches."""
    path = Path(path)
    dest = Path(dest)
    digest = plugin_sha256(path)
    marker = dest / SHA256_NAME
    yml = dest / REQUIRED_MEMBER
    if dest.is_dir() and marker.is_file() and yml.is_file():
        recorded = marker.read_text(encoding="utf-8").strip()
        if recorded == digest:
            try:
                plugin = _parse_plugin_yml(yml.read_bytes())
            except ValueError:
                pass
            else:
                members = tuple(_list_tree_members(dest))
                return UnpackResult(
                    dest=dest,
                    sha256=digest,
                    unpacked=False,
                    plugin=plugin,
                    parts=detect_parts(dest),
                    members=members,
                )
    files = _extract_files(path)
    plugin = _parse_plugin_yml(files[REQUIRED_MEMBER])
    members = tuple(sorted(files))
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".tmp")
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    try:
        for rel, data in files.items():
            out = tmp / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
        (tmp / SHA256_NAME).write_text(digest + "\n", encoding="utf-8")
        if dest.exists():
            shutil.rmtree(dest)
        os.replace(tmp, dest)
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    return UnpackResult(
        dest=dest,
        sha256=digest,
        unpacked=True,
        plugin=plugin,
        parts=detect_parts(members),
        members=members,
    )


def pack_tree(src: Path, dest: Path) -> str:
    """Write a deterministic zip of ``src`` to ``dest`` and return its sha256."""
    manifest = inspect_src(src)
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".pack-tmp")
    if tmp.exists():
        tmp.unlink()
    src = Path(src)
    with zipfile.ZipFile(
        tmp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=PACK_COMPRESSLEVEL,
    ) as zf:
        for rel in manifest.members:
            info = zipfile.ZipInfo(filename=rel, date_time=PACK_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = PACK_CREATE_SYSTEM
            info.external_attr = PACK_EXTERNAL_ATTR
            zf.writestr(info, (src / rel).read_bytes(), compresslevel=PACK_COMPRESSLEVEL)
    os.replace(tmp, dest)
    return plugin_sha256(dest)


def pack_files(files: dict[str, bytes], dest: Path) -> str:
    """Write a deterministic zip from ``{rel: bytes}`` and return its sha256."""
    cleaned: dict[str, bytes] = {}
    total = 0
    for raw_name, data in files.items():
        rel = _safe_name(str(raw_name))
        if not rel:
            continue
        if not _allowed_member(rel):
            raise ValueError(f"disallowed path {rel!r}")
        blob = data if isinstance(data, (bytes, bytearray)) else str(data).encode("utf-8")
        total += len(blob)
        if total > MAX_UNCOMPRESSED_BYTES:
            raise ValueError("uncompressed zip too large")
        cleaned[rel] = bytes(blob)
        if len(cleaned) > MAX_FILES:
            raise ValueError(f"zip has more than {MAX_FILES} files")
    if REQUIRED_MEMBER not in cleaned:
        raise ValueError(f"{REQUIRED_MEMBER} is required at the archive root")
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".pack-tmp")
    if tmp.exists():
        tmp.unlink()
    with zipfile.ZipFile(
        tmp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=PACK_COMPRESSLEVEL,
    ) as zf:
        for rel in sorted(cleaned):
            info = zipfile.ZipInfo(filename=rel, date_time=PACK_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = PACK_CREATE_SYSTEM
            info.external_attr = PACK_EXTERNAL_ATTR
            zf.writestr(info, cleaned[rel], compresslevel=PACK_COMPRESSLEVEL)
    if tmp.stat().st_size > MAX_ZIP_BYTES:
        tmp.unlink(missing_ok=True)
        raise ValueError(f"zip exceeds {MAX_ZIP_BYTES} bytes")
    os.replace(tmp, dest)
    return plugin_sha256(dest)


def rewrite_plugin_id(raw: bytes, new_id: str) -> bytes:
    """Return a new zip whose ``plugin.yml`` ``id`` is ``new_id``."""
    fd, tmp_name = tempfile.mkstemp(prefix="zoto-rewrite-src.", suffix=".zip")
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        tmp.write_bytes(raw)
        return pack_bytes_from_members(rewrite_plugin_members(_extract_files(tmp), new_id))
    finally:
        tmp.unlink(missing_ok=True)


def rewrite_plugin_members(members: dict[str, bytes], new_id: str) -> dict[str, bytes]:
    pid = str(new_id or "").strip()
    if not pid:
        raise ValueError("plugin id is required")
    doc = _parse_plugin_yml(members[REQUIRED_MEMBER])
    doc["id"] = pid
    out = dict(members)
    out[REQUIRED_MEMBER] = yaml.safe_dump(doc, sort_keys=False, allow_unicode=True).encode("utf-8")
    return out


def pack_bytes_from_members(members: dict[str, bytes]) -> bytes:
    fd, dest_name = tempfile.mkstemp(prefix="zoto-pack.", suffix=".zip")
    os.close(fd)
    dest = Path(dest_name)
    try:
        pack_files(members, dest)
        return dest.read_bytes()
    finally:
        dest.unlink(missing_ok=True)


def _parse_plugin_yml(raw: bytes) -> dict[str, Any]:
    try:
        doc = yaml.safe_load(raw.decode("utf-8"))
    except (UnicodeDecodeError, yaml.YAMLError) as e:
        raise ValueError(f"{REQUIRED_MEMBER} is not YAML: {e}") from e
    if not isinstance(doc, dict):
        raise ValueError(f"{REQUIRED_MEMBER} must be a mapping")
    return doc


def _extract_files(path: Path) -> dict[str, bytes]:
    read = psz.read_pack_zip(Path(path))
    return dict(read.members)


def _read_src_files(src: Path) -> dict[str, bytes]:
    src = src.resolve()
    files: dict[str, bytes] = {}
    total = 0
    for path in sorted(src.rglob("*")):
        if not path.is_file():
            continue
        rel_path = path.relative_to(src)
        if any(part.startswith(".") or part == "__pycache__" for part in rel_path.parts):
            continue
        if path.name == SHA256_NAME:
            continue
        rel = rel_path.as_posix()
        if ".." in rel_path.parts:
            raise ValueError(f"illegal path {rel!r}")
        if not _allowed_member(rel):
            raise ValueError(f"disallowed path {rel!r}")
        data = path.read_bytes()
        total += len(data)
        if total > MAX_UNCOMPRESSED_BYTES:
            raise ValueError("uncompressed zip too large")
        files[rel] = data
        if len(files) > MAX_FILES:
            raise ValueError(f"zip has more than {MAX_FILES} files")
    if not files:
        raise ValueError("empty source tree")
    return files


def _list_tree_members(root: Path) -> list[str]:
    out: list[str] = []
    root = root.resolve()
    for path in root.rglob("*"):
        if not path.is_file() or path.name == SHA256_NAME:
            continue
        rel = path.relative_to(root).as_posix()
        if any(part.startswith(".") for part in path.relative_to(root).parts):
            continue
        out.append(rel)
    out.sort()
    return out


def _safe_name(name: str) -> str:
    n = name.replace("\\", "/")
    if re.match(r"^[A-Za-z]:", n):
        raise ValueError(f"absolute zip path {name!r}")
    if n.startswith("/") or n.startswith("//") or (len(n) >= 3 and n[1] == ":" and n[2] == "/"):
        raise ValueError(f"absolute zip path {name!r}")
    if len(n) >= 2 and n[1] == ":":
        raise ValueError(f"absolute zip path {name!r}")
    while n.startswith("./"):
        n = n[2:]
    if not n or n.endswith("/"):
        return ""
    if any(n.startswith(p) for p in _SKIP_PREFIX) or posixpath.basename(n).startswith("._"):
        return ""
    parts = [p for p in n.split("/") if p and p != "."]
    if ".." in parts or not parts:
        raise ValueError(f"illegal zip path {name!r}")
    return "/".join(parts)


def _allowed_member(rel: str) -> bool:
    suffix = Path(rel).suffix.lower()
    return suffix in ALLOWED_SUFFIX


def _is_symlink(info: zipfile.ZipInfo) -> bool:
    mode = info.external_attr >> 16
    return bool(mode) and stat.S_ISLNK(mode)
