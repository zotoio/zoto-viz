## Revert proof

Recorded at HEAD `6fc1a91635b18317d90a31a4c5b7aeedb8008b04`.

`node scripts/revert-proof.mjs 139 --prove` at that commit: **baseline GREEN** (each targeted test passes on HEAD), **patched RED** (each `.patch` reverted, test fails as below).

| row | test | revert description | baseline | patched |
| --- | --- | --- | --- | --- |
| data-source-no-executable-layers | `tests/test_data_source_plugin.py::test_data_source_rejects_frontend` | Drop frontend guard in `check_data_source_semantics` | pass | fail `assert blocked is True` |
| partition-skips-data-source | `remix-partition.test.ts` | Remove data-source skip in `partitionCatalog` | pass | fail `expected true to be false` |
| remix-snapshot-demo-flag | `remix-snapshot.test.ts` | Remove `demo: true` from remix frame merge | pass | fail `expected undefined to be true` |

Command table (from `--prove`):


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

### partition-skips-data-source

```
AssertionError: expected true to be false // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```

### remix-snapshot-demo-flag

```
AssertionError: expected undefined to be true // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```
