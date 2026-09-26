"""Safe pack zip reader for the B-stage install pipeline."""
from __future__ import annotations

import hashlib
import io
import unicodedata
import zlib
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

# Fixed cap for manifest/metadata member reads (plugin.yml); packs cannot raise this.
MANIFEST_MEMBER_MAX_BYTES = 65_536

_MAX_COMPRESSION_RATIO = 100
_REQUIRED = "plugin.yml"
_ALLOWED_COMPRESS = frozenset({zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED})


def _zip_limits() -> tuple[int, int, int]:
    from . import plugin_zip as pz

    return pz.MAX_ZIP_BYTES, pz.MAX_UNCOMPRESSED_BYTES, pz.MAX_FILES


@dataclass
class ZipReadStats:
    archive_bytes_read: int = 0
    central_directory_parses: int = 0


class _CountingZipFile(zipfile.ZipFile):
    def __init__(self, file: Any, stats: ZipReadStats) -> None:
        self._pack_stats = stats
        super().__init__(file)

    def _RealGetContents(self) -> None:
        self._pack_stats.central_directory_parses += 1
        super()._RealGetContents()


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

    def seekable(self) -> bool:
        raw_seekable = getattr(self._raw, "seekable", None)
        if callable(raw_seekable):
            return bool(raw_seekable())
        return bool(raw_seekable)

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


def zip_entry_error(member: str, detail: str) -> str:
    rel = member.replace("\\", "/")
    return f"zip entry {rel!r}: {detail}"


def member_dedupe_key(rel: str) -> str:
    return unicodedata.normalize("NFC", rel).casefold()


def pack_read_from_members(
    members: dict[str, bytes],
    *,
    compressed_bytes: int = 0,
    stats: ZipReadStats | None = None,
) -> PackZipRead:
    """Build a read view from member bytes (no zip central-directory parse)."""
    from . import plugin_zip as pz

    if _REQUIRED not in members:
        raise ValueError(f"{_REQUIRED} is required at the archive root")
    plugin_raw = members[_REQUIRED]
    if len(plugin_raw) > MANIFEST_MEMBER_MAX_BYTES:
        raise ValueError(
            zip_entry_error(_REQUIRED, f"exceeds {MANIFEST_MEMBER_MAX_BYTES} byte manifest read cap"),
        )
    plugin = _parse_plugin_yml(plugin_raw)
    member_sha = {rel: hashlib.sha256(data).hexdigest() for rel, data in members.items()}
    members_sorted = tuple(sorted(members))
    uncompressed = sum(len(b) for b in members.values())
    return PackZipRead(
        members=dict(members),
        member_sha256=member_sha,
        plugin=plugin,
        members_sorted=members_sorted,
        parts=pz.detect_parts(members_sorted),
        compressed_bytes=compressed_bytes,
        uncompressed_bytes=uncompressed,
        stats=stats or ZipReadStats(),
    )


def read_pack_zip(path: Path) -> PackZipRead:
    """Parse a plugin zip once and inflate every member safely."""
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
        zf = _CountingZipFile(counting, stats)
    except zipfile.BadZipFile as e:
        raise ValueError("not a zip") from e
    with zf:
        members = _read_all_members(zf)
    return pack_read_from_members(members, compressed_bytes=compressed, stats=stats)


def write_pack_zip_to_staging(staging: Path, read: PackZipRead, *, zip_sha256: str | None = None) -> None:
    """Write parsed members into ``staging`` (paths must stay under ``staging``)."""
    staging = Path(staging).resolve()
    staging.mkdir(parents=True, exist_ok=True)
    for rel, data in read.members.items():
        out = (staging / rel).resolve()
        if staging not in out.parents and out != staging:
            raise ValueError(zip_entry_error(rel, "path escapes staging directory"))
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(bytes(read.members[rel]))
    if zip_sha256:
        from . import plugin_zip as pz

        (staging / pz.SHA256_NAME).write_text(zip_sha256 + "\n", encoding="utf-8")


def materialize_pack_read_to_runtime(runtime: Path, read: PackZipRead, *, zip_sha256: str) -> None:
    write_pack_zip_to_staging(runtime, read, zip_sha256=zip_sha256)


def _parse_plugin_yml(raw: bytes) -> dict[str, Any]:
    try:
        doc = yaml.safe_load(raw.decode("utf-8"))
    except (UnicodeDecodeError, yaml.YAMLError) as e:
        raise ValueError(f"{_REQUIRED} is not YAML: {e}") from e
    if not isinstance(doc, dict):
        raise ValueError(f"{_REQUIRED} must be a mapping")
    return doc


def _read_all_members(zf: zipfile.ZipFile) -> dict[str, bytes]:
    from . import plugin_zip as pz

    _, max_uncompressed, max_files = _zip_limits()
    infos = zf.infolist()
    if len(infos) > max_files:
        raise ValueError(f"zip has more than {max_files} entries")
    files: dict[str, bytes] = {}
    seen: dict[str, str] = {}
    total = 0
    for info in infos:
        raw_name = info.filename
        if info.is_dir():
            continue
        if info.flag_bits & 0x1:
            raise ValueError(zip_entry_error(raw_name, "encrypted entries are not allowed"))
        if info.compress_type not in _ALLOWED_COMPRESS:
            raise ValueError(zip_entry_error(raw_name, "unsupported compression method"))
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
        key = member_dedupe_key(rel)
        if key in seen:
            first = seen[key]
            raise ValueError(
                zip_entry_error(raw_name, f"duplicate name (same as {first!r} after normalization)"),
            )
        seen[key] = raw_name
        claimed = int(info.file_size)
        cap = max_uncompressed - total
        if rel == _REQUIRED:
            cap = min(cap, MANIFEST_MEMBER_MAX_BYTES + 1)
        try:
            data = _read_member_bytes(zf, info, cap)
        except (zipfile.BadZipFile, zipfile.LargeZipFile, EOFError, zlib.error, RuntimeError, NotImplementedError) as e:
            raise ValueError(zip_entry_error(info.filename, str(e))) from e
        actual = len(data)
        if actual != claimed:
            raise ValueError(zip_entry_error(rel, f"inflated {actual} bytes, declared {claimed}"))
        compressed = int(info.compress_size) or 1
        if actual > compressed * _MAX_COMPRESSION_RATIO:
            raise ValueError(
                zip_entry_error(rel, f"compression ratio exceeds {_MAX_COMPRESSION_RATIO}"),
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


def _read_member_bytes(zf: zipfile.ZipFile, info: zipfile.ZipInfo, cap: int) -> bytes:
    if cap < 0:
        raise ValueError(zip_entry_error(info.filename, "uncompressed zip too large"))
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
                if info.filename.replace("\\", "/").endswith(_REQUIRED) or info.filename.endswith(_REQUIRED):
                    raise ValueError(
                        zip_entry_error(_REQUIRED, f"exceeds {MANIFEST_MEMBER_MAX_BYTES} byte manifest read cap"),
                    )
                raise ValueError(zip_entry_error(info.filename, f"uncompressed size exceeds {cap}"))
            out.write(chunk)
    return out.getvalue()
