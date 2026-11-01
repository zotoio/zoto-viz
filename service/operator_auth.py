"""Operator bearer for non-loopback clients.

The token is never copied onto GET responses. Loopback keeps the CSRF header.
Set ``ZOTO_VIZ_OPERATOR_TOKEN`` or leave the mode-0600 file under the user dir.
"""
from __future__ import annotations

import os
import secrets
import sys
from pathlib import Path

from . import paths

ENV = "ZOTO_VIZ_OPERATOR_TOKEN"
FILE_NAME = "operator.token"


def token_file() -> Path:
    return paths.user_dir() / FILE_NAME


def load_or_create() -> tuple[str, bool]:
    """Return ``(token, created)``. The environment variable wins and is not written to disk."""
    env = os.environ.get(ENV, "").strip()
    if env:
        return env, False
    path = token_file()
    if path.is_file():
        text = path.read_text(encoding="utf-8").strip()
        if text:
            try:
                path.chmod(0o600)
            except OSError:
                pass
            return text, False
    raw = secrets.token_urlsafe(32)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, (raw + "\n").encode("utf-8"))
    finally:
        os.close(fd)
    return raw, True


def announce(*, created: bool) -> None:
    """Tell the operator where the token lives. The value stays off this stream."""
    if os.environ.get(ENV, "").strip():
        print(
            f"[monitor] LAN writes and POST /mcp use Authorization: Bearer from {ENV}",
            file=sys.stderr,
            flush=True,
        )
        return
    path = token_file()
    if created:
        print(
            f"[monitor] wrote LAN operator token to {path} (mode 0600). "
            "Reads stay open; writes and POST /mcp send Authorization: Bearer.",
            file=sys.stderr,
            flush=True,
        )
        return
    print(
        f"[monitor] LAN writes and POST /mcp need Authorization: Bearer from {path}",
        file=sys.stderr,
        flush=True,
    )
