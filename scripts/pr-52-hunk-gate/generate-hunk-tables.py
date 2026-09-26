#!/usr/bin/env python3
"""Print hunk-to-row markdown tables (stdout only; proofs dir is patch+json)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
GATE = Path(__file__).resolve().parent
PROOFS = ROOT / "revert-proofs" / "52"

HUNK_ROW: dict[str, dict[int, str]] = {
    "web/src/app/main.ts": {
        0: "main import trim (viz-host re-exports)",
        1: "viz-main-deliver + tile budget imports",
        2: "nixie boot + dev wall flags + main-viz-tile-lines",
        3: "syncVizBudgetTileScope",
        4: "main-viz-ubo-wire.test.ts > afterLook broadcast",
        5: "main-viz-ubo-wire.test.ts > bindVizWriter broadcast",
        6: "main-viz-ubo-wire.test.ts > sandbox writeBuffer broadcast",
        7: "mainVizDeliver feed path",
        8: "main-viz-hud.test.ts > M2",
        9: "boot wall flags + nixie clock",
    },
    "web/src/graph/mosaic.ts": dict.fromkeys(range(4), "mosaic-viz-tile-sync.test.ts"),
    "web/src/plugins/host.ts": dict.fromkeys(range(2), "host-scope-wire.test.ts"),
    "web/src/plugins/typesafe-host.ts": dict.fromkeys(range(7), "typesafe-host-clock-wire.test.ts"),
    "web/src/plugins/dogfood-runner.ts": {6: "dogfood-runner-clock-wire.test.ts"},
}


def split_for(path: str, idx: int, manifest: dict) -> str:
    if path in manifest.get("52a", []):
        return "52a"
    if path in manifest.get("52b", []):
        return "52b"
    splits = manifest.get("shared_hunk_splits", {}).get(path, {})
    if idx in splits.get("52a", []):
        return "52a"
    if idx in splits.get("52b", []):
        return "52b"
    return "52b"


def row_for(entry: dict) -> str:
    path = entry["path"]
    idx = int(entry["hunk_id"].split("#")[1])
    if path in HUNK_ROW and idx in HUNK_ROW[path]:
        return f"test/row: {HUNK_ROW[path][idx]}"
    rev = entry.get("revert_rows") or []
    if rev:
        return f"revert: `{rev[0]}`"
    tests = entry.get("tests") or []
    if tests:
        return f"test: `{tests[0]}` (+ sweep RED)"
    if entry.get("vitest_red"):
        return "sweep RED (vitest/tsc fails on hunk removal)"
    return "**no row, reason: sweep GREEN — see QE follow-up**"


def emit_table(pr: str, rows: list[dict]) -> None:
    print(f"### Hunk-to-row ({pr})")
    print()
    print("| Hunk | Sweep @ HEAD | Row or named test |")
    print("|------|----------------|-------------------|")
    for e in rows:
        print(f"| `{e['hunk']}` | {e['sweep']} | {e['row']} |")
    print()


def main() -> None:
    manifest = yaml.safe_load((GATE / "split-manifest.yml").read_text())
    sweep = json.loads((PROOFS / "hunk-sweep-results.json").read_text())
    tables: dict[str, list[dict]] = {"52a": [], "52b": []}

    for entry in sweep:
        idx = int(entry["hunk_id"].split("#")[1])
        pr = split_for(entry["path"], idx, manifest)
        tables[pr].append(
            {
                "hunk": entry["hunk_id"],
                "sweep": "RED" if entry["vitest_red"] else "GREEN",
                "row": row_for(entry),
            }
        )

    for pr in ("52a", "52b"):
        emit_table(pr, tables[pr])
    print(f"**Sweep:** `python3 scripts/pr-52-hunk-gate/run-hunk-sweep.py` (must exit 0).", file=sys.stderr)


if __name__ == "__main__":
    main()
