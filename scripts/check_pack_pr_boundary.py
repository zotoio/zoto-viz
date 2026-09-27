#!/usr/bin/env python3
"""Enforce pack PR boundary: one plugins/src/<pack>/ plus allowlisted paths only."""
from __future__ import annotations

import argparse
import ast
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Any

PACK_SRC_RE = re.compile(r"^plugins/src/([^/]+)/")
ALLOWED_SCHEMA_PATH = "tests/test_plugin_schema.py"
ALLOWED_CATALOG_PATH = "tests/test_plugin_catalog.py"
ALLOWED_TSCONFIG_PATH = "web/tsconfig.json"
VIZ_VALIDATE_FUNC = "test_viz_plugin_yml_validates"
HOST_CHANGE_LABEL = "host-change"
HOST_REVIEWED_LABEL = "host-reviewed"
HOST_REVIEW_FAIL_MESSAGE = "host change: needs human review before merge"
MISSING_PR_NUMBER_MESSAGE = (
    "pack-boundary: FAILED — missing pull request number "
    "(set --pr N or provide pull_request.number in GITHUB_EVENT_PATH)"
)
CSP_SANDBOX_CONFIG_PATHS = frozenset(
    {
        "web/index.html",
        "web/src/plugins/host.ts",
    }
)


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


def pack_py_test_path(pack: str) -> str:
    return f"tests/test_{pack.replace('-', '_')}_pack.py"


def is_pack_py_test_file(path: str, pack: str) -> bool:
    return path == pack_py_test_path(pack)


def revert_proofs_folder_segment(path: str) -> str | None:
    """Second path segment under revert-proofs/, or None if not under that tree."""
    if not path.startswith("revert-proofs/"):
        return None
    parts = path.split("/")
    if len(parts) < 2 or not parts[1]:
        return None
    return parts[1]


def revert_proofs_violation(path: str, pr_number: int) -> Violation | None:
    """Reject revert-proofs/<other>/ on this PR; allow only revert-proofs/<pr_number>/."""
    segment = revert_proofs_folder_segment(path)
    if segment is None:
        return None
    if segment == str(pr_number):
        return None
    return Violation(
        path,
        f"revert-proofs/{segment}/ is not allowed for PR #{pr_number} "
        f"(only revert-proofs/{pr_number}/)",
    )


def is_allowed_multipack_web_src(path: str, packs: set[str]) -> bool:
    return any(is_pack_test_file(path, pack) for pack in packs)


def is_multipack_forbidden_host_path(path: str, packs: set[str]) -> bool:
    """Host/sensitive paths that must not ride along with a multi-pack PR."""
    if path.startswith("service/"):
        return True
    if path.startswith("plugins/sdk/"):
        return True
    if path in CSP_SANDBOX_CONFIG_PATHS:
        return True
    if path.startswith("web/src/"):
        return not is_allowed_multipack_web_src(path, packs)
    return False


def evaluate_multipack_pr(changed_files: list[str], packs: set[str]) -> list[Violation]:
    violations: list[Violation] = []
    for path in sorted(changed_files):
        if not is_multipack_forbidden_host_path(path, packs):
            continue
        violations.append(
            Violation(
                path,
                "multi-pack PR cannot change host, service, sdk, CSP/sandbox, "
                "or web/src (except that pack's plugin tests) without the "
                "host-change label",
            )
        )
    return violations


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


def _tuple_string_literals(node: ast.Tuple | ast.List) -> list[str] | None:
    values: list[str] = []
    for elt in node.elts:
        if not isinstance(elt, ast.Constant) or not isinstance(elt.value, str):
            return None
        values.append(elt.value)
    return values


def _module_level_id_collections(tree: ast.Module) -> dict[str, ast.Tuple | ast.List]:
    collections: dict[str, ast.Tuple | ast.List] = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if not isinstance(target, ast.Name):
            continue
        if not isinstance(node.value, (ast.Tuple, ast.List)):
            continue
        if _tuple_string_literals(node.value) is None:
            continue
        collections[target.id] = node.value
    return collections


def validate_catalog_py_change(base_text: str, head_text: str, pack: str) -> list[Violation]:
    if base_text == head_text:
        return []
    try:
        base_tree = ast.parse(base_text)
        head_tree = ast.parse(head_text)
    except SyntaxError as exc:
        return [
            Violation(
                ALLOWED_CATALOG_PATH,
                f"could not parse {ALLOWED_CATALOG_PATH}: {exc}",
            )
        ]

    base_collections = _module_level_id_collections(base_tree)
    head_collections = _module_level_id_collections(head_tree)

    def ids_for(collections: dict[str, ast.Tuple | ast.List], name: str) -> list[str]:
        node = collections.get(name)
        if node is None:
            return []
        return _tuple_string_literals(node) or []

    changed_names = sorted(
        name
        for name in set(base_collections) | set(head_collections)
        if ids_for(base_collections, name) != ids_for(head_collections, name)
    )
    if len(changed_names) != 1:
        return [
            Violation(
                ALLOWED_CATALOG_PATH,
                "only allowed change is adding one pack id to a module-level "
                "id tuple or list",
            )
        ]

    name = changed_names[0]
    base_node = base_collections.get(name)
    head_node = head_collections.get(name)
    if base_node is None or head_node is None:
        return [
            Violation(
                ALLOWED_CATALOG_PATH,
                "pack id tuple/list must be updated in place, not added/removed",
            )
        ]

    base_ids = _tuple_string_literals(base_node) or []
    head_ids = _tuple_string_literals(head_node) or []

    base_norm = ast.dump(base_tree, annotate_fields=False)
    head_norm = ast.dump(head_tree, annotate_fields=False)
    base_coll_dump = ast.dump(base_node, annotate_fields=False)
    head_coll_dump = ast.dump(head_node, annotate_fields=False)
    if base_norm.replace(base_coll_dump, "") != head_norm.replace(head_coll_dump, ""):
        return [
            Violation(
                ALLOWED_CATALOG_PATH,
                "only allowed change is adding one pack id to an id tuple or list",
            )
        ]

    if head_ids[:-1] != base_ids and head_ids[1:] != base_ids:
        return [
            Violation(
                ALLOWED_CATALOG_PATH,
                "id list change must be exactly one added pack id (no reorder/removal)",
            )
        ]
    if len(head_ids) != len(base_ids) + 1:
        return [
            Violation(
                ALLOWED_CATALOG_PATH,
                "id list change must add exactly one pack id",
            )
        ]
    added = set(head_ids) - set(base_ids)
    if added != {pack}:
        return [
            Violation(
                ALLOWED_CATALOG_PATH,
                f"added pack id must be {pack!r}, got {sorted(added)!r}",
            )
        ]
    return []


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
    pr_number: int,
) -> list[Violation]:
    """Validate a single-pack PR. file_contents maps path -> (base, head) text."""
    violations: list[Violation] = []
    pack_prefix = f"plugins/src/{pack}/"

    for path in sorted(changed_files):
        if path.startswith(pack_prefix):
            continue
        rev_v = revert_proofs_violation(path, pr_number)
        if rev_v is None and revert_proofs_folder_segment(path) is not None:
            continue
        if rev_v is not None:
            violations.append(rev_v)
            continue
        if is_pack_test_file(path, pack):
            continue
        if is_pack_py_test_file(path, pack):
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
        if path == ALLOWED_CATALOG_PATH:
            base_text, head_text = file_contents.get(path, (None, None))
            if head_text is None:
                violations.append(
                    Violation(path, "missing head content for catalog test file")
                )
                continue
            violations.extend(
                validate_catalog_py_change(base_text or "", head_text, pack)
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
    pr_number: int,
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
        pack_list = ", ".join(sorted(packs))
        violations = evaluate_multipack_pr(changed_files, packs)
        if violations:
            lines.append(
                "pack-boundary: multi-pack PR "
                f"({pack_list}) with forbidden host changes; FAILED"
            )
            for v in violations:
                lines.append(f"  {v.path}: {v.reason}")
            return 1, lines
        lines.append(
            "pack-boundary: FAILED — pack PR must not touch multiple "
            f"plugins/src/<pack>/ folders ({pack_list})"
        )
        return 1, lines

    pack = next(iter(packs))
    lines.append(f"pack-boundary: validating pack PR for {pack!r}.")
    violations = evaluate_pack_pr(changed_files, pack, file_contents, pr_number)
    if violations:
        lines.append("pack-boundary: FAILED")
        for v in violations:
            lines.append(f"  {v.path}: {v.reason}")
        return 1, lines

    lines.append("pack-boundary: passed.")
    return 0, lines


def git_diff_changed_paths(base: str, head: str) -> list[str]:
    proc = subprocess.run(
        ["git", "diff", "--name-status", "-M", f"{base}...{head}"],
        check=True,
        capture_output=True,
        text=True,
    )
    return paths_from_name_status(proc.stdout)


def paths_from_name_status(text: str) -> list[str]:
    paths: set[str] = set()
    for line in text.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        status = parts[0]
        if status.startswith(("R", "C")) and len(parts) >= 3:
            paths.add(parts[1])
            paths.add(parts[2])
        elif len(parts) >= 2:
            paths.add(parts[1])
    return sorted(paths)


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


def pr_number_from_github_event() -> int | None:
    event_path = os.environ.get("GITHUB_EVENT_PATH")
    if not event_path:
        return None
    try:
        with open(event_path, encoding="utf-8") as handle:
            event = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    pull = event.get("pull_request")
    if not isinstance(pull, dict):
        return None
    number = pull.get("number")
    if isinstance(number, int):
        return number
    if isinstance(number, str) and number.isdigit():
        return int(number)
    return None


def resolve_pr_number(cli_pr: int | None) -> int | None:
    if cli_pr is not None:
        return cli_pr
    return pr_number_from_github_event()


def parse_github_timestamp(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value).astimezone(timezone.utc)


def _github_request(url: str, token: str) -> tuple[Any, str | None]:
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(req) as resp:
        body = resp.read()
        next_url = None
        link = resp.headers.get("Link")
        if link:
            for part in link.split(","):
                if 'rel="next"' in part:
                    next_url = part.split(";")[0].strip(" <>")
                    break
        return json.loads(body), next_url


def fetch_issue_labels(repo: str, issue_number: int, token: str) -> set[str]:
    owner, name = repo.split("/", 1)
    url = (
        f"https://api.github.com/repos/{owner}/{name}/issues/{issue_number}"
    )
    doc, _ = _github_request(url, token)
    return {label["name"] for label in doc.get("labels", [])}


def fetch_pull_head_commit_date(
    repo: str, pull_number: int, token: str
) -> datetime | None:
    owner, name = repo.split("/", 1)
    url = (
        f"https://api.github.com/repos/{owner}/{name}/pulls/{pull_number}/commits"
        "?per_page=100"
    )
    commits: list[dict] = []
    while url:
        page, url = _github_request(url, token)
        if not isinstance(page, list):
            break
        commits.extend(page)
    if not commits:
        return None
    last = commits[-1].get("commit", {}).get("committer", {}).get("date")
    if not last:
        return None
    return parse_github_timestamp(last)


def fetch_labeled_events(repo: str, issue_number: int, token: str) -> list[dict]:
    """Issue events API (labeled/unlabeled); fallback if timeline is unavailable."""
    owner, name = repo.split("/", 1)
    url = (
        f"https://api.github.com/repos/{owner}/{name}/issues/{issue_number}/events"
        "?per_page=100"
    )
    items: list[dict] = []
    while url:
        page, url = _github_request(url, token)
        if not isinstance(page, list):
            break
        for row in page:
            event = row.get("event")
            if event in ("labeled", "unlabeled"):
                items.append(row)
    return items


    return items


def fetch_issue_timeline(repo: str, issue_number: int, token: str) -> list[dict]:
    owner, name = repo.split("/", 1)
    url = (
        f"https://api.github.com/repos/{owner}/{name}/issues/"
        f"{issue_number}/timeline?per_page=100"
    )
    items: list[dict] = []
    while url:
        page, url = _github_request(url, token)
        if not isinstance(page, list):
            break
        items.extend(page)
    return items


def load_pr_review_context(
    repo: str, issue_number: int, token: str
) -> tuple[set[str], list[dict], datetime | None]:
    labels = fetch_issue_labels(repo, issue_number, token)
    try:
        timeline = fetch_issue_timeline(repo, issue_number, token)
    except urllib.error.HTTPError:
        timeline = fetch_labeled_events(repo, issue_number, token)
    push_at = last_push_at_from_timeline(timeline)
    head_commit_at = fetch_pull_head_commit_date(repo, issue_number, token)
    if head_commit_at is not None and (push_at is None or head_commit_at > push_at):
        push_at = head_commit_at
    return labels, timeline, push_at


def last_push_at_from_timeline(timeline: list[dict]) -> datetime | None:
    latest: datetime | None = None
    for item in timeline:
        event = item.get("event")
        if event == "head_ref_force_pushed":
            created = item.get("created_at")
            if not created:
                continue
            ts = parse_github_timestamp(created)
        elif event == "committed":
            ts = _committed_event_timestamp(item)
            if ts is None:
                continue
        else:
            continue
        if latest is None or ts > latest:
            latest = ts
    return latest


def _committed_event_timestamp(item: dict) -> datetime | None:
    created = item.get("created_at")
    if created:
        return parse_github_timestamp(created)
    for role in ("committer", "author"):
        date = (item.get(role) or {}).get("date")
        if date:
            return parse_github_timestamp(date)
    commit = item.get("commit") or {}
    for role in ("committer", "author"):
        date = (commit.get(role) or {}).get("date")
        if date:
            return parse_github_timestamp(date)
    return None


def host_reviewed_labeled_at(
    timeline: list[dict], current_labels: set[str]
) -> datetime | None:
    if HOST_REVIEWED_LABEL not in current_labels:
        return None
    review_at: datetime | None = None
    for item in sorted(timeline, key=lambda row: row.get("created_at", "")):
        event = item.get("event")
        label = item.get("label") or {}
        name = label.get("name")
        if event == "labeled" and name == HOST_REVIEWED_LABEL:
            created = item.get("created_at")
            if created:
                review_at = parse_github_timestamp(created)
        elif event == "unlabeled" and name == HOST_REVIEWED_LABEL:
            review_at = None
    return review_at


def run_host_change_gate(
    labels: set[str],
    timeline: list[dict],
    *,
    last_push_at: datetime | None = None,
) -> tuple[int, list[str]]:
    """Return exit code and log lines for host-change labelled PRs."""
    lines: list[str] = []
    if HOST_CHANGE_LABEL not in labels:
        return 0, lines

    lines.append("pack-boundary: host-change label present; checking review gate.")
    push_at = last_push_at if last_push_at is not None else last_push_at_from_timeline(
        timeline
    )
    review_at = host_reviewed_labeled_at(timeline, labels)

    if review_at is None or push_at is None or push_at >= review_at:
        lines.append(f"pack-boundary: FAILED — {HOST_REVIEW_FAIL_MESSAGE}")
        if push_at is not None and review_at is not None and push_at >= review_at:
            lines.append(
                "  latest push is at or after host-reviewed label "
                "(new commits need a fresh review)"
            )
        elif review_at is None:
            lines.append(f"  missing {HOST_REVIEWED_LABEL!r} label on the pull request")
        elif push_at is None:
            lines.append("  could not determine latest push time from timeline")
        return 1, lines

    lines.append(
        "pack-boundary: host-change PR reviewed "
        f"(push {push_at.isoformat()} before review {review_at.isoformat()}); "
        "check passed."
    )
    return 0, lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base", nargs="?", help="base git ref (merge base side of ... range)")
    parser.add_argument("head", nargs="?", help="head git ref")
    parser.add_argument(
        "--repo",
        help="GitHub owner/repo for label and timeline lookup (requires GITHUB_TOKEN)",
    )
    parser.add_argument(
        "--pr",
        "--pr-number",
        type=int,
        dest="pr_number",
        help="Pull request number (required locally; CI may use GITHUB_EVENT_PATH)",
    )
    parser.add_argument(
        "--dry-run-host-review",
        metavar="JSON",
        help="JSON object with labels, timeline, optional last_push_at (ISO); "
        "skips git diff and pack rules",
    )
    args = parser.parse_args(argv)

    if args.dry_run_host_review:
        payload = json.loads(args.dry_run_host_review)
        labels = set(payload.get("labels", []))
        timeline = payload.get("timeline", [])
        push_raw = payload.get("last_push_at")
        push_at = parse_github_timestamp(push_raw) if push_raw else None
        code, lines = run_host_change_gate(labels, timeline, last_push_at=push_at)
        for line in lines:
            print(line)
        return code

    if not args.base or not args.head:
        parser.error("base and head refs are required unless --dry-run-host-review is set")

    pr_number = resolve_pr_number(args.pr_number)
    if pr_number is None:
        print(MISSING_PR_NUMBER_MESSAGE, file=sys.stderr)
        return 1

    token = os.environ.get("GITHUB_TOKEN", "")
    if args.repo and args.pr_number:
        if not token:
            print("pack-boundary: FAILED — GITHUB_TOKEN is required for PR label lookup", file=sys.stderr)
            return 1
        try:
            labels, timeline, push_at = load_pr_review_context(
                args.repo, args.pr_number, token
            )
        except urllib.error.HTTPError as exc:
            print(
                f"pack-boundary: FAILED — GitHub API error {exc.code}: {exc.reason}",
                file=sys.stderr,
            )
            return 1
        code, lines = run_host_change_gate(
            labels, timeline, last_push_at=push_at
        )
        for line in lines:
            print(line)
        if code != 0:
            return code
        if HOST_CHANGE_LABEL in labels:
            return 0

    changed = git_diff_changed_paths(args.base, args.head)
    contents: dict[str, tuple[str | None, str | None]] = {}
    for path in changed:
        if path in (ALLOWED_TSCONFIG_PATH, ALLOWED_SCHEMA_PATH, ALLOWED_CATALOG_PATH):
            contents[path] = load_file_pair(args.base, args.head, path)

    code, lines = run_check(changed, contents, pr_number)
    for line in lines:
        print(line)
    return code


if __name__ == "__main__":
    sys.exit(main())
