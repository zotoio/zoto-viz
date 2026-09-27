#!/usr/bin/env python3
"""Remove-one-hunk sweep vs main for web/src and plugins/src (PR #88)."""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "revert-proofs" / "88" / "hunk-map.json"
SKIP_FILES = re.compile(
    r"(viz-pack-runtime-esbuild|fat-lan|soak)"
)
DESELECT = {
    "web/src/viz-pack-runtime-esbuild.test.ts",
}


def run(cmd: list[str], cwd: Path | None = None) -> str:
    p = subprocess.run(cmd, cwd=cwd or ROOT, text=True, capture_output=True)
    if p.returncode not in (0, 1):
        raise SystemExit(p.stderr or p.stdout)
    return p.stdout


def parse_hunks(diff: str) -> list[dict]:
    hunks: list[dict] = []
    cur_file = None
    for line in diff.splitlines():
        if line.startswith("diff --git "):
            m = re.search(r"b/(.+)$", line)
            cur_file = m.group(1) if m else None
        elif line.startswith("@@") and cur_file:
            hunks.append({"file": cur_file, "header": line})
    return hunks


def row_for_file(path: str) -> str | None:
    name = Path(path).name
    for j in (ROOT / "revert-proofs" / "88").glob("*.json"):
        if j.name.endswith(".sidecar.json") or j.name == "hunk-map.json":
            continue
        data = json.loads(j.read_text())
        tf = data.get("testFile", "")
        if path.endswith(tf.replace("src/", "")) or tf in path:
            return j.stem
    return None


def main() -> None:
    diff = run(["git", "diff", "main...HEAD", "--", "web/src", "plugins/src"])
    hunks = parse_hunks(diff)
    rows = {j.stem for j in (ROOT / "revert-proofs" / "88").glob("*.json")}
    mapped: list[dict] = []
    for i, h in enumerate(hunks):
        f = h["file"]
        if f in DESELECT or SKIP_FILES.search(f):
            mapped.append({**h, "id": i, "map": "skipped-env-flake"})
            continue
        stem = row_for_file(f)
        if stem and stem in rows:
            mapped.append({**h, "id": i, "map": f"row:{stem}"})
            continue
        mapped.append({**h, "id": i, "map": "no-row: hunk not tied to single revert row"})
    OUT.write_text(json.dumps(mapped, indent=2) + "\n")
    print(f"wrote {len(mapped)} hunks to {OUT}")


if __name__ == "__main__":
    main()
