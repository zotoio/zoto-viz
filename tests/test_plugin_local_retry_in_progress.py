"""Retry returns in_progress when the pack install lock is already held."""
from __future__ import annotations

import threading
from pathlib import Path

import pytest

from service import plugin_local
from service.pack_install_retry import RETRY_RESULT_IN_PROGRESS
from service.plugin_install import (
    _install_zip_to_runtime_locked,
    pack_install_lock,
    reset_install_hooks_for_tests,
)

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


def test_concurrent_retry_blocked_zip_serializes_with_barrier(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    pid, v2_sha, _marker, _v2 = _blocked_v2_setup(tmp_path, monkeypatch)
    reset_install_hooks_for_tests()
    enter_install = threading.Event()
    release_install = threading.Event()
    install_calls = 0
    real_install = _install_zip_to_runtime_locked

    def gated_install(*args: object, **kwargs: object) -> object:
        nonlocal install_calls
        install_calls += 1
        enter_install.set()
        assert release_install.wait(timeout=5)
        return real_install(*args, **kwargs)

    monkeypatch.setattr(
        "service.plugin_install._install_zip_to_runtime_locked",
        gated_install,
    )
    results: list[dict] = []
    errors: list[BaseException] = []

    def worker() -> None:
        try:
            results.append(plugin_local.retry_blocked_zip_install(v2_sha, activate=False))
        except BaseException as e:
            errors.append(e)

    t1 = threading.Thread(target=worker, daemon=True)
    t2 = threading.Thread(target=worker, daemon=True)
    t1.start()
    t2.start()
    assert enter_install.wait(timeout=5)
    release_install.set()
    t1.join(timeout=15)
    t2.join(timeout=15)
    assert not errors
    assert install_calls == 1
    in_progress = [r for r in results if r.get("retryResult") == RETRY_RESULT_IN_PROGRESS]
    assert len(in_progress) == 1
