#!/usr/bin/env python3
"""RECORD.json: proven commit, QE tree (proven index minus revert-proofs/), and key."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

QE_TREE_CMD_TEMPLATE = (
    "GIT_INDEX_FILE=$(mktemp -u) sh -c "
    "'git read-tree {commit} && git rm -r -q --cached --ignore-unmatch revert-proofs && git write-tree'"
)


def _run(cmd: list[str], *, cwd: Path = ROOT, env: dict | None = None) -> str:
    p = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True, env=env)
    if p.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)}\n{p.stderr}\n{p.stdout}")
    return p.stdout.strip()


def qe_tree(commit: str) -> str:
    """Tree of ``commit`` with ``revert-proofs/`` removed (QE index recipe)."""
    commit = _run(["git", "rev-parse", commit])
    idx = tempfile.mktemp(prefix="record-index-")
    env = {**os.environ, "GIT_INDEX_FILE": idx}
    try:
        _run(["git", "read-tree", commit], env=env)
        rm = subprocess.run(
            ["git", "rm", "-r", "-q", "--cached", "--ignore-unmatch", "revert-proofs"],
            cwd=ROOT,
            env=env,
            text=True,
            capture_output=True,
        )
        if rm.returncode != 0:
            subprocess.run(
                ["git", "rm", "-r", "-qf", "--cached", "--ignore-unmatch", "revert-proofs"],
                cwd=ROOT,
                env=env,
                check=True,
                text=True,
                capture_output=True,
            )
        return _run(["git", "write-tree"], env=env)
    finally:
        for suffix in ("", ".lock"):
            try:
                os.unlink(idx + suffix)
            except OSError:
                pass


def write_record(pr: str, commit: str) -> tuple[str, str, str]:
    commit = _run(["git", "rev-parse", commit])
    tree = qe_tree(commit)
    path = ROOT / "revert-proofs" / pr / "RECORD.json"
    path.write_text(
        json.dumps({"commit": commit, "tree": tree, "key": tree}, indent=2) + "\n",
        encoding="utf-8",
    )
    cmd = QE_TREE_CMD_TEMPLATE.format(commit=commit)
    print(f"Wrote {path}")
    print(f"  commit={commit}")
    print(f"  tree={tree}")
    print(f"  key={tree}")
    return commit, tree, cmd


def main() -> None:
    if len(sys.argv) != 3:
        print("usage: revert_proof_record.py <104|105|106> <commit>", file=sys.stderr)
        sys.exit(2)
    write_record(sys.argv[1], sys.argv[2])


if __name__ == "__main__":
    main()
