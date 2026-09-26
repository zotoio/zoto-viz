#!/usr/bin/env python3
"""Remove-one-hunk sweep: each production hunk alone reverted must turn pack tests red."""
from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = "cursor/pr-b-install-retry-6122"
CANARY = (
    "tests/test_pack_safe_zip_install.py",
    "tests/test_pack_zip_install_ux.py",
)


@dataclass
class Hunk:
    file: str
    index: int
    header: str
    body: str


def production_files() -> list[str]:
    out = subprocess.check_output(
        ["git", "diff", "--name-only", f"{BASE}...HEAD", "--", "service/", "web/src"],
        cwd=ROOT,
        text=True,
    )
    return [ln.strip() for ln in out.splitlines() if ln.strip()]


def split_hunks(path: str, diff: str) -> list[Hunk]:
    parts = re.split(r"(?=^@@ )", diff, flags=re.MULTILINE)
    hunks: list[Hunk] = []
    idx = 0
    for part in parts:
        if not part.startswith("@@"):
            continue
        idx += 1
        lines = part.splitlines()
        hunks.append(Hunk(path, idx, lines[0], "\n".join(lines[1:]) + "\n"))
    return hunks


def invert_hunk(h: Hunk) -> str:
    lines: list[str] = []
    for line in h.body.splitlines(keepends=True):
        if line.startswith("+") and not line.startswith("+++"):
            lines.append("-" + line[1:])
        elif line.startswith("-") and not line.startswith("---"):
            lines.append("+" + line[1:])
        else:
            lines.append(line)
    return f"--- a/{h.file}\n+++ b/{h.file}\n{h.header}\n" + "".join(lines)


def run_canary() -> int:
    r = subprocess.run(
        [sys.executable, "-m", "pytest", *CANARY, "--no-cov", "-q"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    return r.returncode


def main() -> None:
    all_hunks: list[Hunk] = []
    for path in production_files():
        diff = subprocess.check_output(
            ["git", "diff", f"{BASE}...HEAD", "--", path],
            cwd=ROOT,
            text=True,
        )
        all_hunks.extend(split_hunks(path, diff))

    baseline = run_canary()
    if baseline != 0:
        print("baseline canary not green", file=sys.stderr)
        sys.exit(1)

    print(f"hunks={len(all_hunks)} canary=green")
    green_when_removed: list[str] = []
    for h in all_hunks:
        patch = invert_hunk(h)
        p = ROOT / ".sweep-hunk.patch"
        p.write_text(patch, encoding="utf-8")
        applied = subprocess.run(["git", "apply", str(p)], cwd=ROOT, capture_output=True)
        if applied.returncode != 0:
            print(f"SKIP {h.file}#{h.index} apply-fail")
            p.unlink(missing_ok=True)
            continue
        code = run_canary()
        subprocess.run(["git", "checkout", "--", h.file], cwd=ROOT, check=True)
        p.unlink(missing_ok=True)
        tag = f"{h.file}#{h.index} {h.header}"
        if code == 0:
            green_when_removed.append(tag)
            print(f"WARN {tag} -> canary stayed GREEN")
        else:
            print(f"OK   {tag} -> canary RED")

    if green_when_removed:
        print(f"\n{len(green_when_removed)} hunks removed without failing canary (see WARN lines)")
        sys.exit(2)
    print("\nAll hunks: removing any one alone fails canary.")


if __name__ == "__main__":
    main()
