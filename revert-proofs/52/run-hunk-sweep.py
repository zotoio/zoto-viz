#!/usr/bin/env python3
"""QE hunk sweep: revert each production hunk; tsc then targeted vitest (full suite fallback)."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "web"
PROOFS = Path(__file__).resolve().parent
BASE = "origin/main"
EXCLUDE = re.compile(r"\.test\.ts$")

EXTRA_TESTS: dict[str, list[str]] = {
    "web/src/plugins/viz-tile-budget.ts": [
        "src/plugins/dogfood-tile-budget.test.ts",
        "src/plugins/viz-tile-cadence.test.ts",
        "src/core/viz-wall-limited-harness.test.ts",
    ],
    "web/src/ui/viz-copy.ts": ["src/ui/viz-copy.test.ts", "src/ui/tile-hud-label.test.ts"],
    "web/src/ui/tile-hud-label.ts": ["src/ui/tile-hud-label.test.ts"],
    "web/src/ui/viz-hud.ts": [
        "src/ui/viz-hud.test.ts",
        "src/ui/viz-hud-write-steady.test.ts",
        "src/ui/viz-hud-f4.test.ts",
        "src/app/main-viz-hud.test.ts",
    ],
    "web/src/core/viz-dev-wall-flags.ts": [
        "src/core/viz-dev-wall-flags.test.ts",
        "src/app/main-viz-dev-wall-bad-input.test.ts",
    ],
    "web/src/app/main.ts": [
        "src/app/main-viz-hud.test.ts",
        "src/app/main-viz-deliver.test.ts",
        "src/app/main-viz-dev-wall-bad-input.test.ts",
    ],
    "web/src/plugins/viz-host.ts": ["src/plugins/viz-host.test.ts", "src/plugins/dogfood.test.ts"],
    "web/src/plugins/nixie-wall-clock.ts": [
        "src/plugins/nixie-wall-clock.test.ts",
        "src/plugins/nixie-wall-clock-source-rows.test.ts",
        "src/plugins/nixie-clock-sky.test.ts",
    ],
    "web/src/graph/mosaic.ts": ["src/graph/mosaic-viz-tile-sync.test.ts"],
    "web/src/app/main.ts": [
        "src/app/main-viz-ubo-wire.test.ts",
        "src/app/main-viz-hud.test.ts",
        "src/app/main-viz-deliver.test.ts",
    ],
    "web/src/plugins/host.ts": [
        "src/plugins/host.test.ts",
        "src/plugins/host-scope-wire.test.ts",
    ],
    "web/src/plugins/typesafe-host.ts": [
        "src/plugins/typesafe-host.test.ts",
        "src/plugins/typesafe-host-clock-wire.test.ts",
    ],
    "web/src/plugins/dogfood-runner.ts": [
        "src/plugins/dogfood.test.ts",
        "src/plugins/dogfood-runner-clock-wire.test.ts",
    ],
}


@dataclass
class Hunk:
    path: str
    index: int
    header: str
    lines: list[str]

    @property
    def hunk_id(self) -> str:
        return f"{self.path}#{self.index}"


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True)


def file_exists_at_base(path: str) -> bool:
    return (
        subprocess.run(
            ["git", "cat-file", "-e", f"{BASE}:{path}"],
            cwd=ROOT,
            capture_output=True,
        ).returncode
        == 0
    )


def parse_hunks() -> list[Hunk]:
    diff = git("diff", f"{BASE}...HEAD", "--", "web/src")
    hunks: list[Hunk] = []
    current_file = ""
    idx_in_file = 0
    i = 0
    lines = diff.splitlines(True)
    while i < len(lines):
        line = lines[i]
        if line.startswith("diff --git "):
            m = re.search(r" b/(web/src/.+)$", line.strip())
            current_file = m.group(1) if m else ""
            idx_in_file = 0
            i += 1
            continue
        if line.startswith("@@"):
            if EXCLUDE.search(current_file):
                i += 1
                while i < len(lines) and not lines[i].startswith(("diff --git ", "@@")):
                    i += 1
                continue
            header = line.strip()
            body: list[str] = []
            i += 1
            while i < len(lines) and not lines[i].startswith(("diff --git ", "@@")):
                body.append(lines[i])
                i += 1
            hunks.append(Hunk(current_file, idx_in_file, header, body))
            idx_in_file += 1
            continue
        i += 1
    return hunks


def tests_for_path(path: str) -> list[str]:
    if path in EXTRA_TESTS:
        return EXTRA_TESTS[path]
    stem = Path(path).name.replace(".ts", "")
    out = subprocess.run(
        ["rg", "-l", stem, "src", "--glob", "*.test.ts"],
        cwd=WEB,
        capture_output=True,
        text=True,
    )
    files = [ln.strip() for ln in out.stdout.splitlines() if ln.strip()]
    return files[:8] if files else []


def patch_for_hunk(h: Hunk, reverse: bool) -> str:
    parts = [
        f"diff --git a/{h.path} b/{h.path}\n",
        f"--- a/{h.path}\n",
        f"+++ b/{h.path}\n",
        h.header + "\n",
        *h.lines,
    ]
    text = "".join(parts)
    if not reverse:
        return text
    out: list[str] = []
    for ln in text.splitlines(True):
        if ln.startswith("--- "):
            out.append(f"+++ b/{h.path}\n")
        elif ln.startswith("+++ "):
            out.append(f"--- a/{h.path}\n")
        elif ln.startswith("+") and not ln.startswith("+++"):
            out.append("-" + ln[1:])
        elif ln.startswith("-") and not ln.startswith("---"):
            out.append("+" + ln[1:])
        else:
            out.append(ln)
    return "".join(out)


def revert_hunk(h: Hunk) -> None:
    path = ROOT / h.path
    if not file_exists_at_base(h.path):
        path.unlink(missing_ok=True)
        return
    tmp = PROOFS / ".sweep-hunk.patch"
    tmp.write_text(patch_for_hunk(h, reverse=True))
    r = subprocess.run(
        ["git", "apply", "--whitespace=nowarn", str(tmp)],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    tmp.unlink(missing_ok=True)
    if r.returncode != 0:
        if file_exists_at_base(h.path):
            path.write_text(git("show", f"{BASE}:{h.path}"))
        else:
            path.unlink(missing_ok=True)


def tree_is_red(path: str) -> bool:
    tsc = subprocess.run(
        ["pnpm", "exec", "tsc", "-p", "tsconfig.json", "--noEmit"],
        cwd=WEB,
        capture_output=True,
    )
    if tsc.returncode != 0:
        return True
    tests = tests_for_path(path)
    cmd = ["pnpm", "exec", "vitest", "run", "--bail=1"]
    if tests:
        cmd.extend(tests)
    vit = subprocess.run(cmd, cwd=WEB, capture_output=True)
    if vit.returncode != 0:
        return True
    if tests:
        vit2 = subprocess.run(
            ["pnpm", "exec", "vitest", "run", "--bail=1"],
            cwd=WEB,
            capture_output=True,
        )
        return vit2.returncode != 0
    return False


def load_revert_patch_rows() -> dict[str, list[str]]:
    by_file: dict[str, list[str]] = {}
    for p in PROOFS.glob("*.patch"):
        text = p.read_text()
        row = p.name.replace(".patch", "")
        for m in re.finditer(r"^diff --git a/(web/src/[^\s]+)", text, re.M):
            by_file.setdefault(m.group(1), []).append(row)
    return by_file


def main() -> int:
    hunks = parse_hunks()
    patch_rows = load_revert_patch_rows()
    subprocess.run(["git", "checkout", "HEAD", "--", "web/src"], cwd=ROOT, check=True)
    results: list[dict] = []

    for n, h in enumerate(hunks):
        subprocess.run(["git", "checkout", "HEAD", "--", h.path], cwd=ROOT, check=True)
        revert_hunk(h)
        red = tree_is_red(h.path)
        subprocess.run(["git", "checkout", "HEAD", "--", h.path], cwd=ROOT, check=True)
        snippet = "".join(ln for ln in h.lines if ln.startswith("+"))[:120]
        matched = []
        for row in patch_rows.get(h.path, []):
            pf = PROOFS / f"{row}.patch"
            if pf.exists() and snippet and snippet.strip("+") in pf.read_text():
                matched.append(row)
        results.append(
            {
                "hunk_id": h.hunk_id,
                "path": h.path,
                "header": h.header,
                "vitest_red": red,
                "revert_rows": matched or patch_rows.get(h.path, [])[:1],
                "tests": tests_for_path(h.path),
            }
        )
        print(f"[{n + 1}/{len(hunks)}] {'RED' if red else 'GREEN'} {h.hunk_id}", flush=True)

    (PROOFS / "hunk-sweep-results.json").write_text(json.dumps(results, indent=2))
    green = [r for r in results if not r["vitest_red"]]
    print(f"Done. GREEN hunks (need row/test): {len(green)} / {len(hunks)}")
    return 1 if green else 0


if __name__ == "__main__":
    sys.exit(main())
