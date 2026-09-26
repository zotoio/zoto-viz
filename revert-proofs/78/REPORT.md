## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| 01-pa-tree-zero-staging-read | tests/test_pack_safe_zip_install.py :: test_pa_fresh_install_zero_staging_hash_bytes | Fresh install must not re-read staged files for tree hashing. | python -m pytest tests/test_pack_safe_zip_install.py::test_pa_fresh_install_zero_staging_hash_bytes | RED (expected) |
| 02-pa-remint-reread-tree | tests/test_pack_safe_zip_install.py :: test_pa_remint_hashes_only_plugin_yml | Remint must hash only plugin.yml bytes, not the whole staged tree. | python -m pytest tests/test_pack_safe_zip_install.py::test_pa_remint_hashes_only_plugin_yml | RED (expected) |
| 03-pa-remint-tree-match | tests/test_pack_safe_zip_install.py :: test_pa_remint_tree_matches_from_scratch | Remint combined tree hash must match from-scratch v1 hash. | python -m pytest tests/test_pack_safe_zip_install.py::test_pa_remint_tree_matches_from_scratch | RED (expected) |
| 04-pa-tree-path-sensitive | tests/test_pack_safe_zip_install.py :: test_pa_tree_hash_sensitive_to_path_layout | Tree hash must include every member path, not only plugin.yml. | python -m pytest tests/test_pack_safe_zip_install.py::test_pa_tree_hash_sensitive_to_path_layout | RED (expected) |
| 05-qe-upgrade-rollback | tests/test_pack_safe_zip_install.py :: test_qe_upgrade_rollback_restores_v1_and_cleans_bak | Upgrade rename failure must surface UX rollback copy and pack-info block. | python -m pytest tests/test_pack_safe_zip_install.py::test_qe_upgrade_rollback_restores_v1_and_cleans_bak | RED (expected) |
| 06-qe-duplicate-name | tests/test_pack_safe_zip_install.py :: test_qe_duplicate_name_rejected_before_staging | Duplicate normalized zip entry names rejected before staging. | python -m pytest tests/test_pack_safe_zip_install.py::test_qe_duplicate_name_rejected_before_staging | RED (expected) |
| 07-qe-crash-staging-boot | tests/test_pack_safe_zip_install.py :: test_qe_crash_staging_removed_at_boot | Crash-leftover .staging removed once at boot. | python -m pytest tests/test_pack_safe_zip_install.py::test_qe_crash_staging_removed_at_boot | RED (expected) |
| 08-qe-staged-pack-registry | tests/test_pack_safe_zip_install.py :: test_qe_staged_pack_guard_registry | go-live consumes validator-issued StagedPack instances. | python -m pytest tests/test_pack_safe_zip_install.py::test_qe_staged_pack_guard_registry | RED (expected) |
| 09-qe-staged-bytes-match | tests/test_pack_safe_zip_install.py :: test_qe_staged_bytes_match_and_outside_staging_untouched | On-disk staging bytes must match entry digests from validate. | python -m pytest tests/test_pack_safe_zip_install.py::test_qe_staged_bytes_match_and_outside_staging_untouched | RED (expected) |
| 10-qe-size-cap | tests/test_pack_safe_zip_install.py :: test_qe_size_cap_uses_inflated_bytes_exact | Inflated-byte cap uses actual inflated size. | python -m pytest tests/test_pack_safe_zip_install.py::test_qe_size_cap_uses_inflated_bytes_exact | RED (expected) |
| 11-pa-manifest-cap | tests/test_pack_safe_zip_install.py :: test_pa_manifest_read_cap_65536_exact | plugin.yml manifest read capped at 65536 bytes. | python -m pytest tests/test_pack_safe_zip_install.py::test_pa_manifest_read_cap_65536_exact | RED (expected) |
| 12-pedant-exact-counts | tests/test_pack_safe_zip_install.py :: test_pedant_single_cd_parse_web_adopt_mcp | Exactly one central-directory parse per install path. | python -m pytest tests/test_pack_safe_zip_install.py::test_pedant_single_cd_parse_web_adopt_mcp | RED (expected) |
| 13-ux-file-name-message | tests/test_pack_zip_install_ux.py :: test_zip_ux_user_message_examples | Zip unsafe user copy uses Couldn't install {stem}.zip. | python -m pytest tests/test_pack_zip_install_ux.py::test_zip_ux_user_message_examples | RED (expected) |
| 14-validator-order | tests/test_pack_safe_zip_install.py :: test_install_checks_run_in_registration_order | Install validators run in ascending order value. | python -m pytest tests/test_pack_safe_zip_install.py::test_install_checks_run_in_registration_order | RED (expected) |
| 15-cd-declared-size | tests/test_pack_safe_zip_install.py :: test_qe_cd_declared_size_larger_than_actual | Reject zip entries whose declared size exceeds inflated bytes. | python -m pytest tests/test_pack_safe_zip_install.py::test_qe_cd_declared_size_larger_than_actual | RED (expected) |
| 16-literal-corrupt-tail | tests/test_pack_zip_install_ux.py :: test_zip_ux_literal_corrupt_tail | Literal corrupt zip tail copy. | python -m pytest tests/test_pack_zip_install_ux.py::test_zip_ux_literal_corrupt_tail | RED (expected) |
| 17-literal-prior-suffix | tests/test_pack_zip_install_ux.py :: test_zip_ux_literal_corrupt_prior_suffix | Literal prior-version suffix copy. | python -m pytest tests/test_pack_zip_install_ux.py::test_zip_ux_literal_corrupt_prior_suffix | RED (expected) |
| 18-literal-encrypted-tail | tests/test_pack_zip_install_ux.py :: test_zip_ux_literal_encrypted_tail | Literal encrypted zip tail copy. | python -m pytest tests/test_pack_zip_install_ux.py::test_zip_ux_literal_encrypted_tail | RED (expected) |
| 19-literal-oversize-tail | tests/test_pack_zip_install_ux.py :: test_zip_ux_literal_oversize_tail | Literal oversize zip tail copy. | python -m pytest tests/test_pack_zip_install_ux.py::test_zip_ux_literal_oversize_tail | RED (expected) |
| 20-literal-upgrade-rollback | tests/test_pack_zip_install_ux.py :: test_zip_ux_literal_upgrade_rollback_message | Literal upgrade rollback message template. | python -m pytest tests/test_pack_zip_install_ux.py::test_zip_ux_literal_upgrade_rollback_message | RED (expected) |
| 21-consent-migration-rehash | tests/test_pack_safe_zip_install.py :: test_consent_survives_pack_tree_hash_migration | Consent tree hash migrated once per record (boot2 reads 0 bytes). | python -m pytest tests/test_pack_safe_zip_install.py::test_consent_survives_pack_tree_hash_migration | RED (expected) |

### 01-pa-tree-zero-staging-read

```
tests/test_pack_safe_zip_install.py F                                    [100%]

=================================== FAILURES ===================================
________________ test_pa_fresh_install_zero_staging_hash_bytes _________________

        meter = _meter_pack_folder_reads(monkeypatch, local_rt)
        staged = psz.read_pack_zip(zip_path)
>       assert meter["bytes"] == 0
E       assert 129 == 0

tests/test_pack_safe_zip_install.py:651: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-F2e6TS/01-pa-tree-zero-staging-read-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_safe_zip_install.py::test_pa_fresh_install_zero_staging_hash_bytes
============================== 1 failed in 0.11s ===============================
```

### 02-pa-remint-reread-tree

```
tests/test_pack_safe_zip_install.py F                                    [100%]

=================================== FAILURES ===================================
____________________ test_pa_remint_hashes_only_plugin_yml _____________________

        yml_path = reminted.staging_dir / "plugin.yml"
        yml_len = yml_path.stat().st_size
>       assert meter["bytes"] == yml_read_len
E       assert 166 == 35

tests/test_pack_safe_zip_install.py:667: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-F2e6TS/02-pa-remint-reread-tree-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_safe_zip_install.py::test_pa_remint_hashes_only_plugin_yml
============================== 1 failed in 0.11s ===============================
```

### 03-pa-remint-tree-match

```
tests/test_pack_safe_zip_install.py F                                    [100%]

=================================== FAILURES ===================================
___________________ test_pa_remint_tree_matches_from_scratch ___________________

        staged = psz.read_pack_zip(zip_path)
        reminted = psz.remint(staged, "sample-2")
>       assert reminted.tree_sha256 == psz.runtime_tree_hash(reminted.staging_dir)
E       AssertionError: assert '3b0f4d2ece42...36556c306d21b' == 'fba7dfffad7a...7dd4d2815e586'
E         
E         - fba7dfffad7a5e1a20d357e4ed4424646113f5c3c9fbd0217bc7dd4d2815e586
E         + 3b0f4d2ece4256ef270580188122ff31c94442bd0dcafd1d60a36556c306d21b

tests/test_pack_safe_zip_install.py:679: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-F2e6TS/03-pa-remint-tree-match-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_safe_zip_install.py::test_pa_remint_tree_matches_from_scratch
============================== 1 failed in 0.11s ===============================
```

### 04-pa-tree-path-sensitive

```
tests/test_pack_safe_zip_install.py F                                    [100%]

=================================== FAILURES ===================================
__________________ test_pa_tree_hash_sensitive_to_path_layout __________________

        digests = {k: v for k, v in staged.member_sha256.items() if k != "visualisation.yml"}
        digests["nested/visualisation.yml"] = moved
        expected_before = psz.tree_hash_from_digests(
            {**staged.member_sha256, pz.SHA256_NAME: sidecar_hex},
        )
        expected_after = psz.tree_hash_from_digests({**digests, pz.SHA256_NAME: sidecar_hex})
>       assert before == expected_before
E       AssertionError: assert '50ada4747563...a6288c133ffb2' == '77e0ea2ca954...7e51b9b7828a4'
E         
E         - 77e0ea2ca954583d15e87ec777f47e2d9109900cfcd51f7eef07e51b9b7828a4
E         + 50ada47475636b7da896e4c8d3fbca0ee2716217cff9ca2275fa6288c133ffb2

tests/test_pack_safe_zip_install.py:705: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-F2e6TS/04-pa-tree-path-sensitive-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_safe_zip_install.py::test_pa_tree_hash_sensitive_to_path_layout
============================== 1 failed in 0.11s ===============================
```

### 05-qe-upgrade-rollback

```
tests/test_pack_safe_zip_install.py F                                    [100%]

=================================== FAILURES ===================================
_____________ test_qe_upgrade_rollback_restores_v1_and_cleans_bak ______________

        _repo(tmp_path, monkeypatch)
        good = _zip_bytes({"plugin.yml": MINIMAL, "visualisation.yml": VIZ})
        assert plugin_local.publish_local({"zip_b64": base64.b64encode(good).decode()})["ok"] is True
        runtime = paths.plugin_local_runtime_dir() / "sample"
        old_tree = pi.runtime_tree_hash(runtime)
        v2 = _zip_bytes({"plugin.yml": "id: sample\nname: Sample\nversion: 2\n", "visualisation.yml": VIZ})
        expected = upgrade_rollback_user_message("Sample", 2, 1)
    
        def boom() -> None:
            raise OSError("rename failed")
    
        pi.set_after_first_rename(boom)
        finally:
            pi.set_after_first_rename(None)
        assert blocked["ok"] is False
        assert again["ok"] is False
>       assert blocked["message"] == expected
E       assert "Couldn't update pack." == "Couldn't upd...e server log."
E         
E         - Couldn't update Sample to version 2, so version 1 is still installed. Try again, and if it keeps failing, check the server log.
E         + Couldn't update pack.

tests/test_pack_safe_zip_install.py:737: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-F2e6TS/05-qe-upgrade-rollback-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_safe_zip_install.py::test_qe_upgrade_rollback_restores_v1_and_cleans_bak
============================== 1 failed in 0.16s ===============================
```

### 06-qe-duplicate-name

```
tests/test_pack_safe_zip_install.py F                                    [100%]

=================================== FAILURES ===================================
________________ test_qe_duplicate_name_rejected_before_staging ________________

        good = _zip_bytes({"plugin.yml": MINIMAL, "visualisation.yml": VIZ})
        first = plugin_local.publish_local({"zip_b64": base64.b64encode(good).decode()})
        assert first["ok"] is True
        staging_writes.clear()
        dest = paths.plugin_local_dir() / "sample.zip"
            },
        )
>       assert blocked["ok"] is False
E       assert True is False

tests/test_pack_safe_zip_install.py:185: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-F2e6TS/06-qe-duplicate-name-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_safe_zip_install.py::test_qe_duplicate_name_rejected_before_staging
============================== 1 failed in 0.16s ===============================
```

### 07-qe-crash-staging-boot

```
tests/test_pack_safe_zip_install.py F                                    [100%]

=================================== FAILURES ===================================
____________________ test_qe_crash_staging_removed_at_boot _____________________

        orphan = pi.new_staging_dir(parent, "orphan-crash")
        (orphan / "plugin.yml").write_text("id: orphan-crash\nname: O\nversion: 1\n", encoding="utf-8")
        assert len(pi.list_staging_dirs(parent)) == 1
        removed = pi.recover_orphan_staging_dirs(parent)
        assert removed == 1
>       assert pi.list_staging_dirs(parent) == []
E       AssertionError: assert [PosixPath('/...sh/77aa0e12')] == []
E         
E         Left contains one more item: PosixPath('/tmp/pytest-of-ubuntu/pytest-749/plugin-local0/local/.runtime/.staging/orphan-crash/77aa0e12')
E         Use -v to get more diff

tests/test_pack_safe_zip_install.py:796: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-F2e6TS/07-qe-crash-staging-boot-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_safe_zip_install.py::test_qe_crash_staging_removed_at_boot
============================== 1 failed in 0.11s ===============================
```

### 08-qe-staged-pack-registry

```
tests/test_pack_safe_zip_install.py F                                    [100%]

=================================== FAILURES ===================================
______________________ test_qe_staged_pack_guard_registry ______________________

        staged = psz.read_pack_zip(zip_path)
        forged = dataclasses.replace(staged, tree_sha256="0" * 64)
>       with pytest.raises(ValueError, match="not issued"):
E       Failed: DID NOT RAISE ValueError

tests/test_pack_safe_zip_install.py:808: Failed
- generated xml file: /tmp/revert-proof-artifacts-F2e6TS/08-qe-staged-pack-registry-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_safe_zip_install.py::test_qe_staged_pack_guard_registry
============================== 1 failed in 0.11s ===============================
```

### 09-qe-staged-bytes-match

```
tests/test_pack_safe_zip_install.py F                                    [100%]

=================================== FAILURES ===================================
___________ test_qe_staged_bytes_match_and_outside_staging_untouched ___________

            pack_read=read,
        )
        assert result.dest == runtime
        assert pi.list_staging_dirs(parent) == []
        for rel, digest in read.member_sha256.items():
            on_disk = runtime / rel
>           assert hashlib.sha256(on_disk.read_bytes()).hexdigest() == digest
E           AssertionError: assert '75895fa2901a...e78d3cd9da95a' == '4f0ee50214ef...abf7f8090b67a'
E             
E             - 4f0ee50214ef04649453ed961a2fe4a09b3fceba08d57a955e9abf7f8090b67a
E             + 75895fa2901a382dd6f4e8f7288f2f641b409123defe4594977e78d3cd9da95a

tests/test_pack_safe_zip_install.py:222: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-F2e6TS/09-qe-staged-bytes-match-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_safe_zip_install.py::test_qe_staged_bytes_match_and_outside_staging_untouched
============================== 1 failed in 0.11s ===============================
```

### 10-qe-size-cap

```
tests/test_pack_safe_zip_install.py F                                    [100%]

=================================== FAILURES ===================================
__________________ test_qe_size_cap_uses_inflated_bytes_exact __________________

        path = tmp_path / "big.zip"
        path.write_bytes(z)
        with pytest.raises(ValueError) as exc:
            psz.read_pack_zip(path)
>       assert str(exc.value) == f"zip entry 'payload.txt': uncompressed size exceeds {remaining}"
E       assert "zip entry 'p...ze exceeds 50" == "zip entry 'p...ze exceeds 15"
E         
E         Skipping 41 identical leading characters in diff, use -v to show
E         ?            +

tests/test_pack_safe_zip_install.py:249: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-F2e6TS/10-qe-size-cap-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_safe_zip_install.py::test_qe_size_cap_uses_inflated_bytes_exact
============================== 1 failed in 0.11s ===============================
```

### 11-pa-manifest-cap

```
tests/test_pack_safe_zip_install.py F                                    [100%]

=================================== FAILURES ===================================
____________________ test_pa_manifest_read_cap_65536_exact _____________________


    def test_pa_manifest_read_cap_65536_exact(tmp_path: Path) -> None:
>       assert psz.MANIFEST_MEMBER_MAX_BYTES == 65_536
E       assert 1000000 == 65536
E        +  where 1000000 = psz.MANIFEST_MEMBER_MAX_BYTES

tests/test_pack_safe_zip_install.py:282: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-F2e6TS/11-pa-manifest-cap-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_safe_zip_install.py::test_pa_manifest_read_cap_65536_exact
============================== 1 failed in 0.11s ===============================
```

### 12-pedant-exact-counts

```
tests/test_pack_safe_zip_install.py F                                    [100%]

=================================== FAILURES ===================================
__________________ test_pedant_single_cd_parse_web_adopt_mcp ___________________

        def web() -> None:
            out = plugin_local.publish_local({"zip_b64": b64})
            assert out["ok"] is True
    
        _assert_one_cd_parse(cd_parse_counter, web)
        last = pi.last_install_pack_read_for_tests()
        assert last is not None
        assert last.stats.archive_bytes_read == PEDANT_ARCHIVE_BYTES_READ
>       assert last.stats.central_directory_parses == PEDANT_CENTRAL_DIRECTORY_PARSES
E       AssertionError: assert 0 == 1
E        +  where 0 = ZipReadStats(archive_bytes_read=312, central_directory_parses=0).central_directory_parses
E        +    where ZipReadStats(archive_bytes_read=312, central_directory_parses=0) = PackZipReadView(plugin={'id': 'sample', 'name': 'Sample', 'version': 1}, stats=ZipReadStats(archive_bytes_read=312, ce...5c943614dde99df2396ecd91f478023ae669b353c9f3c67662c7e1bfcf9c36bc'}, members_sorted=('plugin.yml', 'visualisation.yml')).stats

tests/test_pack_safe_zip_install.py:335: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-F2e6TS/12-pedant-exact-counts-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_safe_zip_install.py::test_pedant_single_cd_parse_web_adopt_mcp
============================== 1 failed in 0.16s ===============================
```

### 13-ux-file-name-message

```
tests/test_pack_zip_install_ux.py F                                      [100%]

=================================== FAILURES ===================================
______________________ test_zip_ux_user_message_examples _______________________

    def test_zip_ux_user_message_examples() -> None:
>       assert zip_unsafe_user_message("unsafe", "not a zip") == (
            "Couldn't install unsafe.zip. The file isn't a valid pack or is damaged."
        )
E       assert 'Could not in...r is damaged.' == "Couldn't ins...r is damaged."
E         
E         - Couldn't install unsafe.zip. The file isn't a valid pack or is damaged.
E         ?      + ^

tests/test_pack_zip_install_ux.py:69: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-F2e6TS/13-ux-file-name-message-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_zip_install_ux.py::test_zip_ux_user_message_examples
============================== 1 failed in 0.06s ===============================
```

### 14-validator-order

```
tests/test_pack_safe_zip_install.py F                                    [100%]

=================================== FAILURES ===================================
________________ test_install_checks_run_in_registration_order _________________

        def second(ctx: pi.InstallContext) -> None:
            seen.append("second")
            raise ValueError("stop")
    
        pi.register_install_check(first)
            rel="z.zip",
        )
        with pytest.raises(ValueError, match="stop"):
            pi.run_staging_checks(ctx)
>       assert seen == ["first", "second"]
E       AssertionError: assert ['second'] == ['first', 'second']
E         
E         At index 0 diff: 'second' != 'first'
E         Use -v to get more diff

tests/test_pack_safe_zip_install.py:640: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-F2e6TS/14-validator-order-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_safe_zip_install.py::test_install_checks_run_in_registration_order
============================== 1 failed in 0.11s ===============================
```

### 15-cd-declared-size

```
tests/test_pack_safe_zip_install.py F                                    [100%]

=================================== FAILURES ===================================
_________________ test_qe_cd_declared_size_larger_than_actual __________________

        path = tmp_path / "lie.zip"
        path.write_bytes(patched)
>       with pytest.raises(ValueError) as exc:
E       Failed: DID NOT RAISE ValueError

tests/test_pack_safe_zip_install.py:276: Failed
- generated xml file: /tmp/revert-proof-artifacts-F2e6TS/15-cd-declared-size-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_safe_zip_install.py::test_qe_cd_declared_size_larger_than_actual
============================== 1 failed in 0.11s ===============================
```

### 16-literal-corrupt-tail

```
tests/test_pack_zip_install_ux.py F                                      [100%]

=================================== FAILURES ===================================
_______________________ test_zip_ux_literal_corrupt_tail _______________________

    def test_zip_ux_literal_corrupt_tail() -> None:
>       assert ZIP_UX_CORRUPT_TAIL == "The file isn't a valid pack or is damaged."
E       assert '' == "The file isn...r is damaged."
E         
E         - The file isn't a valid pack or is damaged.

tests/test_pack_zip_install_ux.py:29: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-F2e6TS/16-literal-corrupt-tail-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_zip_install_ux.py::test_zip_ux_literal_corrupt_tail - ...
============================== 1 failed in 0.06s ===============================
```

### 17-literal-prior-suffix

```
tests/test_pack_zip_install_ux.py F                                      [100%]

=================================== FAILURES ===================================
___________________ test_zip_ux_literal_corrupt_prior_suffix ___________________

    def test_zip_ux_literal_corrupt_prior_suffix() -> None:
>       assert ZIP_UX_CORRUPT_PRIOR_SUFFIX == ", so version {version} is still installed."
E       AssertionError: assert '' == ', so version...ll installed.'
E         
E         - , so version {version} is still installed.

tests/test_pack_zip_install_ux.py:33: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-F2e6TS/17-literal-prior-suffix-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_zip_install_ux.py::test_zip_ux_literal_corrupt_prior_suffix
============================== 1 failed in 0.06s ===============================
```

### 18-literal-encrypted-tail

```
tests/test_pack_zip_install_ux.py F                                      [100%]

=================================== FAILURES ===================================
______________________ test_zip_ux_literal_encrypted_tail ______________________

    def test_zip_ux_literal_encrypted_tail() -> None:
>       assert ZIP_UX_ENCRYPTED_TAIL == "It's password-protected. Zip it again without a password."
E       assert '' == "It's passwor...t a password."
E         
E         - It's password-protected. Zip it again without a password.

tests/test_pack_zip_install_ux.py:37: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-F2e6TS/18-literal-encrypted-tail-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_zip_install_ux.py::test_zip_ux_literal_encrypted_tail
============================== 1 failed in 0.06s ===============================
```

### 19-literal-oversize-tail

```
tests/test_pack_zip_install_ux.py F                                      [100%]

=================================== FAILURES ===================================
______________________ test_zip_ux_literal_oversize_tail _______________________

    def test_zip_ux_literal_oversize_tail() -> None:
>       assert ZIP_UX_OVERSIZE_TAIL == "It unpacks to more than packs are allowed."
E       AssertionError: assert '' == 'It unpacks t... are allowed.'
E         
E         - It unpacks to more than packs are allowed.

tests/test_pack_zip_install_ux.py:41: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-F2e6TS/19-literal-oversize-tail-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_zip_install_ux.py::test_zip_ux_literal_oversize_tail
============================== 1 failed in 0.06s ===============================
```

### 20-literal-upgrade-rollback

```
tests/test_pack_zip_install_ux.py F                                      [100%]

=================================== FAILURES ===================================
_________________ test_zip_ux_literal_upgrade_rollback_message _________________

    def test_zip_ux_literal_upgrade_rollback_message() -> None:
>       assert UPGRADE_ROLLBACK_UX_MESSAGE == (
            "Couldn't update {name} to version {new_version}, so version {old_version} is still installed. "
            "Try again, and if it keeps failing, check the server log."
        )
E       assert '' == "Couldn't upd...e server log."
E         
E         - Couldn't update {name} to version {new_version}, so version {old_version} is still installed. Try again, and if it keeps failing, check the server log.

tests/test_pack_zip_install_ux.py:55: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-F2e6TS/20-literal-upgrade-rollback-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_zip_install_ux.py::test_zip_ux_literal_upgrade_rollback_message
============================== 1 failed in 0.06s ===============================
```

### 21-consent-migration-rehash

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

tests/test_pack_safe_zip_install.py:849: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-F2e6TS/21-consent-migration-rehash-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_safe_zip_install.py::test_consent_survives_pack_tree_hash_migration
============================== 1 failed in 0.16s ===============================
```
