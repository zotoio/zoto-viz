#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def capture(proof_dir: Path, name: str) -> tuple[str, str, int]:
    patch = proof_dir / f"{name}.patch"
    sidecar = proof_dir / f"{name}.json"
    data = json.loads(sidecar.read_text())
    test_id = data.get("testId") or f"{data['testFile']}::{data['testName']}"
    if not patch.is_file():
        return test_id, "", -1
    subprocess.run(["git", "checkout", "--", "service", "web"], cwd=ROOT, check=True)
    r = subprocess.run(
        ["git", "apply", str(patch)],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        return test_id, f"patch failed: {r.stderr[:200]}", 2
    env = {**dict(__import__("os").environ), "PYTEST_ADDOPTS": "--no-cov -q"}
    runner = data.get("runner", "pytest")
    if runner == "vitest":
        node_id = test_id.split(" > ", 1)[-1] if " > " in test_id else test_id
        cmd = ["pnpm", "exec", "vitest", "run", "-t", node_id]
        pr = subprocess.run(cmd, cwd=ROOT / "web", env=env, capture_output=True, text=True)
    else:
        cmd = ["python3", "-m", "pytest", test_id, "--tb=short"]
        pr = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True)
    subprocess.run(["git", "checkout", "--", "service", "web"], cwd=ROOT, check=True)
    out = pr.stdout + pr.stderr
    red = ""
    for line in out.splitlines():
        if line.strip().startswith("E   AssertionError:"):
            red = line.strip()[2:].strip()
        elif line.strip().startswith("AssertionError:"):
            red = line.strip()
        elif "AssertionError" in line and "assert" in line:
            red = line.strip()
    if not red and pr.returncode != 0:
        m = re.search(r"(AssertionError:.*)", out)
        if m:
            red = m.group(1).strip()
    return test_id, red, pr.returncode


def main() -> None:
    import sys

    proof_dir = Path(sys.argv[1])
    for sidecar in sorted(proof_dir.glob("*.json")):
        name = sidecar.stem
        test_id, red, code = capture(proof_dir, name)
        data = json.loads(sidecar.read_text())
        if "testId" not in data or not data.get("testId"):
            data["testId"] = test_id
        if red and code != 0:
            data["red"] = red
        data.pop("testFile", None)
        data.pop("testName", None)
        sidecar.write_text(json.dumps(data, indent=2) + "\n")
        print(name, code, red[:80] if red else "NO RED")


if __name__ == "__main__":
    main()
