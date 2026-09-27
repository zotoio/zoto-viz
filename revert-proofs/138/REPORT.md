## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| install-barrier-lock | tests/test_plugin_install.py :: test_concurrent_install_same_pack_serializes_with_barriers | Revert per-pack install lock singleton so concurrent installs are not serialized | python3 -m pytest --no-cov -p no:cacheprovider -p revert_proof_pytest_plugin tests/test_plugin_install.py::test_concurrent_install_same_pack_serializes_with_barriers | RED (expected) |
| install-race-retry-lock | tests/test_plugin_install.py :: test_retry_and_scan_race_single_install_20_of_20 | Revert retry_blocked_zip_install pack lock so scan+retry can double-install | python3 -m pytest --no-cov -p no:cacheprovider -p revert_proof_pytest_plugin tests/test_plugin_install.py::test_retry_and_scan_race_single_install_20_of_20 | RED (expected) |
| host-mesh-demo-engine | | | | **ERROR: row host-mesh-demo-engine: revert target unreachable from production: plugins/src/host-mesh-demo/visualisation.yml** |
| renderer-dpr-hmr | | | | **ERROR: row renderer-dpr-hmr: revert target unreachable from production: web/src/graph/pack-mirror-readback-vite-server.ts** |
| starter-pack-starter-sim | | | | **ERROR: row starter-pack-starter-sim: revert target unreachable from production: plugins/sdk/starter/frontend/sim.ts** |

### install-barrier-lock

```
tests/test_plugin_install.py F                                           [100%]

=================================== FAILURES ===================================
__________ test_concurrent_install_same_pack_serializes_with_barriers __________

        release_hook = threading.Event()
        second_started = threading.Event()
        errors: list[BaseException] = []
    
        v2 = _bump_pack(tmp_path, 2)
                order.append(f"done-{label}")
            except BaseException as e:
                errors.append(e)
    
        monkeypatch.setattr("service.plugin_install._after_first_rename", after_first_rename)
        t2 = threading.Thread(target=install_thread, args=("second", v3), daemon=True)
        t1.start()
        assert first_in_hook.wait(timeout=5)
>       assert not pack_install_lock(pid).acquire(blocking=False)
E       AssertionError: assert not True
E        +  where True = <built-in method acquire of _thread.lock object at 0x7f0efd0c8980>(blocking=False)
E        +    where <built-in method acquire of _thread.lock object at 0x7f0efd0c8980> = <locked _thread.lock object at 0x7f0efd0c8980>.acquire
E        +      where <locked _thread.lock object at 0x7f0efd0c8980> = pack_install_lock('upgrade-probe')

tests/test_plugin_install.py:677: AssertionError
=========================== short test summary info ============================
FAILED tests/test_plugin_install.py::test_concurrent_install_same_pack_serializes_with_barriers
============================== 1 failed in 0.34s ===============================
```

### install-race-retry-lock

```
tests/test_plugin_install.py F                                           [100%]

=================================== FAILURES ===================================
_______________ test_retry_and_scan_race_single_install_20_of_20 _______________

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

tests/test_plugin_install.py:586: AssertionError
=============================== warnings summary ===============================
tests/test_plugin_install.py::test_retry_and_scan_race_single_install_20_of_20
    File "<tmp> line 918, in retry_blocked_zip_install
      lock.release()
  RuntimeError: release unlocked lock
  
  Enable tracemalloc to get traceback where the object was allocated.
-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
=========================== short test summary info ============================
FAILED tests/test_plugin_install.py::test_retry_and_scan_race_single_install_20_of_20
========================= 1 failed, 1 warning in 0.44s =========================
```
