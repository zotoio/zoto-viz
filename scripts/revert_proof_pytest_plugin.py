"""Revert-proof pytest plugin: JSON report with AssertionError typing from excinfo."""

from __future__ import annotations

import json
import os
from pathlib import Path

_reports: list[dict] = []


def pytest_runtest_logreport(report) -> None:
    if report.when != "call":
        return
    revert_proof_assertion = False
    if report.failed:
        excinfo = getattr(report, "excinfo", None)
        if excinfo is not None:
            revert_proof_assertion = excinfo.errisinstance(AssertionError)
    _reports.append(
        {
            "nodeid": report.nodeid,
            "outcome": report.outcome,
            "revertProofAssertion": bool(revert_proof_assertion),
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
