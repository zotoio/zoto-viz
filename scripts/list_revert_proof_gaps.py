#!/usr/bin/env python3
"""List pytest node ids missing revert-proofs/80 rows (changed tests vs BASE)."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = sys.argv[1] if len(sys.argv) > 1 else "6520b01"
PROOF = ROOT / "revert-proofs/80"


def main() -> None:
    r = subprocess.run(
        ["git", "diff", f"{BASE}..HEAD", "--name-only"],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    test_files = [f for f in r.stdout.splitlines() if f.startswith("tests/test_") and f.endswith(".py")]
    existing = set()
    for j in PROOF.glob("*.json"):
        d = json.loads(j.read_text())
        tid = d.get("testId")
        if tid:
            existing.add(tid)
    collected: set[str] = set()
    env = {**dict(__import__("os").environ), "PYTEST_ADDOPTS": "--no-cov"}
    for tf in sorted(test_files):
        pr = subprocess.run(
            [sys.executable, "-m", "pytest", tf, "--collect-only", "-q"],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
        )
        for line in pr.stdout.splitlines():
            m = re.match(r"^([^\s]+::[^\s]+)", line.strip())
            if m:
                collected.add(m.group(1))
    missing = sorted(collected - existing)
    print(f"changed test files: {len(test_files)}")
    print(f"collected: {len(collected)} proofs: {len(existing)} missing: {len(missing)}")
    for tid in missing:
        print(tid)


if __name__ == "__main__":
    main()
