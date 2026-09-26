"""Retry returns in_progress when the pack install lock is already held."""
from __future__ import annotations

from pathlib import Path

import pytest

from service import plugin_local
from service.pack_install_retry import RETRY_RESULT_IN_PROGRESS
from service.plugin_install import pack_install_lock, reset_install_hooks_for_tests

from tests.test_plugin_install import _blocked_v2_setup


def test_retry_returns_in_progress_when_pack_lock_held(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    pid, v2_sha, _marker, _v2 = _blocked_v2_setup(tmp_path, monkeypatch)
    reset_install_hooks_for_tests()
    lock = pack_install_lock(pid)
    assert lock.acquire(blocking=False)
    try:
        info = plugin_local.retry_blocked_zip_install(v2_sha, activate=False)
        assert info.get("retryResult") == RETRY_RESULT_IN_PROGRESS
        assert info.get("error") == "retry_in_progress"
    finally:
        lock.release()
