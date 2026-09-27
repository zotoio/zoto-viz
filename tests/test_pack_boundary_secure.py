from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

from scripts.check_pack_pr_boundary import (
    GITHUB_PULL_FILES_API_MAX,
    PACK_PR_HOST_INFRA_FAIL,
    run_check,
    run_secure_ci_check,
    validate_pull_changed_files_complete,
)
from scripts.pack_boundary_safe_io import (
    PACK_BOUNDARY_MAX_FILE_BYTES,
    WorkflowSafePrinter,
    read_regular_file_under_root,
    scan_pr_head_tree,
    validate_changed_paths,
)

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_secure_dry_run_weakened_pr_checker_on_disk_still_fails(tmp_path: Path) -> None:
    """(a) PR head may contain a noop boundary script; the base process still enforces rules."""
    pr_head = tmp_path / "pr_head"
    scripts_dir = pr_head / "scripts"
    scripts_dir.mkdir(parents=True)
    (scripts_dir / "check_pack_pr_boundary.py").write_text(
        "def run_check(*_a, **_k):\n    return 0, ['pack-boundary: passed.']\n"
    )
    changed = [
        "plugins/src/ant-colony/plugin.yml",
        "plugins/src/metro-lines/plugin.yml",
        ".github/workflows/ci.yml",
    ]
    err = scan_pr_head_tree(pr_head, changed)
    assert err is None
    code, lines = run_check(changed, {}, pr_number=1, allow_host_infra=False)
    assert code == 1
    assert any(PACK_PR_HOST_INFRA_FAIL in line or "host infra" in line for line in lines)


def test_secure_dry_run_rejects_symlink_in_pr_head(tmp_path: Path) -> None:
    """(b) Symlink under PR head tree fails the required check."""
    pr_head = tmp_path / "pr_head"
    pack_dir = pr_head / "plugins/src/demo-pack"
    pack_dir.mkdir(parents=True)
    (pack_dir / "plugin.yml").write_text("id: demo-pack\n")
    target = REPO_ROOT / "scripts/check_pack_pr_boundary.py"
    link = pack_dir / "escape-link"
    link.symlink_to(target)
    changed = ["plugins/src/demo-pack/escape-link"]
    err = scan_pr_head_tree(pr_head, changed)
    assert err is not None
    assert "symlink" in err.lower()


def test_secure_dry_run_github_env_write_escaped(tmp_path: Path) -> None:
    """(g) PR-derived values appended to GITHUB_ENV use delimiter escaping, not raw newlines."""
    env_path = tmp_path / "github_env"
    env_path.write_text("", encoding="utf-8")
    printer = WorkflowSafePrinter()
    evil = "plugins/demo\nMALICIOUS=1"
    printer.append_github_env("PACK_BOUNDARY_NOTE", evil, path=str(env_path))
    body = env_path.read_text(encoding="utf-8")
    lines = body.splitlines()
    assert lines[0].startswith("PACK_BOUNDARY_NOTE=<<PACK_BOUNDARY_")
    delim = lines[0].split("<<", 1)[1]
    assert lines[-1] == delim
    assert "\n".join(lines[1:-1]) == evil


def test_secure_dry_run_workflow_command_injection_escaped(capsys: pytest.CaptureFixture[str]) -> None:
    """(c) PR-derived paths with leading :: are escaped; stop-commands wraps output."""
    printer = WorkflowSafePrinter()
    evil = "::error title=pass::ok.js"
    assert WorkflowSafePrinter.escape_line(evil).startswith("%::")
    printer.write_lines([f"{evil}: outside pack folder"])
    out = capsys.readouterr().out
    assert "::stop-commands::" in out
    assert f"::{printer._token}::" in out


def test_secure_dry_run_rejects_newline_in_filename() -> None:
    """(d) Control characters in API paths fail before any env/output side effects."""
    bad = "plugins/src/demo-pack/plugin.yml\nNODE_OPTIONS=--require ./x.js"
    assert validate_changed_paths([bad]) is not None
    env_before = dict(os.environ)
    try:
        os.environ["NODE_OPTIONS"] = "--require ./x.js"
        assert validate_changed_paths([bad]) is not None
    finally:
        os.environ.clear()
        os.environ.update(env_before)


def test_secure_dry_run_rejects_oversized_pr_head_file(tmp_path: Path) -> None:
    """(e) Files over the read cap fail closed."""
    pr_head = tmp_path / "pr_head"
    target = pr_head / "web/tsconfig.json"
    target.parent.mkdir(parents=True)
    over = 1_048_576
    target.write_bytes(b"x" * (over + 1))
    rejected = False
    try:
        read_regular_file_under_root(pr_head, "web/tsconfig.json", max_bytes=over)
    except ValueError as exc:
        rejected = "exceeds size cap" in str(exc)
    assert rejected is True


def test_secure_dry_run_rejects_at_api_file_limit() -> None:
    """(f) At the 3000-file API ceiling the check fails closed."""
    limit = GITHUB_PULL_FILES_API_MAX
    err = validate_pull_changed_files_complete(["f"] * limit, limit)
    assert err is not None
    assert str(limit) in err


def test_secure_dry_run_rejects_incomplete_api_page() -> None:
    """(f) Incomplete pulls/files listing vs changed_files fails closed."""
    err = validate_pull_changed_files_complete(["only-one"], 2)
    assert err is not None
    assert "incomplete" in err


def test_pack_boundary_cli_runs_from_repo_root_like_workflow() -> None:
    proc = subprocess.run(
        [sys.executable, "scripts/check_pack_pr_boundary.py", "--help"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert "pack-boundary" in proc.stdout.lower() or "pack PR" in proc.stdout


def test_secure_ci_check_mocked_api_uses_pr_head_tree(tmp_path: Path) -> None:
    pr_head = tmp_path / "pr_head"
    pack = pr_head / "plugins/src/demo-pack"
    pack.mkdir(parents=True)
    (pack / "plugin.yml").write_text("id: demo-pack\n")
    changed = ["plugins/src/demo-pack/plugin.yml"]
    with patch(
        "scripts.check_pack_pr_boundary.load_pr_review_context",
        return_value=(set(), [], None),
    ), patch(
        "scripts.check_pack_pr_boundary.fetch_pull_changed_files",
        return_value=changed,
    ), patch(
        "scripts.check_pack_pr_boundary.fetch_pull_boundary_paths",
        return_value=changed,
    ), patch(
        "scripts.check_pack_pr_boundary.fetch_pull_changed_files_count",
        return_value=1,
    ):
        code = run_secure_ci_check(
            "org/repo",
            1,
            "token",
            REPO_ROOT,
            pr_head,
            printer=WorkflowSafePrinter(),
        )
    assert code == 0
