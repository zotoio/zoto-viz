from __future__ import annotations

import io

import pytest

from service import bootstrap
from service import install as inst


def _host(tmp_path, **kwargs):
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    root = tmp_path / "repo"
    root.mkdir(exist_ok=True)
    (root / "requirements.txt").write_text("pyyaml\n", encoding="utf-8")
    defaults = dict(
        root=root,
        home=home,
        platform="linux",
        python=(3, 12, 3),
        executable="/usr/bin/python3",
        which=lambda name: {
            "node": "/usr/bin/node",
            "tshark": "/usr/bin/tshark",
            "ip": "/usr/bin/ip",
            "gh": "/usr/bin/gh",
            "systemd-inhibit": "/usr/bin/systemd-inhibit",
        }.get(name),
        env_path="/usr/bin",
        euid=1000,
        isatty=False,
    )
    defaults.update(kwargs)
    return inst.Host(**defaults)


def test_gather_bootstrap_reports_gh_auth(tmp_path) -> None:
    host = _host(tmp_path)

    def run(cmd, cwd):
        if cmd[:3] == ["gh", "auth", "status"]:
            return 1, "", "not logged in"
        if cmd[:2] == ["node", "-v"]:
            return 0, "v22.14.0\n", ""
        return 0, "", ""

    items = bootstrap.gather_bootstrap_items(host, run)
    by_id = {i.id: i for i in items}
    assert by_id["gh"].ok
    assert not by_id["gh-auth"].ok
    assert by_id["screensaver"].ok
    assert by_id["screensaver"].detail == "systemd-inhibit (/usr/bin/systemd-inhibit)"


def test_gather_bootstrap_reports_gh_auth_without_systemd_inhibit(tmp_path) -> None:
    """#221: a host without systemd-inhibit still reports gh auth; the screensaver row says what is missing."""
    tools = {"node": "/usr/bin/node", "tshark": "/usr/bin/tshark", "ip": "/usr/bin/ip", "gh": "/usr/bin/gh"}
    host = _host(tmp_path, which=tools.get)

    def run(cmd, cwd):
        if cmd[:3] == ["gh", "auth", "status"]:
            return 1, "", "not logged in"
        if cmd[:2] == ["node", "-v"]:
            return 0, "v22.14.0\n", ""
        return 0, "", ""

    by_id = {i.id: i for i in bootstrap.gather_bootstrap_items(host, run)}
    assert by_id["gh"].ok
    assert not by_id["gh-auth"].ok
    saver = by_id["screensaver"]
    assert (saver.ok, saver.detail, saver.optional) == (False, "systemd-inhibit not on PATH", True)
    assert saver.manual == ("Install systemd (systemd-inhibit) or use xset on X11.",)


def test_bootstrap_dry_run(tmp_path) -> None:
    host = _host(tmp_path, which=lambda n: None)

    def run(cmd, cwd):
        if cmd[:2] == ["node", "-v"]:
            return 0, "v22.14.0\n", ""
        return 1, "", ""

    buf = io.StringIO()
    code = bootstrap.cli_bootstrap(dry_run=True, host=host, run=run, stdin=io.StringIO(""), stdout=buf)
    assert code == 0
    out = buf.getvalue()
    assert "dry-run" in out
    assert "gh" in out.lower()


def test_format_bootstrap_lists_missing() -> None:
    items = [
        bootstrap.BootstrapItem("gh", "GitHub CLI", False, "missing", ("brew install gh",)),
    ]
    text = bootstrap.format_bootstrap(items)
    assert "[MISSING] GitHub CLI" in text
    assert "brew install gh" in text
