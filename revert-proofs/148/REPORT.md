## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| mosaic-16-allowed | tests/test_pack_wall_layout.py :: test_wall_layout_rejects_unknown_mosaic_with_exact_message | Revert row: allow mosaic 16 in pack_wall_layout ALLOWED_MOSAIC_SIZES | python3 -m pytest --no-cov -p no:cacheprovider -p revert_proof_pytest_plugin tests/test_pack_wall_layout.py::test_wall_layout_rejects_unknown_mosaic_with_exact_message | RED (expected) |

### mosaic-16-allowed

```
tests/test_pack_wall_layout.py F                                         [100%]

=================================== FAILURES ===================================
__________ test_wall_layout_rejects_unknown_mosaic_with_exact_message __________

    def test_wall_layout_rejects_unknown_mosaic_with_exact_message() -> None:
        doc = yaml.safe_load(FIXTURE.read_text(encoding="utf-8"))
        msg = wall_layout_mosaic_error("tests/fixtures/wall-layout/bad-mosaic-16.yml tile_4x4.look", "16")
        err = ""
        raised = False
        try:
            validate_wall_layout_doc(doc, rel_path="tests/fixtures/wall-layout/bad-mosaic-16.yml")
        except ValueError as exc:
            raised = True
            err = str(exc)
>       assert raised and err == msg
E       assert (False)

tests/test_pack_wall_layout.py:36: AssertionError
=========================== short test summary info ============================
FAILED tests/test_pack_wall_layout.py::test_wall_layout_rejects_unknown_mosaic_with_exact_message
============================== 1 failed in 0.03s ===============================
```
