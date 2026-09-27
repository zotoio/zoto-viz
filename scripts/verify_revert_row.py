#!/usr/bin/env python3
"""Verify one revert-proof row: apply --check, run single test unpatched/patched."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)


def main() -> None:
    row_json = Path(sys.argv[1])
    meta = json.loads(row_json.read_text(encoding="utf-8"))
    patch = row_json.with_suffix(".patch")
    test_file = meta["testFile"]
    test_name = meta["testName"]
    runner = meta.get("runner", "pytest")
    expected = meta["patchedFailure"]

    r = run(["git", "apply", "--check", str(patch)])
    if r.returncode != 0:
        print("APPLY_CHECK_FAIL", r.stderr)
        sys.exit(1)

    if runner == "pytest":
        node = f"{test_file}::{test_name}" if "::" not in test_name else f"{test_file}::{test_name}"
        base = run([".venv/bin/python", "-m", "pytest", "-q", "-o", "addopts=", node, "--maxfail=1"])
        if base.returncode != 0:
            print("BASE_FAIL", base.stdout, base.stderr)
            sys.exit(1)
        run(["git", "apply", str(patch)])
        red = run([".venv/bin/python", "-m", "pytest", "-q", "-o", "addopts=", node, "--maxfail=1"])
        run(["git", "checkout", "--"] + [p for p in run(["git", "diff", "--name-only"]).stdout.split()])
        if red.returncode == 0:
            print("PATCH_DID_NOT_FAIL")
            sys.exit(1)
        if expected not in (red.stdout + red.stderr):
            print("RED_MISMATCH", expected, red.stdout[-500:], red.stderr[-500:])
            sys.exit(1)
    else:
        base = run(["pnpm", "exec", "vitest", "run", test_file, "-t", test_name, "--maxWorkers=1"],)
        if base.returncode != 0:
            print("BASE_FAIL", base.stdout, base.stderr)
            sys.exit(1)
        run(["git", "apply", str(patch)])
        red = run(
            ["pnpm", "exec", "vitest", "run", test_file, "-t", test_name, "--maxWorkers=1"],
        )
        run(["git", "checkout", "--"] + [p for p in run(["git", "diff", "--name-only"]).stdout.split()])
        if red.returncode == 0:
            print("PATCH_DID_NOT_FAIL")
            sys.exit(1)
        if expected not in (red.stdout + red.stderr):
            print("RED_MISMATCH", expected)
            sys.exit(1)
    print("OK", row_json.name)


if __name__ == "__main__":
    main()
