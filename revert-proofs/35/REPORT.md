## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| 23-block-record-atomic-write | tests/test_pack_zip_blocks.py :: test_block_write_crash_before_rename_keeps_prior_record | Per-pack block records must be atomically replaced so a crash before rename keeps the prior record. | python -m pytest tests/test_pack_zip_blocks.py::test_block_write_crash_before_rename_keeps_prior_record | RED (expected) |

### 23-block-record-atomic-write

```
tests/test_pack_zip_blocks.py F
ERROR: Coverage failure: total of 16 is less than fail-under=80
                                                                         [100%]

=================================== FAILURES ===================================
___________ test_block_write_crash_before_rename_keeps_prior_record ____________

        record_zip_block(
            sha_v1,
            row_for_start_failure(
                sha256=sha_v1,
                message="v2 couldn't start",
    
        def crash() -> None:
            raise RuntimeError("simulated crash before rename")
    
        set_after_block_write_before_replace(crash)
>       with pytest.raises(RuntimeError, match="simulated crash"):
E       Failed: DID NOT RAISE RuntimeError

tests/test_pack_zip_blocks.py:119: Failed
- generated xml file: /tmp/revert-proof-artifacts-UUDT6Q/23-block-record-atomic-write-patched-pytest.xml -
================================ tests coverage ================================
--------------------------------------------------
TOTAL                 1229   1038    16%
FAIL Required test coverage of 80% not reached. Total coverage: 15.54%
=========================== short test summary info ============================
FAILED tests/test_pack_zip_blocks.py::test_block_write_crash_before_rename_keeps_prior_record
============================== 1 failed in 0.16s ===============================
/home/ubuntu/.local/lib/python3.12/site-packages/coverage/inorout.py:558: CoverageWarning: Module service.agent was never imported. (module-not-imported); see https://coverage.readthedocs.io/en/7.16.1/messages.html#warning-module-not-imported
  self.warn(f"Module {pkg} was never imported.", slug="module-not-imported")
```
