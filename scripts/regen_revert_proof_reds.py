#!/usr/bin/env python3
"""Re-run each revert-proof row at HEAD: refresh sidecar red (full line, no pytest … truncation)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = {
    **dict(**__import__("os").environ),
    "PATH": f"{ROOT}/.venv-review/bin:{ROOT}/.ci-shim/bin:" + __import__("os").environ.get("PATH", ""),
}


def run(cmd: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    p = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True, env=ENV)
    if check and p.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)}\n{p.stdout}\n{p.stderr}")
    return p


def reset_tree() -> None:
    run(["git", "checkout", "HEAD", "--", "service", "docs"], check=False)


def extract_red(output: str) -> str:
    for line in output.splitlines():
        if line.startswith("E   AssertionError:"):
            return line[2:].strip()
        if line.startswith("E   Failed:"):
            return line[2:].strip()
        if line.startswith("E   assert "):
            return f"AssertionError: {line[2:].strip()}"
        if line.startswith("E   ") and not line.startswith("E   +"):
            return line[2:].strip()
    raise RuntimeError(f"no failure line in output tail:\n{output[-4000:]}")


def regen_row(pr: str, name: str) -> None:
    patch = ROOT / f"revert-proofs/{pr}/{name}.patch"
    sidecar = ROOT / f"revert-proofs/{pr}/{name}.json"
    meta = json.loads(sidecar.read_text(encoding="utf-8"))
    test_id = meta["testId"]
    reset_tree()
    chk = run(["git", "apply", "--check", str(patch)], check=False)
    if chk.returncode:
        raise SystemExit(f"{name}: apply --check failed:\n{chk.stderr}")
    green = run(
        [
            "pytest",
            test_id,
            "--no-cov",
            "-q",
            "-p",
            "no:warnings",
            "-o",
            "addopts=",
        ],
        check=False,
    )
    if green.returncode != 0:
        raise SystemExit(f"{name}: unpatched not green:\n{green.stdout}{green.stderr}")
    run(["git", "apply", str(patch)])
    red_run = run(
        [
            "pytest",
            test_id,
            "--no-cov",
            "--tb=line",
            "-q",
            "-p",
            "no:warnings",
            "-o",
            "addopts=",
        ],
        check=False,
    )
    reset_tree()
    if red_run.returncode == 0:
        raise SystemExit(f"{name}: patched still green")
    red = extract_red(red_run.stdout + red_run.stderr)
    if "..." in red:
        raise SystemExit(f"{name}: red still truncated: {red!r}")
    meta["red"] = red
    sidecar.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"{name}: {red}")


def main() -> None:
    pr = sys.argv[1]
    names = sorted(
        p.stem for p in (ROOT / f"revert-proofs/{pr}").glob("*.json") if p.name != "RECORD.json"
    )
    if len(sys.argv) > 2:
        names = [n for n in names if n in sys.argv[2:]]
    failed: list[str] = []
    for name in names:
        try:
            regen_row(pr, name)
        except SystemExit as exc:
            print(exc, file=sys.stderr)
            failed.append(name)
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
