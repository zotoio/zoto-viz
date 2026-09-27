#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/workspace")
WEB = ROOT / "web"
VENV = ROOT / ".venv/bin"
SPLITS = [
    ("27a", "6520b01", "4a1e647d"),
    ("27b", "4a1e647d", "e4d64961"),
    ("27c", "e4d64961", "6678a61b"),
]


def run(cmd: list[str], cwd: Path = ROOT, timeout: int = 600, env: dict | None = None):
    base = {**os.environ, **(env or {})}
    if VENV.is_dir():
        base["PATH"] = f"{VENV}:{base.get('PATH', '')}"
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, env=base)


def checkout_web(ref: str) -> None:
    run(["git", "checkout", "-f", ref, "--", "web", "plugins"])
    run(["git", "clean", "-fd", "web", "plugins"])


def sidecars(base: str, head: str) -> list[Path]:
    out = run(["git", "diff", f"{base}...{head}", "--name-only", "--", "revert-proofs/27"]).stdout
    return sorted(ROOT / ln for ln in out.splitlines() if ln.endswith(".json"))


def test_name_pat(raw: str) -> re.Pattern[str]:
    s = raw
    if s.startswith("^"):
        s = s[1:]
    if s.endswith("$"):
        s = s[:-1]
    return re.compile(s)


def vitest_run(tf: str, extra: list[str] | None = None) -> tuple[int, str]:
    cmd = ["pnpm", "exec", "vitest", "run", tf, *(extra or [])]
    r = run(cmd, cwd=WEB, timeout=300)
    return r.returncode, r.stdout + r.stderr


def assertion_for_test(out: str, tn: str) -> str | None:
    pat = test_name_pat(tn)
    for block in re.split(r"\n(?= FAIL )", out):
        if " FAIL " not in block:
            continue
        header = block.split("\n", 1)[0]
        if not pat.search(header):
            continue
        m = re.search(r"(AssertionError: .+)", block)
        if m:
            return m.group(1).rstrip()
    return None


def vitest_row(tf: str, tn: str) -> tuple[int, str | None]:
    code, out = vitest_run(tf, ["-t", tn])
    if code == 0:
        return 0, None
    m = re.search(r"(AssertionError: .+)", out)
    return code, (m.group(1).rstrip() if m else None)


def vitest_full_file(tf: str, tn: str) -> tuple[int, str, str | None]:
    code, out = vitest_run(tf)
    summary = ""
    for ln in out.splitlines():
        if ln.strip().startswith("Test Files") or ln.strip().startswith("Tests "):
            summary = ln.strip()
    measured = assertion_for_test(out, tn)
    return code, summary, measured


def patch_mutation_body(patch: Path) -> str:
    lines: list[str] = []
    for ln in patch.read_text().splitlines():
        if ln.startswith("@@"):
            continue
        if ln.startswith(("diff ", "index ", "---", "+++")):
            continue
        if ln[:1] in "-+ ":
            lines.append(ln)
    return "\n".join(lines)


def mutation_hash(patch: Path) -> str:
    import hashlib

    return hashlib.sha256(patch_mutation_body(patch).encode()).hexdigest()[:16]


def validate_sidecar_assertion(row: str, expected: str) -> list[str]:
    errs: list[str] = []
    if not expected.startswith("AssertionError:"):
        errs.append(f"{row}: patchedAssertion must start with AssertionError:")
    if re.search(r"\b\d+\s*ms\b|Duration|Test Files|passed \|", expected):
        errs.append(f"{row}: patchedAssertion looks like a summary line, not AssertionError")
    return errs


def check_mutation_duplicates() -> list[str]:
    """Same +/- body (@@ stripped) + same vitest target + same assertion => one row."""
    groups: dict[tuple[str, str, str, str], list[str]] = {}
    for sc in sorted((ROOT / "revert-proofs/27").glob("*.json")):
        patch = sc.with_suffix(".patch")
        if not patch.exists():
            continue
        d = json.loads(sc.read_text())
        key = (
            mutation_hash(patch),
            d["testFile"],
            d["testName"],
            d["patchedAssertion"],
        )
        groups.setdefault(key, []).append(sc.stem)
    return [f"duplicate mutation+test rows: {names} (hash {key[0]})" for key, names in groups.items() if len(names) > 1]


def check_pnpm_not_in_diff(base: str, head: str) -> list[str]:
    stat = run(["git", "diff", f"{base}...{head}", "--stat"]).stdout
    bad = [ln for ln in stat.splitlines() if ".modules.yaml" in ln or "pnpm-workspace-state" in ln]
    return [f"PR diff must not touch pnpm lock state: {ln.strip()}" for ln in bad]


def patch_minus_plus(patch: Path) -> tuple[list[str], list[str]]:
    minus, plus = [], []
    for ln in patch.read_text().splitlines():
        if ln.startswith("-") and not ln.startswith("---"):
            minus.append(ln[1:])
        elif ln.startswith("+") and not ln.startswith("+++"):
            plus.append(ln[1:])
    return minus, plus


def validate_patch(row: str, patch: Path, sc: Path) -> list[str]:
    errs: list[str] = []
    d = json.loads(sc.read_text())
    lint = bool(d.get("lintRow"))
    minus, plus = patch_minus_plus(patch)
    if not minus and not lint:
        errs.append(f"{row}: no `-` hunk lines (not lint row)")
    if lint and not minus and not plus:
        errs.append(f"{row}: lint row has no `-` or `+` lines")
    m = re.search(r"^\+\+\+ b/(\S+)", patch.read_text(), re.M)
    if not m:
        return errs
    text = (ROOT / m.group(1)).read_text()
    for line in minus:
        if line not in text:
            errs.append(f"{row}: missing production line: {line[:72]!r}")
    return errs


def strict_apply_check(split_rows: list[Path], head: str) -> list[str]:
    errs: list[str] = []
    checkout_web(head)
    for sc in split_rows:
        patch = sc.with_suffix(".patch")
        if not patch.exists():
            continue
        r = run(["git", "apply", "--check", "-p1", str(patch)])
        if r.returncode != 0:
            errs.append(f"{sc.stem}: git apply --check failed: {r.stderr.strip()[:120]}")
    return errs


def main() -> None:
    dup = run(["bash", "-lc", "sha256sum revert-proofs/27/*.patch | sort | uniq -D -w64"]).stdout.strip()
    print("=== (b) sha256sum revert-proofs/27/*.patch | sort | uniq -D -w64 ===")
    print(dup or "(empty — no duplicate hashes)")
    if dup:
        sys.exit(1)

    print("\n=== (b2) mutation body dup (@@ stripped) + same test + assertion ===")
    mut_dups = check_mutation_duplicates()
    print("\n".join(mut_dups) if mut_dups else "(empty — no duplicate mutation rows)")
    if mut_dups:
        sys.exit(6)

    print("\n=== (#80) pnpm state files must not appear in PR diff stat ===")
    pnpm_errs: list[str] = []
    pnpm_errs.extend(check_pnpm_not_in_diff("6520b01", "4a1e647d"))
    pnpm_errs.extend(check_pnpm_not_in_diff("4a1e647d", "e4d64961"))
    pnpm_errs.extend(check_pnpm_not_in_diff("e4d64961", "6678a61b"))
    print("\n".join(pnpm_errs) if pnpm_errs else "No node_modules/.modules.yaml or .pnpm-workspace-state-v1.json in split diffs.")

    sidecar_shape: list[str] = []
    for sc in sorted((ROOT / "revert-proofs/27").glob("*.json")):
        d = json.loads(sc.read_text())
        sidecar_shape.extend(validate_sidecar_assertion(sc.stem, d["patchedAssertion"]))
    if sidecar_shape:
        print("\n=== (#80) patchedAssertion shape ===")
        for e in sidecar_shape:
            print(e)
    if pnpm_errs or sidecar_shape:
        sys.exit(7)
    apply_errs: list[str] = []
    for split, base, head in SPLITS:
        rows = sidecars(base, head)
        apply_errs.extend(f"{split}: {e}" for e in strict_apply_check(rows, head))
    print("\n".join(apply_errs) if apply_errs else "All split patches apply with zero offset/fuzz.")
    if apply_errs:
        sys.exit(4)

    mismatches: list[tuple[str, str, str]] = []
    fullfile_fails: list[str] = []
    shape: list[str] = []

    for split, base, head in SPLITS:
        print(f"\n=== (c) row gates {split} @ {head[:8]} ===")
        checkout_web(head)
        for sc in sidecars(base, head):
            patch = sc.with_suffix(".patch")
            if not patch.exists():
                continue
            row = sc.stem
            shape.extend(validate_patch(row, patch, sc))
            d = json.loads(sc.read_text())
            expected = d["patchedAssertion"]
            shape.extend(validate_sidecar_assertion(row, expected))
            tf, tn = d["testFile"], d["testName"]
            checkout_web(head)
            if run(["git", "apply", "-p1", str(patch)]).returncode != 0:
                mismatches.append((row, expected, "PATCH_APPLY_FAILED"))
                continue
            _, measured = vitest_row(tf, tn)
            checkout_web(head)
            if not measured:
                mismatches.append((row, expected, "NO_ASSERTION"))
                print(f"FAIL {row}: no AssertionError (-t)")
            elif measured != expected:
                print(f"MISMATCH {row}\n  sidecar:   {expected}\n  measured:  {measured}")
                mismatches.append((row, expected, measured))
            else:
                print(f"OK {row}")

        print(f"\n=== (2) full-file row gates {split} @ {head[:8]} ===")
        checkout_web(head)
        for sc in sidecars(base, head):
            patch = sc.with_suffix(".patch")
            if not patch.exists():
                continue
            row = sc.stem
            d = json.loads(sc.read_text())
            expected = d["patchedAssertion"]
            tf, tn = d["testFile"], d["testName"]
            checkout_web(head)
            if run(["git", "apply", "-p1", str(patch)]).returncode != 0:
                fullfile_fails.append(f"{row}: apply failed")
                continue
            code, summary, measured = vitest_full_file(tf, tn)
            checkout_web(head)
            if code == 0:
                fullfile_fails.append(f"{row}: full-file GREEN ({summary})")
                print(f"FAIL {row}: full-file GREEN ({summary})")
            elif not measured:
                fullfile_fails.append(f"{row}: no matching AssertionError ({summary})")
                print(f"FAIL {row}: no assertion in full-file ({summary})")
            elif measured != expected:
                print(f"MISMATCH {row} full-file\n  sidecar:  {expected}\n  measured: {measured}\n  {summary}")
                fullfile_fails.append(f"{row}: full-file assertion mismatch")
            else:
                print(f"OK {row} full-file | {summary}")

    if shape:
        print("\n=== patch shape ===")
        for e in shape:
            print(e)
    if mismatches:
        sys.exit(2)
    if fullfile_fails:
        print("\nFull-file gate failures:", len(fullfile_fails))
        sys.exit(5)
    if shape:
        sys.exit(3)
    print("\nAll TSE (b)(c) + full-file gates passed")
    qe = run(["python3", str(ROOT / "scripts" / "qe_gate_pr27.py")])
    print(qe.stdout)
    if qe.returncode != 0:
        sys.exit(qe.returncode)


if __name__ == "__main__":
    main()
