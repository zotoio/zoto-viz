#!/usr/bin/env python3
"""Generate and verify revert-proofs/45 sidecars for PR #45 regression tests."""
from __future__ import annotations

import difflib
import json
import shutil
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "revert-proofs" / "45"
ARTIFACTS = Path("/opt/cursor/artifacts/revert-proofs-45")


@dataclass(frozen=True)
class Row:
    slug: str
    runner: str
    test_file: str
    test_name: str
    description: str
    rel_path: str
    apply: Callable[[str], str]


def replace_once(text: str, old: str, new: str) -> str:
    if old not in text:
        raise ValueError(f"missing snippet: {old!r}")
    return text.replace(old, new, 1)


ROWS: list[Row] = [
    Row(
        "incomplete-pull-files-vs-changed-files",
        "pytest",
        "tests/test_pack_pr_boundary.py",
        "test_validate_pull_changed_files_rejects_incomplete_listing",
        "Fail closed when pulls/files listing length disagrees with pull.changed_files.",
        "scripts/check_pack_pr_boundary.py",
        lambda t: replace_once(
            t,
            "    if reported_count != len(listed_paths):",
            "    if False and reported_count != len(listed_paths):",
        ),
    ),
    Row(
        "over-3000-changed-files-rejection",
        "pytest",
        "tests/test_pack_pr_boundary.py",
        "test_validate_pull_changed_files_rejects_over_api_cap",
        "Reject PRs with changed_files above the GitHub pulls/files API cap.",
        "scripts/check_pack_pr_boundary.py",
        lambda t: replace_once(
            t,
            "    if reported_count >= GITHUB_PULL_FILES_API_MAX:",
            "    if False and reported_count >= GITHUB_PULL_FILES_API_MAX:",
        ),
    ),
    Row(
        "non-array-pull-files-page",
        "pytest",
        "tests/test_pack_pr_boundary.py",
        "test_fetch_pull_changed_files_rejects_non_array_page",
        "Non-array pulls/files API page raises ValueError (fail closed).",
        "scripts/check_pack_pr_boundary.py",
        lambda t: replace_once(
            t,
            "        if not isinstance(page, list):",
            "        if False and not isinstance(page, list):",
        ),
    ),
    Row(
        "headline-decimation-eligibility-before-cap",
        "vitest",
        "web/src/plugins/viz-build-gates.test.ts",
        "headline decimation counts eligibility before output cap",
        "Headline eligible count uses full source list before applying VIZ_MAX_HEADLINE_SAMPLES cap.",
        "web/src/plugins/viz-host.ts",
        lambda t: replace_once(
            t,
            "    Number.MAX_SAFE_INTEGER,",
            "    VIZ_MAX_HEADLINE_SAMPLES,",
        ),
    ),
    Row(
        "flow-work-scales-4-4x-gate",
        "vitest",
        "web/src/plugins/viz-build-gates.test.ts",
        "scale gate formula divides VIZ_BUILD_FLOW_SCALE_MAX by 4",
        "Flow work scale gate uses maxWorkRatio = flowRatio × (VIZ_BUILD_FLOW_SCALE_MAX / 4).",
        "web/src/plugins/viz-build-counters.ts",
        lambda t: replace_once(
            t,
            "  const maxWorkRatio = flowRatio * (VIZ_BUILD_FLOW_SCALE_MAX / 4);",
            "  const maxWorkRatio = flowRatio * VIZ_BUILD_FLOW_SCALE_MAX;",
        ),
    ),
    Row(
        "vitest-stripped-child-build",
        "vitest",
        "web/src/plugins/viz-build-gates.test.ts",
        "production bundle excludes counter instrumentation",
        "Child pnpm build must not inherit VITEST=true for __VIZ_BUILD_COUNTERS__ define.",
        "web/vite.config.ts",
        lambda t: replace_once(
            t,
            "  process.env.npm_lifecycle_event !== \"build\";",
            "  process.env.npm_lifecycle_event === \"build\";",
        ),
    ),
    Row(
        "naive-triple-talker-scan-flow-cap",
        "vitest",
        "web/src/plugins/viz-build-gates.test.ts",
        "naive triple talker scan fails k=2 flow cap",
        "flowWorkWithinCap enforces flows × VIZ_BUILD_FLOW_WORK_MULT work ceiling.",
        "web/src/plugins/viz-build-counters.ts",
        lambda t: replace_once(
            t,
            "  return work.flowVisits <= cap && work.rateCalls <= cap;",
            "  return true;",
        ),
    ),
    Row(
        "output-caps-decimation-fat-lan",
        "vitest",
        "web/src/plugins/viz-build-gates.test.ts",
        "output caps match decimation drop stats on seeded fat LAN",
        "Seeded fat-LAN frame byte ceiling and decimation drop accounting.",
        "web/src/plugins/viz-host.ts",
        lambda t: replace_once(
            t,
            "export const FAT_LAN_SEEDED_VIZ_FRAME_BYTE_CEILING = 28_500;",
            "export const FAT_LAN_SEEDED_VIZ_FRAME_BYTE_CEILING = 1;",
        ),
    ),
    Row(
        "dogfood-count-gate-ok",
        "vitest",
        "web/src/plugins/dogfood.test.ts",
        "fat-LAN count gate: deterministic delivery and build work budgets",
        "runDogfoodCountGate aggregates per-pack delivery and work budget success.",
        "web/src/plugins/dogfood-runner.ts",
        lambda t: replace_once(t, "  let ok = true;", "  let ok = false;"),
    ),
    Row(
        "ci-test-needs-valid-fixture",
        "pytest",
        "tests/test_ci_test_needs.py",
        "test_validate_fixture_valid",
        "validate_ci_test_needs accepts a complete test.needs fixture.",
        "scripts/check_ci_test_needs.py",
        lambda t: replace_once(t, "    errors: list[str] = []", '    errors: list[str] = ["broken"]'),
    ),
    Row(
        "ci-test-needs-missing-job",
        "pytest",
        "tests/test_ci_test_needs.py",
        "test_validate_fixture_missing_job_in_needs",
        "Missing jobs in test.needs are reported.",
        "scripts/check_ci_test_needs.py",
        lambda t: replace_once(t, "    if missing:", "    if False and missing:"),
    ),
    Row(
        "ci-test-needs-extra-unknown",
        "pytest",
        "tests/test_ci_test_needs.py",
        "test_validate_fixture_extra_unknown_in_needs",
        "Unknown jobs in test.needs are reported.",
        "scripts/check_ci_test_needs.py",
        lambda t: replace_once(t, "    if extra:", "    if False and extra:"),
    ),
    Row(
        "ci-test-needs-real-workflow",
        "pytest",
        "tests/test_ci_test_needs.py",
        "test_check_real_ci_workflow",
        "check_ci_workflow validates the repo ci.yml test.needs graph.",
        "scripts/check_ci_test_needs.py",
        lambda t: replace_once(
            t,
            "    errors = validate_ci_test_needs(doc)",
            '    errors = ["broken"]',
        ),
    ),
    Row(
        "pack-pr-github-workflow-host-infra",
        "pytest",
        "tests/test_pack_pr_boundary.py",
        "test_multi_pack_with_github_workflow_fails_without_host_labels",
        "Multi-pack PR touching .github/workflows requires host labels.",
        "scripts/check_pack_pr_boundary.py",
        lambda t: replace_once(
            t,
            "    return any(path.startswith(prefix) for prefix in HOST_INFRA_PREFIXES)",
            "    return False",
        ),
    ),
    Row(
        "pack-pr-scripts-change-host-infra",
        "pytest",
        "tests/test_pack_pr_boundary.py",
        "test_multi_pack_with_scripts_change_fails_without_host_labels",
        "Multi-pack PR touching scripts/ requires host labels.",
        "scripts/check_pack_pr_boundary.py",
        lambda t: replace_once(
            t,
            "    return any(path.startswith(prefix) for prefix in HOST_INFRA_PREFIXES)",
            "    return False",
        ),
    ),
    Row(
        "pull-files-fixture-host-script",
        "pytest",
        "tests/test_pack_pr_boundary.py",
        "test_paths_from_pull_files_fixture_includes_rename_and_host_script",
        "Pull-files fixture paths include host script; pack PR must fail without labels.",
        "scripts/check_pack_pr_boundary.py",
        lambda t: replace_once(
            t,
            "    return any(path.startswith(prefix) for prefix in HOST_INFRA_PREFIXES)",
            "    return False",
        ),
    ),
    Row(
        "pack-pr-editing-workflow-yaml-host-infra",
        "pytest",
        "tests/test_pack_pr_boundary.py",
        "test_pack_pr_editing_workflow_yaml_is_host_infra",
        "Single-pack PR editing pack-boundary workflow is host infra.",
        "scripts/check_pack_pr_boundary.py",
        lambda t: replace_once(
            t,
            "    return any(path.startswith(prefix) for prefix in HOST_INFRA_PREFIXES)",
            "    return False",
        ),
    ),
    Row(
        "multi-pack-plugins-only-passes",
        "pytest",
        "tests/test_pack_pr_boundary.py",
        "test_multi_pack_plugins_only_passes",
        "Multi-pack PR with only plugin paths still passes boundary check.",
        "scripts/check_pack_pr_boundary.py",
        lambda t: replace_once(
            t,
            '            f"(multiple pack folders: {pack_list}); check passed."\n        )\n        return 0, lines',
            '            f"(multiple pack folders: {pack_list}); check passed."\n        )\n        return 1, lines',
        ),
    ),
    Row(
        "multi-pack-host-infra-when-reviewed",
        "pytest",
        "tests/test_pack_pr_boundary.py",
        "test_multi_pack_with_host_infra_passes_when_reviewed",
        "Multi-pack PR with host infra passes when allow_host_infra is set.",
        "scripts/check_pack_pr_boundary.py",
        lambda t: replace_once(
            t,
            "    if packs and infra_paths and not allow_host_infra:",
            "    if packs and infra_paths:",
        ),
    ),
    Row(
        "pr-head-symlink-rejected",
        "pytest",
        "tests/test_pack_boundary_secure.py",
        "test_secure_dry_run_rejects_symlink_in_pr_head",
        "lstat PR head paths and reject symlinks under the PR tree.",
        "scripts/pack_boundary_safe_io.py",
        lambda t: replace_once(
            t,
            "    if stat.S_ISLNK(st.st_mode):",
            "    if False and stat.S_ISLNK(st.st_mode):",
        ),
    ),
    Row(
        "workflow-command-injection-escaped",
        "pytest",
        "tests/test_pack_boundary_secure.py",
        "test_secure_dry_run_workflow_command_injection_escaped",
        "Escape PR-derived lines that start with :: before printing.",
        "scripts/pack_boundary_safe_io.py",
        lambda t: replace_once(
            t,
            '            return " " + line',
            "            return line",
        ),
    ),
    Row(
        "unsafe-path-control-chars-rejected",
        "pytest",
        "tests/test_pack_boundary_secure.py",
        "test_secure_dry_run_rejects_newline_in_filename",
        "Reject changed-file paths with control characters or traversal.",
        "scripts/pack_boundary_safe_io.py",
        lambda t: replace_once(
            t,
            "    if path_has_control_chars(path):",
            "    if False and path_has_control_chars(path):",
        ),
    ),
    Row(
        "pr-head-file-size-cap",
        "pytest",
        "tests/test_pack_boundary_secure.py",
        "test_secure_dry_run_rejects_oversized_pr_head_file",
        "Fail when a PR head file exceeds PACK_BOUNDARY_MAX_FILE_BYTES.",
        "scripts/pack_boundary_safe_io.py",
        lambda t: replace_once(
            t,
            "    if size > max_bytes:",
            "    if False and size > max_bytes:",
        ),
    ),
    Row(
        "api-file-list-at-limit",
        "pytest",
        "tests/test_pack_boundary_secure.py",
        "test_secure_dry_run_rejects_at_api_file_limit",
        "Fail closed when changed_files reaches the pulls/files API ceiling.",
        "scripts/check_pack_pr_boundary.py",
        lambda t: replace_once(
            t,
            "    if reported_count >= GITHUB_PULL_FILES_API_MAX:",
            "    if reported_count > GITHUB_PULL_FILES_API_MAX:",
        ),
    ),
    Row(
        "weakened-pr-checker-on-disk-still-fails",
        "pytest",
        "tests/test_pack_boundary_secure.py",
        "test_secure_dry_run_weakened_pr_checker_on_disk_still_fails",
        "Host-infra gate in run_check is not bypassed by PR-head checker content.",
        "scripts/check_pack_pr_boundary.py",
        lambda t: replace_once(
            t,
            "    if packs and infra_paths and not allow_host_infra:",
            "    if False and packs and infra_paths and not allow_host_infra:",
        ),
    ),
    Row(
        "merge-workflow-label-event-host-reviewed",
        "pytest",
        "tests/test_pack_pr_boundary.py",
        "test_merge_workflow_label_event_appends_host_reviewed",
        "Label-driven workflow runs append labeled events to the review timeline.",
        "scripts/check_pack_pr_boundary.py",
        lambda t: replace_once(t, "    if not created:", "    if created:"),
    ),
]


def run_cmd(cmd: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=cwd or REPO, text=True, capture_output=True)


def git_diff(path: str) -> str:
    proc = run_cmd(["git", "diff", "--no-color", path])
    return proc.stdout


def excerpt(stdout: str, stderr: str) -> str:
    blob = (stdout + "\n" + stderr).strip()
    for line in blob.splitlines():
        s = line.strip()
        if "AssertionError" in s or "expected" in s or "Error:" in s or "FAILED" in s:
            return s[:240]
    lines = [ln for ln in blob.splitlines() if ln.strip()]
    return lines[-1][:240] if lines else "(no output)"


def vitest_file_arg(test_file: str) -> str:
    prefix = "web/"
    return test_file[len(prefix) :] if test_file.startswith(prefix) else test_file


def clear_script_pycache() -> None:
    cache = REPO / "scripts" / "__pycache__"
    if cache.is_dir():
        shutil.rmtree(cache)


def run_test(row: Row) -> subprocess.CompletedProcess[str]:
    clear_script_pycache()
    if row.runner == "pytest":
        test_id = f"{row.test_file}::{row.test_name}"
        return run_cmd([sys.executable, "-m", "pytest", test_id, "-q", "--no-cov"])
    return run_cmd(
        [
            "pnpm",
            "exec",
            "vitest",
            "run",
            vitest_file_arg(row.test_file),
            "-t",
            row.test_name,
        ],
        cwd=REPO / "web",
    )


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    summary: dict[str, str] = {}

    for row in ROWS:
        path = REPO / row.rel_path
        original = path.read_text(encoding="utf-8")
        try:
            try:
                patched = row.apply(original)
            except ValueError as exc:
                print(f"{row.slug}: apply failed: {exc}", file=sys.stderr)
                return 1
            path.write_text(patched, encoding="utf-8")

            diff = git_diff(row.rel_path)
            if not diff.strip():
                diff = "".join(
                    difflib.unified_diff(
                        original.splitlines(keepends=True),
                        patched.splitlines(keepends=True),
                        f"a/{row.rel_path}",
                        f"b/{row.rel_path}",
                    )
                )
            if not diff.strip():
                print(f"{row.slug}: empty diff", file=sys.stderr)
                return 1

            (OUT / f"{row.slug}.patch").write_text(diff, encoding="utf-8")
            (OUT / f"{row.slug}.json").write_text(
                json.dumps(
                    {
                        "runner": row.runner,
                        "testFile": row.test_file,
                        "testName": row.test_name,
                        "description": row.description,
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            if row.runner == "vitest":
                tsc = run_cmd(["pnpm", "exec", "tsc", "--noEmit"], cwd=REPO / "web")
                if tsc.returncode != 0:
                    print(f"{row.slug}: tsc on patched tree failed:\n{tsc.stderr}", file=sys.stderr)
                    return 1

            red = run_test(row)
            (ARTIFACTS / f"{row.slug}.patched.log").write_text(
                red.stdout + red.stderr, encoding="utf-8"
            )
            if red.returncode == 0:
                print(f"{row.slug}: expected failing test, got pass", file=sys.stderr)
                return 1

            blob = red.stdout + red.stderr
            if row.runner == "pytest" and not any(
                x in blob
                for x in ("AssertionError", "assert", "DID NOT RAISE", "Failed:")
            ):
                print(f"{row.slug}: pytest failure not assertion:\n{blob}", file=sys.stderr)
                return 1
            if row.runner == "vitest" and "AssertionError" not in blob and "expected" not in blob:
                if "Error:" not in blob:
                    print(f"{row.slug}: vitest failure not assertion:\n{blob}", file=sys.stderr)
                    return 1

            summary[row.slug] = excerpt(red.stdout, red.stderr)

            path.write_text(original, encoding="utf-8")
            green = run_test(row)
            if green.returncode != 0:
                print(f"{row.slug}: unpatched test failed:\n{green.stderr}", file=sys.stderr)
                return 1
        finally:
            path.write_text(original, encoding="utf-8")

    (ARTIFACTS / "excerpts.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
