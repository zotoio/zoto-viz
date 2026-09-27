#!/usr/bin/env python3
"""Ensure the aggregate `test` job needs every other workflow job (and only those)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml


def validate_ci_test_needs(doc: dict) -> list[str]:
    errors: list[str] = []
    jobs = doc.get("jobs")
    if not isinstance(jobs, dict):
        return ["workflow has no jobs mapping"]
    if "test" not in jobs:
        return ["missing job id `test`"]
    test_job = jobs["test"]
    if not isinstance(test_job, dict):
        return ["job `test` is not a mapping"]
    raw_needs = test_job.get("needs", [])
    if raw_needs is None:
        raw_needs = []
    if isinstance(raw_needs, str):
        needs_list = [raw_needs]
    elif isinstance(raw_needs, list):
        needs_list = [str(x) for x in raw_needs]
    else:
        return ["job `test` needs must be a list or string"]
    needs_set = set(needs_list)
    if len(needs_list) != len(needs_set):
        errors.append("job `test` needs contains duplicate entries")
    other_jobs = set(jobs.keys()) - {"test"}
    missing = sorted(other_jobs - needs_set)
    extra = sorted(needs_set - other_jobs)
    if missing:
        errors.append(f"job `test` needs missing: {', '.join(missing)}")
    if extra:
        errors.append(f"job `test` needs unknown jobs: {', '.join(extra)}")
    if not other_jobs and needs_set:
        errors.append("job `test` needs is non-empty but workflow has no other jobs")
    return errors


def check_ci_workflow(path: Path) -> int:
    text = path.read_text(encoding="utf-8")
    doc = yaml.safe_load(text)
    if not isinstance(doc, dict):
        print(f"{path}: workflow root must be a mapping", file=sys.stderr)
        return 1
    errors = validate_ci_test_needs(doc)
    if errors:
        for err in errors:
            print(f"{path}: {err}", file=sys.stderr)
        return 1
    print(f"{path}: test.needs matches all other jobs ({', '.join(sorted(set(doc['jobs']) - {'test'}))})")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workflow", type=Path, help="Path to ci.yml")
    args = parser.parse_args(argv)
    return check_ci_workflow(args.workflow)


if __name__ == "__main__":
    raise SystemExit(main())
