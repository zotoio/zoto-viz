#!/usr/bin/env python3
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


def run(cmd: list[str], cwd: Path = ROOT, timeout: int = 600):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)


def checkout_web(ref: str) -> None:
    run(["git", "checkout", "-f", ref, "--", "web", "plugins"])
    run(["git", "clean", "-fd", "web", "plugins"])


def sidecars(base: str, head: str) -> list[Path]:
    out = run(["git", "diff", f"{base}...{head}", "--name-only", "--", "revert-proofs/27"]).stdout
    return sorted(ROOT / ln for ln in out.splitlines() if ln.endswith(".json"))


def vitest_row(tf: str, tn: str) -> tuple[int, str | None]:
    r = run(["pnpm", "exec", "vitest", "run", tf, "-t", tn], cwd=WEB, timeout=300)
    out = r.stdout + r.stderr
    if r.returncode == 0:
        return 0, None
    m = re.search(r"(AssertionError: .+)", out)
    return r.returncode, (m.group(1).rstrip() if m else None)


def patch_minus_plus(patch: Path) -> tuple[list[str], list[str]]:
    minus, plus = [], []
    for ln in patch.read_text().splitlines():
        if ln.startswith("-") and not ln.startswith("---"):
            minus.append(ln[1:])
        elif ln.startswith("+") and not ln.startswith("+++"):
            plus.append(ln[1:])
    return minus, plus


def validate_patch(row: str, patch: Path) -> list[str]:
    errs = []
    minus, plus = patch_minus_plus(patch)
    if not minus:
        errs.append(f"{row}: no `-` hunk lines")
    m = re.search(r"^\+\+\+ b/(\S+)", patch.read_text(), re.M)
    if not m:
        return errs
    text = (ROOT / m.group(1)).read_text()
    for line in minus:
        if line not in text:
            errs.append(f"{row}: missing production line: {line[:72]!r}")
    return errs


def main() -> None:
    dup = run(["bash", "-lc", "sha256sum revert-proofs/27/*.patch | sort | uniq -D -w64"]).stdout.strip()
    print("=== (b) sha256sum revert-proofs/27/*.patch | sort | uniq -D -w64 ===")
    print(dup or "(empty — no duplicate hashes)")
    if dup:
        sys.exit(1)

    mismatches: list[tuple[str, str, str]] = []
    shape: list[str] = []

    for split, base, head in SPLITS:
        print(f"\n=== (c) row gates {split} @ {head[:8]} ===")
        checkout_web(head)
        for sc in sidecars(base, head):
            patch = sc.with_suffix(".patch")
            if not patch.exists():
                continue
            row = sc.stem
            shape.extend(validate_patch(row, patch))
            d = json.loads(sc.read_text())
            expected = d["patchedAssertion"]
            tf, tn = d["testFile"], d["testName"]
            checkout_web(head)
            if run(["patch", "-p1", "-i", str(patch)]).returncode != 0:
                mismatches.append((row, expected, "PATCH_APPLY_FAILED"))
                continue
            _, measured = vitest_row(tf, tn)
            checkout_web(head)
            if not measured:
                mismatches.append((row, expected, "NO_ASSERTION"))
                print(f"FAIL {row}: no AssertionError")
            elif measured != expected:
                print(f"MISMATCH {row}\n  sidecar:   {expected}\n  measured:  {measured}")
                mismatches.append((row, expected, measured))
            else:
                print(f"OK {row}")

    if shape:
        print("\n=== (b) patch shape ===")
        for e in shape:
            print(e)
    if mismatches:
        for row, exp, got in mismatches:
            if got not in ("PATCH_APPLY_FAILED", "NO_ASSERTION"):
                print(f"\n--- {row} ---\n sidecar:  {exp}\n measured: {got}")
        sys.exit(2)
    if shape:
        sys.exit(3)
    print("\nAll TSE (b)(c) gates passed")


if __name__ == "__main__":
    main()
