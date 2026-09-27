## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| cpu-pong-restore | tests/test_shipped_pack_slug_collision.py :: test_no_shipped_pack_slug_collisions_on_disk | Revert row: restore plugins/src/cpu-pong/ duplicate tree | python3 -m pytest --no-cov -p no:cacheprovider -p revert_proof_pytest_plugin tests/test_shipped_pack_slug_collision.py::test_no_shipped_pack_slug_collisions_on_disk | RED (expected) |

### cpu-pong-restore

```
tests/test_shipped_pack_slug_collision.py F                              [100%]

=================================== FAILURES ===================================
_________________ test_no_shipped_pack_slug_collisions_on_disk _________________

    def test_no_shipped_pack_slug_collisions_on_disk() -> None:
>       assert find_shipped_pack_slug_collisions(SRC) == []
E       AssertionError: assert [('cpu-pong', 'cpupong')] == []
E         
E         Left contains one more item: ('cpu-pong', 'cpupong')
E         Use -v to get more diff

tests/test_shipped_pack_slug_collision.py:20: AssertionError
=========================== short test summary info ============================
FAILED tests/test_shipped_pack_slug_collision.py::test_no_shipped_pack_slug_collisions_on_disk
============================== 1 failed in 0.03s ===============================
```
