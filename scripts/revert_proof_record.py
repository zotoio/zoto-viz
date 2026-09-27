#!/usr/bin/env python3
"""RECORD.json helpers: full tree, proven commit tree, and QE key (tree excluding revert-proofs/)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _run(cmd: list[str], *, cwd: Path = ROOT, env: dict | None = None) -> str:
    p = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True, env=env)
    if p.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)}\n{p.stderr}\n{p.stdout}")
    return p.stdout.strip()


def filtered_tree(commit: str = "HEAD") -> str:
    lines = _run(["git", "ls-tree", "-r", commit]).splitlines()
    with tempfile.TemporaryDirectory() as td:
        index = Path(td) / "index"
        env = {**os.environ, "GIT_INDEX_FILE": str(index)}
        _run(["git", "read-tree", "--empty"], env=env)
        for line in lines:
            meta, path = line.split("\t", 1)
            if path.startswith("revert-proofs/"):
                continue
            mode, typ, sha = meta.split()
            _run(
                ["git", "update-index", "--add", "--cacheinfo", f"{mode},{sha},{path}"],
                env=env,
            )
        return _run(["git", "write-tree"], env=env)


def write_record(pr: str, commit: str) -> None:
    tree = _run(["git", "rev-parse", f"{commit}^{{tree}}"])
    key = filtered_tree(commit)
    path = ROOT / "revert-proofs" / pr / "RECORD.json"
    path.write_text(
        json.dumps({"commit": commit, "tree": tree, "key": key}, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {path}: commit={commit[:8]} tree={tree[:7]} key={key[:7]}")


def main() -> None:
    if len(sys.argv) != 3:
        print("usage: revert_proof_record.py <104|105|106> <commit>", file=sys.stderr)
        sys.exit(2)
    write_record(sys.argv[1], sys.argv[2])


if __name__ == "__main__":
    main()
