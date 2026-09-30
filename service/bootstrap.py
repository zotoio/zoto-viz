"""Consent-gated prerequisite bootstrap: gh, capture tools, venv, Node/pnpm.

Idempotent: skip items already OK; prompt before each install unless ``--yes`` / ``--dry-run``.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence, TextIO

from . import idle
from . import install as inst

Run = Callable[[list[str], Path | None], tuple[int, str, str]]


@dataclass(frozen=True)
class BootstrapItem:
    id: str
    label: str
    ok: bool
    detail: str
    manual: tuple[str, ...] = ()
    install_summary: str = ""
    install_argv: tuple[str, ...] = ()
    install_fn: str = ""
    risk: str = "system"  # system | local | interactive
    optional: bool = False


def _gh_which(host: inst.Host) -> str | None:
    return host.which("gh")


def _gh_auth_ok(run: Run) -> bool:
    if not shutil.which("gh"):
        return False
    code, _out, _err = run(["gh", "auth", "status"], None)
    return code == 0


def gather_bootstrap_items(host: inst.Host, run: Run | None = None) -> list[BootstrapItem]:
    run = run or inst._run_capture
    items: list[BootstrapItem] = []
    mgr = inst.pkg_manager(host)

    gh_path = _gh_which(host)
    if gh_path:
        authed = _gh_auth_ok(run)
        items.append(
            BootstrapItem(
                id="gh",
                label="GitHub CLI (gh)",
                ok=True,
                detail=gh_path,
            )
        )
        items.append(
            BootstrapItem(
                id="gh-auth",
                label="gh auth login (private plugin catalog)",
                ok=authed,
                detail="authenticated" if authed else "not logged in",
                manual=("Run: gh auth login",) if not authed else (),
                install_summary="gh auth login (device flow)",
                install_argv=("gh", "auth", "login", "--web"),
                risk="interactive",
                optional=True,
            )
        )
    else:
        manual = inst._manual_for("gh", host, mgr)
        argv: tuple[str, ...] = ()
        summary = "install GitHub CLI"
        if mgr == "brew":
            argv = ("brew", "install", "gh")
            summary = "brew install gh"
        elif mgr == "apt":
            argv = ("sudo", "apt-get", "install", "-y", "gh")
            summary = "apt install gh"
        elif mgr == "winget":
            argv = ("winget", "install", "-e", "--id", "GitHub.cli")
            summary = "winget install GitHub.cli"
        else:
            manual = (
                "macOS/Linux: https://cli.github.com/",
                'Or: curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg',
            )
        items.append(
            BootstrapItem(
                id="gh",
                label="GitHub CLI (gh)",
                ok=False,
                detail="not on PATH",
                manual=manual,
                install_summary=summary,
                install_argv=argv,
                risk="system",
                optional=True,
            )
        )

    saver_ok, saver_detail, saver_manual = idle.screensaver_tool_check(host.platform, host.which)
    items.append(
        BootstrapItem(
            id="screensaver",
            label="Screensaver / idle inhibit",
            ok=saver_ok,
            detail=saver_detail,
            manual=saver_manual,
            optional=True,
        )
    )

    core = inst.gather_checks(host, run)
    for check in core:
        if check.id in {"python", "node", "tshark", "brew"}:
            argv: tuple[str, ...] = ()
            summary = ""
            risk = "system"
            fn = ""
            if not check.ok and check.id == "tshark":
                pkg_argv = inst._os_package_argv(host, [check.id])
                if pkg_argv:
                    argv = tuple(pkg_argv)
                    summary = "install tshark / wireshark-cli"
            if not check.ok and check.id in {"python", "node"}:
                summary = f"install {check.label}"
            items.append(
                BootstrapItem(
                    id=check.id,
                    label=check.label,
                    ok=check.ok,
                    detail=check.detail,
                    manual=check.manual,
                    install_summary=summary,
                    install_argv=argv,
                    install_fn=fn,
                    risk=risk,
                    optional=not check.required,
                )
            )

    venv_py = inst.venv_python(host)
    venv_ok = venv_py.is_file()
    items.append(
        BootstrapItem(
            id="venv",
            label="Python venv (.venv)",
            ok=venv_ok,
            detail=str(venv_py) if venv_ok else "missing",
            install_summary="create .venv + pip install -r requirements.txt",
            install_fn="venv_and_pip",
            risk="local",
        )
    )

    pnpm_ok = inst._pnpm_works(host, run) if host.which("node") else False
    items.append(
        BootstrapItem(
            id="pnpm",
            label="pnpm (via corepack)",
            ok=pnpm_ok,
            detail="on PATH" if pnpm_ok else "missing or broken",
            install_summary="corepack enable && corepack prepare pnpm@latest --activate",
            install_fn="setup_pnpm",
            risk="local",
            optional=not bool(host.which("node")),
        )
    )
    return items


def format_bootstrap(items: Sequence[BootstrapItem]) -> str:
    lines = ["== Bootstrap prerequisites =="]
    for item in items:
        flag = "ok" if item.ok else ("optional" if item.optional else "MISSING")
        lines.append(f"  [{flag}] {item.label}: {item.detail}")
        if not item.ok and item.manual:
            lines.append("         manual:")
            for inst_line in item.manual:
                lines.append(f"           {inst_line}")
    return "\n".join(lines)


def _apply_item(item: BootstrapItem, host: inst.Host, run: Run) -> str:
    if item.install_fn == "venv_and_pip":
        inst.create_venv(host, run)
        inst.pip_install(host, run)
        return "venv + pip ok"
    if item.install_fn == "setup_pnpm":
        inst.setup_pnpm(host, run)
        return "pnpm ok"
    if item.install_argv:
        code, out, err = run(list(item.install_argv), host.root)
        if code != 0:
            raise RuntimeError((err or out).strip() or f"exit {code}")
        return (out or err).strip() or "ok"
    if item.risk == "interactive" and item.id == "gh-auth":
        code, out, err = run(["gh", "auth", "login", "--web"], None)
        if code != 0:
            raise RuntimeError((err or out).strip() or "gh auth login failed")
        return "gh authenticated"
    raise RuntimeError(f"no installer for {item.id}")


def cli_bootstrap(
    *,
    dry_run: bool = False,
    yes: bool = False,
    fix: bool = False,
    host: inst.Host | None = None,
    run: Run | None = None,
    stdin: TextIO | None = None,
    stdout: TextIO | None = None,
) -> int:
    host = host or inst.default_host()
    run = run or inst._run_capture
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout

    def emit(text: str) -> None:
        stdout.write(text + ("" if text.endswith("\n") else "\n"))

    host, node_note = inst.prefer_node(host, run)
    if node_note:
        os.environ["PATH"] = host.env_path
        emit(node_note)

    items = gather_bootstrap_items(host, run)
    emit(format_bootstrap(items))
    missing = [i for i in items if not i.ok and (fix or not i.optional or i.id in {"gh", "gh-auth"})]
    actionable = [i for i in missing if i.install_argv or i.install_fn or i.risk == "interactive"]

    if not actionable:
        emit("All checked prerequisites are satisfied.")
        return 0

    emit("")
    emit("== Bootstrap plan ==")
    for i, item in enumerate(actionable, 1):
        risk = item.risk.upper()
        emit(f"  {i}. {item.install_summary or item.label}  [{risk}]")
        if item.install_argv:
            emit(f"       $ {' '.join(item.install_argv)}")

    if dry_run:
        emit("(dry-run: nothing applied)")
        return 0

    failures: list[str] = []
    for item in actionable:
        if item.optional and item.id not in {"gh", "gh-auth", "tshark", "python", "node", "venv"}:
            continue
        if not yes:
            accepted = inst.prompt_yes(
                f"Install/fix {item.label}?",
                yes=False,
                isatty=host.isatty,
                stdin=stdin,
                stdout=stdout,
            )
            if not accepted:
                emit(f"  skipped {item.id}")
                continue
        emit(f"-> {item.install_summary or item.label}")
        try:
            result = _apply_item(item, host, run)
            emit(f"   {result}")
        except Exception as exc:
            msg = str(exc).strip() or item.id
            emit(f"   FAILED: {msg}")
            failures.append(f"{item.id}: {msg}")

    emit("")
    emit("Re-checking…")
    after = gather_bootstrap_items(host, run)
    emit(format_bootstrap(after))
    if failures:
        emit("Bootstrap finished with errors:")
        for line in failures:
            emit(f"  {line}")
        return 1
    still = [i for i in after if not i.ok and not i.optional]
    if still:
        emit("Some required items are still missing — see manual steps above.")
        return 1
    return 0
