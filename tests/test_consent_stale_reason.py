"""Batch B stage 2: stale consent reasons and maybe_autoconsent option (a).

A previously granted consent goes stale for one of two reasons:
- ``changed``: the pack's content (an assets hash, the stamp) no longer matches the record;
- ``incomplete``: the record matches what it holds but has no assets_sha256 (it predates the key).

Option (a), the default: an incomplete record is never auto-consented, even with auto-consent on;
it surfaces as reason ``incomplete``. A new pack and a complete record whose content moved on are
auto-consented as before.

Revert rows: drop the ``state == "stale"`` early return in ``maybe_autoconsent`` -> the
``incomplete`` auto-consent rows go red; drop ``consent_reason`` from ``_catalog_row`` -> the
catalog rows go red.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from service import live, plugins


@pytest.fixture(autouse=True)
def _consent_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    live.reset_for_tests()
    live.set_autoconsent(False)
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")
    plugins.reset_scan_memo()
    yield
    plugins.reset_scan_memo()
    live.reset_for_tests()


def _doc(**over: Any) -> dict[str, Any]:
    doc = {"id": "demo-pack", "name": "Demo", "version": 1, "runtime": "typescript", "hash": "a" * 64, "origin": "src"}
    doc.update(over)
    return doc


def _row(pid: str) -> dict[str, Any]:
    row = plugins._plugin_row(pid)
    assert row is not None, pid
    return row


def test_reason_changed_when_the_assets_hash_moved_on() -> None:
    plugins.grant_consent(_doc(assets_sha256="e" * 64), "authored")
    moved = _doc(assets_sha256="f" * 64)
    assert plugins.consent_state(moved) == "changed"
    assert plugins.consent_stale_reason(moved) == "changed"


def test_reason_incomplete_when_the_record_has_no_assets_hash() -> None:
    plugins.grant_consent(_doc(), "authored")
    with_assets = _doc(assets_sha256="e" * 64)
    assert plugins.consent_state(with_assets) == "stale"
    assert plugins.consent_stale_reason(with_assets) == "incomplete"


def test_no_reason_for_granted_or_never_approved() -> None:
    assert plugins.consent_stale_reason(_doc()) is None
    plugins.grant_consent(_doc(), "authored")
    assert plugins.consent_stale_reason(_doc()) is None


def test_option_a_incomplete_record_is_never_auto_consented() -> None:
    plugins.grant_consent(_doc(), "authored")
    with_assets = _doc(assets_sha256="e" * 64)
    live.set_autoconsent(True)
    assert plugins.autoconsent_eligible(with_assets)
    assert plugins.maybe_autoconsent(with_assets) is False
    assert plugins.consent_state(with_assets) == "stale"
    assert plugins.consent_stale_reason(with_assets) == "incomplete"
    assert "assets_sha256" not in plugins._consent_doc()["demo-pack"]


def test_option_a_complete_changed_record_and_new_pack_are_auto_consented_as_before() -> None:
    plugins.grant_consent(_doc(assets_sha256="e" * 64), "authored")
    moved = _doc(assets_sha256="f" * 64)
    live.set_autoconsent(True)
    assert plugins.maybe_autoconsent(moved) is True
    assert plugins.consent_state(moved) == "granted"
    fresh = _doc(id="fresh-pack", assets_sha256="c" * 64)
    assert plugins.maybe_autoconsent(fresh) is True
    assert plugins.consent_state(fresh) == "granted"


def test_option_a_off_changes_nothing() -> None:
    plugins.grant_consent(_doc(), "authored")
    with_assets = _doc(assets_sha256="e" * 64)
    assert plugins.maybe_autoconsent(with_assets) is False
    assert plugins.consent_state(with_assets) == "stale"


def test_catalog_row_carries_the_reason_for_rocket_car_soccer() -> None:
    row = _row("rocket-car-soccer")
    assert "consent_reason" not in row  # never approved: no stale reason
    plugins.grant_consent({k: v for k, v in row.items() if k != "assets_sha256"}, "authored")
    plugins.reset_scan_memo()
    stale = _row("rocket-car-soccer")
    assert (stale["consent_state"], stale["consent_reason"]) == ("stale", "incomplete")
    plugins.grant_consent({**row, "assets_sha256": "0" * 64}, "authored")
    plugins.reset_scan_memo()
    moved = _row("rocket-car-soccer")
    assert (moved["consent_state"], moved["consent_reason"]) == ("changed", "changed")
    plugins.grant_consent(row, "authored")
    plugins.reset_scan_memo()
    assert "consent_reason" not in _row("rocket-car-soccer")
