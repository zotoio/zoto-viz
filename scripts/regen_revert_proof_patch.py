#!/usr/bin/env python3
"""Build a byte-revert patch by applying an inverse edit to HEAD and running git diff."""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def git(*args: str) -> str:
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(r.stderr or r.stdout)
    return r.stdout


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("out_patch")
    p.add_argument("file", type=Path)
    p.add_argument("edit", choices=["delete_line_substring", "replace"], default="delete_line_substring")
    p.add_argument("needle")
    p.add_argument("--replace-with", default="")
    args = p.parse_args()

    path = args.file
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    if args.edit == "delete_line_substring":
        new_lines = [ln for ln in lines if args.needle not in ln]
        if len(new_lines) == len(lines):
            raise SystemExit(f"needle not found: {args.needle!r}")
    else:
        new_lines = [ln.replace(args.needle, args.replace_with, 1) if args.needle in ln else ln for ln in lines]
    path.write_text("".join(new_lines), encoding="utf-8")
    rel = path.relative_to(ROOT).as_posix()
    diff = git("diff", "--", rel)
    if not diff.strip():
        raise SystemExit("empty diff after edit")
    Path(args.out_patch).write_text(diff, encoding="utf-8")
    git("checkout", "--", rel)


ROOT = Path(__file__).resolve().parents[1]
if __name__ == "__main__":
    main()
