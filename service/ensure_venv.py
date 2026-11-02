"""Repair the checkout venv before the monitor process starts.

``python3 -m service.ensure_venv`` is ExecStartPre for the user service.
A copied ``.venv``, or one whose ``python3`` symlink now points at a newer
interpreter than ``pyvenv.cfg``, dies on ``import aiohttp`` and systemd
restarts it. This runs on the base interpreter, outside that venv.
"""
from __future__ import annotations

import sys

from .install import _run_capture, default_host, ensure_checkout_venv


def main() -> int:
    host = default_host()
    try:
        status = ensure_checkout_venv(
            host,
            _run_capture,
            emit=lambda line: print(line, file=sys.stderr, flush=True),
        )
    except RuntimeError as exc:
        print(f"venv: {exc}", file=sys.stderr, flush=True)
        return 1
    if status != "ok":
        print(f"venv: ready ({status})", file=sys.stderr, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
