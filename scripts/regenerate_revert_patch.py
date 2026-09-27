#!/usr/bin/env python3
"""Regenerate a single-hunk revert patch with strict line numbers (no fuzz)."""
from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

ROOT = Path("/workspace")


def blob_short(path: Path) -> str:
    return subprocess.check_output(["git", "hash-object", str(path)], cwd=ROOT).decode().strip()[:7]


def main() -> None:
    if len(sys.argv) != 4:
        print("usage: regenerate_revert_patch.py <repo-rel-path> <patch-out> <minus-line>...", file=sys.stderr)
        sys.exit(2)
    rel = sys.argv[1]
    out = Path(sys.argv[2])
    minus_lines = sys.argv[3:]
    src = ROOT / rel
    lines = src.read_text().splitlines(keepends=True)
    idx = None
    for i, ln in enumerate(lines):
        if ln.rstrip("\n") == minus_lines[0]:
            # verify full block
            ok = all(
                i + j < len(lines) and lines[i + j].rstrip("\n") == m
                for j, m in enumerate(minus_lines)
            )
            if ok:
                idx = i
                break
    if idx is None:
        print("minus block not found", file=sys.stderr)
        sys.exit(1)
    old_n = len(minus_lines)
    new_n = 0
    start = idx + 1  # 1-based for diff
    old_start = idx + 1
    ctx_before = 3
    ctx_after = 3
    hunk_old_start = max(1, old_start - ctx_before)
    hunk_new_start = max(1, old_start - ctx_before)
    hunk_old_count = (old_start - hunk_old_start) + old_n + min(ctx_after, len(lines) - (idx + old_n))
    hunk_new_count = (old_start - hunk_new_start) + new_n + min(ctx_after, len(lines) - (idx + old_n))
    body: list[str] = []
    for j in range(hunk_old_start - 1, min(len(lines), idx + old_n + ctx_after)):
        prefix = " "
        if idx <= j < idx + old_n:
            prefix = "-"
        body.append(prefix + lines[j].rstrip("\n"))
    func_ctx = lines[idx - 1].strip() if idx > 0 else ""
    if "function" in func_ctx or func_ctx.endswith("{"):
        ctx_suffix = " " + func_ctx[:40]
    else:
        ctx_suffix = ""
    patch = [
        f"diff --git a/{rel} b/{rel}",
        f"index {blob_short(src)}..rev0001 100644",
        f"--- a/{rel}",
        f"+++ b/{rel}",
        f"@@ -{old_start},{old_n} +{old_start},{new_n} @@{ctx_suffix}",
    ]
    for m in minus_lines:
        patch.append("-" + m)
    out.write_text("\n".join(patch) + "\n")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
