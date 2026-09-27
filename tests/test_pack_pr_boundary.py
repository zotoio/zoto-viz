from __future__ import annotations

import json
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from scripts.check_pack_pr_boundary import (
    GITHUB_PULL_FILES_API_MAX,
    ALLOWED_CATALOG_PATH,
    ALLOWED_SCHEMA_PATH,
    ALLOWED_TSCONFIG_PATH,
    HOST_REVIEW_FAIL_MESSAGE,
    MISSING_PR_NUMBER_MESSAGE,
    PACK_PR_HOST_INFRA_FAIL,
    evaluate_pack_pr,
    merge_workflow_label_event,
    pack_py_test_path,
    paths_from_name_status,
    paths_from_pull_files_pages,
    run_check,
    run_host_change_gate,
    validate_catalog_py_change,
    validate_schema_py_change,
    fetch_pull_changed_files,
    validate_pull_changed_files_complete,
    validate_tsconfig_change,
)

SCHEMA_HEAD = '''\
def test_viz_plugin_yml_validates() -> None:
    for pid in ("packet-tunnel", "rf-constellation", "talker-storm",
                "kefrens-bars", "roto-proto", "blob-mesh", "star-sines", "hn-rain", "hn-term",
                "stereo-gram", "syscon", "cypher-cic", "nixie-clock", "ant-colony"):
        doc = plugins.load_file(ROOT / "plugins" / "src" / pid / "plugin.yml")
        assert doc["viz"]["graphWalk"] is False
'''

SCHEMA_BASE = SCHEMA_HEAD.replace(', "ant-colony"', "")

TSCONFIG_BASE = """{
  "compilerOptions": {"strict": true},
  "include": ["src", "../plugins/src/hn-term/frontend/teletype.ts"],
  "exclude": ["src/**/*.test.ts"]
}
"""


def _contents(pairs: dict[str, tuple[str, str]]) -> dict[str, tuple[str | None, str | None]]:
    return {k: (a, b) for k, (a, b) in pairs.items()}


def test_clean_pack_pr_passes() -> None:
    pack = "ant-colony"
    files = [
        f"plugins/src/{pack}/plugin.yml",
        f"web/src/plugins/{pack}.test.ts",
        ALLOWED_SCHEMA_PATH,
    ]
    tsconfig_head = TSCONFIG_BASE.replace(
        '"include": ["src", "../plugins/src/hn-term/frontend/teletype.ts"]',
        '"include": ["src", "../plugins/src/hn-term/frontend/teletype.ts", '
        f'"../plugins/src/{pack}/frontend/index.ts"]',
    )
    contents = _contents(
        {
            ALLOWED_SCHEMA_PATH: (SCHEMA_BASE, SCHEMA_HEAD),
            ALLOWED_TSCONFIG_PATH: (TSCONFIG_BASE, tsconfig_head),
        }
    )
    code, lines = run_check(files + [ALLOWED_TSCONFIG_PATH], contents, pr_number=99)
    assert code == 0
    assert any("passed" in line for line in lines)


def test_pack_pr_viz_host_edit_fails() -> None:
    pack = "marble-run"
    files = [
        f"plugins/src/{pack}/plugin.yml",
        f"web/src/plugins/{pack}.test.ts",
        "web/src/plugins/viz-host.ts",
    ]
    code, lines = run_check(files, {}, pr_number=99)
    assert code == 1
    assert any("viz-host.ts" in line for line in lines)


def test_pack_pr_tsconfig_compiler_options_fails() -> None:
    pack = "metro-lines"
    head = TSCONFIG_BASE.replace('"strict": true', '"strict": false')
    violations = validate_tsconfig_change(TSCONFIG_BASE, head, pack)
    assert violations
    assert "compilerOptions" in violations[0].reason or "field" in violations[0].reason


def test_two_pack_folders_not_a_pack_pr() -> None:
    files = [
        "plugins/src/ant-colony/plugin.yml",
        "plugins/src/metro-lines/plugin.yml",
    ]
    code, lines = run_check(files, {}, pr_number=99)
    assert code == 1
    assert any("metro-lines" in line or "ant-colony" in line for line in lines)


def test_multi_pack_with_host_web_src_fails() -> None:
    files = [
        "plugins/src/ant-colony/plugin.yml",
        "plugins/src/metro-lines/plugin.yml",
        "web/src/plugins/viz-host.ts",
    ]
    code, lines = run_check(files, {}, pr_number=99)
    assert code == 1
    assert any("multi-pack PR" in line for line in lines)
    assert any("viz-host.ts" in line for line in lines)


def test_multi_pack_with_github_workflow_fails_without_host_labels() -> None:
    files = [
        "plugins/src/ant-colony/plugin.yml",
        "plugins/src/metro-lines/plugin.yml",
        ".github/workflows/ci.yml",
    ]
    code, lines = run_check(files, {}, pr_number=1)
    assert code == 1
    assert any("host infra" in line or PACK_PR_HOST_INFRA_FAIL in line for line in lines)
    assert any("ci.yml" in line for line in lines)


def test_multi_pack_with_scripts_change_fails_without_host_labels() -> None:
    files = [
        "plugins/src/ant-colony/plugin.yml",
        "plugins/src/metro-lines/plugin.yml",
        "scripts/check_pack_pr_boundary.py",
    ]
    code, lines = run_check(files, {}, pr_number=1)
    assert code == 1
    assert any("host infra" in line or "scripts/" in line for line in lines)


def test_multi_pack_plugins_only_fails() -> None:
    files = [
        "plugins/src/ant-colony/plugin.yml",
        "plugins/src/metro-lines/plugin.yml",
        "plugins/src/ant-colony/frontend/index.ts",
        "plugins/src/metro-lines/frontend/index.ts",
    ]
    code, lines = run_check(files, {}, pr_number=1)
    assert code == 1
    assert any("must not touch multiple" in line for line in lines)


def test_multi_pack_with_host_infra_fails_even_when_reviewed() -> None:
    files = [
        "plugins/src/ant-colony/plugin.yml",
        "plugins/src/metro-lines/plugin.yml",
        ".github/workflows/ci.yml",
    ]
    code, lines = run_check(files, {}, pr_number=1, allow_host_infra=True)
    assert code == 1
    assert any("must not touch multiple" in line for line in lines)


def test_multi_pack_with_each_pack_test_still_passes() -> None:
    files = [
        "plugins/src/ant-colony/plugin.yml",
        "plugins/src/metro-lines/plugin.yml",
        "web/src/plugins/ant-colony.test.ts",
        "web/src/plugins/metro-lines.test.ts",
    ]
    code, lines = run_check(files, {}, pr_number=99)
    assert code == 1
    assert any("FAILED" in line for line in lines)


def test_host_only_pr_passes() -> None:
    files = ["web/src/plugins/viz-host.ts", "service/foo.py"]
    code, lines = run_check(files, {}, pr_number=99)
    assert code == 0
    assert any("not a pack PR" in line for line in lines)


def test_schema_only_adds_matching_pack_id() -> None:
    assert not validate_schema_py_change(SCHEMA_BASE, SCHEMA_HEAD, "ant-colony")
    bad = SCHEMA_HEAD.replace('"ant-colony"', '"wrong-pack"')
    assert validate_schema_py_change(SCHEMA_BASE, bad, "ant-colony")


def test_evaluate_rejects_foreign_web_src() -> None:
    pack = "marble-run"
    paths = [f"plugins/src/{pack}/x.ts", "web/src/plugins/viz-host.ts"]
    violations = evaluate_pack_pr(paths, pack, {}, pr_number=99)
    assert len(violations) == 1
    assert violations[0].path == "web/src/plugins/viz-host.ts"


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def test_host_change_without_review_fails_dry_run() -> None:
    push = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)
    payload = {
        "labels": ["host-change"],
        "timeline": [{"event": "committed", "created_at": _iso(push)}],
        "last_push_at": _iso(push),
    }
    code, lines = run_host_change_gate(
        set(payload["labels"]), payload["timeline"], last_push_at=push
    )
    assert code == 1
    assert any(HOST_REVIEW_FAIL_MESSAGE in line for line in lines)


def test_host_change_reviewed_after_push_passes_dry_run() -> None:
    push = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)
    review = datetime(2026, 9, 26, 13, 0, tzinfo=timezone.utc)
    timeline = [
        {"event": "committed", "created_at": _iso(push)},
        {
            "event": "labeled",
            "label": {"name": "host-reviewed"},
            "created_at": _iso(review),
        },
    ]
    code, lines = run_host_change_gate(
        {"host-change", "host-reviewed"}, timeline, last_push_at=push
    )
    assert code == 0
    assert any("check passed" in line for line in lines)


def test_host_change_push_after_review_fails_dry_run() -> None:
    review = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)
    push = datetime(2026, 9, 26, 13, 0, tzinfo=timezone.utc)
    timeline = [
        {
            "event": "labeled",
            "label": {"name": "host-reviewed"},
            "created_at": _iso(review),
        },
        {"event": "committed", "created_at": _iso(push)},
    ]
    code, lines = run_host_change_gate(
        {"host-change", "host-reviewed"}, timeline, last_push_at=push
    )
    assert code == 1
    assert any(HOST_REVIEW_FAIL_MESSAGE in line for line in lines)
    assert any("fresh review" in line for line in lines)


def test_dry_run_host_review_cli() -> None:
    from scripts.check_pack_pr_boundary import main

    payload = json.dumps({"labels": ["host-change"], "last_push_at": _iso(datetime.now(timezone.utc))})
    assert main(["--dry-run-host-review", payload]) == 1


CATALOG_EXTRA_VIEWS_TAIL = '''\
EXTRA_VIEWS = (
    "lan-heat", "lan-pong", "pulse-ts", "lan-pulse", "drone-show",
    "waves", "orbits", "helix", "skyline", "pacman", "tetris", "portal", "carousel",
    "memory", "disk", "gpu", "sockets", "cgroups", "units", "udev", "syscon",
    "cypher-cic",
    "backrooms",
)
'''


def test_catalog_extra_views_id_addition_allowed() -> None:
    pack = "voxel-world"
    base = CATALOG_EXTRA_VIEWS_TAIL
    head = base.replace(
        '    "backrooms",\n)',
        '    "backrooms",\n    "voxel-world",\n)',
    )
    assert not validate_catalog_py_change(base, head, pack)


def test_voxel_world_style_pack_pr_passes() -> None:
    pack = "voxel-world"
    files = [
        f"plugins/src/{pack}/plugin.yml",
        f"plugins/src/{pack}/vitest.config.mts",
        pack_py_test_path(pack),
        ALLOWED_CATALOG_PATH,
    ]
    base = CATALOG_EXTRA_VIEWS_TAIL
    head = base.replace(
        '    "backrooms",\n)',
        '    "backrooms",\n    "voxel-world",\n)',
    )
    contents = _contents({ALLOWED_CATALOG_PATH: (base, head)})
    code, lines = run_check(files, contents, pr_number=99)
    assert code == 0
    assert any("passed" in line for line in lines)


def test_catalog_non_id_edit_rejected() -> None:
    pack = "voxel-world"
    head = CATALOG_EXTRA_VIEWS_TAIL.replace(
        "EXTRA_VIEWS", "EXTRA_VIEWSRenamed"
    )
    assert validate_catalog_py_change(CATALOG_EXTRA_VIEWS_TAIL, head, pack)


def test_name_status_includes_rename_source_and_dest() -> None:
    text = "R100\tweb/src/plugins/viz-host.ts\tplugins/src/foo/frontend/host.ts\n"
    assert paths_from_name_status(text) == [
        "plugins/src/foo/frontend/host.ts",
        "web/src/plugins/viz-host.ts",
    ]


def test_pack_pr_rejects_revert_proofs_tree() -> None:
    pack = "nixie-clock"
    files = [
        f"plugins/src/{pack}/frontend/index.ts",
        "revert-proofs/112/x.patch",
    ]
    code, lines = run_check(files, {}, pr_number=111)
    assert code == 1
    assert any("revert-proofs/" in line for line in lines)


def test_pack_pr_rejects_own_revert_proofs_folder() -> None:
    pack = "nixie-clock"
    files = [
        f"plugins/src/{pack}/frontend/index.ts",
        "revert-proofs/111/nixie-fc-glsl-revert.patch",
        "revert-proofs/111/nixie-fc-glsl-revert.json",
    ]
    code, lines = run_check(files, {}, pr_number=111)
    assert code == 1
    assert any("revert-proofs/" in line for line in lines)


def test_pack_pr_rejects_second_pack_folder() -> None:
    files = [
        "plugins/src/nixie-clock/frontend/index.ts",
        "plugins/src/metro-lines/plugin.yml",
    ]
    code, lines = run_check(files, {}, pr_number=111)
    assert code == 1
    assert any("metro-lines" in line for line in lines)


def test_cli_missing_pr_number_exits_nonzero() -> None:
    import os
    import subprocess
    import sys
    from pathlib import Path

    repo = Path(__file__).resolve().parents[1]
    env = os.environ.copy()
    env.pop("GITHUB_EVENT_PATH", None)
    proc = subprocess.run(
        [
            sys.executable,
            str(repo / "scripts" / "check_pack_pr_boundary.py"),
            "HEAD",
            "HEAD",
        ],
        cwd=repo,
        env=env,
        capture_output=True,
        text=True,
    )
    assert proc.returncode != 0
    assert "missing pull request number" in proc.stderr
    assert MISSING_PR_NUMBER_MESSAGE in proc.stderr


def test_pack_pr_rejects_revert_proofs_1111_prefix_trap() -> None:
    pack = "nixie-clock"
    files = [
        f"plugins/src/{pack}/frontend/index.ts",
        "revert-proofs/1111/x.patch",
    ]
    code, lines = run_check(files, {}, pr_number=111)
    assert code == 1
    assert any("1111" in line for line in lines)


def test_pack_pr_rejects_revert_proofs_104_on_pr_111() -> None:
    pack = "nixie-clock"
    files = [
        f"plugins/src/{pack}/frontend/index.ts",
        "revert-proofs/104/legacy.patch",
    ]
    code, lines = run_check(files, {}, pr_number=111)
    assert code == 1
    assert any("104" in line for line in lines)


def test_pull_files_rename_counts_one_changed_file() -> None:
    pages = [
        [
            {
                "filename": "plugins/src/demo-pack/plugin.yml",
                "previous_filename": "plugins/src/demo-pack/plugin.old.yml",
                "status": "renamed",
            }
        ]
    ]
    paths = paths_from_pull_files_pages(pages)
    assert paths == ["plugins/src/demo-pack/plugin.yml"]
    assert validate_pull_changed_files_complete(paths, 1) is None


def test_paths_from_pull_files_fixture_includes_rename_and_host_script() -> None:
    import json
    from pathlib import Path

    from scripts.check_pack_pr_boundary import paths_from_pull_files_pages_with_renames

    pages = json.loads(
        (Path(__file__).parent / "fixtures/pack-boundary/pull-files-pages.json").read_text()
    )
    listed = paths_from_pull_files_pages(pages)
    paths = paths_from_pull_files_pages_with_renames(pages)
    assert "plugins/src/ant-colony/plugin.yml" in listed
    assert "scripts/check_pack_pr_boundary.py" in paths
    code, lines = run_check(paths, {}, pr_number=1)
    assert code == 1
    assert any(PACK_PR_HOST_INFRA_FAIL in line or "host infra" in line for line in lines)


def test_pack_pr_editing_workflow_yaml_is_host_infra() -> None:
    """CI runs base-branch script via pull_request_target; these paths need host labels."""
    files = [
        "plugins/src/demo-pack/plugin.yml",
        ".github/workflows/pack-boundary.yml",
    ]
    code, lines = run_check(files, {}, pr_number=1)
    assert code == 1
    assert any("pack-boundary.yml" in line for line in lines)
    assert any(PACK_PR_HOST_INFRA_FAIL in line or "host infra" in line for line in lines)


def test_merge_workflow_label_event_appends_host_reviewed() -> None:
    import os

    os.environ["PACK_BOUNDARY_EVENT_ACTION"] = "labeled"
    os.environ["PACK_BOUNDARY_EVENT_LABEL_NAME"] = "host-reviewed"
    os.environ["PACK_BOUNDARY_EVENT_LABEL_CREATED_AT"] = "2026-09-26T14:00:00Z"
    try:
        merged = merge_workflow_label_event([])
    finally:
        os.environ.pop("PACK_BOUNDARY_EVENT_ACTION", None)
        os.environ.pop("PACK_BOUNDARY_EVENT_LABEL_NAME", None)
        os.environ.pop("PACK_BOUNDARY_EVENT_LABEL_CREATED_AT", None)
    assert len(merged) == 1
    assert merged[0]["event"] == "labeled"


def test_fetch_pull_changed_files_rejects_non_array_page() -> None:
    def fake_request(url: str, token: str) -> tuple[object, str | None]:
        return ({}, None)

    with patch("scripts.check_pack_pr_boundary._github_request", fake_request):
        rejected = False
        try:
            fetch_pull_changed_files("org/repo", 1, "token")
        except ValueError as exc:
            rejected = "non-array" in str(exc)
        assert rejected is True


def test_validate_pull_changed_files_rejects_incomplete_listing() -> None:
    err = validate_pull_changed_files_complete(["a.py"], 2)
    assert err is not None
    assert "incomplete" in err


def test_validate_pull_changed_files_rejects_over_api_cap() -> None:
    over = GITHUB_PULL_FILES_API_MAX + 1
    err = validate_pull_changed_files_complete(["x"] * over, over)
    assert err is not None
    assert f">={GITHUB_PULL_FILES_API_MAX}" in err
    assert "cannot verify the full change set" in err


def test_validate_pull_changed_files_rejects_at_api_limit() -> None:
    limit = GITHUB_PULL_FILES_API_MAX
    err = validate_pull_changed_files_complete(["x"] * limit, limit)
    assert err is not None
    assert f">={limit}" in err


def test_committed_event_timestamp_ignores_committer_date() -> None:
    from scripts.check_pack_pr_boundary import _committed_event_timestamp

    assert _committed_event_timestamp({"committer": {"date": "2026-09-26T15:00:00Z"}}) is None
    ts = _committed_event_timestamp({"created_at": "2026-09-26T14:00:00Z"})
    assert ts is not None
    assert ts.year == 2026


def test_rename_lists_predecessor_for_boundary_scan() -> None:
    from scripts.check_pack_pr_boundary import (
        paths_from_pull_files_pages,
        paths_from_pull_files_pages_with_renames,
    )

    page = [
        {
            "filename": "plugins/src/demo-pack/plugin.yml",
            "previous_filename": "scripts/check_pack_pr_boundary.py",
            "status": "renamed",
        }
    ]
    assert paths_from_pull_files_pages([page]) == ["plugins/src/demo-pack/plugin.yml"]
    assert set(paths_from_pull_files_pages_with_renames([page])) == {
        "plugins/src/demo-pack/plugin.yml",
        "scripts/check_pack_pr_boundary.py",
    }


def test_weakened_pr_checker_in_tree_still_fails_with_head_contents() -> None:
    noop = "def run_check(*_a, **_k):\n    return 0, ['pack-boundary: passed.']\n"
    changed = [
        "plugins/src/demo-pack/plugin.yml",
        "scripts/check_pack_pr_boundary.py",
    ]
    contents = {
        "scripts/check_pack_pr_boundary.py": (None, noop),
    }
    code, lines = run_check(changed, contents, pr_number=1, allow_host_infra=False)
    assert code == 1
    assert any(PACK_PR_HOST_INFRA_FAIL in line or "host infra" in line for line in lines)
