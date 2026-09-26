#!/usr/bin/env python3
"""Apply one revert patch, run its test, print JSON red line. Restores tree after."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    proof_dir = Path(sys.argv[1])
    name = sys.argv[2]
    patch = proof_dir / f"{name}.patch"
    sidecar = proof_dir / f"{name}.json"
    data = json.loads(sidecar.read_text())
    test_id = data.get("testId")
    if not test_id:
        tf = data.get("testFile", "")
        tn = data.get("testName", "")
        test_id = f"{tf}::{tn}" if tf and tn else ""
    if not patch.is_file():
        print(f"skip {name}: no patch", file=sys.stderr)
        return
    subprocess.run(["git", "checkout", "--", "service", "web"], cwd=ROOT, check=True)
    r = subprocess.run(["git", "apply", str(patch)], cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr.decode(), file=sys.stderr)
        sys.exit(1)
    env = {**dict(__import__("os").environ), "PYTEST_ADDOPTS": "--no-cov -q"}
    cmd = ["python3", "-m", "pytest", test_id, "--tb=short"]
    pr = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True)
    subprocess.run(["git", "checkout", "--", "service", "web"], cwd=ROOT, check=True)
    out = pr.stdout + pr.stderr
    red = ""
    for line in out.splitlines():
        if "AssertionError" in line or "assert " in line and "Error" in line:
            red = line.strip()
        if line.strip().startswith("E   assert"):
            red = "AssertionError: " + line.strip()[2:].strip()
        if "KeyError" in line:
            red = line.strip()
    if not red and pr.returncode != 0:
        for line in reversed(out.splitlines()):
            if line.startswith("FAILED") or "Error" in line:
                red = line.strip()
                break
    print(json.dumps({"testId": test_id, "red": red, "exit": pr.returncode}))


if __name__ == "__main__":
    main()
