#!/usr/bin/env python3
"""Manually verify revert-proofs/45 rows (no revert-proof.mjs)."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PROOFS = REPO / "revert-proofs" / "45"


def run(cmd: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=cwd or REPO,
        text=True,
        capture_output=True,
    )


def excerpt_failure(stdout: str, stderr: str) -> str:
    blob = stdout + "\n" + stderr
    for line in blob.splitlines():
        s = line.strip()
        if "AssertionError" in s:
            return s[:240]
    for line in blob.splitlines():
        s = line.strip()
        if "assert" in s.lower() and ("AssertionError" in blob or "expected" in s):
            return s[:240]
    for line in blob.splitlines():
        s = line.strip()
        if "AssertionError:" in s or re.search(r"assert .*==", s):
            return s[:240]
    for line in blob.splitlines():
        s = line.strip()
        if "toThrow" in s or "expected" in s:
            return s[:240]
    lines = [ln.strip() for ln in blob.splitlines() if ln.strip()]
    return lines[-1][:240] if lines else "(no output)"


def single_test_count_line(runner: str, stdout: str, stderr: str) -> str:
    blob = stdout + "\n" + stderr
    if runner == "pytest":
        for line in blob.splitlines():
            s = line.strip()
            if re.search(r"^\d+ (passed|failed)", s) and " in " in s:
                return s
        raise ValueError(f"no pytest summary line in:\n{blob[-500:]}")
    for line in blob.splitlines():
        s = line.strip()
        if s.startswith("Tests") and ("passed" in s or "failed" in s):
            return s
    raise ValueError(f"no vitest Tests summary line in:\n{blob[-500:]}")


def assert_exactly_one(runner: str, summary: str, outcome: str) -> None:
    """outcome: 'passed' or 'failed'."""
    if runner == "pytest":
        m = re.match(r"(\d+) (passed|failed)", summary)
        if not m:
            raise ValueError(f"bad pytest summary: {summary}")
        n, kind = int(m.group(1)), m.group(2)
        if n != 1 or kind != outcome:
            raise ValueError(f"expected 1 {outcome}, got: {summary}")
        return
    if outcome == "passed":
        if not re.search(r"\b1 passed\b", summary):
            raise ValueError(f"expected Tests 1 passed, got: {summary}")
        if re.search(r"\b\d+ failed\b", summary) and not re.search(r"\b0 failed\b", summary):
            if "1 failed" in summary:
                raise ValueError(f"expected no failures on green, got: {summary}")
    else:
        if not re.search(r"\b1 failed\b", summary):
            raise ValueError(f"expected Tests 1 failed, got: {summary}")


def vitest_name_pattern(full_name: str) -> str:
    return "^" + re.escape(full_name) + "$"


def clear_script_pycache() -> None:
    cache = REPO / "scripts" / "__pycache__"
    if cache.is_dir():
        shutil.rmtree(cache)


def run_test(row: dict) -> subprocess.CompletedProcess[str]:
    if row["runner"] == "pytest":
        clear_script_pycache()
        node = f"{row['testFile']}::{row['testName']}"
        return run([sys.executable, "-m", "pytest", node, "-q", "--no-cov"])
    rel = row["testFile"]
    if rel.startswith("web/"):
        rel = rel[4:]
    pattern = vitest_name_pattern(row["testName"])
    return run(
        [
            "pnpm",
            "exec",
            "vitest",
            "run",
            rel,
            "-t",
            pattern,
        ],
        cwd=REPO / "web",
    )


def patched_files(patch_text: str) -> list[str]:
    return re.findall(r"^\+\+\+ b/(.*)$", patch_text, re.MULTILINE)


def main() -> int:
    head = run(["git", "rev-parse", "--short", "HEAD"]).stdout.strip()
    rows: list[tuple[str, dict]] = []
    for path in sorted(PROOFS.glob("*.json")):
        rows.append((path.stem, json.loads(path.read_text(encoding="utf-8"))))

    report: dict[str, dict[str, str]] = {}
    failures: list[str] = []

    for slug, meta in rows:
        patch_path = PROOFS / f"{slug}.patch"
        patch = patch_path.read_text(encoding="utf-8")
        files = patched_files(patch)
        runner = meta["runner"]

        check = run(["git", "apply", "--check", str(patch_path)])
        if check.returncode != 0:
            failures.append(f"{slug}: patch does not apply: {check.stderr.strip()}")
            continue

        green = run_test(meta)
        try:
            green_line = single_test_count_line(runner, green.stdout, green.stderr)
            assert_exactly_one(runner, green_line, "passed")
        except ValueError as exc:
            failures.append(f"{slug}: green count: {exc}")
            continue
        if green.returncode != 0:
            failures.append(f"{slug}: green failed:\n{green.stdout}\n{green.stderr}")
            continue

        apply = run(["git", "apply", str(patch_path)])
        if apply.returncode != 0:
            failures.append(f"{slug}: git apply failed: {apply.stderr}")
            continue

        red = run_test(meta)
        for f in files:
            run(["git", "checkout", "--", f])

        try:
            red_line = single_test_count_line(runner, red.stdout, red.stderr)
            assert_exactly_one(runner, red_line, "failed")
        except ValueError as exc:
            failures.append(f"{slug}: red count: {exc}")
            continue

        if red.returncode == 0:
            failures.append(f"{slug}: expected red, test passed")
            continue

        blob = red.stdout + red.stderr
        if not (
            "AssertionError" in blob
            or "expected" in blob
            or "assert " in blob
            or "toThrow" in blob
        ):
            failures.append(f"{slug}: red is not assertion:\n{blob[-800:]}")
            continue

        report[slug] = {
            "green_assert": green_line,
            "red_assert": excerpt_failure(red.stdout, red.stderr),
            "red_count": red_line,
        }
        print(f"OK {slug}")

    out = PROOFS / "REPORT.md"
    lines = [
        f"## Revert proof (manual `{head}` verification)",
        "",
        "Hand-run: `git apply` one-line patch, anchored single test. Count line proves exactly one test ran.",
        "",
        "| row | green | red |",
        "| --- | --- | --- |",
    ]
    for slug, _ in rows:
        r = report.get(slug)
        if not r:
            lines.append(f"| `{slug}` | **MISSING** | **MISSING** |")
            continue
        green_cell = f"`{r['green_assert']}`"
        red_cell = f"{r['red_assert']} · `{r['red_count']}`"
        lines.append(f"| `{slug}` | {green_cell} | {red_cell} |")
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")

    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
