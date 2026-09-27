#!/usr/bin/env python3
"""Apply each revert row patch and run full vitest + pytest (survivor = both pass)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROOFS = ROOT / "revert-proofs" / "103"
WEB = ROOT / "web"
PYTEST = ROOT / ".venv" / "bin" / "pytest"


def run(cmd: list[str], cwd: Path | None = None) -> tuple[int, str]:
    p = subprocess.run(cmd, cwd=cwd or ROOT, capture_output=True, text=True)
    out = (p.stdout or "") + (p.stderr or "")
    return p.returncode, out


def main() -> int:
    rows = sorted(PROOFS.glob("*.json"))
    survivors: list[str] = []
    necessary: list[str] = []
    for row in rows:
        name = row.stem
        patch = PROOFS / f"{name}.patch"
        if not patch.is_file():
            continue
        run(["git", "checkout", "--", "."])
        ok, msg = True, ""
        proc = run(["git", "apply", str(patch)])
        if proc[0] != 0:
            print(f"{name}: APPLY_FAIL {proc[1][:200]}", file=sys.stderr)
            run(["git", "checkout", "--", "."])
            continue
        vt = run(["pnpm", "exec", "vitest", "run"], cwd=WEB)
        pt = (0, "") if vt[0] != 0 else run([str(PYTEST), "-o", "addopts="])
        run(["git", "checkout", "--", "."])
        if vt[0] == 0 and pt[0] == 0:
            survivors.append(name)
            disp = "survivor (full suites still green with hunk reverted)"
        else:
            necessary.append(name)
            parts = []
            if vt[0] != 0:
                parts.append(f"vitest exit {vt[0]}")
            if pt[0] != 0:
                parts.append(f"pytest exit {pt[0]}")
            disp = "caught: " + ", ".join(parts)
        print(f"{name}\t{disp}")
    print("\nSUMMARY survivors:", len(survivors), "necessary:", len(necessary))
    for s in survivors:
        print("  survivor:", s)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
