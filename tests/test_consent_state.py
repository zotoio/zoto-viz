"""consent_state: why a pack is or isn't approved (none / granted / changed / stale), strict on stale."""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from service import live, plugins

HEX64 = re.compile(r"[0-9a-f]{32,}")


@pytest.fixture(autouse=True)
def _consent_file(tmp_path: Path, monkeypatch):
    live.reset_for_tests()
    live.set_autoconsent(False)
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")
    yield
    live.reset_for_tests()


def _doc(**over):
    doc = {
        "id": "demo-pack",
        "name": "Demo",
        "version": 1,
        "runtime": "typescript",
        "hash": "a" * 64,
        "origin": "zip",
    }
    doc.update(over)
    return doc


def test_never_approved_is_none() -> None:
    assert plugins.consent_state(_doc()) == "none"


def test_matching_record_is_granted() -> None:
    doc = _doc(shader_sha256="b" * 64)
    plugins.grant_consent(doc, "reviewed")
    assert plugins.consent_state(doc) == "granted"
    assert plugins.consent_kind(doc) == "reviewed"


def test_yaml_only_pack_needs_no_consent() -> None:
    doc = {"id": "plain", "version": 1}
    assert plugins.consent_state(doc) == "granted"


def test_stamp_mismatch_is_changed() -> None:
    doc = _doc()
    plugins.grant_consent(doc, "reviewed")
    assert plugins.consent_state(_doc(hash="c" * 64)) == "changed"
    assert plugins.consent_state(_doc(version=2)) == "changed"


def test_shader_hash_mismatch_is_changed() -> None:
    doc = _doc(shader_sha256="b" * 64)
    plugins.grant_consent(doc, "reviewed")
    assert plugins.consent_state(_doc(shader_sha256="d" * 64)) == "changed"


def test_pack_without_assets_on_either_side_stays_granted() -> None:
    """The new asset key must not flip every older asset-less pack to changed/stale."""
    doc = _doc(shader_sha256="b" * 64)
    plugins.grant_consent(doc, "authored")
    assert "assets_sha256" not in plugins._consent_doc()["demo-pack"]
    assert plugins.consent_state(doc) == "granted"


def test_record_predating_assets_key_is_stale_and_not_consented() -> None:
    """Koi on zoto: approved before its meshes existed. Strict (Andrew, option a): stale never mounts."""
    plugins.grant_consent(_doc(), "authored")
    with_assets = _doc(assets_sha256="e" * 64)
    assert plugins.consent_state(with_assets) == "stale"
    assert plugins.consent_kind(with_assets) is None
    assert plugins.consented(with_assets) is False


def test_regrant_after_stale_records_asset_hash() -> None:
    plugins.grant_consent(_doc(), "authored")
    with_assets = _doc(assets_sha256="e" * 64)
    plugins.grant_consent(with_assets, "authored")
    assert plugins.consent_state(with_assets) == "granted"


def _asset_home(tmp_path: Path) -> Path:
    home = tmp_path / "demo-pack"
    (home / "assets").mkdir(parents=True)
    (home / "assets" / "fish.glb").write_bytes(b"glTF-demo")
    (home / "plugin.yml").write_text("id: demo-pack\n", encoding="utf-8")
    return home


def test_catalog_consent_agrees_with_pack_assets_check(tmp_path: Path) -> None:
    """The catalog must hash assets before judging consent, or it says `authored` while /pack-assets 403s."""
    home = _asset_home(tmp_path)
    doc = _doc(assets=[{"id": "fish", "path": "assets/fish.glb"}])
    plugins.grant_consent(doc, "authored")  # record made without assets_sha256 (pre-key approval)
    errors: list[dict[str, str]] = []
    row = plugins._catalog_row(doc, {}, home, errors, "demo-pack/plugin.yml")
    assert row is not None, errors
    assert row.get("assets_sha256")
    assert row["consent"] is None
    assert row["consent_state"] == "stale"
    assert plugins.consented(row) is False


def test_catalog_consent_state_never_carries_hash_values(tmp_path: Path) -> None:
    home = _asset_home(tmp_path)
    doc = _doc(assets=[{"id": "fish", "path": "assets/fish.glb"}])
    for grant in (False, True):
        if grant:
            plugins.grant_consent(doc, "authored")
        row = plugins._catalog_row(doc, {}, home, [], "demo-pack/plugin.yml")
        assert row is not None
        state = row["consent_state"]
        assert state in {"none", "granted", "changed", "stale"}
        assert not HEX64.search(str(state))
