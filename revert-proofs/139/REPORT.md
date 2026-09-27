## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| data-source-no-executable-layers | tests/test_data_source_plugin.py :: test_data_source_rejects_frontend | Revert blocking executable layers on data-source plugin manifests | python3 -m pytest --no-cov -p no:cacheprovider -p revert_proof_pytest_plugin tests/test_data_source_plugin.py::test_data_source_rejects_frontend | RED (expected) |
| partition-skips-data-source | | | | **ERROR: row partition-skips-data-source: baseline test selection failed (target not found; never a pass) --- baseline output --- JSON report written to <tmp>** |
| remix-snapshot-demo-flag | | | | **ERROR: row remix-snapshot-demo-flag: baseline test selection failed (target not found; never a pass) --- baseline output --- JSON report written to <tmp>** |

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
============================== 1 failed in 0.10s ===============================
```
