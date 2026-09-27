#!/usr/bin/env python3
"""Row gate: patched full test-file run must red on sidecar test (QE #42/#86 item 2)."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/workspace")
WEB = ROOT / "web"
SPLITS = [
    ("27a", "6520b01", "4a1e647d"),
    ("27b", "4a1e647d", "e4d64961"),
    ("27c", "e4d64961", "6678a61b"),
]


def run(cmd: list[str], cwd: Path = ROOT, timeout: int = 600) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)


def checkout_web(ref: str) -> None:
    run(["git", "checkout", "-f", ref, "--", "web", "plugins"])
    run(["git", "clean", "-fd", "web", "plugins"])


def sidecars(base: str, head: str) -> list[Path]:
    out = run(["git", "diff", f"{base}...{head}", "--name-only", "--", "revert-proofs/27"]).stdout
    return sorted(ROOT / ln for ln in out.splitlines() if ln.endswith(".json"))


def vitest_full_file(tf: str, test_name_re: str) -> tuple[int, str, str | None]:
    r = run(["pnpm", "exec", "vitest", "run", tf], cwd=WEB, timeout=300)
    out = r.stdout + r.stderr
    pat = re.compile(test_name_re)
    assertion = None
    matched = False
    for block in re.split(r"\n(?= FAIL )", out):
        if " FAIL " not in block:
            continue
        header = block.split("\n", 1)[0]
        if not pat.search(header):
            continue
        matched = True
        m = re.search(r"(AssertionError: .+)", block)
        if m:
            assertion = m.group(1).rstrip()
            break
    summary = ""
    for ln in out.splitlines():
        if ln.strip().startswith("Test Files") or ln.strip().startswith("Tests "):
            summary = ln.strip()
    if not matched and r.returncode != 0:
        # fallback: any assertion in file run
        m = re.search(r"(AssertionError: .+)", out)
        assertion = m.group(1).rstrip() if m else None
    return r.returncode, summary, assertion if matched else (None if r.returncode else assertion)


def main() -> None:
    failures: list[str] = []
    for split, base, head in SPLITS:
        print(f"\n=== full-file row gates {split} @ {head[:8]} ===")
        checkout_web(head)
        for sc in sidecars(base, head):
            patch = sc.with_suffix(".patch")
            if not patch.exists():
                continue
            row = sc.stem
            d = json.loads(sc.read_text())
            expected = d["patchedAssertion"]
            tf, tn = d["testFile"], d["testName"]
            if run(["git", "apply", "--check", "-p1", str(patch)]).returncode != 0:
                failures.append(f"{row}: git apply --check failed")
                print(f"FAIL {row}: apply --check")
                continue
            checkout_web(head)
            if run(["git", "apply", "-p1", str(patch)]).returncode != 0:
                failures.append(f"{row}: git apply failed")
                print(f"FAIL {row}: apply")
                continue
            code, summary, measured = vitest_full_file(tf, tn)
            checkout_web(head)
            if code == 0:
                failures.append(f"{row}: full file passed when patched")
                print(f"FAIL {row}: full-file GREEN ({summary})")
            elif not measured:
                failures.append(f"{row}: no AssertionError in full-file run")
                print(f"FAIL {row}: no assertion ({summary})")
            elif measured != expected:
                print(f"MISMATCH {row} full-file\n  sidecar:  {expected}\n  measured: {measured}\n  {summary}")
                failures.append(f"{row}: assertion mismatch full-file")
            else:
                print(f"OK {row} | {summary} | {measured[:72]}…")

    if failures:
        sys.exit(1)
    print("\nAll full-file row gates passed.")


if __name__ == "__main__":
    main()
