"""The suite runs against a scratch HOME (tests/conftest.py), never the operator's ~/.zoto-viz."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from service import agent, nasa_api, paths, plugins, profiles, repo_sync, rf

pwd = pytest.importorskip("pwd")

REAL_HOME = Path(pwd.getpwuid(os.getuid()).pw_dir).resolve()
TEST_HOME = Path(os.environ["ZOTO_VIZ_TEST_HOME"]).resolve()


def _user_paths() -> dict[str, Path]:
    return {
        "paths._HOME": paths._HOME,
        "paths.user_dir()": paths.user_dir(),
        "paths.config_dir()": paths.config_dir(),
        "plugins.CONSENT_FILE": plugins.CONSENT_FILE,
        "repo_sync.status_file()": repo_sync.status_file(),
        "nasa_api._HOST_ENV": nasa_api._HOST_ENV,
        "rf.WATCH_FILE": rf.WATCH_FILE,
        "agent.AI_CONTROL_FILE": agent.AI_CONTROL_FILE,
        "profiles.DIR": profiles.DIR,
    }


def test_session_home_is_a_scratch_dir() -> None:
    assert TEST_HOME != REAL_HOME
    assert not TEST_HOME.is_relative_to(REAL_HOME)
    assert Path.home().resolve() == TEST_HOME


@pytest.mark.parametrize("name", sorted(_user_paths()))
def test_user_paths_live_under_session_home(name: str) -> None:
    path = _user_paths()[name].resolve()
    assert not path.is_relative_to(REAL_HOME), f"{name} = {path} is under the real home"
    assert path.is_relative_to(TEST_HOME), f"{name} = {path} is not under {TEST_HOME}"


@pytest.mark.parametrize("var", ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"])
def test_xdg_dirs_live_under_session_home(var: str) -> None:
    assert Path(os.environ[var]).resolve().is_relative_to(TEST_HOME)


def test_subprocesses_inherit_session_home() -> None:
    out = subprocess.run(
        [sys.executable, "-c", "from pathlib import Path; print(Path.home())"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    assert Path(out).resolve() == TEST_HOME
