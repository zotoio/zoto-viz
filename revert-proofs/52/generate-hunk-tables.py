#!/usr/bin/env python3
"""Emit pr-52a-hunk-to-row.md and pr-52b-hunk-to-row.md from sweep + manifest."""
from __future__ import annotations

import json
from pathlib import Path

import yaml

PROOFS = Path(__file__).resolve().parent

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
    "web/src/graph/mosaic.ts": dict.fromkeys(
        range(4), "mosaic-viz-tile-sync.test.ts"
    ),
    "web/src/plugins/host.ts": dict.fromkeys(
        range(2), "host-scope-wire.test.ts"
    ),
    "web/src/plugins/typesafe-host.ts": dict.fromkeys(
        range(7),
        "typesafe-host-clock-wire.test.ts",
    ),
    "web/src/plugins/dogfood-runner.ts": {
        6: "dogfood-runner-clock-wire.test.ts",
    },
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


def main() -> None:
    manifest = yaml.safe_load((PROOFS / "split-manifest.yml").read_text())
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
        lines = [
            f"<!-- Paste into PR #{pr} body (QE hunk-to-row gate) -->",
            f"## Hunk-to-row table ({pr})",
            "",
            "Every production hunk under `web/src` (not tests, not proofs) maps to a revert row or named test.",
            "",
            "| Hunk | Sweep @ HEAD | Row or named test |",
            "|------|----------------|-------------------|",
        ]
        no_row = []
        for e in tables[pr]:
            lines.append(f"| `{e['hunk']}` | {e['sweep']} | {e['row']} |")
            if "no row" in e["row"]:
                no_row.append(e["hunk"])
        lines.append("")
        lines.append(f"**Sweep:** `python3 revert-proofs/52/run-hunk-sweep.py` (must exit 0).")
        if no_row:
            lines.extend(["", "### no row, reason", ""])
            for h in no_row:
                lines.append(f"- `{h}`")
        (PROOFS / f"pr-{pr}-hunk-to-row.md").write_text("\n".join(lines) + "\n")
        print(f"pr-{pr}-hunk-to-row.md: {len(tables[pr])} hunks, {len(no_row)} unmapped")


if __name__ == "__main__":
    main()
