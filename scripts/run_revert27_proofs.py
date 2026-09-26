#!/usr/bin/env python3
"""Verify revert-proofs/27 rows: 1 test pass green, apply patch → 1 fail with AssertionError."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROOF_DIR = ROOT / "revert-proofs" / "27"
WEB = ROOT / "web"


def run_vitest(test_file: str, test_name: str) -> subprocess.CompletedProcess[str]:
    rel = test_file.removeprefix("web/").removeprefix("src/")
    tf = f"src/{rel}" if not rel.startswith("src/") else rel
    cmd = [
        "pnpm",
        "exec",
        "vitest",
        "run",
        tf,
        "-t",
        test_name,
    ]
    return subprocess.run(cmd, cwd=WEB, capture_output=True, text=True)


def git_apply(patch: Path, reverse: bool = False) -> subprocess.CompletedProcess[str]:
    cmd = ["git", "apply", "--whitespace=nowarn"]
    if reverse:
        cmd.append("-R")
    cmd.append(str(patch))
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)


def extract_assertion(output: str) -> str | None:
    for line in output.splitlines():
        if line.strip().startswith("AssertionError:"):
            return line.strip()
    m = re.search(r"(AssertionError:[^\n]+)", output)
    return m.group(1).strip() if m else None


def main() -> int:
    only = sys.argv[1:] if len(sys.argv) > 1 else []
    failures: list[str] = []
    updated = 0

    for json_path in sorted(PROOF_DIR.glob("*.json")):
        slug = json_path.stem
        if only and slug not in only:
            continue
        patch_path = PROOF_DIR / f"{slug}.patch"
        if not patch_path.is_file():
            failures.append(f"{slug}: missing patch")
            continue
        meta = json.loads(json_path.read_text())
        if meta.get("runner") != "vitest":
            continue
        test_file = meta["testFile"]
        if test_file.startswith("web/"):
            meta["testFile"] = test_file.removeprefix("web/")
        test_name = meta["testName"]

        check = subprocess.run(
            ["git", "apply", "--check", str(patch_path)],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        if check.returncode != 0:
            failures.append(f"{slug}: patch does not apply: {check.stderr.strip()}")
            continue

        green = run_vitest(meta["testFile"], test_name)
        if green.returncode != 0:
            failures.append(f"{slug}: unpatched test did not pass\n{green.stdout}\n{green.stderr}")
            continue

        applied = git_apply(patch_path)
        if applied.returncode != 0:
            failures.append(f"{slug}: git apply failed: {applied.stderr}")
            continue
        try:
            red = run_vitest(meta["testFile"], test_name)
            if red.returncode == 0:
                failures.append(f"{slug}: patched test still passed")
                continue
            assertion = extract_assertion(red.stdout + red.stderr)
            if not assertion:
                failures.append(f"{slug}: no AssertionError in output\n{red.stdout}\n{red.stderr}")
                continue
            if meta.get("patchedAssertion") != assertion:
                meta["patchedAssertion"] = assertion
                json_path.write_text(json.dumps(meta, indent=2) + "\n")
                updated += 1
        finally:
            rev = git_apply(patch_path, reverse=True)
            if rev.returncode != 0:
                failures.append(f"{slug}: failed to reverse patch: {rev.stderr}")
                subprocess.run(["git", "apply", "-R", str(patch_path)], cwd=ROOT)

    print(f"Updated {updated} sidecar(s)")
    if failures:
        print("FAILURES:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("All rows OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
