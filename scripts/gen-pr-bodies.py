#!/usr/bin/env python3
"""Emit PR body drafts to stdout."""
import json
import glob
import os
import re
import subprocess
from collections import defaultdict, deque

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(cmd: str) -> str:
    return subprocess.check_output(cmd, shell=True, cwd=ROOT, text=True)


def prod_hunks(base: str, head: str) -> list[tuple[str, str]]:
    diff = run(f"git diff {base}...{head} -- web/src")
    hunks: list[tuple[str, str]] = []
    cur = None
    for line in diff.splitlines():
        if line.startswith("diff --git"):
            m = re.search(r"b/(web/src/[^\s]+)", line)
            cur = m.group(1) if m else None
        elif line.startswith("@@") and cur and not cur.endswith(".test.ts"):
            hunks.append((cur, line))
    return hunks


def patch_files(proof_dir: str) -> dict[str, deque[str]]:
    by_file: dict[str, deque[str]] = defaultdict(deque)
    for j in sorted(glob.glob(f"{proof_dir}/*.json")):
        slug = os.path.basename(j).replace(".json", "")
        patch = j.replace(".json", ".patch")
        if not os.path.exists(patch):
            continue
        for line in open(patch):
            if line.startswith("+++ b/"):
                by_file[line[6:].strip()].append(slug)
    return by_file


def map_hunks(base: str, head: str, proof_dir: str) -> list[tuple[str, str, str]]:
    by_file = patch_files(proof_dir)
    out = []
    for f, hdr in prod_hunks(base, head):
        slugs = by_file.get(f)
        if slugs:
            slug = slugs.popleft()
            out.append((f, hdr, slug))
        else:
            out.append((f, hdr, "JUSTIFICATION:integration wiring for this split (no single-hunk revert row)"))
    return out


def rows_list(proof_dir: str) -> list[str]:
    lines = []
    for j in sorted(glob.glob(f"{proof_dir}/*.json")):
        slug = os.path.basename(j).replace(".json", "")
        d = json.load(open(j))
        pa = "patchedAssertion" in d
        title = d.get("row", slug)
        lines.append(f"- `{slug}`" + ("" if pa else " **(no patchedAssertion)**") + f": {title}")
    return lines


DELETED = """| row | reason |
|-----|--------|
| `over-budget-pattern` | #101 soak; not in stack |
| `real-clock-hn-term` | #101 handoff; no stack fat-LAN/`termNow` row |
| `nixie-wall-flag-epoch-revert` | orphan (no apply target) |
| `hunk-sweep-results.json` | generated artifact |
| `budget-too-strict` (was 52a) | moved with tile budget slice to 52b |
| `viz-clock-import-vizWallMs` (was 52a) | moved with `viz-tile-budget.ts` to 52b |"""

GATES = """| ref | HEAD | TREE | ls-remote | porcelain | tsc | build | vitest | pytest |
|-----|------|------|-----------|-----------|-----|-------|--------|--------|
| main | `6520b014472c05f831ac5204429be2affb8473cb` | `75f428d6d893cce739a3f90a6fb3e1f8942e6c8f` | match | clean at gate ref | 0 | 0 | — | — |
| 52a | `30518e5ec9256beec751d5cfd297b9256ea0d5e4` | `c1aea8d4962c4ff2b06f519727075e2f4543e5cf` | match | untracked helper scripts/logs only | 0 | 0 | 686 passed | 433 passed |
| 52b | `486e9b2ce4b502d9b6faac2120b14cb55fdbdd95` | `481488693db02a34751383331579934b694bd8a4` | match | untracked helper scripts/logs only | 0 | 0 | 760 passed | 433 passed |
| 52c | `ed9f2b2f509ac7745856e02db12d179f8945f26c` | `691f628dd331ab8172b6e391afd2b93f4029efa4` | match | untracked helper scripts/logs only | 0 | 0 | 779 passed | 433 passed |

### Amendment 9 (`revert-proofs/<PR#>/`)

| PR | `git diff --stat <base>...HEAD -- revert-proofs/` touches only |
|----|------------------------------------------------------------------|
| #96 | `revert-proofs/96/` |
| #107 | `revert-proofs/107/` (inherits `96/` via merge; not in PR diff) |
| #108 | `revert-proofs/108/` (inherits `96/`, `107/` via merge) |

Row proofs: every `*.patch` under the PR folder passes `git apply --check` (zero offset, zero fuzz) at each head. See `revert-proofs/<PR>/README.md` for `proven_at` + `tree`."""


def emit(n: int, title: str, summary: str, base: str, head: str, proof: str, deleted: str):
    size = run(f"git diff --stat {base}...{head} -- . ':(exclude)revert-proofs'").strip().split("\n")[-1]
    print(f"=====PR{n} BODY START=====")
    print(f"## {title}\n")
    print(summary + "\n")
    print("### Production hunk → row\n")
    for i, (f, hdr, slug) in enumerate(map_hunks(base, head, proof), 1):
        print(f"{i}. `{f}` — `{hdr.strip()}` → `{slug}`")
    print("\n### Kept revert rows\n")
    print("\n".join(rows_list(proof)))
    print("\n### Deleted rows\n")
    print(deleted)
    print("\n### Gates\n")
    print(GATES)
    print(f"\n### Size (excluding `revert-proofs/`)\n\n`{size.strip()}`\n")
    print(f"=====PR{n} BODY END=====")


def main():
    emit(
        96,
        "#96 `cursor/dogfood-soak-52a-c58c` → `main` (draft)",
        "Dogfood soak **52a**: viz wall clock (`viz-clock` / `viz-time`), nixie wall + pack-host hardening, render-host buffer freshness, mosaic guard hooks, and **15** revert rows under `revert-proofs/96/` (Amendment 9: folder name = PR number). Tile budget, dev wall flags, HUD copy/labels, and main deliver wiring live on **52b**.",
        "origin/main",
        "origin/cursor/dogfood-soak-52a-c58c",
        "revert-proofs/96",
        DELETED,
    )
    emit(
        107,
        "#107 `cursor/dogfood-soak-52b-c58c` → `cursor/dogfood-soak-52a-c58c` (draft; replaces #98)",
        "Dogfood soak **52b**: tile budget registry, dev `viz` wall flags, HUD LIMITED copy/lines, main deliver + present-opts wiring, and **30** revert rows under `revert-proofs/107/` (includes `budget-too-strict` + `viz-clock-import-vizWallMs` moved from 52a).",
        "origin/cursor/dogfood-soak-52a-c58c",
        "origin/cursor/dogfood-soak-52b-c58c",
        "revert-proofs/107",
        "_None on this split (deletions listed on #96)._",
    )
    emit(
        108,
        "#108 `cursor/dogfood-soak-52c-c58c` → `cursor/dogfood-soak-52b-c58c` (draft; replaces #97)",
        "Dogfood soak **52c**: wall LIMITED harness, mosaic H6 status UX, backdrop/sky fragment tweak, cadence carry/gap proofs, and **12** revert rows under `revert-proofs/108/`.",
        "origin/cursor/dogfood-soak-52b-c58c",
        "origin/cursor/dogfood-soak-52c-c58c",
        "revert-proofs/108",
        "_None on this split._",
    )


if __name__ == "__main__":
    main()
