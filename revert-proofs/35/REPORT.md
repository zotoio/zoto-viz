## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| 01-retry-clear-before-lock | tests/test_plugin_install.py :: test_retry_blocked_zip_runs_full_install_keeps_v1_on_repeat_failure | Retry clears zip block before taking pack lock. | python -m pytest tests/test_plugin_install.py::test_retry_blocked_zip_runs_full_install_keeps_v1_on_repeat_failure | RED (expected) |
| 02-retry-scan-race | tests/test_plugin_install.py :: test_retry_and_scan_race_single_install | Drop-folder install ignores persisted sha256 block rows. | python -m pytest tests/test_plugin_install.py::test_retry_and_scan_race_single_install | RED (expected) |
| 03-retry-hash-mismatch | tests/test_plugin_install.py :: test_retry_zip_hash_mismatch_returns_409_without_installing | Retry does not compare drop-folder zip sha to blocked digest. | python -m pytest tests/test_plugin_install.py::test_retry_zip_hash_mismatch_returns_409_without_installing | RED (expected) |
| 04-retry-csrf | tests/test_plugin_local_retry_access.py :: RetryBlockedZipAccessTest::test_retry_post_requires_csrf | Retry POST bypasses CSRF middleware. | python -m pytest tests/test_plugin_local_retry_access.py::RetryBlockedZipAccessTest::test_retry_post_requires_csrf | RED (expected) |
| 05-concurrency-20 | tests/test_plugin_install.py :: test_concurrent_install_passes_20_of_20 | Concurrent installs for the same pack are not serialized. | python -m pytest tests/test_plugin_install.py::test_concurrent_install_passes_20_of_20 | RED (expected) |
| 06-symlink | tests/test_plugin_install.py :: test_symlink_zip_rejected_via_install_pipeline | Symlink entries inside plugin zips are accepted. | python -m pytest tests/test_plugin_install.py::test_symlink_zip_rejected_via_install_pipeline | RED (expected) |
| 07-zip-slip | tests/test_plugin_install.py :: test_zip_slip_rejected_on_unpack | Zip slip paths are unpacked. | python -m pytest tests/test_plugin_install.py::test_zip_slip_rejected_on_unpack | RED (expected) |
| 08-interrupted-swap | tests/test_plugin_install.py :: test_interrupted_swap_uses_after_first_rename_hook | Interrupted swap recovery is disabled. | python -m pytest tests/test_plugin_install.py::test_interrupted_swap_uses_after_first_rename_hook | RED (expected) |
| 09-startup-recovery | tests/test_plugin_install.py :: test_startup_recovery_runs_in_fresh_process | Startup recovery does not restore .bak runtimes. | python -m pytest tests/test_plugin_install.py::test_startup_recovery_runs_in_fresh_process | RED (expected) |
| 10-unchanged-zip-skip | tests/test_plugin_install.py :: test_unchanged_zip_skips_reinstall_on_three_scans | Unchanged local zips trigger reinstall on every drop scan. | python -m pytest tests/test_plugin_install.py::test_unchanged_zip_skips_reinstall_on_three_scans | RED (expected) |
| 11-two-rescan | tests/test_plugin_install.py :: test_start_failed_zip_hash_blocks_rescan_notice_once | Failed start does not persist sha256 install block. | python -m pytest tests/test_plugin_install.py::test_start_failed_zip_hash_blocks_rescan_notice_once | RED (expected) |
| 13-boundary-host-escape | tests/test_pack_bundle_boundary.py :: test_install_local_zip_blocks_bad_bundle[host-escape-pack-boundary-host-escape] | install_local_zip allows host-escape bundle. | python -m pytest tests/test_pack_bundle_boundary.py::test_install_local_zip_blocks_bad_bundle[host-escape-pack-boundary-host-escape] | RED (expected) |
| 14-boundary-json-escape | tests/test_pack_bundle_boundary.py :: test_install_local_zip_blocks_bad_bundle[json-escape-pack-boundary-json-escape] | install_local_zip allows json-escape bundle. | python -m pytest tests/test_pack_bundle_boundary.py::test_install_local_zip_blocks_bad_bundle[json-escape-pack-boundary-json-escape] | RED (expected) |
| 15-host-escape-lint | tests/test_plugin_install.py :: test_host_escape_still_blocked_via_bundle_lint | Host escape pack installs without bundle lint block. | python -m pytest tests/test_plugin_install.py::test_host_escape_still_blocked_via_bundle_lint | RED (expected) |
| 16-sdk-contract | tests/test_plugin_install.py :: test_sdk_contract_still_checked_on_install | SDK contract is not enforced on install. | python -m pytest tests/test_plugin_install.py::test_sdk_contract_still_checked_on_install | RED (expected) |
| 17-retry-ux-in-flight | src/plugins/pack-install-retry.test.ts :: pack install retry UX > in flight: disables button and shows Retrying…; second submit is a no-op | in flight: disables button and shows Retrying…; second submit is a no-op | web/node_modules/.bin/vitest run src/plugins/pack-install-retry.test.ts -t "pack install retry UX > in flight: disables button and shows Retrying…; second submit is a no-op" | RED (expected) |
| 18-retry-ux-start-failed | src/plugins/pack-install-retry.test.ts :: pack install retry UX > start_failed: updates blocked record in place with still-couldn't-start copy | start_failed: updates blocked record in place with still-couldn't-start copy | web/node_modules/.bin/vitest run src/plugins/pack-install-retry.test.ts -t "pack install retry UX > start_failed: updates blocked record in place with still-couldn't-start copy" | RED (expected) |
| 19-retry-ux-zip-changed | src/plugins/pack-install-retry.test.ts :: pack install retry UX > zip_changed: keeps blocked row with zip-changed copy | zip_changed: keeps blocked row with zip-changed copy | web/node_modules/.bin/vitest run src/plugins/pack-install-retry.test.ts -t "pack install retry UX > zip_changed: keeps blocked row with zip-changed copy" | RED (expected) |
| 20-retry-ux-success | src/plugins/pack-install-retry.test.ts :: pack install retry UX > success: removes blocked row and appends history line | success: removes blocked row and appends history line | web/node_modules/.bin/vitest run src/plugins/pack-install-retry.test.ts -t "pack install retry UX > success: removes blocked row and appends history line" | RED (expected) |
| 21-retry-api-outcomes | tests/test_plugin_local_retry_outcomes.py :: RetryBlockedZipOutcomesTest::test_maps_retry_result_to_status_without_parsing_message | test_maps_retry_result_to_status_without_parsing_message | python -m pytest tests/test_plugin_local_retry_outcomes.py::RetryBlockedZipOutcomesTest::test_maps_retry_result_to_status_without_parsing_message | RED (expected) |
| 22-block-record-unreadable | | | | **ERROR: row 22-block-record-unreadable: baseline ran 0 tests (selection/filter error; never a pass)** |
| 23-block-record-atomic-write | | | | **ERROR: row 23-block-record-atomic-write: baseline ran 0 tests (selection/filter error; never a pass)** |
| 24-block-path-traversal | | | | **ERROR: row 24-block-path-traversal: baseline ran 0 tests (selection/filter error; never a pass)** |
| 25-block-id-case-collision | | | | **ERROR: row 25-block-id-case-collision: baseline ran 0 tests (selection/filter error; never a pass)** |
| 26-local-unchanged-bypass | | | | **ERROR: row 26-local-unchanged-bypass: baseline ran 0 tests (selection/filter error; never a pass)** |
| 27-mcp-unchanged-bypass | | | | **ERROR: row 27-mcp-unchanged-bypass: baseline ran 0 tests (selection/filter error; never a pass)** |

### 01-retry-clear-before-lock

```
tests/test_plugin_install.py F                                           [100%]

=================================== FAILURES ===================================
_____ test_retry_blocked_zip_runs_full_install_keeps_v1_on_repeat_failure ______

tmp_path = PosixPath('/tmp/pytest-of-ubuntu/pytest-459/test_retry_blocked_zip_runs_fu0')
_isolate_plugin_local = PosixPath('/tmp/pytest-of-ubuntu/pytest-459/plugin-local0/local')

    def test_retry_blocked_zip_runs_full_install_keeps_v1_on_repeat_failure(
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        v2_sha = pz.plugin_sha256(Path(tmp_v2))
        Path(tmp_v2).unlink(missing_ok=True)
        set_start_runtime_hook(lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("nope")))
        with pytest.raises(InstallStartFailedError):
            plugin_local.install_local_zip(v2, overwrite=True)
        (paths.plugin_local_dir() / f"{pid}.zip").write_bytes(v2)
        drain_install_notices()
    
        from service.pack_install_retry import RETRY_RESULT_START_FAILED, format_retry_start_failed_message
    
        info = plugin_local.retry_blocked_zip_install(v2_sha, activate=False)
        assert info.get("ok") is False
>       assert info.get("error") == "pack_install_start_failed"
E       AssertionError: assert 'not_blocked' == 'pack_install_start_failed'
E         
E         - pack_install_start_failed
E         + not_blocked

tests/test_plugin_install.py:351: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-5UqRjs/01-retry-clear-before-lock-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_plugin_install.py::test_retry_blocked_zip_runs_full_install_keeps_v1_on_repeat_failure
============================== 1 failed in 0.73s ===============================
```

### 02-retry-scan-race

```
tests/test_plugin_install.py F                                           [100%]

=================================== FAILURES ===================================
___________________ test_retry_and_scan_race_single_install ____________________

            install_calls += 1
            hold.set()
            assert release.wait(timeout=5)
            return real_locked(*args, **kwargs)
    
        t_retry.start()
        go.set()
        assert hold.wait(timeout=5)
        release.set()
        t_scan.join(timeout=15)
        t_retry.join(timeout=15)
>       assert install_calls == 1
E       assert 2 == 1

tests/test_plugin_install.py:471: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-5UqRjs/02-retry-scan-race-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_plugin_install.py::test_retry_and_scan_race_single_install
============================== 1 failed in 1.30s ===============================
```

### 03-retry-hash-mismatch

```
tests/test_plugin_install.py F                                           [100%]

=================================== FAILURES ===================================
_________ test_retry_zip_hash_mismatch_returns_409_without_installing __________

        v2_sha = pz.plugin_sha256(Path(tmp_v2))
        Path(tmp_v2).unlink(missing_ok=True)
        set_start_runtime_hook(lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("nope")))
        with pytest.raises(InstallStartFailedError):
            plugin_local.install_local_zip(v2, overwrite=True)
        dest = paths.plugin_local_dir() / f"{pid}.zip"
    
        info = plugin_local.retry_blocked_zip_install(v2_sha, activate=False)
        assert info.get("retryResult") == RETRY_RESULT_ZIP_CHANGED
>       assert info.get("error") == "zip_hash_mismatch"
E       AssertionError: assert 'zip_not_found' == 'zip_hash_mismatch'
E         
E         - zip_hash_mismatch
E         + zip_not_found

tests/test_plugin_install.py:397: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-5UqRjs/03-retry-hash-mismatch-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_plugin_install.py::test_retry_zip_hash_mismatch_returns_409_without_installing
============================== 1 failed in 0.73s ===============================
```

### 04-retry-csrf

```
tests/test_plugin_local_retry_access.py F                                [100%]

=================================== FAILURES ===================================
___________ RetryBlockedZipAccessTest.test_retry_post_requires_csrf ____________

            json={"sha256": "deadbeef"},
        )
>       assert resp.status == 403
E       AssertionError: assert 404 == 403
E        +  where 404 = <ClientResponse(http://127.0.0.1:40603/api/ai/plugin/local/blocked/retry) [404 Not Found]>\n<CIMultiDictProxy('Content-... HttpOnly; Path=/; SameSite=Strict', 'Date': 'Sat, 26 Sep 2026 22:57:27 GMT', 'Server': 'Python/3.12 aiohttp/3.14.3')>\n.status

tests/test_plugin_local_retry_access.py:29: AssertionError
----------------------------- Captured stdout call -----------------------------
[monitor] POST /api/ai/plugin/local/blocked/retry -> 404
- generated xml file: /tmp/revert-proof-artifacts-5UqRjs/04-retry-csrf-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_plugin_local_retry_access.py::RetryBlockedZipAccessTest::test_retry_post_requires_csrf
======================== 1 failed, 4 warnings in 0.04s =========================
```

### 05-concurrency-20

```
tests/test_plugin_install.py F                                           [100%]

=================================== FAILURES ===================================
___________________ test_concurrent_install_passes_20_of_20 ____________________

            first_in_hook = threading.Event()
            release_hook = threading.Event()
            errors: list[BaseException] = []
    
            def after_first_rename() -> None:
            )
            t1.start()
>           assert first_in_hook.wait(timeout=5)
E           assert False
E            +  where False = wait(timeout=5)
E            +    where wait = <threading.Event at 0x7f50a9862cf0: unset>.wait

tests/test_plugin_install.py:601: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-5UqRjs/05-concurrency-20-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_plugin_install.py::test_concurrent_install_passes_20_of_20
============================== 1 failed in 5.45s ===============================
```

### 06-symlink

```
tests/test_plugin_install.py F                                           [100%]

=================================== FAILURES ===================================
________________ test_symlink_zip_rejected_via_install_pipeline ________________

        yml = "id: sym-test\nname: Sym\nversion: 1\nengine: graph\nbase: topology\n"
        raw = _zip_with_symlink(yml, "link.ts", "../escape.ts")
>       with pytest.raises(ValueError, match="symlink"):
E       Failed: DID NOT RAISE ValueError

tests/test_plugin_install.py:672: Failed
- generated xml file: /tmp/revert-proof-artifacts-5UqRjs/06-symlink-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_plugin_install.py::test_symlink_zip_rejected_via_install_pipeline
============================== 1 failed in 0.12s ===============================
```

### 07-zip-slip

```
tests/test_plugin_install.py F                                           [100%]

=================================== FAILURES ===================================
_______________________ test_zip_slip_rejected_on_unpack _______________________

        dest = tmp_path / "out"
        dest.mkdir()
>       with pytest.raises(ValueError, match="illegal zip path"):
E       Failed: DID NOT RAISE ValueError

tests/test_plugin_install.py:659: Failed
- generated xml file: /tmp/revert-proof-artifacts-5UqRjs/07-zip-slip-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_plugin_install.py::test_zip_slip_rejected_on_unpack - Faile...
============================== 1 failed in 0.07s ===============================
```

### 08-interrupted-swap

```
tests/test_plugin_install.py F                                           [100%]

=================================== FAILURES ===================================
______________ test_interrupted_swap_uses_after_first_rename_hook ______________

            nonlocal hook_calls
            hook_calls += 1
            raise RuntimeError("simulated kill between renames")
    
        dest = paths.plugin_local_dir() / f"{pid}.zip"
        try:
            set_after_first_rename(after_first_rename)
            with pytest.raises(RuntimeError, match="simulated kill between renames"):
                install_zip_to_runtime(
                    tmp_path_zip,
            tmp_path_zip.unlink(missing_ok=True)
    
        assert hook_calls == 1
        bak = runtime.parent / f"{pid}.bak"
        assert bak.is_dir()
        assert not runtime.exists()
        assert pz.plugin_sha256(dest) == zip_v1_sha
    
        from service.pack_install_catalog import peek_catalog_records
    
        msgs = recover_interrupted_swaps(runtime.parent)
>       assert len(msgs) == 1
E       assert 0 == 1
E        +  where 0 = len([])

tests/test_plugin_install.py:235: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-5UqRjs/08-interrupted-swap-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_plugin_install.py::test_interrupted_swap_uses_after_first_rename_hook
============================== 1 failed in 0.71s ===============================
```

### 09-startup-recovery

```
tests/test_plugin_install.py F                                           [100%]

=================================== FAILURES ===================================
_________________ test_startup_recovery_runs_in_fresh_process __________________

        out = subprocess.check_output([sys.executable, "-c", script], env=env, text=True)
        payload = __import__("json").loads(out)
>       assert payload["msgs"]
E       assert []

tests/test_plugin_install.py:775: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-5UqRjs/09-startup-recovery-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_plugin_install.py::test_startup_recovery_runs_in_fresh_process
============================== 1 failed in 0.51s ===============================
```

### 10-unchanged-zip-skip

```
tests/test_plugin_install.py F                                           [100%]

=================================== FAILURES ===================================
______________ test_unchanged_zip_skips_reinstall_on_three_scans _______________

        for _ in range(3):
            plugin_local.sync_local_drop()
>       assert swaps == 0
E       assert 1 == 0

tests/test_plugin_install.py:710: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-5UqRjs/10-unchanged-zip-skip-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_plugin_install.py::test_unchanged_zip_skips_reinstall_on_three_scans
============================== 1 failed in 0.74s ===============================
```

### 11-two-rescan

```
tests/test_plugin_install.py F                                           [100%]

=================================== FAILURES ===================================
_____________ test_start_failed_zip_hash_blocks_rescan_notice_once _____________

tmp_path = PosixPath('/tmp/pytest-of-ubuntu/pytest-479/test_start_failed_zip_hash_blo0')
monkeypatch = <_pytest.monkeypatch.MonkeyPatch object at 0x7f04b687faa0>
_isolate_plugin_local = PosixPath('/tmp/pytest-of-ubuntu/pytest-479/plugin-local0/local')

    def test_start_failed_zip_hash_blocks_rescan_notice_once(
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        v2_sha = pz.plugin_sha256(Path(tmp_v2))
        Path(tmp_v2).unlink(missing_ok=True)
        set_start_runtime_hook(lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("nope")))
        with pytest.raises(InstallStartFailedError):
            plugin_local.install_local_zip(v2, overwrite=True)
>       assert zip_block_for_sha(v2_sha) is not None
E       AssertionError: assert None is not None
E        +  where None = <function zip_block_for_sha at 0x7f04b68a40e0>('a3fa86d1743a2c7c9b794bf2ee36ea236f80fae263b2e2a06aa3c9df737af2bd')

tests/test_plugin_install.py:299: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-5UqRjs/11-two-rescan-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_plugin_install.py::test_start_failed_zip_hash_blocks_rescan_notice_once
============================== 1 failed in 0.70s ===============================
```

### 13-boundary-host-escape

```
tests/test_pack_bundle_boundary.py F                                     [100%]

=================================== FAILURES ===================================
_ test_install_local_zip_blocks_bad_bundle[host-escape-pack-boundary-host-escape] _

        raw = _zip_tree(_pack_fixture(fixture))
        info = plugin_local.publish_local({"zip_b64": base64.b64encode(raw).decode(), "activate": True})
        assert info["ok"] is False
        assert info.get("error") == "pack_boundary"
        assert "was blocked" in info.get("message", "")
        assert "Nothing was installed" in info.get("message", "")
        assert pack_id not in {p["id"] for p in plugins.scan()["plugins"]}
        assert not (paths.plugin_local_dir() / f"{pack_id}.zip").is_file()
        runtime = paths.plugin_local_runtime_dir() / pack_id
>       assert not runtime.exists()
E       AssertionError: assert not True
E        +  where True = exists()
E        +    where exists = PosixPath('/tmp/pytest-of-ubuntu/pytest-481/plugin-local0/local/.runtime/pack-boundary-host-escape').exists

tests/test_pack_bundle_boundary.py:65: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-5UqRjs/13-boundary-host-escape-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_bundle_boundary.py::test_install_local_zip_blocks_bad_bundle[host-escape-pack-boundary-host-escape]
============================== 1 failed in 0.18s ===============================
```

### 14-boundary-json-escape

```
tests/test_pack_bundle_boundary.py F                                     [100%]

=================================== FAILURES ===================================
_ test_install_local_zip_blocks_bad_bundle[json-escape-pack-boundary-json-escape] _

        raw = _zip_tree(_pack_fixture(fixture))
        info = plugin_local.publish_local({"zip_b64": base64.b64encode(raw).decode(), "activate": True})
        assert info["ok"] is False
        assert info.get("error") == "pack_boundary"
        assert "was blocked" in info.get("message", "")
        assert "Nothing was installed" in info.get("message", "")
        assert pack_id not in {p["id"] for p in plugins.scan()["plugins"]}
        assert not (paths.plugin_local_dir() / f"{pack_id}.zip").is_file()
        runtime = paths.plugin_local_runtime_dir() / pack_id
>       assert not runtime.exists()
E       AssertionError: assert not True
E        +  where True = exists()
E        +    where exists = PosixPath('/tmp/pytest-of-ubuntu/pytest-483/plugin-local0/local/.runtime/pack-boundary-json-escape').exists

tests/test_pack_bundle_boundary.py:65: AssertionError
- generated xml file: /tmp/revert-proof-artifacts-5UqRjs/14-boundary-json-escape-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_bundle_boundary.py::test_install_local_zip_blocks_bad_bundle[json-escape-pack-boundary-json-escape]
============================== 1 failed in 0.17s ===============================
```

### 15-host-escape-lint

```
tests/test_plugin_install.py F                                           [100%]

=================================== FAILURES ===================================
________________ test_host_escape_still_blocked_via_bundle_lint ________________

        plugins.reset_bundles()
        raw = _zip_tree(_pack_fixture("host-escape"))
        from service.pack_boundary import PackBundleBoundaryError
    
>       with pytest.raises((PackBundleBoundaryError, InstallV2BlockedError, ValueError)):
E       Failed: DID NOT RAISE any of (PackBundleBoundaryError, InstallV2BlockedError, ValueError)

tests/test_plugin_install.py:726: Failed
- generated xml file: /tmp/revert-proof-artifacts-5UqRjs/15-host-escape-lint-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_plugin_install.py::test_host_escape_still_blocked_via_bundle_lint
============================== 1 failed in 0.12s ===============================
```

### 16-sdk-contract

```
tests/test_plugin_install.py F                                           [100%]

=================================== FAILURES ===================================
__________________ test_sdk_contract_still_checked_on_install __________________

        _repo(tmp_path, monkeypatch)
        plugins.reset_bundles()
        err = psc.catalog_sdk_contract_error("x.zip", {"id": "x", "name": "X"}, 0, 99)
        monkeypatch.setattr(
            "service.plugin_install.assert_pack_sdk_compatible",
            lambda *_a, **_k: err,
        )
        raw = _zip_tree(_pack_fixture("upgrade-probe"))
>       with pytest.raises(ValueError, match="zoto-viz"):
E       Failed: DID NOT RAISE ValueError

tests/test_plugin_install.py:745: Failed
- generated xml file: /tmp/revert-proof-artifacts-5UqRjs/16-sdk-contract-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_plugin_install.py::test_sdk_contract_still_checked_on_install
============================== 1 failed in 0.44s ===============================
```

### 17-retry-ux-in-flight

```
AssertionError: expected { disabled: false, label: 'Retry' } to deeply equal { disabled: true, label: 'Retrying…' }
    at /tmp/revert-proof-wt-workspace-449519/web/src/plugins/pack-install-retry.test.ts:57:39
    at file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```

### 18-retry-ux-start-failed

```
AssertionError: expected 'Upgrade probe v2 couldn\'t start, so …' to be 'Upgrade probe v2 still couldn\'t star…' // Object.is equality
    at /tmp/revert-proof-wt-workspace-449519/web/src/plugins/pack-install-retry.test.ts:76:48
    at file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```

### 19-retry-ux-zip-changed

```
AssertionError: expected 'Upgrade probe v2 couldn\'t start, so …' to be 'Upgrade probe has changed since it wa…' // Object.is equality
    at /tmp/revert-proof-wt-workspace-449519/web/src/plugins/pack-install-retry.test.ts:91:70
    at file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```

### 20-retry-ux-success

```
AssertionError: expected [ { …(11) } ] to have a length of +0 but got 1
    at Proxy.<anonymous> (file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/index.OVGXnVRj.js:2137:20)
    at Proxy.<anonymous> (file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/index.OVGXnVRj.js:1934:14)
    at Proxy.methodWrapper (file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/chai@6.2.2/node_modules/chai/index.js:1700:25)
    at /tmp/revert-proof-wt-workspace-449519/web/src/plugins/pack-install-retry.test.ts:104:37
    at file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-449519/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
```

### 21-retry-api-outcomes

```
tests/test_plugin_local_retry_outcomes.py F                              [100%]

=================================== FAILURES ===================================
_ RetryBlockedZipOutcomesTest.test_maps_retry_result_to_status_without_parsing_message _

        cases = [
            ({"ok": True, "retryResult": RETRY_RESULT_SUCCESS}, 200),
            ({"ok": False, "retryResult": RETRY_RESULT_START_FAILED, "error": "pack_install_start_failed"}, 400),
            ({"ok": False, "retryResult": RETRY_RESULT_ZIP_CHANGED, "error": "zip_hash_mismatch"}, 409),
            ({"ok": False, "retryResult": RETRY_RESULT_IN_PROGRESS, "error": "retry_in_progress"}, 409),
            ({"ok": False, "retryResult": RETRY_RESULT_NOT_BLOCKED, "error": "not_blocked"}, 404),
        ]
        for info, want in cases:
>           assert plugin_local.retry_blocked_zip_http_status(info) == want
E           AssertionError: assert 200 == 400
E            +  where 200 = <function retry_blocked_zip_http_status at 0x7f9828b9f1a0>({'ok': False, 'retryResult': 'start_failed', 'error': 'pack_install_start_failed'})
E            +    where <function retry_blocked_zip_http_status at 0x7f9828b9f1a0> = plugin_local.retry_blocked_zip_http_status

tests/test_plugin_local_retry_outcomes.py:50: AssertionError
=============================== warnings summary ===============================
tests/test_plugin_local_retry_outcomes.py:29
- generated xml file: /tmp/revert-proof-artifacts-5UqRjs/21-retry-api-outcomes-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_plugin_local_retry_outcomes.py::RetryBlockedZipOutcomesTest::test_maps_retry_result_to_status_without_parsing_message
======================== 1 failed, 4 warnings in 0.03s =========================
```
