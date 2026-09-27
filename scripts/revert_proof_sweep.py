#!/usr/bin/env python3
"""Measured remove-one-row sweep: each revert patch removed must leave full pytest green."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = {
    **__import__("os").environ,
    "PATH": f"{ROOT}/.venv-review/bin:{ROOT}/.ci-shim/bin:" + __import__("os").environ.get("PATH", ""),
}


def run(cmd: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    p = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True, env=ENV)
    if check and p.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)}\n{p.stdout[-2000:]}\n{p.stderr[-2000:]}")
    return p


def reset() -> None:
    run(["git", "checkout", "HEAD", "--", "service", "docs", "tests", "web"], check=False)


def main() -> None:
    pr = sys.argv[1]
    rows = sorted(
        p.stem for p in (ROOT / f"revert-proofs/{pr}").glob("*.json") if p.name != "RECORD.json"
    )
    survivors: list[str] = []
    print(f"| row | remove patch | pytest |")
    print(f"| --- | --- | --- |")
    for name in rows:
        reset()
        patch = ROOT / f"revert-proofs/{pr}/{name}.patch"
        run(["git", "apply", str(patch)], check=False)
        p = run(["pytest", "-o", "addopts=", "-q", "--tb=no"], check=False)
        ok = p.returncode == 0
        mark = "green" if ok else "RED"
        print(f"| {name} | yes | {mark} |")
        if ok:
            survivors.append(name)
        reset()
    print(f"\nSurvivors ({len(survivors)}): {survivors}", file=sys.stderr)


if __name__ == "__main__":
    main()
