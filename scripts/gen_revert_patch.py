#!/usr/bin/env python3
"""Print git diff patch from one exact substring replacement."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    rel, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
    path = ROOT / rel
    subprocess.run(["git", "checkout", "--", rel], cwd=ROOT, check=True)
    text = path.read_text()
    if old not in text:
        print(f"OLD NOT FOUND in {rel}", file=sys.stderr)
        sys.exit(1)
    path.write_text(text.replace(old, new, 1))
    diff = subprocess.run(["git", "diff", "--", rel], cwd=ROOT, capture_output=True, text=True)
    subprocess.run(["git", "checkout", "--", rel], cwd=ROOT, check=True)
    sys.stdout.write(diff.stdout)


if __name__ == "__main__":
    main()
