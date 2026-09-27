## Revert proof (PR #56)

| row | test | revert description | patched result |
| --- | --- | --- | --- |
| 13-pack-id-lowercase | `tests/test_plugin_id_pattern.py::test_schema_rejects_uppercase_plugin_id` | Top-level `properties.id.pattern` must stay lowercase-only. | RED |

### 13-pack-id-lowercase

```
FAILED tests/test_plugin_id_pattern.py::test_schema_rejects_uppercase_plugin_id - Failed: DID NOT RAISE ValueError
```
