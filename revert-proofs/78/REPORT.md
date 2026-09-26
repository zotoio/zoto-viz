## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| 19-consent-migration-rehash | tests/test_pack_safe_zip_install.py :: test_consent_survives_pack_tree_hash_migration | Consent tree migration hashes each live folder once on first boot only; revert re-hashes every boot. | python -m pytest tests/test_pack_safe_zip_install.py::test_consent_survives_pack_tree_hash_migration | RED (expected) |

### 19-consent-migration-rehash

```
tests/test_pack_safe_zip_install.py F                                    [100%]

=================================== FAILURES ===================================
________________ test_consent_survives_pack_tree_hash_migration ________________

    
        good = _zip_bytes({"plugin.yml": MINIMAL, "visualisation.yml": VIZ})
        assert plugin_local.publish_local({"zip_b64": base64.b64encode(good).decode()})["ok"] is True
        runtime = paths.plugin_local_runtime_dir() / "sample"
        live_bytes = _live_tree_file_bytes(runtime)
        assert live_bytes > 0
        legacy = psz.legacy_runtime_tree_hash(runtime)
        doc = plugins.validate_doc({"id": "sample", "name": "Sample", "version": 1})
        meter = _meter_pack_folder_reads(monkeypatch, runtime)
        msgs_boot1 = plugins.migrate_consent_pack_tree_hashes(runtime.parent)
        assert any("sample" in m for m in msgs_boot1)
        assert meter["bytes"] == live_bytes
        assert plugins.consent_kind(doc) == "reviewed"
        assert plugins.consented(doc)
        rec = plugins._consent_doc()["sample"]
        assert rec.get("tree_hash_version") == plugins.PACK_TREE_HASH_VERSION
        assert rec.get("pack_tree_sha256") == psz.runtime_tree_hash(runtime)
    
        meter["bytes"] = 0
        msgs_boot2 = plugins.migrate_consent_pack_tree_hashes(runtime.parent)
>       assert msgs_boot2 == []
E       AssertionError: assert ['pack tree h...d for sample'] == []
E         
E         Left contains one more item: 'pack tree hash migrated for sample'
E         Use -v to get more diff

tests/test_pack_safe_zip_install.py:810: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-sYTnpi/19-consent-migration-rehash-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_safe_zip_install.py::test_consent_survives_pack_tree_hash_migration
============================== 1 failed in 0.16s ===============================
```
