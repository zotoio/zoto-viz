"""Safe pack zip reader for the B-stage install pipeline (single CD parse per read)."""
from __future__ import annotations

import hashlib
import io
import posixpath
import stat
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

# Fixed cap for manifest/metadata member reads (plugin.yml); packs cannot raise this.
MANIFEST_MEMBER_MAX_BYTES = 65_536

_REQUIRED = "plugin.yml"


def _zip_limits() -> tuple[int, int, int]:
    from . import plugin_zip as pz

    return pz.MAX_ZIP_BYTES, pz.MAX_UNCOMPRESSED_BYTES, pz.MAX_FILES


@dataclass
class ZipReadStats:
    archive_bytes_read: int = 0
    central_directory_parses: int = 0


@dataclass(frozen=True)
class PackZipRead:
    members: dict[str, bytes]
    member_sha256: dict[str, str]
    plugin: dict[str, Any]
    members_sorted: tuple[str, ...]
    parts: tuple[str, ...]
    compressed_bytes: int
    uncompressed_bytes: int
    stats: ZipReadStats


class _CountingReader:
    def __init__(self, raw: io.BufferedReader, stats: ZipReadStats) -> None:
        self._raw = raw
        self._stats = stats

    @property
    def seekable(self) -> bool:
        return self._raw.seekable

    def read(self, n: int = -1) -> bytes:
        data = self._raw.read(n)
        self._stats.archive_bytes_read += len(data)
        return data

    def read1(self, n: int = -1) -> bytes:
        data = self._raw.read1(n)
        self._stats.archive_bytes_read += len(data)
        return data

    def seek(self, offset: int, whence: int = 0) -> int:
        return self._raw.seek(offset, whence)

    def tell(self) -> int:
        return self._raw.tell()

    def close(self) -> None:
        self._raw.close()


def reset_zip_read_stats_for_tests() -> None:
    """No-op placeholder for tests that reset pipeline state."""
    return None


def zip_entry_error(member: str, detail: str) -> str:
    rel = member.replace("\\", "/")
    return f"zip entry {rel!r}: {detail}"


def read_pack_zip(path: Path) -> PackZipRead:
    """Parse a plugin zip once (central directory) and inflate every member safely."""
    path = Path(path)
    if not path.is_file():
        raise ValueError(f"not a file {path}")
    max_zip, _, _ = _zip_limits()
    compressed = path.stat().st_size
    if compressed > max_zip:
        raise ValueError(f"zip exceeds {max_zip} bytes")
    stats = ZipReadStats()
    try:
        raw = path.open("rb")
        counting = _CountingReader(raw, stats)
        zf = zipfile.ZipFile(counting)
    except zipfile.BadZipFile as e:
        raise ValueError("not a zip") from e
    stats.central_directory_parses = 1
    with zf:
        members = _read_all_members(zf, stats)
    if _REQUIRED not in members:
        raise ValueError(f"{_REQUIRED} is required at the archive root")
    plugin_raw = members[_REQUIRED]
    if len(plugin_raw) > MANIFEST_MEMBER_MAX_BYTES:
        raise ValueError(
            zip_entry_error(_REQUIRED, f"exceeds {MANIFEST_MEMBER_MAX_BYTES} byte manifest read cap"),
        )
    plugin = _parse_plugin_yml(plugin_raw)
    from . import plugin_zip as pz

    member_sha = {rel: hashlib.sha256(data).hexdigest() for rel, data in members.items()}
    members_sorted = tuple(sorted(members))
    uncompressed = sum(len(b) for b in members.values())
    return PackZipRead(
        members=members,
        member_sha256=member_sha,
        plugin=plugin,
        members_sorted=members_sorted,
        parts=pz.detect_parts(members_sorted),
        compressed_bytes=compressed,
        uncompressed_bytes=uncompressed,
        stats=stats,
    )


def write_pack_zip_to_staging(staging: Path, read: PackZipRead) -> None:
    """Write parsed members into ``staging``; staged file bytes must match entry hashes."""
    staging = Path(staging)
    staging.mkdir(parents=True, exist_ok=True)
    for rel, data in read.members.items():
        out = staging / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
        digest = hashlib.sha256(out.read_bytes()).hexdigest()
        if digest != read.member_sha256[rel]:
            raise ValueError(zip_entry_error(rel, "staged bytes do not match zip entry"))


def _parse_plugin_yml(raw: bytes) -> dict[str, Any]:
    try:
        doc = yaml.safe_load(raw.decode("utf-8"))
    except (UnicodeDecodeError, yaml.YAMLError) as e:
        raise ValueError(f"{_REQUIRED} is not YAML: {e}") from e
    if not isinstance(doc, dict):
        raise ValueError(f"{_REQUIRED} must be a mapping")
    return doc


def _read_all_members(zf: zipfile.ZipFile, stats: ZipReadStats) -> dict[str, bytes]:
    from . import plugin_zip as pz

    _, max_uncompressed, max_files = _zip_limits()
    files: dict[str, bytes] = {}
    seen_norm: dict[str, str] = {}
    total = 0
    for info in zf.infolist():
        if info.is_dir():
            continue
        raw_name = info.filename
        if pz._is_symlink(info):
            raise ValueError(zip_entry_error(raw_name, "symlink members are not allowed"))
        try:
            rel = pz._safe_name(raw_name)
        except ValueError as e:
            raise ValueError(zip_entry_error(raw_name, str(e))) from e
        if not rel:
            continue
        if not pz._allowed_member(rel):
            raise ValueError(zip_entry_error(rel, "disallowed path suffix"))
        if rel in seen_norm:
            first = seen_norm[rel]
            raise ValueError(
                zip_entry_error(raw_name, f"duplicate name (same as {first!r} after normalization)"),
            )
        seen_norm[rel] = raw_name
        claimed = int(info.file_size)
        if claimed < 0:
            raise ValueError(zip_entry_error(rel, "invalid declared uncompressed size"))
        remaining = max_uncompressed - total
        data = _read_member_bytes(zf, info, remaining)
        actual = len(data)
        if claimed > 0 and actual > claimed:
            raise ValueError(
                zip_entry_error(rel, f"inflated {actual} bytes exceeds declared {claimed}"),
            )
        total += actual
        if total > max_uncompressed:
            raise ValueError(zip_entry_error(rel, f"uncompressed size exceeds {max_uncompressed}"))
        files[rel] = data
        if len(files) > max_files:
            raise ValueError(f"zip has more than {max_files} files")
    if not files:
        raise ValueError("empty zip")
    return files


def _read_member_bytes(
    zf: zipfile.ZipFile,
    info: zipfile.ZipInfo,
    cap: int,
) -> bytes:
    chunk_size = 65_536
    out = io.BytesIO()
    total = 0
    with zf.open(info, "r") as fh:
        while True:
            chunk = fh.read(chunk_size)
            if not chunk:
                break
            total += len(chunk)
            if total > cap:
                raise ValueError(zip_entry_error(info.filename, f"uncompressed size exceeds {cap}"))
            out.write(chunk)
    return out.getvalue()
