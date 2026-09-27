#!/usr/bin/env python3
"""Replay revert-proofs/103 patches and verify red vitest lines."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PROOFS_DIR = REPO_ROOT / "revert-proofs" / "103"
WEB_DIR = REPO_ROOT / "web"
VITEST_JSON_REPORT = WEB_DIR / ".vitest" / "json" / "output.json"

FUZZ_RE = re.compile(r"(?i)\bfuzz\b|\(offset\s+\d+\s+line")
ASSERTION_RE = re.compile(r"^AssertionError: .+")

# Map proof stem -> exact `vitest list` row when JSON suite titles are stale.
STEM_VITEST_LIST_OVERRIDE: dict[str, str] = {
    "consent-notice-settings-plugins": (
        "src/app/mosaic-consent-resume.test.ts > mosaic consent resume > "
        "shows Settings → Plugins approval copy on the tile"
    ),
    "consent-resume-external-approve": (
        "src/app/mosaic-consent-resume.test.ts > mosaic consent resume > "
        "retries through switchPaneView when consent appears (external approve)"
    ),
    "reload-header-mode-persisted": (
        "src/app/mosaic-view-reload.test.ts > mosaic view reload regressions (B/C/D/E) > "
        "B: 1× reload keeps header and main mode aligned via persisted zoto-viz.mode"
    ),
    "reload-header-swaps-focused-tile": (
        "src/app/mosaic-view-reload.test.ts > mosaic view reload regressions (B/C/D/E) > "
        "C: header pick swaps the focused tile (not header-only)"
    ),
    "reload-neighbour-teardown-only-from": (
        "src/app/mosaic-view-reload.test.ts > mosaic view reload regressions (B/C/D/E) > "
        "D: neighbour pane pick does not teardown the focused tile view"
    ),
    "reload-reconcile-backrooms-slot": (
        "src/app/mosaic-view-reload.test.ts > mosaic view reload regressions (B/C/D/E) > "
        "E: reload restores Backrooms on the focused slot when mode and tiles diverged"
    ),
    "settings-mosaic-pick-delegates-hook": (
        "src/app/mosaic-view-reload.test.ts > mosaic view reload regressions (B/C/D/E) > "
        "pane picker delegates through the live hook and persists layout"
    ),
    "switch-pane-header-deny": (
        "src/app/switch-pane-view.test.ts > switchPaneView > entry %s > "
        "denies consent without swapping or mounting"
    ),
    "switch-pane-header-succeeds": (
        "src/app/switch-pane-view.test.ts > switchPaneView > entry %s > "
        "succeeds through teardown, swap, and mount"
    ),
    "switch-pane-header-swap-from-focus": (
        "src/app/switch-pane-view.test.ts > switchPaneView > entry %s > "
        "uses focus fallback when the requested tile id is stale"
    ),
    "switch-pane-tile-stale-from": (
        "src/app/switch-pane-view.test.ts > switchPaneView > entry %s > "
        "uses focus fallback when the requested tile id is stale"
    ),
    "switch-pane-tile-succeeds": (
        "src/app/switch-pane-view.test.ts > switchPaneView > entry %s > "
        "succeeds through teardown, swap, and mount"
    ),
}

# When `vitest list` uses describe.each %s, JSON testName must disambiguate header vs tile.
STEM_VITEST_RUN_TEST_NAME: dict[str, str] = {
    "switch-pane-header-deny": (
        "switchPaneView > entry header > denies consent without swapping or mounting"
    ),
    "switch-pane-header-succeeds": (
        "switchPaneView > entry header > succeeds through teardown, swap, and mount"
    ),
    "switch-pane-header-swap-from-focus": (
        "switchPaneView > entry header > uses focus fallback when the requested tile id is stale"
    ),
    "switch-pane-tile-stale-from": (
        "switchPaneView > entry tile > uses focus fallback when the requested tile id is stale"
    ),
    "switch-pane-tile-succeeds": (
        "switchPaneView > entry tile > succeeds through teardown, swap, and mount"
    ),
}


@dataclass
class ProofRow:
    stem: str
    meta_path: Path
    patch_path: Path
    meta: dict


@dataclass
class ReplayResult:
    stem: str
    apply_check: str
    pre_tests: str
    post_tests: str
    assertion: str
    red_line_ok: str
    ok: bool
    detail: str = ""


@dataclass
class NameMappingRow:
    stem: str
    json_test_name: str
    constructed_full: str
    vitest_list_name: str | None
    suggested_test_name: str | None
    needs_fix: bool


def list_proof_json_files() -> list[Path]:
    return sorted(
        p
        for p in PROOFS_DIR.glob("*.json")
        if p.name != "recorded-head.txt"
    )


def load_proofs() -> list[ProofRow]:
    rows: list[ProofRow] = []
    for meta_path in list_proof_json_files():
        stem = meta_path.stem
        patch_path = PROOFS_DIR / f"{stem}.patch"
        if not patch_path.is_file():
            raise SystemExit(f"missing patch for {meta_path.name}")
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        rows.append(ProofRow(stem, meta_path, patch_path, meta))
    return rows


def run_vitest_list() -> list[str]:
    proc = subprocess.run(
        ["pnpm", "exec", "vitest", "list"],
        cwd=WEB_DIR,
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise SystemExit(
            "vitest list failed:\n"
            + (proc.stderr or proc.stdout or "(no output)")
        )
    return [line.strip() for line in proc.stdout.splitlines() if line.strip()]


def full_test_name(test_file: str, test_name: str) -> str:
    return f"{test_file} > {test_name}"


def suffix_after_file(full_name: str, test_file: str) -> str:
    prefix = f"{test_file} > "
    if full_name.startswith(prefix):
        return full_name[len(prefix) :]
    return full_name


def leaf_title(name: str) -> str:
    return name.split(" > ")[-1]


def candidates_for_leaf(test_file: str, leaf: str, vitest_names: list[str]) -> list[str]:
    prefix = f"{test_file} > "
    out: list[str] = []
    for name in vitest_names:
        if not name.startswith(prefix):
            continue
        if name.endswith(f" > {leaf}") or leaf_title(name) == leaf:
            out.append(name)
    return out


def resolve_vitest_list_name(
    stem: str, test_file: str, test_name: str, vitest_names: set[str]
) -> str | None:
    if stem in STEM_VITEST_LIST_OVERRIDE:
        override = STEM_VITEST_LIST_OVERRIDE[stem]
        return override if override in vitest_names else None

    constructed = full_test_name(test_file, test_name)
    if constructed in vitest_names:
        return constructed

    leaf = leaf_title(test_name)
    cands = candidates_for_leaf(test_file, leaf, sorted(vitest_names))
    if "switch-pane-header" in stem:
        cands = [c for c in cands if " > entry header > " in c]
    elif stem.startswith("switch-pane-tile"):
        cands = [c for c in cands if " > entry tile > " in c]

    if len(cands) == 1:
        return cands[0]
    return None


def build_name_mappings(
    proofs: list[ProofRow], vitest_names: list[str]
) -> list[NameMappingRow]:
    name_set = set(vitest_names)
    rows: list[NameMappingRow] = []
    for proof in proofs:
        test_file = proof.meta["testFile"]
        test_name = proof.meta["testName"]
        constructed = full_test_name(test_file, test_name)
        vitest_list_name = resolve_vitest_list_name(
            proof.stem, test_file, test_name, name_set
        )
        if proof.stem in STEM_VITEST_RUN_TEST_NAME:
            suggested = STEM_VITEST_RUN_TEST_NAME[proof.stem]
        elif vitest_list_name is not None:
            suggested = suffix_after_file(vitest_list_name, test_file)
        else:
            suggested = None
        needs_fix = (
            vitest_list_name is None
            or constructed not in name_set
            or (suggested is not None and suggested != test_name)
        )
        rows.append(
            NameMappingRow(
                stem=proof.stem,
                json_test_name=test_name,
                constructed_full=constructed,
                vitest_list_name=vitest_list_name,
                suggested_test_name=suggested,
                needs_fix=needs_fix,
            )
        )
    return rows


def print_name_mapping_table(rows: list[NameMappingRow]) -> None:
    print("\n=== testName vs vitest list (cd web && pnpm exec vitest list) ===")
    print(
        f"{'stem':<40} {'needs_fix':<10} json testName (truncated)"
    )
    print("-" * 100)
    for row in rows:
        trunc = row.json_test_name
        if len(trunc) > 52:
            trunc = trunc[:49] + "..."
        print(f"{row.stem:<40} {str(row.needs_fix):<10} {trunc}")
        if row.needs_fix:
            print(f"  constructed: {row.constructed_full}")
            if row.vitest_list_name:
                print(f"  vitest list: {row.vitest_list_name}")
                print(f"  fix testName: {row.suggested_test_name}")
            else:
                print("  vitest list: (no unique match)")
    fixes = [r for r in rows if r.needs_fix]
    print(f"\nMapping summary: {len(fixes)}/{len(rows)} proofs need testName fixes.")


def git_apply_verbose(args: list[str], patch: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "apply", "-v", *args, str(patch.relative_to(REPO_ROOT))],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def git_apply_check(patch: Path) -> tuple[bool, str]:
    proc = git_apply_verbose(["--check"], patch)
    combined = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        return False, combined.strip() or "git apply --check failed"
    if FUZZ_RE.search(combined):
        return False, f"git apply --check reported fuzz/offset:\n{combined}"
    return True, "ok"


def git_apply(patch: Path) -> tuple[bool, str]:
    proc = git_apply_verbose([], patch)
    combined = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        return False, combined.strip() or "git apply failed"
    if FUZZ_RE.search(combined):
        return False, f"git apply reported fuzz/offset:\n{combined}"
    if "cleanly" not in combined.lower():
        return False, f"git apply did not report a clean apply:\n{combined}"
    return True, "ok"


def git_revert_patch(patch: Path) -> None:
    subprocess.run(
        ["git", "apply", "-R", str(patch.relative_to(REPO_ROOT))],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


@dataclass
class VitestRun:
    exit_code: int
    executed: int
    success: bool | None
    output: str
    assertion_lines: list[str]


def load_vitest_json_report() -> dict | None:
    if not VITEST_JSON_REPORT.is_file():
        return None
    try:
        return json.loads(VITEST_JSON_REPORT.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def executed_test_count(report: dict | None) -> int:
    if report is None:
        return -1
    passed = int(report.get("numPassedTests", 0))
    failed = int(report.get("numFailedTests", 0))
    return passed + failed


def assertion_lines_from_report(report: dict | None) -> list[str]:
    if report is None:
        return []
    lines: list[str] = []
    for file_result in report.get("testResults", []):
        for result in file_result.get("assertionResults", []):
            if result.get("status") != "failed":
                continue
            for message in result.get("failureMessages", []):
                for raw in str(message).splitlines():
                    line = raw.strip()
                    if ASSERTION_RE.match(line):
                        lines.append(line)
                        break
    return lines


def extract_assertion_lines(output: str, report: dict | None) -> list[str]:
    lines = assertion_lines_from_report(report)
    if lines:
        return lines
    from_output: list[str] = []
    for raw in output.splitlines():
        line = raw.strip()
        if ASSERTION_RE.match(line):
            from_output.append(line)
    return from_output


def run_vitest(test_file: str, test_name: str) -> VitestRun:
    if VITEST_JSON_REPORT.is_file():
        VITEST_JSON_REPORT.unlink()
    pattern = f"^{re.escape(test_name)}$"
    proc = subprocess.run(
        [
            "pnpm",
            "exec",
            "vitest",
            "run",
            test_file,
            "-t",
            pattern,
            "--reporter=json",
        ],
        cwd=WEB_DIR,
        capture_output=True,
        text=True,
        check=False,
    )
    combined = (proc.stdout or "") + (proc.stderr or "")
    report = load_vitest_json_report()
    executed = executed_test_count(report)
    success = report.get("success") if report is not None else None
    assertions = extract_assertion_lines(combined, report)
    return VitestRun(
        exit_code=proc.returncode,
        executed=executed,
        success=success,
        output=combined,
        assertion_lines=assertions,
    )


def replay_proof(proof: ProofRow) -> ReplayResult:
    test_file = proof.meta["testFile"]
    test_name = proof.meta["testName"]
    expected_red = proof.meta.get("redLine", "")

    ok_check, check_msg = git_apply_check(proof.patch_path)
    if not ok_check:
        return ReplayResult(
            stem=proof.stem,
            apply_check="FAIL",
            pre_tests="-",
            post_tests="-",
            assertion="-",
            red_line_ok="-",
            ok=False,
            detail=check_msg,
        )

    pre = run_vitest(test_file, test_name)
    if pre.executed != 1:
        return ReplayResult(
            stem=proof.stem,
            apply_check="PASS",
            pre_tests=f"FAIL({pre.executed})",
            post_tests="-",
            assertion="-",
            red_line_ok="-",
            ok=False,
            detail=(
                f"expected exactly 1 executed test before patch, got {pre.executed}; "
                f"vitest exit {pre.exit_code}"
            ),
        )
    if pre.success is not True:
        return ReplayResult(
            stem=proof.stem,
            apply_check="PASS",
            pre_tests=f"FAIL(success={pre.success})",
            post_tests="-",
            assertion="-",
            red_line_ok="-",
            ok=False,
            detail="baseline test must pass before applying revert patch",
        )

    ok_apply, apply_msg = git_apply(proof.patch_path)
    if not ok_apply:
        git_revert_patch(proof.patch_path)
        return ReplayResult(
            stem=proof.stem,
            apply_check="PASS",
            pre_tests="PASS(1)",
            post_tests="-",
            assertion="-",
            red_line_ok="-",
            ok=False,
            detail=apply_msg,
        )

    try:
        post = run_vitest(test_file, test_name)
        assertions = post.assertion_lines
        if post.executed != 1:
            return ReplayResult(
                stem=proof.stem,
                apply_check="PASS",
                pre_tests="PASS(1)",
                post_tests=f"FAIL({post.executed})",
                assertion="-",
                red_line_ok="-",
                ok=False,
                detail=f"expected exactly 1 executed test after patch, got {post.executed}",
            )
        if post.success is not False:
            return ReplayResult(
                stem=proof.stem,
                apply_check="PASS",
                pre_tests="PASS(1)",
                post_tests=f"FAIL(success={post.success})",
                assertion="-",
                red_line_ok="-",
                ok=False,
                detail="patched test must fail (vitest report success=false)",
            )
        if len(assertions) != 1:
            return ReplayResult(
                stem=proof.stem,
                apply_check="PASS",
                pre_tests="PASS(1)",
                post_tests="PASS(1)",
                assertion="-",
                red_line_ok="-",
                ok=False,
                detail=f"expected 1 AssertionError line, found {len(assertions)}",
            )

        assertion = assertions[0]
        red_ok = assertion == expected_red if expected_red else True
        detail = assertion
        if expected_red and not red_ok:
            detail = (
                f"AssertionError mismatch.\n  got:      {assertion}\n"
                f"  expected: {expected_red}"
            )
        return ReplayResult(
            stem=proof.stem,
            apply_check="PASS",
            pre_tests="PASS(1)",
            post_tests="PASS(1)",
            assertion=assertion[:70] + ("..." if len(assertion) > 70 else ""),
            red_line_ok="PASS" if red_ok else "FAIL",
            ok=red_ok,
            detail=detail,
        )
    finally:
        git_revert_patch(proof.patch_path)


def print_replay_table(results: list[ReplayResult]) -> None:
    print("\n=== revert-proofs/103 replay ===")
    header = (
        f"{'stem':<40} {'apply':<6} {'pre':<10} {'post':<10} "
        f"{'redLine':<8} {'ok':<5}"
    )
    print(header)
    print("-" * len(header))
    for row in results:
        print(
            f"{row.stem:<40} {row.apply_check:<6} {row.pre_tests:<10} "
            f"{row.post_tests:<10} {row.red_line_ok:<8} {str(row.ok):<5}"
        )
        if not row.ok and row.detail:
            for detail_line in row.detail.splitlines():
                print(f"  {detail_line}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--map-only",
        action="store_true",
        help="Print testName mapping only (skip git apply / vitest replay).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Replay at most N proofs (0 = all).",
    )
    args = parser.parse_args(argv)

    if not PROOFS_DIR.is_dir():
        print(f"missing proofs dir: {PROOFS_DIR}", file=sys.stderr)
        return 1

    proofs = load_proofs()
    vitest_names = run_vitest_list()
    mappings = build_name_mappings(proofs, vitest_names)
    print_name_mapping_table(mappings)

    if args.map_only:
        return 0

    selected = proofs if args.limit <= 0 else proofs[: args.limit]
    results = [replay_proof(proof) for proof in selected]
    print_replay_table(results)
    failed = sum(1 for r in results if not r.ok)
    print(f"\nReplay summary: {len(results) - failed}/{len(results)} passed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
