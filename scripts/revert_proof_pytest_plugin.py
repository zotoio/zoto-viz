"""Revert-proof pytest plugin: JSON report with rewritten-assert detection."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

_reports: list[dict] = []


def _rewritten_assert_in_test(excinfo, item) -> tuple[bool, str | None]:
    if excinfo is None:
        return False, None
    test_path = Path(item.path).resolve()
    for entry in reversed(excinfo.traceback):
        try:
            frame_path = Path(entry.path).resolve()
        except (TypeError, ValueError):
            continue
        if frame_path != test_path:
            continue
        statement = getattr(entry, "statement", None)
        stmt = str(statement).strip() if statement is not None else ""
        if stmt.startswith("assert "):
            return True, stmt
        return False, stmt or None
    return False, None


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if report.when != "call":
        return
    revert_proof_assertion = False
    revert_proof_red = None
    if report.failed:
        excinfo = call.excinfo
        ok, stmt = _rewritten_assert_in_test(excinfo, item)
        revert_proof_assertion = ok
        if ok and stmt:
            revert_proof_red = {"assert": stmt}
    _reports.append(
        {
            "nodeid": report.nodeid,
            "outcome": report.outcome,
            "revertProofAssertion": bool(revert_proof_assertion),
            "revertProofRed": revert_proof_red,
        }
    )


def pytest_sessionfinish(session, exitstatus) -> None:
    out = os.environ.get("REVERT_PROOF_PYTEST_JSON")
    if not out:
        return
    Path(out).write_text(
        json.dumps({"tests": _reports, "exitstatus": exitstatus}),
        encoding="utf-8",
    )
