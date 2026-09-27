## Revert proof (PR #60)

**Proven code commit:** `9083064d59a9c2b2244c7d9839012c266481a6a4`  
**Proven tree:** `ac5b453742052011954f4b7be82d8d8799c6e20d`

Patches apply at zero offset; unpatched node passes; patched node fails with the sidecar `patchedFailure` line.

| row | test | revert description | result |
| --- | --- | --- | --- |
| 01-legacy-zoto-allowlist | `src/plugins/pack-lint.test.ts` :: pack lint guardrails > off-allowlist inline zoto declare fails disallowedLegacyZoto guard | disallowedLegacyZoto blocks declare const zoto off allowlist | RED (expected) |
| 02-pack-id-hyphen-slug | `tests/test_plugin_id_pattern.py::test_schema_rejects_nonconforming_plugin_ids[bad_underscore]` | Hyphen-only pack id schema (no `_` in slug) | RED: `AssertionError: DID NOT RAISE ValueError` |
| 03-plugin-sky-swiftshader-launch | `src/plugins/plugin-sky-smoke-render.test.ts` :: plugin sky smoke render > plugin sky smoke browser launch opts in SwiftShader for GPU-less CI | `ignoreDefaultArgs: ['--disable-software-rasterizer']` + SwiftShader args on `chromium.launch` | RED: `AssertionError: expected { headless: true, args: [ …(5) ] } to deeply equal { headless: true, …(2) }` |
| 12-talker-slots | `src/plugins/starter-template.test.ts` :: pack starter template > talker slots stay stable across reorder | Talker slot assignment ignores reorder | RED (expected) |

### Non-regression (proven commit)

| suite | result |
| --- | --- |
| `python3 -m pytest -o addopts=` (uv 3.12 venv, systemd-inhibit shim on PATH) | 442 passed, **1 failed**: `tests/test_cursor_harness.py::test_node_harness_session_and_tools` |
| `pnpm exec vitest run` (`web/`) | 777 passed, 0 failed, 3 skipped |
| `starter-pack-ci.test.ts` + `plugin-sky-smoke-render.test.ts` | 9/9 passed |

### 01-legacy-zoto-allowlist

```
AssertionError: expected 0 to be greater than 0
    at web/src/plugins/pack-lint.test.ts:317:41
```

### 12-talker-slots

```
AssertionError: expected [] to deeply equal [ 'a', 'b' ]
    at web/src/plugins/starter-template.test.ts:43:44
```
