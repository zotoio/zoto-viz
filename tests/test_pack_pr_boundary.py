from __future__ import annotations

from scripts.check_pack_pr_boundary import (
    ALLOWED_SCHEMA_PATH,
    ALLOWED_TSCONFIG_PATH,
    evaluate_pack_pr,
    run_check,
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
