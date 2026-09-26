#!/usr/bin/env python3
"""Enforce pack PR boundary: one plugins/src/<pack>/ plus allowlisted paths only."""
from __future__ import annotations

import argparse
import ast
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import PurePosixPath

PACK_SRC_RE = re.compile(r"^plugins/src/([^/]+)/")
ALLOWED_SCHEMA_PATH = "tests/test_plugin_schema.py"
ALLOWED_TSCONFIG_PATH = "web/tsconfig.json"
VIZ_VALIDATE_FUNC = "test_viz_plugin_yml_validates"


@dataclass(frozen=True)
class Violation:
    path: str
    reason: str


def detect_packs(changed_files: list[str]) -> set[str]:
    packs: set[str] = set()
    for path in changed_files:
        match = PACK_SRC_RE.match(path)
        if match:
            packs.add(match.group(1))
    return packs


def is_pack_test_file(path: str, pack: str) -> bool:
    prefix = "web/src/plugins/"
    if not path.startswith(prefix) or not path.endswith(".test.ts"):
        return False
    stem = PurePosixPath(path).stem
    if stem.endswith(".test"):
        stem = stem[: -len(".test")]
    return stem == pack or stem.startswith(f"{pack}-")


def _plugin_tuple_from_viz_test(tree: ast.Module) -> ast.Tuple | None:
    for node in tree.body:
        if not isinstance(node, ast.FunctionDef) or node.name != VIZ_VALIDATE_FUNC:
            continue
        for stmt in node.body:
            if not isinstance(stmt, ast.For):
                continue
            if isinstance(stmt.iter, ast.Tuple):
                return stmt.iter
    return None


def _tuple_string_literals(node: ast.Tuple) -> list[str] | None:
    values: list[str] = []
    for elt in node.elts:
        if not isinstance(elt, ast.Constant) or not isinstance(elt.value, str):
            return None
        values.append(elt.value)
    return values


def validate_schema_py_change(base_text: str, head_text: str, pack: str) -> list[Violation]:
    if base_text == head_text:
        return []
    try:
        base_tree = ast.parse(base_text)
        head_tree = ast.parse(head_text)
    except SyntaxError as exc:
        return [
            Violation(
                ALLOWED_SCHEMA_PATH,
                f"could not parse {ALLOWED_SCHEMA_PATH}: {exc}",
            )
        ]

    base_tuple = _plugin_tuple_from_viz_test(base_tree)
    head_tuple = _plugin_tuple_from_viz_test(head_tree)
    if base_tuple is None or head_tuple is None:
        return [
            Violation(
                ALLOWED_SCHEMA_PATH,
                f"expected {VIZ_VALIDATE_FUNC} to iterate a literal tuple of pack ids",
            )
        ]

    base_ids = _tuple_string_literals(base_tuple)
    head_ids = _tuple_string_literals(head_tuple)
    if base_ids is None or head_ids is None:
        return [
            Violation(
                ALLOWED_SCHEMA_PATH,
                "pack id tuple must contain only string literals",
            )
        ]

    base_norm = ast.dump(base_tree, annotate_fields=False)
    head_norm = ast.dump(head_tree, annotate_fields=False)
    base_tuple_dump = ast.dump(base_tuple, annotate_fields=False)
    head_tuple_dump = ast.dump(head_tuple, annotate_fields=False)

    if base_norm.replace(base_tuple_dump, "") != head_norm.replace(head_tuple_dump, ""):
        return [
            Violation(
                ALLOWED_SCHEMA_PATH,
                "only allowed change is adding one pack id to "
                f"{VIZ_VALIDATE_FUNC} tuple",
            )
        ]

    if head_ids[:-1] != base_ids and head_ids[1:] != base_ids:
        return [
            Violation(
                ALLOWED_SCHEMA_PATH,
                "tuple change must be exactly one added pack id (no reorder/removal)",
            )
        ]
    if len(head_ids) != len(base_ids) + 1:
        return [
            Violation(
                ALLOWED_SCHEMA_PATH,
                "tuple change must add exactly one pack id",
            )
        ]
    added = set(head_ids) - set(base_ids)
    if added != {pack}:
        return [
            Violation(
                ALLOWED_SCHEMA_PATH,
                f"added pack id must be {pack!r}, got {sorted(added)!r}",
            )
        ]
    return []


def validate_tsconfig_change(base_text: str, head_text: str, pack: str) -> list[Violation]:
    if base_text == head_text:
        return []
    try:
        base_doc = json.loads(base_text)
        head_doc = json.loads(head_text)
    except json.JSONDecodeError as exc:
        return [Violation(ALLOWED_TSCONFIG_PATH, f"invalid JSON: {exc}")]

    base_keys = set(base_doc)
    head_keys = set(head_doc)
    if base_keys != head_keys:
        return [
            Violation(
                ALLOWED_TSCONFIG_PATH,
                "only the include list may change (top-level keys differ)",
            )
        ]

    for key in base_keys:
        if key == "include":
            continue
        if base_doc[key] != head_doc[key]:
            return [
                Violation(
                    ALLOWED_TSCONFIG_PATH,
                    f"field {key!r} must not change in a pack PR",
                )
            ]

    base_include = list(base_doc.get("include", []))
    head_include = list(head_doc.get("include", []))
    if base_include == head_include:
        return [
            Violation(
                ALLOWED_TSCONFIG_PATH,
                "file changed but include list is identical (unexpected diff)",
            )
        ]

    base_set = set(base_include)
    head_set = set(head_include)
    removed = base_set - head_set
    added = head_set - base_set

    violations: list[Violation] = []
    pack_prefix = f"../plugins/src/{pack}/"
    for path in sorted(removed):
        violations.append(
            Violation(
                ALLOWED_TSCONFIG_PATH,
                f"include entry removed ({path!r}); only additions are allowed",
            )
        )

    for path in sorted(added):
        if path.startswith(pack_prefix):
            continue
        if path == "src" or path.startswith("src/"):
            continue
        violations.append(
            Violation(
                ALLOWED_TSCONFIG_PATH,
                f"include addition {path!r} must point under {pack_prefix} or src/",
            )
        )
    return violations


def evaluate_pack_pr(
    changed_files: list[str],
    pack: str,
    file_contents: dict[str, tuple[str | None, str | None]],
) -> list[Violation]:
    """Validate a single-pack PR. file_contents maps path -> (base, head) text."""
    violations: list[Violation] = []
    pack_prefix = f"plugins/src/{pack}/"

    for path in sorted(changed_files):
        if path.startswith(pack_prefix):
            continue
        if is_pack_test_file(path, pack):
            continue
        if path == ALLOWED_TSCONFIG_PATH:
            base_text, head_text = file_contents.get(path, (None, None))
            if base_text is None:
                base_text = "{}"
            if head_text is None:
                violations.append(
                    Violation(path, "missing head content for tsconfig.json")
                )
                continue
            violations.extend(validate_tsconfig_change(base_text, head_text, pack))
            continue
        if path == ALLOWED_SCHEMA_PATH:
            base_text, head_text = file_contents.get(path, (None, None))
            if head_text is None:
                violations.append(
                    Violation(path, "missing head content for schema test file")
                )
                continue
            violations.extend(
                validate_schema_py_change(base_text or "", head_text, pack)
            )
            continue
        violations.append(
            Violation(
                path,
                "outside pack folder and not on the pack PR allowlist",
            )
        )
    return violations


def run_check(
    changed_files: list[str],
    file_contents: dict[str, tuple[str | None, str | None]],
) -> tuple[int, list[str]]:
    """Return (exit_code, lines to print)."""
    lines: list[str] = []
    packs = detect_packs(changed_files)

    if not packs:
        lines.append(
            "pack-boundary: not a pack PR (no plugins/src/<pack>/ changes); check passed."
        )
        return 0, lines

    if len(packs) > 1:
        lines.append(
            "pack-boundary: not a pack PR "
            f"(multiple pack folders: {', '.join(sorted(packs))}); check passed."
        )
        return 0, lines

    pack = next(iter(packs))
    lines.append(f"pack-boundary: validating pack PR for {pack!r}.")
    violations = evaluate_pack_pr(changed_files, pack, file_contents)
    if violations:
        lines.append("pack-boundary: FAILED")
        for v in violations:
            lines.append(f"  {v.path}: {v.reason}")
        return 1, lines

    lines.append("pack-boundary: passed.")
    return 0, lines


def git_diff_name_only(base: str, head: str) -> list[str]:
    proc = subprocess.run(
        ["git", "diff", "--name-only", f"{base}...{head}"],
        check=True,
        capture_output=True,
        text=True,
    )
    return [line for line in proc.stdout.splitlines() if line.strip()]


def git_show(ref: str, path: str) -> str | None:
    proc = subprocess.run(
        ["git", "show", f"{ref}:{path}"],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        return None
    return proc.stdout


def load_file_pair(base: str, head: str, path: str) -> tuple[str | None, str | None]:
    return git_show(base, path), git_show(head, path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base", help="base git ref (merge base side of ... range)")
    parser.add_argument("head", help="head git ref")
    args = parser.parse_args(argv)

    changed = git_diff_name_only(args.base, args.head)
    contents: dict[str, tuple[str | None, str | None]] = {}
    for path in changed:
        if path in (ALLOWED_TSCONFIG_PATH, ALLOWED_SCHEMA_PATH):
            contents[path] = load_file_pair(args.base, args.head, path)

    code, lines = run_check(changed, contents)
    for line in lines:
        print(line)
    return code


if __name__ == "__main__":
    sys.exit(main())
