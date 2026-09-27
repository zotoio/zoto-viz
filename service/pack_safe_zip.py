"""Validate pack zips once → ``StagedPack``; remint and go-live never re-parse the archive."""
from __future__ import annotations

import hashlib
import io
import logging
import secrets
import shutil
import struct
import unicodedata
import weakref
import zlib
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO, Callable

import yaml

from . import plugin_zip as pz

_LOG = logging.getLogger(__name__)

# Fixed cap for manifest/metadata member reads (plugin.yml); packs cannot raise this.
MANIFEST_MEMBER_MAX_BYTES = 65_536

_MAX_COMPRESSION_RATIO = 100
_REQUIRED = "plugin.yml"
_ALLOWED_COMPRESS = frozenset({zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED})

_STAGED_SENTINEL = object()
_TREE_HASH_VERSION = 0x01

_issued_staged: dict[int, weakref.ReferenceType[Any]] = {}


@dataclass
class ZipReadStats:
    archive_bytes_read: int = 0
    central_directory_parses: int = 0

@dataclass(frozen=True)
class Blocked:
    reason: str
    message: str
    technical: str = ""


class _CountingZipFile(zipfile.ZipFile):
    def __init__(self, file: Any, stats: ZipReadStats) -> None:
        self._pack_stats = stats
        super().__init__(file)

    def _RealGetContents(self) -> None:
        self._pack_stats.central_directory_parses += 1
        super()._RealGetContents()


@dataclass(frozen=True)
class StagedPack:
    """Frozen install payload; only built inside this module."""

    staging_dir: Path
    zip_sha256: str
    tree_sha256: str
    manifest: dict[str, Any]
    source: str
    member_sha256: dict[str, str]
    members_sorted: tuple[str, ...]
    parts: tuple[str, ...]
    stats: ZipReadStats
    _token: object

    def __post_init__(self) -> None:
        _assert_staged_token(self._token)

    @property
    def pack_id(self) -> str:
        return str(self.manifest["id"])

    @property
    def plugin(self) -> dict[str, Any]:
        """Alias for legacy tests and callers."""
        return self.manifest

    @property
    def members(self) -> dict[str, bytes]:
        root = self.staging_dir
        out: dict[str, bytes] = {}
        for path in root.rglob("*"):
            if path.is_file() and path.name != pz.SHA256_NAME:
                out[path.relative_to(root).as_posix()] = path.read_bytes()
        return out


def _assert_staged_token(token: object) -> None:
    if token is not _STAGED_SENTINEL:
        raise TypeError("StagedPack cannot be constructed outside pack_safe_zip")


def _register_issued_staged(pack: StagedPack) -> None:
    oid = id(pack)
    _issued_staged[oid] = weakref.ref(pack, lambda _ref, key=oid: _issued_staged.pop(key, None))


def _consume_issued_staged(pack: StagedPack) -> None:
    oid = id(pack)
    ref = _issued_staged.pop(oid, None)
    if ref is None or ref() is not pack:
        raise ValueError("StagedPack was not issued by the pack validator")


def _make_staged_pack(**kwargs: Any) -> StagedPack:
    pack = StagedPack(_token=_STAGED_SENTINEL, **kwargs)
    _register_issued_staged(pack)
    return pack


def normalized_tree_path(rel: str) -> str:
    return unicodedata.normalize("NFC", rel.replace("\\", "/"))


def _tree_path_sort_key(rel: str) -> str:
    return normalized_tree_path(rel)


def _tree_entry_bytes(rel: str, file_digest_hex: str) -> bytes:
    path = normalized_tree_path(rel).encode("utf-8")
    digest = bytes.fromhex(file_digest_hex)
    if len(digest) != 32:
        raise ValueError("file digest must be 32 bytes")
    return struct.pack(">I", len(path)) + path + digest


def tree_hash_from_digests(member_sha256: dict[str, str]) -> str:
    digest = hashlib.sha256()
    digest.update(bytes([_TREE_HASH_VERSION]))
    for rel in sorted(member_sha256, key=_tree_path_sort_key):
        digest.update(_tree_entry_bytes(rel, member_sha256[rel]))
    return digest.hexdigest()


def legacy_runtime_tree_hash(runtime: Path) -> str:
    """Pre-v1 tree hash (path utf-8 + raw bytes); used only for one-time migration."""
    if not runtime.is_dir():
        return ""
    digest = hashlib.sha256()
    for path in sorted(runtime.rglob("*")):
        if not path.is_file():
            continue
        digest.update(path.relative_to(runtime).as_posix().encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()


def staging_root(runtime_parent: Path) -> Path:
    return Path(runtime_parent) / ".staging"


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
    """Versioned pack tree hash from files on disk (verification / migration)."""
    if not runtime.is_dir():
        return ""
    digests: dict[str, str] = {}
    for path in sorted(runtime.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(runtime).as_posix()
        digests[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
    return tree_hash_from_digests(digests)


def runtime_tree_hash_from_disk_with_byte_count(runtime: Path) -> tuple[str, int]:
    if not runtime.is_dir():
        return "", 0
    digests: dict[str, str] = {}
    bytes_read = 0
    for path in sorted(runtime.rglob("*")):
        if not path.is_file():
            continue
        data = path.read_bytes()
        bytes_read += len(data)
        rel = path.relative_to(runtime).as_posix()
        digests[rel] = hashlib.sha256(data).hexdigest()
    return tree_hash_from_digests(digests), bytes_read


def zip_entry_error(member: str, detail: str) -> str:
    rel = member.replace("\\", "/")
    return f"zip entry {rel!r}: {detail}"


def member_dedupe_key(rel: str) -> str:
    return unicodedata.normalize("NFC", rel).casefold()


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


def validate_pack_zip(
    stream: BinaryIO,
    source: str,
    runtime_parent: Path,
) -> StagedPack | Blocked:
    """Single CD parse, one zip SHA-256, extract under ``runtime_parent/.staging``."""
    runtime_parent = Path(runtime_parent)
    stats = ZipReadStats()
    staging: Path | None = None
    pack_id = ""
    try:
        raw = stream.read()
        if not raw:
            return Blocked("zip_unsafe", "empty zip", technical="empty zip")
        zip_sha = hashlib.sha256(raw).hexdigest()
        if len(raw) > pz.MAX_ZIP_BYTES:
            return Blocked(
                "zip_unsafe",
                f"zip exceeds {pz.MAX_ZIP_BYTES} bytes",
                technical=f"zip exceeds {pz.MAX_ZIP_BYTES} bytes",
            )
        try:
            counting = _CountingReader(io.BytesIO(raw), stats)  # type: ignore[arg-type]
            zf = _CountingZipFile(counting, stats)
        except zipfile.BadZipFile as e:
            return Blocked("zip_unsafe", "not a zip", technical=str(e))
        with zf:
            members = _read_all_members(zf)
        from . import plugins

        plugin = _parse_plugin_yml(members[_REQUIRED])
        pack_id = str(plugin.get("id") or "")
        if not pack_id:
            return Blocked("schema_invalid", "id is required", technical="id is required")
        doc = plugin
        cleanup_staging_for_pack(runtime_parent, pack_id)
        staging = new_staging_dir(runtime_parent, pack_id)
        member_sha: dict[str, str] = {}
        for rel, data in members.items():
            member_sha[rel] = hashlib.sha256(data).hexdigest()
            out = (staging / rel).resolve()
            if staging.resolve() not in out.parents and out != staging.resolve():
                raise ValueError(zip_entry_error(rel, "path escapes staging directory"))
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
        sidecar = (zip_sha + "\n").encode("utf-8")
        (staging / pz.SHA256_NAME).write_text(zip_sha + "\n", encoding="utf-8")
        tree_digests = {**member_sha, pz.SHA256_NAME: hashlib.sha256(sidecar).hexdigest()}
        members_sorted = tuple(sorted(members))
        tree_sha = tree_hash_from_digests(tree_digests)
        return _make_staged_pack(
            staging_dir=staging,
            zip_sha256=zip_sha,
            tree_sha256=tree_sha,
            manifest=dict(doc),
            source=str(source),
            member_sha256=member_sha,
            members_sorted=members_sorted,
            parts=pz.detect_parts(members_sorted),
            stats=stats,
        )
    except ValueError as e:
        cleanup_staging_dir(staging)
        if pack_id:
            cleanup_staging_for_pack(runtime_parent, pack_id)
        return Blocked("zip_unsafe", str(e), technical=str(e))
    except Exception as e:
        cleanup_staging_dir(staging)
        return Blocked("zip_unsafe", str(e), technical=str(e))


def remint(staged: StagedPack, new_id: str) -> StagedPack:
    """Rewrite manifest id inside staging; re-hash ``plugin.yml`` and recombine tree (no zip parse)."""
    _consume_issued_staged(staged)
    root = staged.staging_dir
    yml_path = root / _REQUIRED
    doc = _parse_plugin_yml(yml_path.read_bytes())
    doc["id"] = str(new_id)
    yml_bytes = yaml.safe_dump(doc, sort_keys=False, allow_unicode=True).encode("utf-8")
    yml_path.write_bytes(yml_bytes)
    member_sha = dict(staged.member_sha256)
    member_sha[_REQUIRED] = hashlib.sha256(yml_bytes).hexdigest()
    tree_digests = dict(member_sha)
    tree_digests[pz.SHA256_NAME] = hashlib.sha256((staged.zip_sha256 + "\n").encode()).hexdigest()
    doc = _parse_plugin_yml(yml_bytes)
    tree_sha = tree_hash_from_digests(tree_digests)
    return _make_staged_pack(
        staging_dir=root,
        zip_sha256=staged.zip_sha256,
        tree_sha256=tree_sha,
        manifest=dict(doc),
        source=staged.source,
        member_sha256=member_sha,
        members_sorted=staged.members_sorted,
        parts=staged.parts,
        stats=staged.stats,
    )


def go_live(
    staged: StagedPack,
    runtime: Path,
    *,
    after_first_rename: Callable[[], None] | None = None,
) -> bool:
    """Rename staging into ``runtime``; upgrade swaps via ``.bak``. Returns True when upgraded."""
    _assert_staged_token(getattr(staged, "_token", None))
    _consume_issued_staged(staged)
    runtime = Path(runtime)
    staging = staged.staging_dir
    if not staging.is_dir():
        raise ValueError("staging directory missing")
    bak = runtime.parent / f"{runtime.name}.bak"
    if bak.is_dir():
        shutil.rmtree(bak, ignore_errors=True)
    if not runtime.is_dir():
        staging.rename(runtime)
        return False
    runtime.rename(bak)
    if after_first_rename is not None:
        after_first_rename()
    try:
        staging.rename(runtime)
    except Exception:
        if bak.is_dir() and not runtime.is_dir():
            bak.rename(runtime)
        raise
    return True


def validate_pack_zip_path(path: Path, source: str, runtime_parent: Path) -> StagedPack | Blocked:
    with Path(path).open("rb") as fh:
        return validate_pack_zip(fh, source, runtime_parent)


# --- helpers used by tests / legacy read path (no extra CD parse when given bytes) ---


def read_pack_zip(path: Path, *, runtime_parent: Path | None = None) -> StagedPack:
    """Parse a zip file into a staged tree (validator entry for path-based tests)."""
    from . import paths

    parent = runtime_parent or paths.plugin_local_runtime_dir(create=True)
    hit = validate_pack_zip_path(path, f"path:{path.name}", parent)
    if isinstance(hit, Blocked):
        raise ValueError(hit.technical or hit.message)
    return hit


def write_pack_zip_to_staging(staging: Path, staged: StagedPack) -> None:
    """Test hook: materialize already-validated members (no-op when staging is the staged dir)."""
    _assert_staged_token(staged._token)
    if Path(staging).resolve() == staged.staging_dir.resolve():
        return
    shutil.copytree(staged.staging_dir, staging, dirs_exist_ok=True)


def _parse_plugin_yml(raw: bytes) -> dict[str, Any]:
    try:
        doc = yaml.safe_load(raw.decode("utf-8"))
    except (UnicodeDecodeError, yaml.YAMLError) as e:
        raise ValueError(f"{_REQUIRED} is not YAML: {e}") from e
    if not isinstance(doc, dict):
        raise ValueError(f"{_REQUIRED} must be a mapping")
    return doc


def _read_all_members(zf: zipfile.ZipFile) -> dict[str, bytes]:
    _, max_uncompressed, max_files = pz.MAX_ZIP_BYTES, pz.MAX_UNCOMPRESSED_BYTES, pz.MAX_FILES
    max_uncompressed = pz.MAX_UNCOMPRESSED_BYTES
    max_files = pz.MAX_FILES
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
        if rel == _REQUIRED and actual > MANIFEST_MEMBER_MAX_BYTES:
            raise ValueError(
                zip_entry_error(_REQUIRED, f"exceeds {MANIFEST_MEMBER_MAX_BYTES} byte manifest read cap"),
            )
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
    if _REQUIRED not in files:
        raise ValueError(f"{_REQUIRED} is required at the archive root")
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
