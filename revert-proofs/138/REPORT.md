## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| install-barrier-lock | tests/test_plugin_install.py :: test_concurrent_install_same_pack_serializes_with_barriers | Revert per-pack install lock singleton so concurrent installs are not serialized | python3 -m pytest --no-cov -p no:cacheprovider -p revert_proof_pytest_plugin tests/test_plugin_install.py::test_concurrent_install_same_pack_serializes_with_barriers | RED (expected) |
| host-mesh-demo-engine | | | | **ERROR: row host-mesh-demo-engine: baseline test selection failed (target not found; never a pass) --- baseline output --- failed to load config from <tmp>  ⎯⎯⎯⎯⎯⎯⎯ Startup Error ⎯⎯⎯⎯⎯⎯⎯⎯ TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts" for <tmp>     at Object.getFileProtocolModuleFormat [as file:] (node:internal/modules/esm/get_format:219:9)     at defaultGetFormat (node:internal/modules/esm/get_format:245:36)     at defaultLoad (node:internal/modules/esm/load:120:22)     at async ModuleLoader.loadAndTranslate (node:internal/modules/esm/loader:514:32)     at async ModuleJob._link (node:internal/modules/esm/module_job:115:19) {   code: 'ERR_UNKNOWN_FILE_EXTENSION' }** |
| install-race-retry-lock | | | | **ERROR: row install-race-retry-lock: red line mismatch (expected "assert 2 == 1", got "assert install_calls == 1")** |
| renderer-dpr-hmr | | | | **ERROR: row renderer-dpr-hmr: baseline test selection failed (target not found; never a pass) --- baseline output --- failed to load config from <tmp>  ⎯⎯⎯⎯⎯⎯⎯ Startup Error ⎯⎯⎯⎯⎯⎯⎯⎯ TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts" for <tmp>     at Object.getFileProtocolModuleFormat [as file:] (node:internal/modules/esm/get_format:219:9)     at defaultGetFormat (node:internal/modules/esm/get_format:245:36)     at defaultLoad (node:internal/modules/esm/load:120:22)     at async ModuleLoader.loadAndTranslate (node:internal/modules/esm/loader:514:32)     at async ModuleJob._link (node:internal/modules/esm/module_job:115:19) {   code: 'ERR_UNKNOWN_FILE_EXTENSION' }** |
| starter-pack-starter-sim | | | | **ERROR: row starter-pack-starter-sim: revert target unreachable from production: plugins/sdk/pack-lint.ts** |

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
E        +  where True = <built-in method acquire of _thread.lock object at 0x7f92975cff00>(blocking=False)
E        +    where <built-in method acquire of _thread.lock object at 0x7f92975cff00> = <locked _thread.lock object at 0x7f92975cff00>.acquire
E        +      where <locked _thread.lock object at 0x7f92975cff00> = pack_install_lock('upgrade-probe')

tests/test_plugin_install.py:677: AssertionError
=========================== short test summary info ============================
FAILED tests/test_plugin_install.py::test_concurrent_install_same_pack_serializes_with_barriers
============================== 1 failed in 0.34s ===============================
```
