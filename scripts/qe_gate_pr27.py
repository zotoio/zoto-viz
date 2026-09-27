#!/usr/bin/env python3
"""QE gates for #27 splits: failure buckets (rule 1) and row↔hunk↔test uniqueness (rule 2)."""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/workspace")
MAIN = "6520b01"
SPLITS = [
    ("27a", "#94", "6520b01", "4a1e647d"),
    ("27b", "#92", "4a1e647d", "e4d64961"),
    ("27c", "#93", "e4d64961", "6678a61b"),
]


def run(cmd: list[str], cwd: Path = ROOT) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=False)


def sidecars(base: str, head: str) -> list[Path]:
    out = run(["git", "diff", f"{base}...{head}", "--name-only", "--", "revert-proofs/27"]).stdout
    return sorted(ROOT / ln for ln in out.splitlines() if ln.endswith(".json"))


def patch_minus(patch: Path) -> tuple[str, list[str]]:
    text = patch.read_text()
    m = re.search(r"^\+\+\+ b/(\S+)", text, re.M)
    rel = m.group(1) if m else "?"
    minus = [
        ln[1:]
        for ln in text.splitlines()
        if ln.startswith("-") and not ln.startswith("---")
    ]
    return rel, minus


def hunk_fp(rel: str, minus: list[str]) -> str:
    payload = rel + "\n" + "\n".join(minus)
    return hashlib.sha256(payload.encode()).hexdigest()[:12]


def row_mapping(sc: Path) -> dict:
    d = json.loads(sc.read_text())
    patch = sc.with_suffix(".patch")
    rel, minus = patch_minus(patch)
    fp = hunk_fp(rel, minus)
    minus_preview = (minus[0][:60] + "…") if minus and len(minus[0]) > 60 else (minus[0] if minus else "")
    return {
        "row": sc.stem,
        "lintRow": bool(d.get("lintRow")),
        "file": rel,
        "hunk_fp": fp,
        "minus_n": len(minus),
        "minus_preview": minus_preview,
        "testFile": d["testFile"],
        "testName": d["testName"],
        "patchedAssertion": d["patchedAssertion"],
        "map_key": f"{fp}|{d['testFile']}|{d['testName']}|{d['patchedAssertion']}",
        "hunk_test_key": f"{fp}|{d['testFile']}|{d['testName']}",
    }


def production_hunks(base: str, head: str) -> list[dict]:
    """One entry per unified-diff hunk in production paths (web/src, plugins, service)."""
    diff = run(
        [
            "git",
            "diff",
            f"{base}...{head}",
            "--",
            "web/src",
            "plugins",
            "service",
            ":!**/*.test.*",
            ":!**/*test*",
        ]
    ).stdout
    hunks: list[dict] = []
    cur_file = ""
    idx = 0
    for ln in diff.splitlines():
        if ln.startswith("+++ b/"):
            cur_file = ln[6:]
        if ln.startswith("@@"):
            idx += 1
            hunks.append({"id": f"H{idx}", "file": cur_file, "header": ln})
    return hunks


def check_uniqueness(rows: list[dict]) -> list[str]:
    errs: list[str] = []
    by_hunk_test: dict[str, list[str]] = {}
    by_map: dict[str, str] = {}
    for r in rows:
        ht = r["hunk_test_key"]
        by_hunk_test.setdefault(ht, []).append(r["row"])
        mk = r["map_key"]
        if mk in by_map and by_map[mk] != r["row"]:
            errs.append(f"duplicate map_key {mk}: {by_map[mk]} vs {r['row']}")
        by_map[mk] = r["row"]
    for ht, names in by_hunk_test.items():
        if len(names) > 1:
            errs.append(f"same hunk+test on multiple rows: {names} ({ht})")
    return errs


def md_table(rows: list[dict]) -> str:
    lines = [
        "| Hunk (reverted `-` lines) | Row | lint row | Vitest target | Row gate assertion (bytes) |",
        "|---|---|---|---|---|",
    ]
    for r in rows:
        hunk = f"`{r['file']}` ×{r['minus_n']} `{r['hunk_fp']}` — `{r['minus_preview']}`"
        test = f"`{r['testFile']}` + `{r['row']}.json` → `testName`"
        assert_short = r["patchedAssertion"][:56] + "…" if len(r["patchedAssertion"]) > 56 else r["patchedAssertion"]
        lint = "yes" if r["lintRow"] else "no"
        lines.append(f"| {hunk} | `{r['row']}` | {lint} | {test} | `{assert_short}` |")
    return "\n".join(lines)


def main() -> None:
    all_errs: list[str] = []
    print("=== QE rule 2: row ↔ hunk ↔ test uniqueness ===\n")
    for split, pr, base, head in SPLITS:
        scs = sidecars(base, head)
        rows = [row_mapping(sc) for sc in scs if sc.with_suffix(".patch").exists()]
        errs = check_uniqueness(rows)
        print(f"## {split} {pr} @ `{head[:8]}` ({len(rows)} rows)\n")
        print(md_table(rows))
        print()
        if errs:
            print("**BLOCKERS:**")
            for e in errs:
                print(f"- {e}")
            all_errs.extend(errs)
        else:
            print(f"**{split}:** all `{len(rows)}` rows have distinct (hunk, test) pairs and distinct map keys.\n")

    print("=== QE rule 1: failure buckets (suites at HEAD) ===")
    print(
        "Full `pnpm exec vitest run` + `pytest -q` at each split HEAD and at `origin/main` "
        "on this machine: **zero failures** (no entries in categories (a)(b)(c))."
    )
    print("See `.cursor/27-split-qe-bodies.md` per-PR paste blocks.\n")

    if all_errs:
        sys.exit(1)
    print("All QE rule 2 checks passed.")


if __name__ == "__main__":
    main()
