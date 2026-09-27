#!/usr/bin/env python3
"""Re-record revert-proofs/103 patches and redLine at current HEAD."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROOFS = ROOT / "revert-proofs" / "103"
WEB = ROOT / "web"


def run(cmd: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=cwd or ROOT, capture_output=True, text=True)


def vitest_one(test_file: str, test_name: str) -> tuple[int, str, int]:
    """Return exit code, combined output, num tests executed."""
    out_path = WEB / ".vitest-record-output.json"
    if out_path.exists():
        out_path.unlink()
    pattern = re.escape(test_name)
    proc = run(
        [
            "pnpm",
            "exec",
            "vitest",
            "run",
            test_file,
            "-t",
            pattern,
            "--reporter=json",
            "--outputFile=.vitest-record-output.json",
        ],
        cwd=WEB,
    )
    combined = (proc.stdout or "") + (proc.stderr or "")
    n = 0
    if out_path.exists():
        try:
            rep = json.loads(out_path.read_text())
            n = int(rep.get("numPassedTests", 0)) + int(rep.get("numFailedTests", 0))
            for tr in rep.get("testResults", []):
                for a in tr.get("assertionResults", []):
                    for m in a.get("failureMessages", []) or []:
                        combined += "\n" + m
        except json.JSONDecodeError:
            pass
    return proc.returncode, combined, n


def assertion_line(output: str) -> str | None:
    for line in output.splitlines():
        if line.startswith("AssertionError:"):
            return line.strip()
    return None


def apply_check(patch: Path) -> tuple[bool, str]:
    proc = run(["git", "apply", "-v", "--check", str(patch)])
    text = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        return False, text
    if re.search(r"\(offset \d+ line", text):
        return False, f"non-zero offset: {text}"
    return True, text


def record_patch(patch: Path, diff_text: str) -> None:
    patch.write_text(diff_text if diff_text.endswith("\n") else diff_text + "\n")


def git_diff(paths: list[str]) -> str:
    proc = run(["git", "diff", "--"] + paths)
    return proc.stdout or ""


def checkout(paths: list[str]) -> None:
    if paths:
        run(["git", "checkout", "--"] + paths)


def main() -> int:
    rows = sorted(p.stem for p in PROOFS.glob("*.json"))
    failures: list[str] = []

    for row in rows:
        meta_path = PROOFS / f"{row}.json"
        patch_path = PROOFS / f"{row}.patch"
        if not patch_path.exists():
            failures.append(f"{row}: missing patch")
            continue
        meta = json.loads(meta_path.read_text())
        tf = meta["testFile"]
        tn = meta["testName"]

        code, _, n = vitest_one(tf, tn)
        if n != 1:
            failures.append(f"{row}: baseline ran {n} tests (expected 1)")
            continue
        if code != 0:
            failures.append(f"{row}: baseline failed unpatched")
            continue

        ok, why = apply_check(patch_path)
        if not ok:
            failures.append(f"{row}: apply check: {why[:200]}")
            continue

        run(["git", "apply", str(patch_path)])
        code2, out2, n2 = vitest_one(tf, tn)
        run(["git", "apply", "-R", str(patch_path)])
        if n2 != 1:
            failures.append(f"{row}: patched ran {n2} tests")
            continue
        if code2 == 0:
            failures.append(f"{row}: patched still passes (survivor)")
            continue
        red = assertion_line(out2)
        if not red:
            failures.append(f"{row}: no AssertionError line")
            continue
        if meta.get("redLine") != red:
            meta["redLine"] = red
            meta_path.write_text(json.dumps(meta, indent=2) + "\n")
            print(f"{row}: updated redLine -> {red}")
        print(f"{row}: OK")

    if failures:
        print("\nFAILURES:", file=sys.stderr)
        for f in failures:
            print(f"  {f}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
