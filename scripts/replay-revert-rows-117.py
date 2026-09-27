#!/usr/bin/env python3
"""Replay revert-proofs/117 rows: green unpatched, red patched, refresh sidecar redLine."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROWS = ROOT / "revert-proofs" / "117"
ARCHIVE_DOC = ROOT / "docs" / "revert-proofs-archive.md"
WEB = ROOT / "web"

ASSERTION_RE = re.compile(r"^AssertionError: .+$")


def revert_proofs_pr_tracked(pr: str) -> bool:
    """True only when git indexes revert-proofs/<pr>/ (ignore untracked workspace copies)."""
    out = subprocess.check_output(
        ["git", "ls-files", "--", f"revert-proofs/{pr}/"],
        cwd=ROOT,
        text=True,
    ).strip()
    return bool(out)


def run_vitest(test_file: str, test_name: str) -> tuple[int, str]:
    proc = subprocess.run(
        [
            "pnpm",
            "exec",
            "vitest",
            "run",
            f"src/app/__tests__/{test_file}",
            "-t",
            test_name,
            "--testTimeout=20000",
            "--maxWorkers=1",
        ],
        cwd=WEB,
        capture_output=True,
        text=True,
    )
    return proc.returncode, proc.stdout + proc.stderr


def extract_red(output: str) -> str:
    for line in output.splitlines():
        if line.startswith("AssertionError:"):
            return line.strip()
    for line in output.splitlines():
        m = re.search(r"(AssertionError: .+)$", line)
        if m:
            return m.group(1).strip()
    raise SystemExit(f"no AssertionError line in vitest output:\n{output[-4000:]}")


def git_apply(patch: Path, reverse: bool = False) -> None:
    cmd = ["git", "apply", "--whitespace=nowarn"]
    if reverse:
        cmd.append("-R")
    cmd.append(str(patch))
    subprocess.check_call(cmd, cwd=ROOT)


def main() -> None:
    if not revert_proofs_pr_tracked("117"):
        print(
            f"skip: revert-proofs/117/ not tracked (catch-up option b); "
            f"replay on refs/pull/117/head — see {ARCHIVE_DOC.relative_to(ROOT)}",
            file=sys.stderr,
        )
        return
    mapping = {
        "entry-connect-call": ("main-entry.connect.test.ts", "opens the live websocket and marks #conn ok"),
        "entry-ws-feed-state": ("main-entry.feed.test.ts", "applies websocket state to the demo LAN counters"),
        "entry-mode-picker-apply": (
            "main-entry.mode-picker.test.ts",
            "persists the picked view through applyMode on change",
        ),
        "entry-boot-async": ("main-entry.boot.test.ts", "finishes async boot and writes session live state"),
    }
    for slug, (test_file, test_name) in mapping.items():
        patch = ROWS / f"{slug}.patch"
        sidecar = ROWS / f"{slug}.json"
        if not patch.is_file():
            raise SystemExit(f"missing {patch}")
        code, out = run_vitest(test_file, test_name)
        if code != 0:
            raise SystemExit(f"unpatched {slug} should pass, exit {code}\n{out[-2000:]}")
        git_apply(patch)
        try:
            code, out = run_vitest(test_file, test_name)
            if code == 0:
                raise SystemExit(f"patched {slug} should fail\n{out[-2000:]}")
            red = extract_red(out)
            if not ASSERTION_RE.match(red):
                raise SystemExit(f"bad red line for {slug}: {red!r}")
            data = {
                "description": f"Revert production guard ({slug})",
                "runner": "vitest",
                "project": "web",
                "testFile": f"src/app/__tests__/{test_file}",
                "testName": test_name,
                "redLine": red,
            }
            sidecar.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
            print(f"OK {slug}: {red}")
        finally:
            git_apply(patch, reverse=True)
    print("all 117 rows replayed")


if __name__ == "__main__":
    main()
