"""Safe read/print helpers for pack-boundary CI (PR head tree is untrusted data)."""
from __future__ import annotations

import os
import secrets
import stat
import sys
from pathlib import Path, PurePosixPath

# Max bytes read from any single file under the PR head tree (or base tree).
PACK_BOUNDARY_MAX_FILE_BYTES = 1_048_576


def path_has_control_chars(path: str) -> bool:
    if not path or path != path.strip():
        return True
    for ch in path:
        o = ord(ch)
        if o < 32 or o == 127:
            return True
    if ".." in PurePosixPath(path).parts:
        return True
    if path.startswith("/"):
        return True
    return False


def validate_changed_path(path: str) -> str | None:
    if path_has_control_chars(path):
        return f"unsafe path (control characters or traversal): {path!r}"
    return None


def resolve_under_root(root: Path, rel_path: str) -> Path:
    """Join rel_path under root without following symlinks (for lstat/read)."""
    if path_has_control_chars(rel_path):
        raise ValueError(f"unsafe path: {rel_path!r}")
    root_real = root.resolve()
    normed = os.path.normpath(os.path.join(str(root_real), rel_path.replace("/", os.sep)))
    root_s = str(root_real)
    if normed != root_s and not normed.startswith(root_s + os.sep):
        raise ValueError(f"path escapes PR head root: {rel_path!r}")
    return Path(normed)


def lstat_pr_head_path(root: Path, rel_path: str) -> str | None:
    """Fail closed on symlinks; return error message or None if absent or regular file."""
    try:
        full = resolve_under_root(root, rel_path)
    except ValueError as exc:
        return str(exc)
    try:
        st = os.lstat(full)
    except FileNotFoundError:
        return None
    except OSError as exc:
        return f"cannot lstat {rel_path!r}: {exc}"
    if stat.S_ISLNK(st.st_mode):
        return f"symlink not allowed in PR head tree: {rel_path!r}"
    if not stat.S_ISREG(st.st_mode):
        return f"PR head path is not a regular file: {rel_path!r}"
    return None


def read_regular_file_under_root(
    root: Path, rel_path: str, *, max_bytes: int = PACK_BOUNDARY_MAX_FILE_BYTES
) -> str | None:
    err = lstat_pr_head_path(root, rel_path)
    if err:
        raise ValueError(err)
    full = resolve_under_root(root, rel_path)
    if not full.is_file():
        return None
    size = full.stat().st_size
    if size > max_bytes:
        raise ValueError(
            f"file exceeds size cap ({max_bytes} bytes): {rel_path!r} ({size} bytes)"
        )
    return full.read_bytes().decode("utf-8", errors="replace")


class WorkflowSafePrinter:
    """Emit PR-derived lines without workflow command injection."""

    def __init__(self) -> None:
        self._token = secrets.token_hex(16)
        self._stopped = False

    def begin(self) -> None:
        if not self._stopped:
            print(f"::stop-commands::{self._token}", flush=True)
            self._stopped = True

    def end(self) -> None:
        if self._stopped:
            print(f"::{self._token}::", flush=True)
            self._stopped = False

    @staticmethod
    def escape_line(line: str) -> str:
        if line.startswith("::"):
            return " " + line
        return line

    def write_lines(self, lines: list[str], *, stream: object | None = None) -> None:
        out = stream if stream is not None else sys.stdout
        self.begin()
        try:
            for line in lines:
                print(self.escape_line(line), file=out, flush=True)
        finally:
            self.end()


def validate_changed_paths(paths: list[str]) -> str | None:
    for path in paths:
        err = validate_changed_path(path)
        if err:
            return err
    return None


def scan_pr_head_tree(root: Path, paths: list[str]) -> str | None:
    for path in paths:
        err = lstat_pr_head_path(root, path)
        if err:
            return err
    return None
