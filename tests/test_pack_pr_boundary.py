from __future__ import annotations

import json
from datetime import datetime, timezone

from scripts.check_pack_pr_boundary import (
    ALLOWED_CATALOG_PATH,
    ALLOWED_SCHEMA_PATH,
    ALLOWED_TSCONFIG_PATH,
    HOST_REVIEW_FAIL_MESSAGE,
    evaluate_pack_pr,
    pack_py_test_path,
    run_check,
    run_host_change_gate,
    validate_catalog_py_change,
    validate_schema_py_change,
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
    code, lines = run_check(files + [ALLOWED_TSCONFIG_PATH], contents)
    assert code == 0
    assert any("passed" in line for line in lines)


def test_pack_pr_viz_host_edit_fails() -> None:
    pack = "marble-run"
    files = [
        f"plugins/src/{pack}/plugin.yml",
        f"web/src/plugins/{pack}.test.ts",
        "web/src/plugins/viz-host.ts",
    ]
    code, lines = run_check(files, {})
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
    code, lines = run_check(files, {})
    assert code == 0
    assert any("multiple pack folders" in line for line in lines)


def test_multi_pack_with_host_web_src_fails() -> None:
    files = [
        "plugins/src/ant-colony/plugin.yml",
        "plugins/src/metro-lines/plugin.yml",
        "web/src/plugins/viz-host.ts",
    ]
    code, lines = run_check(files, {})
    assert code == 1
    assert any("multi-pack PR" in line for line in lines)
    assert any("viz-host.ts" in line for line in lines)


def test_multi_pack_with_each_pack_test_still_passes() -> None:
    files = [
        "plugins/src/ant-colony/plugin.yml",
        "plugins/src/metro-lines/plugin.yml",
        "web/src/plugins/ant-colony.test.ts",
        "web/src/plugins/metro-lines.test.ts",
    ]
    code, lines = run_check(files, {})
    assert code == 0
    assert any("multiple pack folders" in line for line in lines)


def test_host_only_pr_passes() -> None:
    files = ["web/src/plugins/viz-host.ts", "service/foo.py"]
    code, lines = run_check(files, {})
    assert code == 0
    assert any("not a pack PR" in line for line in lines)


def test_schema_only_adds_matching_pack_id() -> None:
    assert not validate_schema_py_change(SCHEMA_BASE, SCHEMA_HEAD, "ant-colony")
    bad = SCHEMA_HEAD.replace('"ant-colony"', '"wrong-pack"')
    assert validate_schema_py_change(SCHEMA_BASE, bad, "ant-colony")


def test_evaluate_rejects_foreign_web_src() -> None:
    pack = "marble-run"
    paths = [f"plugins/src/{pack}/x.ts", "web/src/plugins/viz-host.ts"]
    violations = evaluate_pack_pr(paths, pack, {})
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
    code, lines = run_check(files, contents)
    assert code == 0
    assert any("passed" in line for line in lines)


def test_catalog_non_id_edit_rejected() -> None:
    pack = "voxel-world"
    head = CATALOG_EXTRA_VIEWS_TAIL.replace(
        "EXTRA_VIEWS", "EXTRA_VIEWSRenamed"
    )
    assert validate_catalog_py_change(CATALOG_EXTRA_VIEWS_TAIL, head, pack)
