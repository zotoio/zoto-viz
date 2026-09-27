## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| data-source-no-executable-layers | tests/test_data_source_plugin.py :: test_data_source_rejects_frontend | Revert blocking executable layers on data-source plugin manifests | python3 -m pytest --no-cov -p no:cacheprovider -p revert_proof_pytest_plugin tests/test_data_source_plugin.py::test_data_source_rejects_frontend | RED (expected) |
| partition-skips-data-source | | | | **ERROR: row partition-skips-data-source: baseline test selection failed (target not found; never a pass) --- baseline output --- failed to load config from <tmp>  ⎯⎯⎯⎯⎯⎯⎯ Startup Error ⎯⎯⎯⎯⎯⎯⎯⎯ TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts" for <tmp>     at Object.getFileProtocolModuleFormat [as file:] (node:internal/modules/esm/get_format:219:9)     at defaultGetFormat (node:internal/modules/esm/get_format:245:36)     at defaultLoad (node:internal/modules/esm/load:120:22)     at async ModuleLoader.loadAndTranslate (node:internal/modules/esm/loader:514:32)     at async ModuleJob._link (node:internal/modules/esm/module_job:115:19) {   code: 'ERR_UNKNOWN_FILE_EXTENSION' }** |
| remix-snapshot-demo-flag | | | | **ERROR: row remix-snapshot-demo-flag: baseline test selection failed (target not found; never a pass) --- baseline output --- failed to load config from <tmp>  ⎯⎯⎯⎯⎯⎯⎯ Startup Error ⎯⎯⎯⎯⎯⎯⎯⎯ TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts" for <tmp>     at Object.getFileProtocolModuleFormat [as file:] (node:internal/modules/esm/get_format:219:9)     at defaultGetFormat (node:internal/modules/esm/get_format:245:36)     at defaultLoad (node:internal/modules/esm/load:120:22)     at async ModuleLoader.loadAndTranslate (node:internal/modules/esm/loader:514:32)     at async ModuleJob._link (node:internal/modules/esm/module_job:115:19) {   code: 'ERR_UNKNOWN_FILE_EXTENSION' }** |

### data-source-no-executable-layers

```
tests/test_data_source_plugin.py F                                       [100%]

=================================== FAILURES ===================================
______________________ test_data_source_rejects_frontend _______________________

                },
            })
        except ValueError as e:
            blocked = "frontend" in str(e)
>       assert blocked is True
E       assert False is True

tests/test_data_source_plugin.py:86: AssertionError
=========================== short test summary info ============================
FAILED tests/test_data_source_plugin.py::test_data_source_rejects_frontend - ...
============================== 1 failed in 0.09s ===============================
```
